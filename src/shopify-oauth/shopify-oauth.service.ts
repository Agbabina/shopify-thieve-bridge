import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class ShopifyOAuthService {
  private readonly logger = new Logger(ShopifyOAuthService.name);

  constructor(private config: ConfigService) {}

  private getRequiredConfig(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new Error(`Missing required Shopify config: ${key}`);
    }
    return value;
  }

  getAuthUrl(
    shop: string,
    accessMode: 'offline',
  ): string {
    const apiKey = this.getRequiredConfig('SHOPIFY_API_KEY');
    const scopes = this.getRequiredConfig('SHOPIFY_SCOPES');
    const redirectUri = this.getRequiredConfig('SHOPIFY_REDIRECT_URL');
    const state = crypto.randomBytes(16).toString('hex');

    const query = new URLSearchParams({
      client_id: apiKey,
      scope: scopes,
      redirect_uri: redirectUri,
      state,
    });


    const authUrl = `https://${shop}/admin/oauth/authorize?${query.toString()}`;
    this.logger.debug(`Generated OAuth URL (${accessMode}): ${authUrl}`);
    return authUrl;
  }

  buildInstallUrl(shop: string): string {
    return this.getAuthUrl(shop, 'offline');
  }

  verifyHmac(query: Record<string, string>): boolean {
  const { hmac, ...rest } = query;
  if (!hmac) return false; // Handle missing HMAC safely

  const secret = this.getRequiredConfig('SHOPIFY_API_SECRET');
  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join('&');

  const generatedHash = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  const a = Buffer.from(generatedHash);
  const b = Buffer.from(hmac);

  // timingSafeEqual requires identical lengths
  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

  async exchangeCodeForToken(
    shop: string,
    code: string,
  ): Promise<{
    access_token: string;
    scope: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
  }> {
    const apiKey = this.getRequiredConfig('SHOPIFY_API_KEY');
    const apiSecret = this.getRequiredConfig('SHOPIFY_API_SECRET');

    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: apiKey,
        client_secret: apiSecret,
        code,
        expiring: '1',
      }).toString(),
    });

    const data = (await response.json()) as {
      access_token: string;
      scope: string;
      expires_in?: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
    };

    if (!response.ok) {
      throw new Error(
        `Token exchange failed: ${response.status} ${response.statusText} - ${JSON.stringify(data)}`,
      );
    }

    if (!data.access_token.startsWith('shpat_')) {
  this.logger.warn(
    `Unexpected token prefix: ${data.access_token.substring(0, 10)}... Expected shpat_`,
  );
    }   

    return data;
  }

 verifyWebhookHmac(rawBody: Buffer, hmacHeader: string): boolean {
  if (!hmacHeader) return false;
  
  const secret = this.getRequiredConfig('SHOPIFY_API_SECRET');
  const generatedHash = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64'); // <-- Shopify Webhooks use base64

  const a = Buffer.from(generatedHash);
  const b = Buffer.from(hmacHeader);

  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

  async registerOrderWebhook(shop: string, accessToken: string) {
  const response = await fetch(
    `https://${shop}/admin/api/2026-07/webhooks.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', // Switch to JSON
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        webhook: {
          topic: 'orders/create',
          address: `${this.getRequiredConfig('SHOPIFY_APP_URL')}/api/shopify/webhooks/orders-create`,
          format: 'json',
        },
      }),
    },
  );

  const data = await response.json();
  // ... rest of your error handling
}
}
