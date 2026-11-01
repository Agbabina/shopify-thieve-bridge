import { Injectable } from '@nestjs/common';
import { chromium } from 'playwright';
import * as cheerio from 'cheerio';

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
    const allowed = ['aliexpress.com', 'thieve.co'];
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
        !allowed.some((domain) => host === domain || host.endsWith('.' + domain))) {
      throw new Error('Only HTTPS AliExpress or Thieve product URLs are allowed');
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
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
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
    let productData: any = null;

    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const json = JSON.parse($(el).html() || '');
        const candidate = Array.isArray(json)
          ? json.find((j) => j['@type'] === 'Product')
          : json;
        if (candidate && candidate['@type'] === 'Product') {
          productData = candidate;
        }
      } catch (e) {
        // not valid JSON or not the right script tag, skip it
      }
    });

    if (!productData) {
      return null;
    }

    return {
      title: productData.name,
      images: productData.image,
      price: productData.offers?.price,
      currency: productData.offers?.priceCurrency,
      availability: productData.offers?.availability,
      sourceUrl: productData.offers?.url,
    };
  }

  async scrapeProductWithRetry(url: string, maxAttempts: number = 2) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const html = await this.scrapeProduct(url);
      if (html.length > 150000) {
        return html;
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
    throw new Error(
      'Could not get a full product page after retries - likely bot-blocked',
    );
  }

  async scrapeAndParse(url: string) {
    const html = await this.scrapeProductWithRetry(url);
    return this.parseProduct(html);
  }

  private async loadSearchPage(searchUrl: string) {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
      });

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
