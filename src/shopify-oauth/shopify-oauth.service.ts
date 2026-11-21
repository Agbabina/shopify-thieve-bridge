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

  createOAuthState(shopInput: string): string {
    const shop = normalizeShopDomain(shopInput);
    const nonce = crypto.randomBytes(32).toString('hex');
    const signature = crypto.createHmac('sha256', this.required('SHOPIFY_API_SECRET'))
      .update(nonce + ':' + shop)
      .digest('hex');
    return nonce + '.' + signature;
  }

  verifyOAuthState(state: string, shopInput: string): boolean {
    if (!state || !state.includes('.')) return false;
    const shop = normalizeShopDomain(shopInput);
    const [nonce, supplied] = state.split('.');
    if (!nonce || !supplied || !/^[a-f0-9]{64}$/i.test(nonce) || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
    const expected = crypto.createHmac('sha256', this.required('SHOPIFY_API_SECRET'))
      .update(nonce + ':' + shop)
      .digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(supplied, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
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
    const baseUrl = this.required('SHOPIFY_APP_URL').replace(/\\/+$/, '');
    const topics = [
      { topic: 'ORDERS_CREATE', path: '/api/shopify/webhooks/orders-create' },
      { topic: 'ORDERS_PAID', path: '/api/shopify/webhooks/orders-paid' },
      { topic: 'FULFILLMENTS_CREATE', path: '/api/shopify/webhooks/fulfillments-create' },
    ];
    const mutation = `
      mutation BridgeWebhookCreate(
        $topic: WebhookSubscriptionTopic!
        $subscription: WebhookSubscriptionInput!
      ) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $subscription) {
          webhookSubscription { id topic uri }
          userErrors { field message }
        }
      }
    `;
    const version = this.config.get<string>('SHOPIFY_ADMIN_API_VERSION') ?? '2026-07';
    const results: Array<{ topic: string; registered: boolean; detail?: string }> = [];

    for (const item of topics) {
      const address = baseUrl + item.path;
      try {
        const response = await fetch('https://' + shop + '/admin/api/' + version + '/graphql.json', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({
            query: mutation,
            variables: {
              topic: item.topic,
              subscription: { uri: address, format: 'JSON' },
            },
          }),
          signal: AbortSignal.timeout(15000),
        });
        const body = await response.json().catch(() => ({})) as {
          data?: {
            webhookSubscriptionCreate?: {
              webhookSubscription?: { id: string; uri: string } | null;
              userErrors?: { message: string }[];
            };
          };
          errors?: { message?: string }[];
        };
        const payload = body.data?.webhookSubscriptionCreate;
        const errors = [
          ...(body.errors ?? []).map((error) => error.message ?? 'GraphQL error'),
          ...(payload?.userErrors ?? []).map((error) => error.message),
        ];
        if (!response.ok || errors.length || !payload?.webhookSubscription) {
          const detail = errors.join('; ');
          const alreadyExists = /already exists|already registered|duplicate/i.test(detail);
          results.push({
            topic: item.topic,
            registered: alreadyExists,
            detail: alreadyExists ? 'already registered' : (detail || 'HTTP ' + response.status),
          });
        } else {
          results.push({ topic: item.topic, registered: true });
        }
      } catch (error) {
        results.push({
          topic: item.topic,
          registered: false,
          detail: error instanceof Error ? error.message : 'Webhook registration failed',
        });
      }
    }
    return results;
  }\n}