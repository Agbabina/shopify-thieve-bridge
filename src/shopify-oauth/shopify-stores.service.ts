import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShopifyStore } from './entities/shopify-store.entity';

@Injectable()
export class ShopifyStoresService {
  constructor(
    @InjectRepository(ShopifyStore)
    private readonly storeRepository: Repository<ShopifyStore>,
  ) {}

  async upsertStore(
    shop: string,
    accessToken: string,
    refreshToken: string | null, // Allow null
    expiresIn?: number,
    scope?: string,
  ): Promise<ShopifyStore> {
    let tokenExpiresAt: Date | null = null;
    if (expiresIn && expiresIn > 0) {
      tokenExpiresAt = new Date();
      tokenExpiresAt.setSeconds(tokenExpiresAt.getSeconds() + expiresIn);
    } else if (expiresIn === 0) {
      // Force expiration (used when refresh fails)
      tokenExpiresAt = new Date(0); // Epoch - already expired
    }

    const store = await this.storeRepository.findOne({ where: { shop } });

    if (store) {
      // Update existing store
      store.accessToken = accessToken;
      store.refreshToken = refreshToken; // Can be null
      if (tokenExpiresAt !== null) {
        store.tokenExpiresAt = tokenExpiresAt;
      }
      if (scope) {
        store.scope = scope;
      }
      store.lastRefreshAt = new Date();
      return await this.storeRepository.save(store);
    } else {
      // Create new store
      const newStore = this.storeRepository.create({
        shop,
        accessToken,
        refreshToken: refreshToken, // Can be null
        tokenExpiresAt: tokenExpiresAt,
        scope: scope || null,
        lastRefreshAt: new Date(),
      });
      return await this.storeRepository.save(newStore);
    }
  }

  async findByShop(shop: string): Promise<ShopifyStore | null> {
    return await this.storeRepository.findOne({ where: { shop } });
  }

  async findById(id: number): Promise<ShopifyStore | null> {
    return await this.storeRepository.findOne({ where: { id } });
  }
}
