import {
  BadRequestException, Controller, Get, Post, Query, Res, Req, UnauthorizedException,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import type { RawBodyRequest } from '@nestjs/common';
import * as crypto from 'crypto';
import { ShopifyOAuthService } from './shopify-oauth.service';
import { ShopifyStoresService } from './shopify-stores.service';
import { OrdersService } from './orders.service';
import { WebhookEventsService } from './webhook-events.service';
import { normalizeShopDomain } from './shop-domain';

@Controller('api/shopify')
export class ShopifyController {
  constructor(
    private readonly shopifyOAuth: ShopifyOAuthService,
    private readonly shopifyStores: ShopifyStoresService,
    private readonly ordersService: OrdersService,
    private readonly webhookEvents: WebhookEventsService,
  ) {}

  @Get('install')
  install(@Query('shop') shop: string, @Res() res: Response) {
    const domain = normalizeShopDomain(shop);
    const state = this.shopifyOAuth.createOAuthState();
    res.cookie('shopify_oauth_state', state, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', maxAge: 5 * 60 * 1000, path: '/api/shopify/callback',
    });
    return res.redirect(this.shopifyOAuth.buildInstallUrl(domain, state));
  }

  @Get('callback')
  async callback(@Query() query: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const { shop, code, hmac, state } = query;
    if (!shop || !code || !hmac || !state) throw new BadRequestException('Missing required OAuth parameters');
    if (!this.shopifyOAuth.verifyHmac(query)) throw new UnauthorizedException('OAuth HMAC validation failed');
    const cookie = (req.headers.cookie ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith('shopify_oauth_state='));
    const savedState = cookie ? decodeURIComponent(cookie.slice('shopify_oauth_state='.length)) : '';
    const a = Buffer.from(state);
    const b = Buffer.from(savedState);
    if (!savedState || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new UnauthorizedException('OAuth state validation failed. Restart installation.');
    res.clearCookie('shopify_oauth_state', { path: '/api/shopify/callback' });

    const domain = normalizeShopDomain(shop);
    const tokenData = await this.shopifyOAuth.exchangeCodeForToken(domain, code);
    await this.shopifyStores.upsertStore(domain, tokenData.access_token, tokenData.refresh_token ?? null, tokenData.expires_in, tokenData.scope);
    const webhooks = await this.shopifyOAuth.registerWebhooks(domain, tokenData.access_token);
    return res.json({ message: 'Store connected', shop: domain, scope: tokenData.scope, webhooks });
  }

  @Post('webhooks/orders-create')
  async handleOrderCreated(@Req() req: RawBodyRequest<Request>) {
    return this.handleOrderWebhook(req, false);
  }

  @Post('webhooks/orders-paid')
  async handleOrderPaid(@Req() req: RawBodyRequest<Request>) {
    return this.handleOrderWebhook(req, true);
  }

  @Post('webhooks/fulfillments-create')
  async handleFulfillmentCreated(@Req() req: RawBodyRequest<Request>) {
    const event = await this.verifyAndLoadWebhook(req);
    if (await this.webhookEvents.wasProcessed(event.webhookId)) return { received: true, duplicate: true };
    await this.ordersService.applyFulfillmentWebhook(event.payload, event.store);
    await this.webhookEvents.markProcessed(event.webhookId, event.topic, event.store.shop);
    return { received: true };
  }

  private async handleOrderWebhook(req: RawBodyRequest<Request>, paid: boolean) {
    const event = await this.verifyAndLoadWebhook(req);
    if (await this.webhookEvents.wasProcessed(event.webhookId)) return { received: true, duplicate: true };
    await this.ordersService.saveFromWebhook(event.payload, event.store, paid);
    await this.webhookEvents.markProcessed(event.webhookId, event.topic, event.store.shop);
    return { received: true };
  }

  private async verifyAndLoadWebhook(req: RawBodyRequest<Request>) {
    if (!req.rawBody) throw new BadRequestException('Missing raw webhook body');
    const signature = req.headers['x-shopify-hmac-sha256'] as string;
    if (!this.shopifyOAuth.verifyWebhookHmac(req.rawBody, signature)) throw new UnauthorizedException('Invalid Shopify webhook signature');
    const shopHeader = req.headers['x-shopify-shop-domain'] as string;
    if (!shopHeader) throw new BadRequestException('Missing Shopify shop domain header');
    const webhookId = req.headers['x-shopify-webhook-id'] as string;
    if (!webhookId) throw new BadRequestException('Missing Shopify webhook ID header');
    const topic = req.headers['x-shopify-topic'] as string;
    if (!topic) throw new BadRequestException('Missing Shopify topic header');
    const shop = normalizeShopDomain(shopHeader);
    const store = await this.shopifyStores.findByShop(shop);
    if (!store) throw new BadRequestException('No connected store matches webhook shop domain');
    let payload: any;
    try { payload = JSON.parse(req.rawBody.toString('utf8')); }
    catch { throw new BadRequestException('Webhook body is not valid JSON'); }
    return { payload, store, webhookId, topic };
  }
}
