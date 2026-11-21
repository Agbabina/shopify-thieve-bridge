import { BadRequestException } from '@nestjs/common';
import { ProductsService } from './product.service';

describe('ProductsService sourcing currency', () => {
  const store = { id: 1, shop: 'bridge.myshopify.com' } as any;
  let repository: any;
  let service: ProductsService;

  beforeEach(() => {
    repository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ ...value, id: value.id ?? 'product-1' })),
      findOne: jest.fn().mockResolvedValue(null),
    };
    service = new ProductsService(repository, { get: (key: string) => key === 'SHOPIFY_STORE_CURRENCY' ? 'NGN' : 20 } as any, { getRate: jest.fn().mockResolvedValue({ rate: 1, source: 'identity' }) } as any);
  });

  it('persists the supplier currency instead of silently defaulting to USD', async () => {
    const saved = await service.saveFromScrape({
      title: 'A real product title',
      price: '8500',
      currency: 'NGN',
      images: ['https://ae01.alicdn.com/product.jpg'],
      sourceUrl: 'https://www.aliexpress.com/item/123.html',
    }, store, 12000);

    expect(saved.supplierPrice).toBe(8500);
    expect(saved.supplierCurrency).toBe('NGN');
    expect(saved.sellingCurrency).toBe('NGN');
    expect(saved.status).toBe('pending_review');
  });

  it('rejects products with an unknown supplier currency', async () => {
    await expect(service.saveFromScrape({
      title: 'A real product title',
      price: '12.50',
      images: ['https://cdn.example.com/product.jpg'],
      sourceUrl: 'https://www.aliexpress.com/item/123.html',
    }, store)).rejects.toBeInstanceOf(BadRequestException);
  });
});
