import { ShopifyStoresService } from './shopify-stores.service';

describe('ShopifyStoresService token encryption', () => {
  it('stores Shopify credentials encrypted and returns decrypted credentials to services', async () => {
    const key = 'a'.repeat(64);
    const repository: any = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const config: any = {
      get: (name: string) => name === 'TOKEN_ENCRYPTION_KEY' ? key : 'test',
    };
    const service = new ShopifyStoresService(repository, config);

    const stored = await service.upsertStore(
      'bridge.myshopify.com',
      'shpat_access_secret',
      'shp_refresh_secret',
      3600,
      'read_products',
    );

    expect(stored.accessToken).toMatch(/^enc:v1:/);
    expect(stored.refreshToken).toMatch(/^enc:v1:/);
    repository.findOne.mockResolvedValue(stored);

    const runtime = await service.findByShop('bridge.myshopify.com');
    expect(runtime?.accessToken).toBe('shpat_access_secret');
    expect(runtime?.refreshToken).toBe('shp_refresh_secret');
    expect(stored.accessToken).not.toContain('shpat_access_secret');
  });
});
