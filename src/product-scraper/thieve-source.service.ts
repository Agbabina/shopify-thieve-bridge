import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductsService } from '../shopify-oauth/product.service';
import { ShopifyStoresService } from '../shopify-oauth/shopify-stores.service';
import { ShopifyTokenService } from '../shopify-oauth/shopify-token.service';
import { CurrencyService } from '../shopify-oauth/currency.service';

type ShopifyVariant = {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  inventoryItem?: { unitCost?: { amount: string; currencyCode: string } | null } | null;
};

type ShopifySourceProduct = {
  id: string;
  title: string;
  descriptionHtml?: string | null;
  vendor?: string | null;
  handle: string;
  onlineStoreUrl?: string | null;
  images: { nodes: { url: string }[] };
  variants: { nodes: ShopifyVariant[]; pageInfo?: { hasNextPage: boolean } };
};

const SOURCE_PRODUCTS_QUERY = `
  query BridgeSourceProducts($first: Int!, $after: String, $query: String!) {
    shop { currencyCode }
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        descriptionHtml
        vendor
        handle
        onlineStoreUrl
        images(first: 10) { nodes { url } }
        variants(first: 20) {
          nodes {
            id
            title
            sku
            price
            inventoryItem { unitCost { amount currencyCode } }
          }
          pageInfo { hasNextPage }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

@Injectable()
export class ThieveSourceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ThieveSourceService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private syncing = false;

  constructor(
    private readonly config: ConfigService,
    private readonly stores: ShopifyStoresService,
    private readonly tokens: ShopifyTokenService,
    private readonly products: ProductsService,
    private readonly currency: CurrencyService,
  ) {}

  onModuleInit() {
    const sourceUrl = this.config.get<string>('THIEVE_SOURCE_URL');
    if (!sourceUrl) {
      this.logger.log('Thieve source sync is disabled; set THIEVE_SOURCE_URL to the connected Shopify store URL.');
      return;
    }

    const configuredInterval = Number(this.config.get('THIEVE_SOURCE_SYNC_INTERVAL_MINUTES') ?? 30);
    const intervalMinutes = Number.isFinite(configuredInterval) ? Math.max(5, configuredInterval) : 30;
    void this.syncConfiguredSource().catch((error: unknown) => {
      this.logger.error('Initial Thieve source sync failed: ' + this.message(error));
    });
    this.timer = setInterval(() => {
      void this.syncConfiguredSource().catch((error: unknown) => {
        this.logger.error('Scheduled Thieve source sync failed: ' + this.message(error));
      });
    }, intervalMinutes * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private message(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown source sync error';
  }

  private sourceShopDomain(input: string): string {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new ServiceUnavailableException('THIEVE_SOURCE_URL must be a full HTTPS Shopify store URL.');
    }
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host) ||
      (url.pathname !== '/' && url.pathname !== '')
    ) {
      throw new ServiceUnavailableException(
        'THIEVE_SOURCE_URL must look like https://your-store.myshopify.com (not a Thieve webpage URL).',
      );
    }
    return host;
  }

  private async sourceFxRate(from: string, to: string) {
    const manualRate = this.config.get<string>('PRODUCT_FX_MANUAL_RATE');
    const manualFrom = String(this.config.get('PRODUCT_FX_MANUAL_FROM') ?? 'USD').toUpperCase();
    const manualTo = String(this.config.get('PRODUCT_FX_MANUAL_TO') ?? 'NGN').toUpperCase();
    if (manualRate && from === manualFrom && to === manualTo) {
      return this.currency.getRate(from, to, manualRate);
    }
    if (manualRate && from === manualTo && to === manualFrom) {
      const value = Number(manualRate);
      if (!Number.isFinite(value) || value <= 0) {
        throw new ServiceUnavailableException('PRODUCT_FX_MANUAL_RATE must be a positive number');
      }
      return this.currency.getRate(from, to, String(1 / value));
    }
    return this.currency.getRate(from, to);
  }

  private async fetchPage(shop: string, token: string, after: string | null, query: string, first: number) {
    const version = this.config.get<string>('SHOPIFY_ADMIN_API_VERSION') ?? '2026-07';
    const response = await fetch('https://' + shop + '/admin/api/' + version + '/graphql.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({
        query: SOURCE_PRODUCTS_QUERY,
        variables: { first, after, query },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => ({})) as {
      data?: {
        shop?: { currencyCode?: string };
        products?: {
          nodes?: ShopifySourceProduct[];
          pageInfo?: { hasNextPage: boolean; endCursor: string | null };
        };
      };
      errors?: { message?: string }[];
    };
    if (!response.ok || body.errors?.length || !body.data?.products) {
      const reason = body.errors?.map((item) => item.message).filter(Boolean).join('; ');
      throw new ServiceUnavailableException(
        'Shopify source query failed (' + response.status + '). Check read_products and read_inventory scopes.' +
        (reason ? ' ' + reason : ''),
      );
    }
    const storeCurrency = String(body.data.shop?.currencyCode ?? '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(storeCurrency)) {
      throw new ServiceUnavailableException('Shopify did not return a valid store currency; source sync stopped to avoid mispricing');
    }
    return {
      nodes: body.data.products.nodes ?? [],
      pageInfo: body.data.products.pageInfo,
      storeCurrency,
    };
  }

  async syncConfiguredSource() {
    if (this.syncing) return { skipped: true, reason: 'A source sync is already running' };
    const sourceUrl = this.config.get<string>('THIEVE_SOURCE_URL');
    if (!sourceUrl) return { enabled: false, imported: 0, updated: 0 };

    this.syncing = true;
    try {
      const shop = this.sourceShopDomain(sourceUrl);
      const store = await this.stores.findByShop(shop);
      if (!store) throw new ServiceUnavailableException('Connect ' + shop + ' through Shopify OAuth before source sync can run.');
      const token = await this.tokens.getValidToken(shop);
      const tag = this.config.get<string>('THIEVE_SOURCE_TAG')?.trim();
      const safeTag = tag?.replace(/[^a-zA-Z0-9_-]/g, '');
      if (tag && (!safeTag || safeTag !== tag)) throw new ServiceUnavailableException('THIEVE_SOURCE_TAG may contain only letters, numbers, hyphens, and underscores');
      const sourceStatus = String(this.config.get('THIEVE_SOURCE_STATUS') ?? 'draft').toLowerCase();
      if (!['draft', 'active', 'archived', 'any'].includes(sourceStatus)) {
        throw new ServiceUnavailableException('THIEVE_SOURCE_STATUS must be draft, active, archived, or any');
      }
      if (sourceStatus !== 'draft' && !safeTag) {
        throw new ServiceUnavailableException('Set THIEVE_SOURCE_TAG when sourcing non-draft products to avoid importing the entire store');
      }
      const queryParts: string[] = [];
      if (sourceStatus !== 'any') queryParts.push('status:' + sourceStatus);
      if (safeTag) queryParts.push('tag:' + safeTag);
      const query = queryParts.join(' ') || 'status:draft';
      let after: string | null = null;
      let hasNextPage = true;
      let pages = 0;
      let imported = 0;
      let updated = 0;
      let inspected = 0;
      const maxProducts = Number(this.config.get('THIEVE_SOURCE_MAX_PRODUCTS') ?? 1000);
      if (!Number.isInteger(maxProducts) || maxProducts < 1 || maxProducts > 10000) {
        throw new ServiceUnavailableException('THIEVE_SOURCE_MAX_PRODUCTS must be an integer from 1 to 10000');
      }

      while (hasNextPage && inspected < maxProducts) {
        const connection = await this.fetchPage(shop, token, after, query, Math.min(25, maxProducts - inspected));
        if (connection.pageInfo?.hasNextPage && (!connection.pageInfo.endCursor || connection.nodes.length === 0)) {
          throw new ServiceUnavailableException('Shopify source pagination returned no usable cursor; sync stopped to avoid looping');
        }
        for (const source of connection.nodes) {
          inspected++;
          const variants = source.variants?.nodes ?? [];
          const sellingCurrency = connection.storeCurrency;
          const validationErrors: string[] = [];
          const normalizedVariants: {
            id: string;
            title: string;
            sku: string | null;
            supplierPrice: number | null;
            supplierCurrency: string | null;
            sellingPrice: number;
            sellingCurrency: string;
            grossMarginPercent: number | null;
          }[] = [];
          const minimumMargin = Number(this.config.get('PRODUCT_MIN_GROSS_MARGIN_PERCENT') ?? 20);
          const minimumMarginValid = Number.isFinite(minimumMargin) && minimumMargin >= 0 && minimumMargin <= 100;
          if (!minimumMarginValid) {
            validationErrors.push('PRODUCT_MIN_GROSS_MARGIN_PERCENT must be a number between 0 and 100');
          }

          if (source.title.trim().length < 5) validationErrors.push('Product title is missing or too short');
          if (variants.length === 0) validationErrors.push('Product has no variants to validate');
          if (source.variants?.pageInfo?.hasNextPage) {
            validationErrors.push('Product has more than 20 variants; increase the source variant page size before approval');
          }
          const imageUrls = (source.images?.nodes ?? [])
            .map((image) => image.url)
            .filter((url) => /^https:\/\//i.test(url));
          if (!imageUrls.length) validationErrors.push('At least one HTTPS product image is required');

          for (const variant of variants) {
            const label = variant.title || variant.sku || 'Unnamed variant';
            const cost = variant.inventoryItem?.unitCost;
            const supplierPrice = Number(cost?.amount ?? 0);
            const supplierCurrency = String(cost?.currencyCode ?? '').toUpperCase();
            const sellingPrice = Number(variant.price ?? 0);
            let margin: number | null = null;

            if (!Number.isFinite(supplierPrice) || supplierPrice <= 0) {
              validationErrors.push(label + ': supplier cost is missing or invalid');
            }
            if (!/^[A-Z]{3}$/.test(supplierCurrency)) {
              validationErrors.push(label + ': supplier cost currency is missing or invalid');
            }
            if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
              validationErrors.push(label + ': selling price is missing or invalid');
            }

            if (
              Number.isFinite(supplierPrice) && supplierPrice > 0 &&
              /^[A-Z]{3}$/.test(supplierCurrency) &&
              Number.isFinite(sellingPrice) && sellingPrice > 0
            ) {
              try {
                const fx = await this.sourceFxRate(supplierCurrency, sellingCurrency);
                margin = Math.round(((sellingPrice - supplierPrice * fx.rate) / sellingPrice) * 10000) / 100;
                if (minimumMarginValid && margin < minimumMargin) {
                  validationErrors.push(label + ': estimated gross margin is below ' + minimumMargin + '%');
                }
              } catch {
                validationErrors.push(label + ': could not obtain a supplier-to-store FX rate');
              }
            }

            normalizedVariants.push({
              id: variant.id,
              title: variant.title,
              sku: variant.sku,
              supplierPrice: Number.isFinite(supplierPrice) && supplierPrice > 0 ? supplierPrice : null,
              supplierCurrency: /^[A-Z]{3}$/.test(supplierCurrency) ? supplierCurrency : null,
              sellingPrice: Number.isFinite(sellingPrice) && sellingPrice > 0 ? sellingPrice : 0,
              sellingCurrency,
              grossMarginPercent: margin,
            });
          }

          const validCosts = normalizedVariants.filter((variant) => variant.supplierPrice !== null);
          const validSellingPrices = normalizedVariants.filter((variant) => variant.sellingPrice > 0);
          const validMargins = normalizedVariants
            .map((variant) => variant.grossMarginPercent)
            .filter((margin): margin is number => margin !== null);
          const supplierCurrencies = [...new Set(validCosts.map((variant) => variant.supplierCurrency).filter((value): value is string => Boolean(value)))];
          if (supplierCurrencies.length > 1) {
            validationErrors.push('Variants have different supplier currencies; normalize supplier costs before approval');
          }
          const supplierCurrency = supplierCurrencies.length === 1 ? supplierCurrencies[0] : '';
          const supplierPrice = validCosts.length
            ? Math.min(...validCosts.map((variant) => variant.supplierPrice as number))
            : 0;
          const sellingPrice = validSellingPrices.length
            ? Math.min(...validSellingPrices.map((variant) => variant.sellingPrice))
            : 0;
          const grossMarginPercent = validMargins.length ? Math.min(...validMargins) : null;

          const saved = await this.products.saveFromThieveSource({
            sourceShopifyProductId: source.id,
            sourceUrl: 'https://' + shop + '/admin/products/' + source.id.split('/').pop(),
            supplierName: source.vendor || 'Thieve',
            title: source.title,
            bodyHtml: source.descriptionHtml ?? null,
            supplierPrice,
            supplierCurrency,
            sellingPrice,
            sellingCurrency,
            grossMarginPercent,
            imageUrls,
            variants: normalizedVariants,
            validationErrors,
          }, store);
          if (saved.created) imported++;
          else updated++;
        }
        hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
        after = connection.pageInfo?.endCursor ?? null;
        pages++;
      }

      const summary = { shop, inspected, imported, updated, pages, query, truncated: hasNextPage };
      this.logger.log('Thieve source sync completed: ' + JSON.stringify(summary));
      return summary;
    } finally {
      this.syncing = false;
    }
  }
}
