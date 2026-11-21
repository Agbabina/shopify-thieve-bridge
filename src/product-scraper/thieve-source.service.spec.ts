import { ServiceUnavailableException } from '@nestjs/common';
import { ThieveSourceService } from './thieve-source.service';

describe('ThieveSourceService', () => {
  const store = { id: 1, shop: 'bridge.myshopify.com' } as any;
  let config: any;
  let stores: any;
  let tokens: any;
  let products: any;
  let currency: any;
  let service: ThieveSourceService;

  beforeEach(() => {
    config = {
      get: (key: string) => ({
        THIEVE_SOURCE_URL: 'https://bridge.myshopify.com',
        THIEVE_SOURCE_STATUS: 'draft',
        SHOPIFY_ADMIN_API_VERSION: '2026-07',
        PRODUCT_MIN_GROSS_MARGIN_PERCENT: 20,
      } as Record<string, unknown>)[key],
    };
    stores = { findByShop: jest.fn().mockResolvedValue(store) };
    tokens = { getValidToken: jest.fn().mockResolvedValue('access-token') };
    products = { saveFromThieveSource: jest.fn().mockResolvedValue({ created: true }) };
    currency = { getRate: jest.fn().mockResolvedValue({ rate: 1, source: 'identity' }) };
    service = new ThieveSourceService(config, stores, tokens, products, currency);
  });

  afterEach(() => jest.restoreAllMocks());

  it('imports one valid Shopify source product and computes its gross margin', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          shop: { currencyCode: 'NGN' },
          products: {
            nodes: [{
              id: 'gid://shopify/Product/123',
              title: 'A sourced product',
              descriptionHtml: '<p>Useful product</p>',
              vendor: 'Thieve',
              handle: 'a-sourced-product',
              onlineStoreUrl: null,
              images: { nodes: [{ url: 'https://cdn.shopify.com/product.jpg' }] },
              variants: {
                nodes: [{
                  id: 'gid://shopify/ProductVariant/456',
                  title: 'Default Title',
                  sku: 'SKU-1',
                  price: '100',
                  inventoryQuantity: 10,
                  inventoryPolicy: 'DENY',
                  inventoryItem: { tracked: true, unitCost: { amount: '50', currencyCode: 'NGN' } },
                }],
              },
            }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    } as Response);

    await expect(service.syncConfiguredSource()).resolves.toMatchObject({
      inspected: 1,
      imported: 1,
      updated: 0,
      pages: 1,
      query: 'status:draft',
    });
    expect(products.saveFromThieveSource).toHaveBeenCalledWith(
      expect.objectContaining({
        supplierPrice: 50,
        supplierCurrency: 'NGN',
        sellingPrice: 100,
        sellingCurrency: 'NGN',
        grossMarginPercent: 50,
        validationErrors: [],
      }),
      store,
    );
  });

  it('validates each variant and uses the lowest margin as the product summary', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          shop: { currencyCode: 'NGN' },
          products: {
            nodes: [{
              id: 'gid://shopify/Product/789',
              title: 'A multi-variant product',
              descriptionHtml: '<p>Two options</p>',
              vendor: 'Thieve',
              handle: 'multi-variant',
              onlineStoreUrl: null,
              images: { nodes: [{ url: 'https://cdn.shopify.com/product.jpg' }] },
              variants: {
                nodes: [
                  { id: 'gid://shopify/ProductVariant/1', title: 'Small', sku: 'S', price: '100', inventoryQuantity: 10, inventoryPolicy: 'DENY', inventoryItem: { tracked: true, unitCost: { amount: '50', currencyCode: 'NGN' } } },
                  { id: 'gid://shopify/ProductVariant/2', title: 'Large', sku: 'L', price: '120', inventoryQuantity: 5, inventoryPolicy: 'DENY', inventoryItem: { tracked: true, unitCost: { amount: '72', currencyCode: 'NGN' } } },
                ],
                pageInfo: { hasNextPage: false },
              },
            }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    } as Response);

    await expect(service.syncConfiguredSource()).resolves.toMatchObject({
      inspected: 1,
      imported: 1,
      query: 'status:draft',
    });
    expect(products.saveFromThieveSource).toHaveBeenCalledWith(
      expect.objectContaining({
        supplierPrice: 50,
        sellingPrice: 100,
        grossMarginPercent: 40,
        validationErrors: [],
        variants: expect.arrayContaining([
          expect.objectContaining({ title: 'Small', grossMarginPercent: 50 }),
          expect.objectContaining({ title: 'Large', grossMarginPercent: 40 }),
        ]),
      }),
      store,
    );
  });

  it('rejects a Thieve webpage URL instead of scraping it', async () => {
    config.get = (key: string) => key === 'THIEVE_SOURCE_URL' ? 'https://thieve.co/products/item' : undefined;
    await expect(service.syncConfiguredSource()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(stores.findByShop).not.toHaveBeenCalled();
  });
});
