import { Injectable } from '@nestjs/common';
import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MOCK_PRODUCTS = [
  {
    title:
      '50pcs Scissor Sheath Cover Durable Hair Cutting Tool Protection Salon Shear Case',
    price: '6062.66',
    currency: 'NGN',
    images: [
      'https://ae-pic-a1.aliexpress-media.com/kf/Sc82d373c9a104344b5556a76615365766.jpg',
      'https://ae-pic-a1.aliexpress-media.com/kf/Sac234d5fb36a40d0a87175595d0acf86I.jpg',
    ],
    availability: 'https://schema.org/InStock',
  },
  {
    title:
      'Professional Hair Cutting Scissors Set Barber Shears Stainless Steel',
    price: '8500.00',
    currency: 'NGN',
    images: [
      'https://ae01.alicdn.com/kf/mock-scissors-set-1.jpg',
      'https://ae01.alicdn.com/kf/mock-scissors-set-2.jpg',
    ],
    availability: 'https://schema.org/InStock',
  },
  {
    title: 'Portable LED Facial Steamer Deep Cleansing Pore Cleaner',
    price: '12300.50',
    currency: 'NGN',
    images: ['https://ae01.alicdn.com/kf/mock-facial-steamer-1.jpg'],
    availability: 'https://schema.org/InStock',
  },
  {
    title: 'Sonic Facial Cleansing Brush Silicone Waterproof Rechargeable',
    price: '9750.00',
    currency: 'NGN',
    images: [
      'https://ae01.alicdn.com/kf/mock-sonic-brush-1.jpg',
      'https://ae01.alicdn.com/kf/mock-sonic-brush-2.jpg',
    ],
    availability: 'https://schema.org/InStock',
  },
  {
    title: 'Microcurrent Facial Massager Anti-Aging Skin Tightening Device',
    price: '15600.00',
    currency: 'NGN',
    images: ['https://ae01.alicdn.com/kf/mock-microcurrent-1.jpg'],
    availability: 'https://schema.org/InStock',
  },
];

@Injectable()
export class ProductScraperService {
  private validateSupplierUrl(input: string) {
    let parsed: URL;
    try { parsed = new URL(input); }
    catch { throw new Error('A valid supplier URL is required'); }
    const host = parsed.hostname.toLowerCase();
    const isAliExpress = host === 'aliexpress.com' || host.endsWith('.aliexpress.com');
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !isAliExpress) {
      if (host === 'thieve.co' || host.endsWith('.thieve.co')) {
        throw new Error('Do not scrape Thieve pages. Use the official Thieve Shopify app and Bridge source sync instead.');
      }
      throw new Error('Only HTTPS AliExpress product URLs are supported by the manual importer');
    }
  }

  private isPrivateAddress(address: string) {
    const version = isIP(address);
    if (version === 4) {
      const parts = address.split('.').map(Number);
      const [a, b] = parts;
      return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) ||
        a >= 224;
    }
    if (version === 6) {
      const value = address.toLowerCase();
      return value === '::' || value === '::1' || value.startsWith('fc') ||
        value.startsWith('fd') || /^fe[89ab]/.test(value) || value.startsWith('ff') ||
        value.startsWith('::ffff:');
    }
    return true;
  }

  private async assertSafeRequestUrl(input: string, navigation: boolean) {
    const url = new URL(input);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || isIP(host)) {
      throw new Error('Blocked unsafe outbound request');
    }
    const allowedSupplierHost = host === 'aliexpress.com' || host.endsWith('.aliexpress.com');
    const allowedAssetHost = host === 'alicdn.com' || host.endsWith('.alicdn.com') ||
      host === 'aliexpress-media.com' || host.endsWith('.aliexpress-media.com');
    if (navigation && !allowedSupplierHost) throw new Error('Blocked redirect outside the approved supplier domain');
    if (!navigation && !allowedSupplierHost && !allowedAssetHost) throw new Error('Blocked request to an unapproved supplier asset host');
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((item) => this.isPrivateAddress(item.address))) {
      throw new Error('Blocked outbound request to a private or non-routable address');
    }
  }

  async scrapeProduct(url: string) {
    this.validateSupplierUrl(url);
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
        locale: 'en-US',
      });
      await context.route('**/*', async (route) => {
        try {
          await this.assertSafeRequestUrl(route.request().url(), route.request().isNavigationRequest());
          await route.continue();
        } catch {
          await route.abort('blockedbyclient');
        }
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.validateSupplierUrl(page.url());
      const html = await page.content();
      return html;
    } finally {
      await browser.close();
    }
  }

  async findSnippet(url: string, text: string) {
    const html = await this.scrapeProduct(url);
    const found = html.toLowerCase().includes(text.toLowerCase());
    return { found, text };
  }

  parseProduct(html: string) {
    const $ = cheerio.load(html);
    const candidates: any[] = [];
    const collectProducts = (value: any) => {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach(collectProducts);
        return;
      }
      if (typeof value !== 'object') return;
      const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
      if (types.includes('Product')) candidates.push(value);
      if (value['@graph']) collectProducts(value['@graph']);
      if (value.itemListElement) collectProducts(value.itemListElement.map((item: any) => item.item ?? item));
    };

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        collectProducts(JSON.parse($(el).html() || ''));
      } catch {
        // Ignore malformed JSON-LD blocks and continue looking for product data.
      }
    });

    const productData = candidates[0];
    if (!productData) return null;
    const offerValue = productData.offers;
    const offer = Array.isArray(offerValue) ? offerValue[0] : offerValue;
    const rawImages = Array.isArray(productData.image) ? productData.image : productData.image ? [productData.image] : [];
    const images = rawImages
      .map((image: any) => typeof image === 'string' ? image : image?.url)
      .filter((image: unknown) => typeof image === 'string');

    return {
      title: productData.name,
      description: productData.description,
      images,
      price: offer?.price ?? offer?.lowPrice,
      currency: offer?.priceCurrency,
      availability: offer?.availability,
      sourceUrl: offer?.url ?? productData.url,
      supplierName: 'AliExpress',
      sku: productData.sku,
    };
  }

  async scrapeProductWithRetry(url: string, maxAttempts: number = 2) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const html = await this.scrapeProduct(url);
      if (this.parseProduct(html)) {
        return html;
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
    throw new Error(
      'Could not extract structured product data after retries; the supplier page may be blocked or unsupported',
    );
  }

  async scrapeAndParse(url: string) {
    const html = await this.scrapeProductWithRetry(url);
    const parsed = this.parseProduct(html);
    return parsed ? { ...parsed, sourceUrl: url } : null;
  }

  private async loadSearchPage(searchUrl: string) {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
      });
      await context.route('**/*', async (route) => {
        try {
          await this.assertSafeRequestUrl(route.request().url(), route.request().isNavigationRequest());
          await route.continue();
        } catch {
          await route.abort('blockedbyclient');
        }
      });
      const page = await context.newPage();

      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await page.waitForTimeout(2000);

      for (let i = 0; i < 5; i++) {
        await page.mouse.wheel(0, 2000);
        await page.waitForTimeout(1000);
      }

      await page.waitForTimeout(2000);

      const html = await page.content();
      return { page, browser, html };
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  async searchProducts(keyword: string) {
    const formattedKeyword = keyword.trim().toLowerCase().replace(/\s+/g, '-');
    const searchUrl = `https://www.aliexpress.com/w/wholesale-${formattedKeyword}.html`;

    let browser;
    try {
      const result = await this.loadSearchPage(searchUrl);
      browser = result.browser;
      const { page, html } = result;

      const products = await page.$$eval("a[href*='/item/']", (items) =>
        items.slice(0, 10).map((item) => ({
          title: item.textContent?.trim(),
          href: item.getAttribute('href'),
        })),
      );

      return {
        success: true,
        keyword,
        searchUrl,
        htmlLength: html.length,
        productsFound: products.length,
        products,
      };
    } catch (error) {
      return {
        success: false,
        keyword,
        searchUrl,
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      };
    } finally {
      if (browser) await browser.close();
    }
  }

  async debugSearchHtml(keyword: string) {
    const formattedKeyword = keyword.trim().toLowerCase().replace(/\s+/g, '-');
    const searchUrl = `https://www.aliexpress.com/w/wholesale-${formattedKeyword}.html`;

    let browser;
    try {
      const result = await this.loadSearchPage(searchUrl);
      browser = result.browser;
      const { html } = result;

      const itemMatches = html.match(/\/item\//g) || [];
      const firstIndex = html.indexOf('/item/');
      const snippet =
        firstIndex !== -1
          ? html.substring(Math.max(0, firstIndex - 300), firstIndex + 300)
          : 'not found';

      const $ = cheerio.load(html);
      const bodyText = $('body').text().substring(0, 1000);
      const titleTag = $('title').text();
      const hasShippingPopup = html.toLowerCase().includes('ship to');
      const hasCookieBanner = html.toLowerCase().includes('cookie');
      const hasCaptcha =
        html.toLowerCase().includes('captcha') ||
        html.toLowerCase().includes('verify');
      const hasKeywordText = html
        .toLowerCase()
        .includes(keyword.toLowerCase().split(' ')[0]);

      return {
        htmlLength: html.length,
        itemOccurrences: itemMatches.length,
        snippet,
        titleTag,
        bodyTextPreview: bodyText,
        hasShippingPopup,
        hasCookieBanner,
        hasCaptcha,
        hasKeywordText,
      };
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      };
    } finally {
      if (browser) await browser.close();
    }
  }

  getMockProducts() {
    return MOCK_PRODUCTS;
  }
}
