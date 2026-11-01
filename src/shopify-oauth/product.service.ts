import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { ShopifyStore } from './entities/shopify-store.entity';

@Injectable()
export class ProductsService {
  constructor(@InjectRepository(Product) private readonly productsRepo: Repository<Product>) {}

  async saveFromScrape(scrapedData: any, store: ShopifyStore, sellingPrice?: number) {
    const supplierPrice = Number(scrapedData.price);
    if (!Number.isFinite(supplierPrice) || supplierPrice < 0) throw new Error('Scraped product has an invalid supplier price');
    const product = this.productsRepo.create({
      supplierName: scrapedData.supplierName ?? 'AliExpress',
      description: String(scrapedData.title ?? scrapedData.description ?? 'Untitled product'),
      supplierPrice,
      sellingPrice: sellingPrice ?? undefined,
      imageUrls: Array.isArray(scrapedData.images) ? scrapedData.images : scrapedData.images ? [scrapedData.images] : [],
      status: 'draft',
      store,
    });
    return this.productsRepo.save(product);
  }

  async findById(id: string) {
    return this.productsRepo.findOne({ where: { id }, relations: { store: true } });
  }

  async markImported(product: Product, shopifyProductId: string) {
    product.shopifyProductId = shopifyProductId;
    product.status = 'imported';
    return this.productsRepo.save(product);
  }
}
