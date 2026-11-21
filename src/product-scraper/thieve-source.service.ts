import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductsService } from '../shopify-oauth/product.service';
import { ShopifyStoresService } from '../shopify-oauth/shopify-stores.service';
import { ShopifyTokenService } from '../shopify-oauth/shopify-token.service';

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
  variants: { nodes: ShopifyVariant[] };
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
        images(first: 20) { nodes { url } }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            inventoryItem { unitCost { amount currencyCode } }
          }
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

  private async fetchPage(shop: string, token: string, after: string | null, query: string) {
    const version = this.config.get<string>('SHOPIFY_ADMIN_API_VERSION') ?? '2026-07';
    const response = await fetch('https://' + shop + '/admin/api/' + version + '/graphql.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({
        query: SOURCE_PRODUCTS_QUERY,
        variables: { first: 50, after, query },
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
    return {
      nodes: body.data.products.nodes ?? [],
      pageInfo: body.data.products.pageInfo,
      storeCurrency: String(body.data.shop?.currencyCode ?? 'NGN').toUpperCase(),
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
      const query = safeTag ? 'status:draft tag:' + safeTag : 'status:draft';
      let after: string | null = null;
      let hasNextPage = true;
      let pages = 0;
      let imported = 0;
      let updated = 0;
      let inspected = 0;

      while (hasNextPage && pages < 4) {
        const connection = await this.fetchPage(shop, token, after, query);
        for (const source of connection.nodes) {
          inspected++;
          const variants = source.variants?.nodes ?? [];
          const primary = variants[0];
          const cost = primary?.inventoryItem?.unitCost;
          const supplierPrice = Number(cost?.amount ?? 0);
          const sellingPrice = Number(primary?.price ?? 0);
          const sellingCurrency = connection.storeCurrency;
          const supplierCurrency = String(cost?.currencyCode ?? sellingCurrency).toUpperCase();
          const imageUrls = (source.images?.nodes ?? [])
            .map((image) => image.url)
            .filter((url) => /^https:\/\//i.test(url));
          const validationErrors: string[] = [];

          if (source.title.trim().length < 5) validationErrors.push('Product title is missing or too short');
          if (variants.length !== 1) validationErrors.push('This Bridge version requires exactly one variant; map variants before approval');
          if (!Number.isFinite(supplierPrice) || supplierPrice <= 0) validationErrors.push('Supplier cost is missing from Shopify inventory item cost; add a verified cost before approval');
          if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) validationErrors.push('Shopify variant selling price is missing or invalid');
          if (!/^[A-Z]{3}$/.test(supplierCurrency)) validationErrors.push('Supplier currency is missing or invalid');
          if (!imageUrls.length) validationErrors.push('At least one HTTPS product image is required');

          const saved = await this.products.saveFromThieveSource({
            sourceShopifyProductId: source.id,
            sourceUrl: source.onlineStoreUrl || 'https://' + shop + '/products/' + source.handle,
            supplierName: source.vendor || 'Thieve',
            title: source.title,
            supplierPrice: Number.isFinite(supplierPrice) && supplierPrice > 0 ? supplierPrice : 0,
            supplierCurrency,
            sellingPrice: Number.isFinite(sellingPrice) && sellingPrice > 0 ? sellingPrice : 0,
            sellingCurrency,
            imageUrls,
            variants,
            validationErrors,
          }, store);
          if (saved.created) imported++;
          else updated++;
        }
        hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
        after = connection.pageInfo?.endCursor ?? null;
        pages++;
      }

      const summary = { shop, inspected, imported, updated, pages, query };
      this.logger.log('Thieve source sync completed: ' + JSON.stringify(summary));
      return summary;
    } finally {
      this.syncing = false;
    }
  }
}
