import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShopifyStoresService } from './shopify-stores.service';

@Injectable()
export class ShopifyTokenService {
  constructor(
    private readonly shopifyStoresService: ShopifyStoresService,
    private readonly config: ConfigService,
  ) {}

  async getValidToken(shop: string): Promise<string> {
    const store = await this.shopifyStoresService.findByShop(shop);

    if (!store) {
      throw new Error('Store not found');
    }

    // No expiry saved means a non-expiring token: use it as-is
    if (!store.tokenExpiresAt) {
      return store.accessToken;
    }

    // Refresh if expired or expiring within 2 minutes
    const expiresAt = new Date(store.tokenExpiresAt).getTime();
    if (expiresAt - Date.now() > 2 * 60 * 1000) {
      return store.accessToken;
    }

    if (!store.refreshToken) {
      throw new Error(
        `Token expired and no refresh token saved. Re-install: /api/shopify/install?shop=${shop}`,
      );
    }

    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.getOrThrow<string>('SHOPIFY_API_KEY'),
        client_secret: this.config.getOrThrow<string>('SHOPIFY_API_SECRET'),
        grant_type: 'refresh_token',
        refresh_token: store.refreshToken,
      }).toString(),
    });

    const data = (await response.json()) as {
      access_token: string;
      expires_in?: number;
      refresh_token?: string;
      scope?: string;
    };

    if (!response.ok) {
      throw new Error(
        `Token refresh failed: ${response.status} - ${JSON.stringify(data)}. Re-install: /api/shopify/install?shop=${shop}`,
      );
    }

    // Shopify returns a new refresh token each time, so save both together
    await this.shopifyStoresService.upsertStore(
      shop,
      data.access_token,
      data.refresh_token ?? store.refreshToken,
      data.expires_in,
      data.scope,
    );

    return data.access_token;
  }
}
