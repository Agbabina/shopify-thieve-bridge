import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { Repository } from 'typeorm';
import { ShopifyStore } from './entities/shopify-store.entity';
import { normalizeShopDomain } from './shop-domain';

@Injectable()
export class ShopifyStoresService {
  constructor(
    @InjectRepository(ShopifyStore) private readonly storeRepository: Repository<ShopifyStore>,
    private readonly config: ConfigService,
  ) {}

  private encryptionKey(): Buffer | null {
    const configured = this.config.get<string>('TOKEN_ENCRYPTION_KEY');
    if (!configured) {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new ServiceUnavailableException('TOKEN_ENCRYPTION_KEY must be configured in production');
      }
      return null;
    }
    if (!/^[a-fA-F0-9]{64}$/.test(configured)) {
      throw new ServiceUnavailableException('TOKEN_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters');
    }
    return Buffer.from(configured, 'hex');
  }

  private encryptToken(token: string | null): string | null {
    if (!token) return null;
    const key = this.encryptionKey();
    if (!key || token.startsWith('enc:v1:')) return token;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['enc', 'v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
  }

  private decryptToken(token: string | null): string | null {
    if (!token || !token.startsWith('enc:v1:')) return token;
    const key = this.encryptionKey();
    if (!key) throw new ServiceUnavailableException('TOKEN_ENCRYPTION_KEY is required to read encrypted Shopify tokens');
    const parts = token.split(':');
    if (parts.length !== 5) throw new ServiceUnavailableException('Stored Shopify token has an invalid encrypted format');
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[2], 'base64'));
      decipher.setAuthTag(Buffer.from(parts[3], 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(parts[4], 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException('Could not decrypt Shopify credentials; verify TOKEN_ENCRYPTION_KEY');
    }
  }

  private async toRuntimeStore(store: ShopifyStore): Promise<ShopifyStore> {
    const key = this.encryptionKey();
    if (!key) {
      if (store.accessToken.startsWith('enc:v1:') || store.refreshToken?.startsWith('enc:v1:')) {
        throw new ServiceUnavailableException('TOKEN_ENCRYPTION_KEY is required to read encrypted Shopify tokens');
      }
      return store;
    }
    let changed = false;
    if (store.accessToken && !store.accessToken.startsWith('enc:v1:')) {
      store.accessToken = this.encryptToken(store.accessToken) as string;
      changed = true;
    }
    if (store.refreshToken && !store.refreshToken.startsWith('enc:v1:')) {
      store.refreshToken = this.encryptToken(store.refreshToken);
      changed = true;
    }
    if (changed) await this.storeRepository.save(store);
    return Object.assign(Object.create(Object.getPrototypeOf(store)), store, {
      accessToken: this.decryptToken(store.accessToken),
      refreshToken: this.decryptToken(store.refreshToken),
    });
  }

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
    const encryptedAccessToken = this.encryptToken(accessToken) as string;
    const encryptedRefreshToken = this.encryptToken(refreshToken);

    if (store) {
      store.accessToken = encryptedAccessToken;
      store.refreshToken = encryptedRefreshToken;
      if (tokenExpiresAt !== null) store.tokenExpiresAt = tokenExpiresAt;
      if (scope) store.scope = scope;
      store.lastRefreshAt = new Date();
      return this.storeRepository.save(store);
    }
    return this.storeRepository.save(this.storeRepository.create({
      shop,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiresAt,
      scope: scope || null,
      lastRefreshAt: new Date(),
    }));
  }

  async findByShop(shopInput: string): Promise<ShopifyStore | null> {
    const shop = this.resolveAlias(shopInput);
    const store = await this.storeRepository.findOne({ where: { shop } });
    if (store) return this.toRuntimeStore(store);

    // Development-only compatibility for CLI aliases when exactly one store is installed.
    if (this.config.get<string>('NODE_ENV') !== 'production' && !shopInput.includes('.')) {
      const stores = await this.storeRepository.find({ take: 2 });
      if (stores.length === 1) return this.toRuntimeStore(stores[0]);
    }
    return null;
  }

  async findById(id: number): Promise<ShopifyStore | null> {
    const store = await this.storeRepository.findOne({ where: { id } });
    return store ? this.toRuntimeStore(store) : null;
  }

  async listSafeStores() {
    return this.storeRepository.find({
      select: { id: true, shop: true, scope: true, updatedAt: true, lastRefreshAt: true },
      order: { updatedAt: 'DESC' },
    });
  }
}
