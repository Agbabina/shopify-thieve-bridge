import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { ShopifyStore } from './entities/shopify-store.entity';
import { normalizeShopDomain } from './shop-domain';

@Injectable()
export class ShopifyStoresService {
  constructor(
    @InjectRepository(ShopifyStore) private readonly storeRepository: Repository<ShopifyStore>,
    private readonly config: ConfigService,
  ) {}

  private resolveAlias(input: string): string {
    const raw = input.trim().toLowerCase();
    const aliases = (this.config.get<string>('SHOPIFY_SHOP_ALIASES') ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
    for (const entry of aliases) {
      const separator = entry.indexOf('=');
      if (separator < 1) continue;
      if (entry.slice(0, separator).trim().toLowerCase() === raw) {
        return normalizeShopDomain(entry.slice(separator + 1).trim());
      }
    }
    const configuredAlias = this.config.get<string>('CLI_SIMULATED_SHOP');
    const defaultDomain = this.config.get<string>('SHOPIFY_DEFAULT_SHOP_DOMAIN');
    if (configuredAlias && defaultDomain && raw === configuredAlias.toLowerCase()) return normalizeShopDomain(defaultDomain);
    return normalizeShopDomain(input);
  }

  async upsertStore(shopInput: string, accessToken: string, refreshToken: string | null, expiresIn?: number, scope?: string): Promise<ShopifyStore> {
    const shop = normalizeShopDomain(shopInput);
    const store = await this.storeRepository.findOne({ where: { shop } });
    const tokenExpiresAt = expiresIn && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000)
      : expiresIn === 0 ? new Date(0) : null;

    if (store) {
      store.accessToken = accessToken;
      store.refreshToken = refreshToken;
      if (tokenExpiresAt !== null) store.tokenExpiresAt = tokenExpiresAt;
      if (scope) store.scope = scope;
      store.lastRefreshAt = new Date();
      return this.storeRepository.save(store);
    }
    return this.storeRepository.save(this.storeRepository.create({
      shop, accessToken, refreshToken, tokenExpiresAt, scope: scope || null, lastRefreshAt: new Date(),
    }));
  }

  async findByShop(shopInput: string): Promise<ShopifyStore | null> {
    const shop = this.resolveAlias(shopInput);
    const store = await this.storeRepository.findOne({ where: { shop } });
    if (store) return store;

    // Development-only compatibility for CLI aliases when exactly one store is installed.
    if (this.config.get<string>('NODE_ENV') !== 'production' && !shopInput.includes('.')) {
      const stores = await this.storeRepository.find({ take: 2 });
      if (stores.length === 1) return stores[0];
    }
    return null;
  }

  async findById(id: number): Promise<ShopifyStore | null> {
    return this.storeRepository.findOne({ where: { id } });
  }

  async listSafeStores() {
    return this.storeRepository.find({
      select: { id: true, shop: true, scope: true, updatedAt: true, lastRefreshAt: true },
      order: { updatedAt: 'DESC' },
    });
  }
}
