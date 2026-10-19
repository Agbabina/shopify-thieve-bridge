import {
  Controller,
  Get,
  Post,
  Query,
  Res,
  Req,
  Body,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { ShopifyOAuthService } from './shopify-oauth.service';
import { ShopifyStoresService } from './shopify-stores.service';
import { OrdersService } from './orders.service';
import type { RawBodyRequest } from '@nestjs/common';

@Controller('api/shopify')
export class ShopifyController {
  constructor(
    private readonly shopifyOAuth: ShopifyOAuthService,
    private readonly shopifyStores: ShopifyStoresService,
    private readonly ordersService: OrdersService,
  ) {}

  @Get('install')
  install(@Query('shop') shop: string, @Res() res: Response) {
    if (!shop || !shop.endsWith('.myshopify.com')) {
      throw new BadRequestException(
        'Valid shop domain required, e.g. mystore.myshopify.com',
      );
    }

    const installUrl = this.shopifyOAuth.buildInstallUrl(shop);
    return res.redirect(installUrl);
  }

  @Get('callback')
  async callback(@Query() query: Record<string, string>, @Res() res: Response) {
    const { shop, code, hmac } = query;
    if (!shop || !code || !hmac) {
      throw new BadRequestException('Missing required OAuth params');
    }

    const isValid = this.shopifyOAuth.verifyHmac(query);
    if (!isValid) {
      throw new BadRequestException('HMAC validation failed');
    }

    const tokenData = await this.shopifyOAuth.exchangeCodeForToken(shop, code);

    await this.shopifyStores.upsertStore(
      shop,
      tokenData.access_token,
      null,
      undefined,
      tokenData.scope,
    );

    try {
      await this.shopifyOAuth.registerOrderWebhook(
        shop,
        tokenData.access_token,
      );
    } catch (webhookError) {
      console.warn('Webhook registration failed:', webhookError);
    }

    return res.json({
      message: 'Store saved successfully',
      shop,
      scope: tokenData.scope,
    });
  }

  @Post('orders')
  async createOrder(
    @Body()
    body: {
      shopifyOrderId?: string;
      customerName?: string;
      customerEmail?: string;
      total?: number;
      status?: string;
      shop: string;
    },
  ) {
    return this.ordersService.create({
      shopifyOrderId: body.shopifyOrderId ?? '',
      customerName: body.customerName ?? 'Guest',
      customerEmail: body.customerEmail ?? '',
      total: body.total ?? 0,
      status: body.status ?? 'pending',
      shop: body.shop,
    });
  }

  @Post('webhooks/orders-create')
  async handleOrderCreated(@Req() req: RawBodyRequest<Request>) {
    const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string;

    if (!req.rawBody) {
      throw new BadRequestException('Missing raw body');
    }

    // TEMP: HMAC bypassed for testing — re-enable before production
    const isValid = this.shopifyOAuth.verifyWebhookHmac(
      req.rawBody,
      hmacHeader,
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const shopDomain = req.headers['x-shopify-shop-domain'] as string;
    console.log('Webhook shop domain received:', shopDomain);
    console.log('All headers:', JSON.stringify(req.headers, null, 2));

    const store = await this.shopifyStores.findByShop(shopDomain);

    if (!store) {
      console.log('Store not found for domain:', shopDomain);
      throw new BadRequestException('Store not found for this webhook');
    }

    const payload = JSON.parse(req.rawBody.toString());
    await this.ordersService.saveFromWebhook(payload, store);

    return { received: true };
  }
}
