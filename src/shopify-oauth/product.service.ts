import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { ShopifyStore } from './entities/shopify-store.entity';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product) private readonly productsRepo: Repository<Product>,
    private readonly config: ConfigService,
  ) {}

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
    const sourceUrl = String(scrapedData.sourceUrl ?? scrapedData.url ?? '');
    if (!/^https:\/\//i.test(sourceUrl)) errors.push('A verified HTTPS supplier source URL is required');
    const availability = String(scrapedData.availability ?? '').toLowerCase();
    if (availability.includes('outofstock') || availability.includes('soldout')) errors.push('Supplier reports that this product is out of stock');
    if (!images.some((image: unknown) => typeof image === 'string' && /^https:\/\//i.test(image))) {
      errors.push('At least one HTTPS product image is required');
    }
    const product = this.productsRepo.create({
      supplierName: scrapedData.supplierName ?? 'AliExpress',
      description: title || 'Untitled product',
      supplierPrice,
      supplierCurrency,
      sellingPrice: sellingPrice ?? undefined,
      sellingCurrency: String(scrapedData.sellingCurrency ?? this.config.get<string>('SHOPIFY_STORE_CURRENCY') ?? 'NGN').toUpperCase(),
      imageUrls: images,
      sourceUrl: sourceUrl || null,
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
    grossMarginPercent?: number | null;
  }, store: ShopifyStore) {
    const existing = await this.productsRepo.findOne({
      where: { sourceShopifyProductId: data.sourceShopifyProductId, store: { id: store.id } },
      relations: { store: true },
    });
    const nextErrors = data.validationErrors.length ? JSON.stringify(data.validationErrors) : null;
    const nextVariants = JSON.stringify(data.variants);
    const nextMargin = data.grossMarginPercent ?? null;
    const sourceChanged = !existing ||
      existing.sourceUrl !== data.sourceUrl ||
      existing.supplierName !== (data.supplierName || 'Thieve') ||
      existing.description !== (data.title || 'Untitled product') ||
      Number(existing.supplierPrice) !== data.supplierPrice ||
      existing.supplierCurrency !== data.supplierCurrency ||
      Number(existing.sellingPrice ?? 0) !== data.sellingPrice ||
      existing.sellingCurrency !== data.sellingCurrency ||
      JSON.stringify(existing.imageUrls ?? []) !== JSON.stringify(data.imageUrls) ||
      existing.sourceVariantsJson !== nextVariants ||
      Number(existing.grossMarginPercent ?? 0) !== Number(nextMargin ?? 0);
    const validationChanged = !existing ||
      existing.validationStatus !== (data.validationErrors.length ? 'needs_review' : 'passed') ||
      existing.validationErrorsJson !== nextErrors;
    const product = existing ?? this.productsRepo.create();
    product.sourceShopifyProductId = data.sourceShopifyProductId;
    product.sourceUrl = data.sourceUrl;
    product.supplierName = data.supplierName || 'Thieve';
    product.description = data.title || 'Untitled product';
    product.supplierPrice = data.supplierPrice;
    product.supplierCurrency = data.supplierCurrency;
    product.sellingPrice = data.sellingPrice || null;
    product.sellingCurrency = data.sellingCurrency;
    product.grossMarginPercent = nextMargin;
    product.imageUrls = data.imageUrls;
    product.sourceVariantsJson = nextVariants;
    product.validationStatus = data.validationErrors.length ? 'needs_review' : 'passed';
    product.validationErrorsJson = nextErrors;
    product.lastValidatedAt = new Date();
    if (sourceChanged || validationChanged) product.status = 'pending_review';
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
