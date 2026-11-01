import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { normalizeShopDomain } from './shop-domain';

@Injectable()
export class ShopifyOAuthService {
  private readonly logger = new Logger(ShopifyOAuthService.name);
  constructor(private readonly config: ConfigService) {}

  private required(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) throw new Error('Missing required Shopify config: ' + key);
    return value;
  }

  createOAuthState(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  buildInstallUrl(shopInput: string, state: string): string {
    const shop = normalizeShopDomain(shopInput);
    const query = new URLSearchParams({
      client_id: this.required('SHOPIFY_API_KEY'),
      scope: this.required('SHOPIFY_SCOPES'),
      redirect_uri: this.required('SHOPIFY_REDIRECT_URL'),
      state,
    });
    return 'https://' + shop + '/admin/oauth/authorize?' + query.toString();
  }

  verifyHmac(query: Record<string, string>): boolean {
    const { hmac, ...rest } = query;
    if (!hmac) return false;
    const message = Object.keys(rest).sort().map((key) => key + '=' + rest[key]).join('&');
    const digest = crypto.createHmac('sha256', this.required('SHOPIFY_API_SECRET')).update(message).digest('hex');
    const a = Buffer.from(digest, 'utf8');
    const b = Buffer.from(hmac, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  verifyWebhookHmac(rawBody: Buffer, signature: string): boolean {
    if (!signature) return false;
    const digest = crypto.createHmac('sha256', this.required('SHOPIFY_API_SECRET')).update(rawBody).digest('base64');
    const a = Buffer.from(digest, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async exchangeCodeForToken(shopInput: string, code: string): Promise<{
    access_token: string; scope: string; expires_in?: number; refresh_token?: string; refresh_token_expires_in?: number;
  }> {
    const shop = normalizeShopDomain(shopInput);
    const response = await fetch('https://' + shop + '/admin/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.required('SHOPIFY_API_KEY'),
        client_secret: this.required('SHOPIFY_API_SECRET'),
        code,
        expiring: '1',
      }).toString(),
    });
    const data = await response.json() as {
      access_token?: string; scope?: string; expires_in?: number; refresh_token?: string; refresh_token_expires_in?: number;
    };
    if (!response.ok || !data.access_token) throw new Error('Shopify token exchange failed: ' + response.status);
    this.logger.log('Shopify token exchange succeeded for ' + shop);
    return {
      access_token: data.access_token,
      scope: data.scope ?? '',
      expires_in: data.expires_in,
      refresh_token: data.refresh_token,
      refresh_token_expires_in: data.refresh_token_expires_in,
    };
  }

  async registerWebhooks(shopInput: string, accessToken: string) {
    const shop = normalizeShopDomain(shopInput);
    const baseUrl = this.required('SHOPIFY_APP_URL').replace(/\/+$/, '');
    const topics = [
      { topic: 'orders/create', path: '/api/shopify/webhooks/orders-create' },
      { topic: 'orders/paid', path: '/api/shopify/webhooks/orders-paid' },
      { topic: 'fulfillments/create', path: '/api/shopify/webhooks/fulfillments-create' },
    ];
    const results: Array<{ topic: string; registered: boolean; detail?: string }> = [];
    for (const item of topics) {
      const address = baseUrl + item.path;
      const response = await fetch('https://' + shop + '/admin/api/2026-07/webhooks.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
        body: JSON.stringify({ webhook: { topic: item.topic, address, format: 'json' } }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 422 && JSON.stringify(payload).toLowerCase().includes('already')) {
        results.push({ topic: item.topic, registered: true, detail: 'already registered' });
      } else if (!response.ok) {
        this.logger.error('Webhook registration failed for ' + item.topic + ': ' + response.status);
        results.push({ topic: item.topic, registered: false, detail: 'HTTP ' + response.status });
      } else {
        results.push({ topic: item.topic, registered: true });
      }
    }
    return results;
  }
}
