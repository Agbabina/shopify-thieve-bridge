import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { ShopifyOAuthService } from './shopify-oauth.service';
import { normalizeShopDomain } from './shop-domain';

describe('ShopifyOAuthService', () => {
  const secret = 'test-secret';
  const config = {
    get: (key: string) => ({
      SHOPIFY_API_KEY: 'test-key',
      SHOPIFY_API_SECRET: secret,
      SHOPIFY_SCOPES: 'read_orders,write_orders',
      SHOPIFY_REDIRECT_URL: 'https://example.com/api/shopify/callback',
    } as Record<string, string>)[key],
  } as unknown as ConfigService;
  const service = new ShopifyOAuthService(config);

  it('creates a high-entropy OAuth state value', () => {
    const state = service.createOAuthState();
    expect(state).toMatch(/^[a-f0-9]{64}$/);
  });

  it('verifies Shopify webhook HMAC against the exact raw body', () => {
    const body = Buffer.from(JSON.stringify({ id: 123, total_price: '10.00' }));
    const signature = crypto.createHmac('sha256', secret).update(body).digest('base64');
    expect(service.verifyWebhookHmac(body, signature)).toBe(true);
    expect(service.verifyWebhookHmac(body, 'invalid')).toBe(false);
  });

  it('verifies OAuth callback HMAC', () => {
    const query = { code: 'abc', shop: 'demo.myshopify.com', state: 'state', timestamp: '123' };
    const message = Object.keys(query).sort().map((key) => key + '=' + query[key as keyof typeof query]).join('&');
    const hmac = crypto.createHmac('sha256', secret).update(message).digest('hex');
    expect(service.verifyHmac({ ...query, hmac })).toBe(true);
  });

  it('builds an install URL with the supplied state and canonical domain', () => {
    const url = new URL(service.buildInstallUrl('demo', 'state-value'));
    expect(url.hostname).toBe('demo.myshopify.com');
    expect(url.searchParams.get('state')).toBe('state-value');
  });
});

describe('normalizeShopDomain', () => {
  it('normalizes a short CLI shop slug', () => {
    expect(normalizeShopDomain('Demo')).toBe('demo.myshopify.com');
  });

  it('accepts a full Shopify domain and rejects arbitrary hosts', () => {
    expect(normalizeShopDomain('https://demo.myshopify.com/path')).toBe('demo.myshopify.com');
    expect(() => normalizeShopDomain('example.com')).toThrow();
  });
});
