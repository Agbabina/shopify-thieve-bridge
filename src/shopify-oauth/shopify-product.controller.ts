import { Controller, Query, Get } from '@nestjs/common';
import { ProductScraperService } from './../product-scraper/product-scraper.service';
import { ProductsService } from './product.service';
import { ShopifyProductsService } from './shopify-products.service';
import { ShopifyStoresService } from './shopify-stores.service';
import { ShopifyTokenService } from './shopify-token.service';

@Controller('api/shopify-products')
export class ShopifyControllerController {
  constructor(
    private readonly scraperService: ProductScraperService,
    private readonly productsService: ProductsService,
    private readonly shopifyStoresService: ShopifyStoresService,
    private readonly shopifyProductsService: ShopifyProductsService,
    private readonly shopifyTokenService: ShopifyTokenService,
  ) {}
  @Get('push-to-shopify')
  async pushToShopify(
    @Query('productId') productId: string,
    @Query('shop') shop: string,
  ) {
    const store = await this.shopifyStoresService.findByShop(shop);
    if (!store) {
      return { error: 'Store not found - install the app first' };
    }
    const product = await this.productsService.findById(productId);
    if (!product) {
      return { error: 'Product not found' };
    }

    const accessToken = await this.shopifyTokenService.getValidToken(shop);
    const updatedProduct =
      await this.shopifyProductsService.createProductInShopify(
        accessToken,
        shop,
        product,
      );
    return { message: 'Product pushed to Shopify', product: updatedProduct };
  }
}
