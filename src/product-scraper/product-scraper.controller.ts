import { Controller, Get, Query } from '@nestjs/common';
import { ProductScraperService } from './product-scraper.service';
import { ProductsService } from '../shopify-oauth/product.service';
import { ShopifyStoresService } from '../shopify-oauth/shopify-stores.service';

@Controller('api/scraper')
export class ProductScraperController {
  constructor(
    private readonly scraperService: ProductScraperService,
    private readonly productsService: ProductsService,
    private readonly shopifyStoresService: ShopifyStoresService,
  ) {}

  @Get('test')
  async test(@Query('url') url: string) {
    const html = await this.scraperService.scrapeProduct(url);
    return { length: html.length, preview: html.substring(0, 500) };
  }

  @Get('find')
  async find(@Query('url') url: string, @Query('text') text: string) {
    return this.scraperService.findSnippet(url, text);
  }

  @Get('parse')
  async parse(@Query('url') url: string) {
    return this.scraperService.scrapeAndParse(url);
  }

  @Get('import')
  async importProduct(
    @Query('url') url: string,
    @Query('shop') shop: string,
    @Query('sellingPrice') sellingPrice?: string,
  ) {
    const store = await this.shopifyStoresService.findByShop(shop);
    if (!store) {
      return { error: 'Store not found - install the app first' };
    }

    const scrapedData = await this.scraperService.scrapeAndParse(url);
    if (!scrapedData) {
      return { error: 'Could not parse product from that URL' };
    }

    const saved = await this.productsService.saveFromScrape(
      scrapedData,
      store,
      sellingPrice ? parseFloat(sellingPrice) : undefined,
    );
    return { message: 'Product saved', product: saved };
  }

  @Get('search')
  async search(@Query('keyword') keyword: string) {
    return this.scraperService.searchProducts(keyword);
  }

  @Get('debug-search')
  async debugSearch(@Query('keyword') keyword: string) {
    return this.scraperService.debugSearchHtml(keyword);
  }

  @Get('seed-mock')
  async seedMock(@Query('shop') shop: string) {
    const store = await this.shopifyStoresService.findByShop(shop);
    if (!store) {
      return { error: 'Store not found - install the app first' };
    }

    const mockProducts = this.scraperService.getMockProducts();
    const saved: any[] = [];

    for (const mockProduct of mockProducts) {
      const suggestedSellingPrice = Math.round(
        parseFloat(mockProduct.price) * 1.5,
      );
      const product = await this.productsService.saveFromScrape(
        mockProduct,
        store,
        suggestedSellingPrice,
      );
      saved.push(product);
    }

    return { message: `${saved.length} mock products saved`, products: saved };
  }
}
