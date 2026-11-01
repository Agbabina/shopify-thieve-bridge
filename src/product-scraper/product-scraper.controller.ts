import { Body, Controller, Get, Post, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ProductScraperService } from './product-scraper.service';
import { ProductsService } from '../shopify-oauth/product.service';
import { ShopifyStoresService } from '../shopify-oauth/shopify-stores.service';
import { AdminApiKeyGuard } from '../shopify-oauth/admin-api-key.guard';

@Controller('api/scraper')
@UseGuards(AdminApiKeyGuard)
export class ProductScraperController {
  constructor(
    private readonly scraperService: ProductScraperService,
    private readonly productsService: ProductsService,
    private readonly shopifyStoresService: ShopifyStoresService,
  ) {}

  @Get('test')
  async test(@Query('url') url: string) {
    if (!url) throw new BadRequestException('url is required');
    const html = await this.scraperService.scrapeProduct(url);
    return { length: html.length, preview: html.substring(0, 500) };
  }

  @Get('find')
  async find(@Query('url') url: string, @Query('text') text: string) {
    if (!url || !text) throw new BadRequestException('url and text are required');
    return this.scraperService.findSnippet(url, text);
  }

  @Get('parse')
  async parse(@Query('url') url: string) {
    if (!url) throw new BadRequestException('url is required');
    return this.scraperService.scrapeAndParse(url);
  }

  @Post('import')
  async importProduct(@Body() body: { url?: string; shop?: string; sellingPrice?: number }) {
    if (!body.url || !body.shop) throw new BadRequestException('url and shop are required');
    if (body.sellingPrice !== undefined && (!Number.isFinite(Number(body.sellingPrice)) || Number(body.sellingPrice) <= 0)) {
      throw new BadRequestException('sellingPrice must be a positive number');
    }
    const store = await this.shopifyStoresService.findByShop(body.shop);
    if (!store) throw new BadRequestException('Store not found - install the app first');
    const scrapedData = await this.scraperService.scrapeAndParse(body.url);
    if (!scrapedData) throw new BadRequestException('Could not parse a product from that URL');
    const saved = await this.productsService.saveFromScrape(scrapedData, store, body.sellingPrice);
    return { message: 'Product saved as draft', product: saved };
  }

  @Get('search')
  async search(@Query('keyword') keyword: string) {
    if (!keyword?.trim()) throw new BadRequestException('keyword is required');
    return this.scraperService.searchProducts(keyword);
  }

  @Get('debug-search')
  async debugSearch(@Query('keyword') keyword: string) {
    if (!keyword?.trim()) throw new BadRequestException('keyword is required');
    return this.scraperService.debugSearchHtml(keyword);
  }

  @Post('seed-mock')
  async seedMock(@Body() body: { shop?: string }) {
    if (!body.shop) throw new BadRequestException('shop is required');
    const store = await this.shopifyStoresService.findByShop(body.shop);
    if (!store) throw new BadRequestException('Store not found - install the app first');
    const saved: any[] = [];
    for (const mockProduct of this.scraperService.getMockProducts()) {
      const suggestedPrice = Math.round(Number(mockProduct.price) * 1.5);
      saved.push(await this.productsService.saveFromScrape(mockProduct, store, suggestedPrice));
    }
    return { message: saved.length + ' mock products saved', products: saved };
  }
}
