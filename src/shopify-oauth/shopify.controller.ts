import { Controller, Get, Query, Res, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { ShopifyOAuthService } from './shopify-oauth.service';

@Controller('api/shopify')
export class ShopifyController {
  constructor(private shopifyOAuth: ShopifyOAuthService) {}

  @Get('install')
  install(@Query('shop') shop: string, @Res() res: Response) {
    if (!shop || !shop.endsWith('.myshopify.com')) {
      throw new BadRequestException('Valid shop domain required, e.g. mystore.myshopify.com');
    }

    const installUrl = this.shopifyOAuth.buildInstallUrl(shop);
    return res.redirect(installUrl);
  }

  @Get('callback')
  async callback(
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    const { shop, code, hmac } = query;

    if (!shop || !code || !hmac) {
      throw new BadRequestException('Missing required OAuth params');
    }

    const isValid = this.shopifyOAuth.verifyHmac(query);
    if (!isValid) {
      throw new BadRequestException('HMAC validation failed');
    }

    const tokenData = await this.shopifyOAuth.exchangeCodeForToken(shop, code);

    // TODO next: save { shop, access_token: tokenData.access_token, scope: tokenData.scope }
    // into shopify_stores table, create/find a session, redirect to /dashboard.
    // Placeholder for now so you can see the token in the browser response:

    return res.json({
      message: 'OAuth successful — token exchange worked',
      shop,
      scope: tokenData.scope,
      access_token_preview: tokenData.access_token.slice(0, 8) + '...',
    });
  }
}