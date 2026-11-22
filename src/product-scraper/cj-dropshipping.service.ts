import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type CjEnvelope<T> = {
  code?: number;
  result?: boolean;
  success?: boolean;
  message?: string;
  data?: T;
};

type CjTokenData = {
  accessToken: string;
  accessTokenExpiryDate: string;
  refreshToken: string;
  refreshTokenExpiryDate: string;
};

type CjProduct = {
  id: string;
  nameEn: string;
  sku: string;
  bigImage: string;
  sellPrice: string;
  nowPrice?: string;
  discountPrice?: string;
  supplierName?: string;
  warehouseInventoryNum?: number;
  totalVerifiedInventory?: number;
  categoryId?: string;
  threeCategoryName?: string;
  description?: string;
  deliveryCycle?: string;
  addMarkStatus?: number;
};

type CjProductSearchData = {
  pageSize: number;
  pageNumber: number;
  totalRecords: number;
  totalPages: number;
  content: Array<{ productList?: CjProduct[] }>;
};

@Injectable()
export class CjDropshippingService {
  private readonly logger = new Logger(CjDropshippingService.name);
  private readonly apiBase = 'https://developers.cjdropshipping.com/api2.0/v1';
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('CJ_API_KEY')?.trim());
  }

  private async request<T>(
    path: string,
    options: { method?: 'GET' | 'POST'; query?: Record<string, string | number | undefined>; body?: unknown; authenticated?: boolean } = {},
  ): Promise<T> {
    const url = new URL(this.apiBase + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.authenticated) headers['CJ-Access-Token'] = await this.getAccessToken();

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        'CJ API request failed: ' + (error instanceof Error ? error.message : 'network error'),
      );
    }

    const payload = await response.json().catch(() => null) as CjEnvelope<T> | null;
    if (!response.ok || !payload || (payload.code !== undefined && payload.code !== 0 && payload.code !== 200) || payload.result === false || payload.success === false) {
      const detail = payload?.message || response.statusText || 'Unknown CJ API error';
      throw new ServiceUnavailableException('CJ API returned an error (' + response.status + '): ' + detail);
    }
    return payload.data as T;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) return this.accessToken;

    if (this.refreshToken) {
      try {
        const refreshed = await this.request<CjTokenData>('/authentication/refreshAccessToken', {
          method: 'POST',
          body: { refreshToken: this.refreshToken },
        });
        this.cacheTokens(refreshed);
        return this.accessToken as string;
      } catch (error) {
        this.logger.warn('CJ refresh token was rejected; requesting a new token with the configured API key.');
        this.accessToken = null;
        this.refreshToken = null;
        if (!(error instanceof ServiceUnavailableException)) throw error;
      }
    }

    const apiKey = this.config.get<string>('CJ_API_KEY')?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException('CJ sourcing is not configured. Add CJ_API_KEY to shopify.env.');
    }

    const tokenData = await this.request<CjTokenData>('/authentication/getAccessToken', {
      method: 'POST',
      body: { apiKey },
    });
    this.cacheTokens(tokenData);
    return this.accessToken as string;
  }

  private cacheTokens(tokens: CjTokenData) {
    if (!tokens?.accessToken || !tokens?.accessTokenExpiryDate) {
      throw new ServiceUnavailableException('CJ authentication response did not contain a valid access token.');
    }
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken || null;
    const expiry = Date.parse(tokens.accessTokenExpiryDate);
    this.accessTokenExpiresAt = Number.isFinite(expiry) ? expiry : Date.now() + 179 * 24 * 60 * 60 * 1000;
  }

  async searchProducts(input: { keyword: string; page?: number; size?: number; countryCode?: string }) {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('CJ sourcing is not configured. Add CJ_API_KEY to shopify.env.');
    }
    const keyword = input.keyword.trim();
    if (!keyword || keyword.length > 200) {
      throw new ServiceUnavailableException('keyword must contain between 1 and 200 characters.');
    }
    const page = input.page ?? 1;
    const size = input.size ?? 20;
    if (!Number.isInteger(page) || page < 1 || page > 1000) {
      throw new ServiceUnavailableException('page must be an integer from 1 to 1000.');
    }
    if (!Number.isInteger(size) || size < 1 || size > 100) {
      throw new ServiceUnavailableException('size must be an integer from 1 to 100.');
    }
    if (input.countryCode && !/^[A-Z]{2}$/.test(input.countryCode)) {
      throw new ServiceUnavailableException('countryCode must be a two-letter ISO country code.');
    }

    const data = await this.request<CjProductSearchData>('/product/listV2', {
      authenticated: true,
      query: {
        keyWord: keyword,
        page,
        size,
        countryCode: input.countryCode,
        features: 'enable_description,enable_category',
      },
    });

    const products = (data?.content ?? []).flatMap((group) => group.productList ?? []);
    return {
      supplier: 'CJdropshipping',
      page: data?.pageNumber ?? page,
      pageSize: data?.pageSize ?? size,
      totalRecords: data?.totalRecords ?? products.length,
      totalPages: data?.totalPages ?? 1,
      products: products.map((product) => ({
        supplierProductId: product.id,
        supplierSku: product.sku,
        title: product.nameEn,
        imageUrl: product.bigImage,
        supplierPrice: Number(product.discountPrice || product.nowPrice || product.sellPrice),
        currency: 'USD',
        supplierName: product.supplierName || 'CJdropshipping',
        category: product.threeCategoryName,
        availableStock: product.totalVerifiedInventory ?? product.warehouseInventoryNum ?? null,
        shippingDaysEstimate: product.deliveryCycle ?? null,
        freeShipping: product.addMarkStatus === 1,
        description: product.description ?? null,
        source: 'cj',
      })),
    };
  }
}
