import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { ShopifyStore } from './entities/shopify-store.entity';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private productsRepo: Repository<Product>,
  ) {}

  async saveFromScrape(
    scrapedData: any,
    store: ShopifyStore,
    sellingPrice?: number,
  ) {
    const product = this.productsRepo.create({
      supplierName: 'AliExpress',
      description: scrapedData.title,
      supplierPrice: parseFloat(scrapedData.price),
      sellingPrice: sellingPrice ?? undefined,
      imageUrls: scrapedData.images ?? [],
      status: 'draft',
      store,
    });

    return this.productsRepo.save(product);
  }

  async findById(id: string) {
    return this.productsRepo.findOne({ where: { id } });
  }
}
