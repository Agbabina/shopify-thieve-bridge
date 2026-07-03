import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class ShopifyOAuthService {
  constructor(private config: ConfigService) {}

  // Builds the URL we redirect the merchant to for consent
  buildInstallUrl(shop: string): string {
    const apiKey = this.config.get('SHOPIFY_API_KEY');
    const scopes = this.config.get('SHOPIFY_SCOPES');
    const redirectUri = this.config.get('SHOPIFY_REDIRECT_URL');
    const state = crypto.randomBytes(16).toString('hex'); // CSRF protection

    // NOTE: in production, store `state` (e.g. in a short-lived cookie or cache)
    // and verify it matches on callback. Skipping persistence here for brevity —
    // we'll wire that in once sessions are set up.

    const query = new URLSearchParams({
      client_id: apiKey,
      scope: scopes,
      redirect_uri: redirectUri,
      state,
    });

    return `https://${shop}/admin/oauth/authorize?${query.toString()}`;
    console.log('API KEY LOADED:', this.config.get('SHOPIFY_API_KEY'));
  }

  // Verifies the HMAC Shopify sends on the callback query string
  verifyHmac(query: Record<string, string>): boolean {
    const { hmac, ...rest } = query;
    const secret = this.config.get('SHOPIFY_API_SECRET');

    const message = Object.keys(rest)
      .sort()
      .map((key) => `${key}=${rest[key]}`)
      .join('&');

    const generatedHash = crypto
      .createHmac('sha256', secret)
      .update(message)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(generatedHash),
      Buffer.from(hmac),
    );
  }

  // Exchanges the temporary `code` for a permanent Admin API access token
  async exchangeCodeForToken(shop: string, code: string): Promise<{
    access_token: string;
    scope: string;
  }> {
    const apiKey = this.config.get('SHOPIFY_API_KEY');
    const apiSecret = this.config.get('SHOPIFY_API_SECRET');

    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: apiKey,
        client_secret: apiSecret,
        code,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.statusText}`);
    }

    return response.json();
  }
}