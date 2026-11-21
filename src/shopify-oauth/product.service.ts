import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { ShopifyStore } from './entities/shopify-store.entity';

@Injectable()
export class ProductsService {
  constructor(@InjectRepository(Product) private readonly productsRepo: Repository<Product>) {}

  async saveFromScrape(scrapedData: any, store: ShopifyStore, sellingPrice?: number) {
    const supplierPrice = Number(scrapedData.price);
    const supplierCurrency = String(scrapedData.currency ?? '').trim().toUpperCase();
    if (!Number.isFinite(supplierPrice) || supplierPrice <= 0) {
      throw new BadRequestException('Scraped product has an invalid supplier price');
    }
    if (!/^[A-Z]{3}$/.test(supplierCurrency)) {
      throw new BadRequestException('Supplier currency is missing or invalid; refusing to assume USD');
    }
    const images = Array.isArray(scrapedData.images)
      ? scrapedData.images
      : scrapedData.images ? [scrapedData.images] : [];
    const errors: string[] = [];
    const title = String(scrapedData.title ?? scrapedData.description ?? '').trim();
    if (title.length < 5) errors.push('Product title is missing or too short');
    if (!images.some((image: unknown) => typeof image === 'string' && /^https:\/\//i.test(image))) {
      errors.push('At least one HTTPS product image is required');
    }
    const product = this.productsRepo.create({
      supplierName: scrapedData.supplierName ?? 'AliExpress',
      description: title || 'Untitled product',
      supplierPrice,
      supplierCurrency,
      sellingPrice: sellingPrice ?? undefined,
      sellingCurrency: String(scrapedData.sellingCurrency ?? supplierCurrency).toUpperCase(),
      imageUrls: images,
      sourceUrl: scrapedData.sourceUrl ?? scrapedData.url ?? null,
      validationStatus: errors.length ? 'needs_review' : 'passed',
      validationErrorsJson: errors.length ? JSON.stringify(errors) : null,
      lastValidatedAt: new Date(),
      status: 'pending_review',
      store,
    });
    return this.productsRepo.save(product);
  }

  async saveFromThieveSource(data: {
    sourceShopifyProductId: string;
    sourceUrl: string;
    supplierName: string;
    title: string;
    supplierPrice: number;
    supplierCurrency: string;
    sellingPrice: number;
    sellingCurrency: string;
    imageUrls: string[];
    variants: unknown[];
    validationErrors: string[];
  }, store: ShopifyStore) {
    const existing = await this.productsRepo.findOne({
      where: { sourceShopifyProductId: data.sourceShopifyProductId, store: { id: store.id } },
      relations: { store: true },
    });
    const product = existing ?? this.productsRepo.create();
    product.sourceShopifyProductId = data.sourceShopifyProductId;
    product.sourceUrl = data.sourceUrl;
    product.supplierName = data.supplierName || 'Thieve';
    product.description = data.title || 'Untitled product';
    product.supplierPrice = data.supplierPrice;
    product.supplierCurrency = data.supplierCurrency;
    product.sellingPrice = data.sellingPrice || null;
    product.sellingCurrency = data.sellingCurrency;
    product.imageUrls = data.imageUrls;
    product.sourceVariantsJson = JSON.stringify(data.variants);
    product.validationStatus = data.validationErrors.length ? 'needs_review' : 'passed';
    product.validationErrorsJson = data.validationErrors.length ? JSON.stringify(data.validationErrors) : null;
    product.lastValidatedAt = new Date();
    product.status = product.status === 'approved' || product.status === 'imported' ? product.status : 'pending_review';
    product.store = store;
    const saved = await this.productsRepo.save(product);
    return { product: saved, created: !existing };
  }

  async findById(id: string) {
    return this.productsRepo.findOne({ where: { id }, relations: { store: true } });
  }

  async approve(product: Product) {
    if (product.validationStatus !== 'passed') {
      throw new BadRequestException('Product has validation issues and cannot be approved yet');
    }
    product.status = 'approved';
    return this.productsRepo.save(product);
  }

  async markImported(product: Product, shopifyProductId: string) {
    product.shopifyProductId = shopifyProductId;
    product.status = 'imported';
    return this.productsRepo.save(product);
  }
}
