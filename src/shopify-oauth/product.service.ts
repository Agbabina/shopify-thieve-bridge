import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrencyService } from './currency.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { ShopifyStore } from './entities/shopify-store.entity';

@Injectable()
export class ProductsService {
  private safeDescriptionHtml(input: unknown): string | null {
    const plain = String(input ?? '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!plain) return null;
    const escaped = plain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<p>' + escaped + '</p>';
  }

  private isAllowedSupplierImage(input: unknown): input is string {
    if (typeof input !== 'string') return false;
    try {
      const url = new URL(input);
      const host = url.hostname.toLowerCase();
      return url.protocol === 'https:' && !url.username && !url.password &&
        (host === 'alicdn.com' || host.endsWith('.alicdn.com') ||
         host === 'aliexpress-media.com' || host.endsWith('.aliexpress-media.com'));
    } catch {
      return false;
    }
  }

  private isAllowedShopifyImage(input: unknown): input is string {
    if (typeof input !== 'string') return false;
    try {
      const url = new URL(input);
      const host = url.hostname.toLowerCase();
      return url.protocol === 'https:' &&
        (host === 'cdn.shopify.com' || host.endsWith('.shopifycdn.net'));
    } catch {
      return false;
    }
  }

  constructor(
    @InjectRepository(Product) private readonly productsRepo: Repository<Product>,
    private readonly config: ConfigService,
    private readonly currency: CurrencyService,
  ) {}

  private async getConfiguredRate(from: string, to: string) {
    const manualRate = this.config.get<string>('PRODUCT_FX_MANUAL_RATE');
    const manualFrom = String(this.config.get('PRODUCT_FX_MANUAL_FROM') ?? 'USD').toUpperCase();
    const manualTo = String(this.config.get('PRODUCT_FX_MANUAL_TO') ?? 'NGN').toUpperCase();
    if (manualRate && from === manualFrom && to === manualTo) return this.currency.getRate(from, to, manualRate);
    if (manualRate && from === manualTo && to === manualFrom) {
      const value = Number(manualRate);
      if (!Number.isFinite(value) || value <= 0) throw new BadRequestException('PRODUCT_FX_MANUAL_RATE must be positive');
      return this.currency.getRate(from, to, String(1 / value));
    }
    return this.currency.getRate(from, to);
  }

  async saveFromScrape(scrapedData: any, store: ShopifyStore, sellingPrice?: number) {
    const supplierPrice = Number(scrapedData.price);
    const supplierCurrency = String(scrapedData.currency ?? '').trim().toUpperCase();
    if (!Number.isFinite(supplierPrice) || supplierPrice <= 0) {
      throw new BadRequestException('Scraped product has an invalid supplier price');
    }
    if (!/^[A-Z]{3}$/.test(supplierCurrency)) {
      throw new BadRequestException('Supplier currency is missing or invalid; refusing to assume USD');
    }
    const rawImages = Array.isArray(scrapedData.images)
      ? scrapedData.images
      : scrapedData.images ? [scrapedData.images] : [];
    const images = rawImages.filter((image: unknown) => this.isAllowedSupplierImage(image));
    const errors: string[] = [];
    const title = String(scrapedData.title ?? scrapedData.description ?? '').trim();
    if (title.length < 5) errors.push('Product title is missing or too short');
    if (title.length > 255) errors.push('Product title exceeds Shopify’s 255-character limit');
    if (sellingPrice === undefined || !Number.isFinite(Number(sellingPrice)) || Number(sellingPrice) <= 0) {
      errors.push('A positive selling price in the configured Shopify store currency is required');
    }
    const sellingCurrency = String(scrapedData.sellingCurrency ?? this.config.get<string>('SHOPIFY_STORE_CURRENCY') ?? '').toUpperCase();
    let grossMarginPercent: number | null = null;
    if (sellingPrice !== undefined && Number.isFinite(Number(sellingPrice)) && Number(sellingPrice) > 0 && /^[A-Z]{3}$/.test(supplierCurrency) && /^[A-Z]{3}$/.test(sellingCurrency)) {
      try {
        const fx = await this.getConfiguredRate(supplierCurrency, sellingCurrency);
        grossMarginPercent = Math.round(((Number(sellingPrice) - supplierPrice * fx.rate) / Number(sellingPrice)) * 10000) / 100;
        const minimumMargin = Number(this.config.get('PRODUCT_MIN_GROSS_MARGIN_PERCENT') ?? 20);
        if (!Number.isFinite(minimumMargin) || minimumMargin < 0 || minimumMargin > 100) {
          errors.push('PRODUCT_MIN_GROSS_MARGIN_PERCENT must be a number between 0 and 100');
        } else if (grossMarginPercent < minimumMargin) {
          errors.push('Estimated gross margin is below the configured minimum of ' + minimumMargin + '%');
        }
      } catch {
        errors.push('Could not obtain a supplier-to-store FX rate; enter a verified rate before approval');
      }
    }
    const sourceUrl = String(scrapedData.sourceUrl ?? scrapedData.url ?? '');
    if (!/^https:\/\//i.test(sourceUrl)) errors.push('A verified HTTPS supplier source URL is required');
    const availability = String(scrapedData.availability ?? '').toLowerCase();
    if (availability.includes('outofstock') || availability.includes('soldout')) errors.push('Supplier reports that this product is out of stock');
    if (!images.length) {
      errors.push('At least one HTTPS product image is required');
    }
    const product = this.productsRepo.create({
      supplierName: scrapedData.supplierName ?? 'AliExpress',
      description: title || 'Untitled product',
      bodyHtml: this.safeDescriptionHtml(scrapedData.description),
      supplierPrice,
      supplierCurrency,
      sellingPrice: sellingPrice ?? undefined,
      sellingCurrency,
      grossMarginPercent,
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
    bodyHtml?: string | null;
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
    const safeImages = data.imageUrls.filter((image) => this.isAllowedShopifyImage(image));
    const nextBodyHtml = this.safeDescriptionHtml(data.bodyHtml);
    const sourceErrors = [...data.validationErrors];
    if (!safeImages.length) sourceErrors.push('No approved Shopify CDN product images were found');
    const nextErrors = sourceErrors.length ? JSON.stringify(sourceErrors) : null;
    const nextVariants = JSON.stringify(data.variants);
    const nextMargin = data.grossMarginPercent ?? null;
    const sourceChanged = !existing ||
      existing.sourceUrl !== data.sourceUrl ||
      existing.supplierName !== (data.supplierName || 'Thieve') ||
      existing.description !== (data.title || 'Untitled product') ||
      existing.bodyHtml !== nextBodyHtml ||
      Number(existing.supplierPrice) !== data.supplierPrice ||
      existing.supplierCurrency !== data.supplierCurrency ||
      Number(existing.sellingPrice ?? 0) !== data.sellingPrice ||
      existing.sellingCurrency !== data.sellingCurrency ||
      JSON.stringify(existing.imageUrls ?? []) !== JSON.stringify(safeImages) ||
      existing.sourceVariantsJson !== nextVariants ||
      Number(existing.grossMarginPercent ?? 0) !== Number(nextMargin ?? 0);
    const validationChanged = !existing ||
      existing.validationStatus !== (sourceErrors.length ? 'needs_review' : 'passed') ||
      existing.validationErrorsJson !== nextErrors;
    const product = existing ?? this.productsRepo.create();
    product.sourceShopifyProductId = data.sourceShopifyProductId;
    product.sourceUrl = data.sourceUrl;
    product.supplierName = data.supplierName || 'Thieve';
    product.description = data.title || 'Untitled product';
    product.bodyHtml = nextBodyHtml;
    product.supplierPrice = data.supplierPrice;
    product.supplierCurrency = data.supplierCurrency;
    product.sellingPrice = data.sellingPrice;
    product.sellingCurrency = data.sellingCurrency;
    product.grossMarginPercent = nextMargin;
    product.imageUrls = safeImages;
    product.sourceVariantsJson = nextVariants;
    product.validationStatus = sourceErrors.length ? 'needs_review' : 'passed';
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
