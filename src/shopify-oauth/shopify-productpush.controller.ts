import { Controller, Query, Get, BadRequestException } from '@nestjs/common';
import { ProductsService } from './product.service';
import { ShopifyStoresService } from './shopify-stores.service';
import { ShopifyProductsService } from './shopify-products.service';
import { ShopifyTokenService } from './shopify-token.service';

@Controller('api/shopify-products')
export class ShopifyProductPushController {
  constructor(
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
    if (!shop || !productId) {
      throw new BadRequestException(
        'Both shop and productId query params are required',
      );
    }

    try {
      const store = await this.shopifyStoresService.findByShop(shop);

      if (!store) {
        return {
          success: false,
          error: 'Store not found - install the app first',
        };
      }

      const product = await this.productsService.findById(productId);

      if (!product) {
        return {
          success: false,
          error: 'Product not found',
        };
      }

      if (product.status === 'imported') {
        return {
          success: false,
          error: 'Product already imported to Shopify',
        };
      }

      const accessToken = await this.shopifyTokenService.getValidToken(shop);

      const shopifyProduct =
        await this.shopifyProductsService.createProductInShopify(
          accessToken,
          shop,
          product,
        );

      return {
        success: true,
        message: 'Product pushed to Shopify successfully',
        product: shopifyProduct,
      };
    } catch (error: any) {
      console.error(error);

      return {
        success: false,
        error: 'Failed to push product to Shopify',
        details: error?.message ?? 'Unknown error',
      };
    }
  }
}
