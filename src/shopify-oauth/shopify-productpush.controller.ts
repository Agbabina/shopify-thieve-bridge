import { BadRequestException, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ProductsService } from './product.service';
import { ShopifyStoresService } from './shopify-stores.service';
import { ShopifyProductsService } from './shopify-products.service';
import { ShopifyTokenService } from './shopify-token.service';
import { AdminApiKeyGuard } from './admin-api-key.guard';

@Controller('api/shopify-products')
@UseGuards(AdminApiKeyGuard)
export class ShopifyProductPushController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly storesService: ShopifyStoresService,
    private readonly shopifyProductsService: ShopifyProductsService,
    private readonly tokenService: ShopifyTokenService,
  ) {}

  @Post(':productId/push')
  async pushToShopify(@Param('productId') productId: string) {
    const product = await this.productsService.findById(productId);
    if (!product) throw new BadRequestException('Product not found');
    if (product.status === 'imported' || product.shopifyProductId) throw new BadRequestException('Product has already been imported');
    const store = await this.storesService.findByShop(product.store.shop);
    if (!store) throw new BadRequestException('Connected Shopify store not found');
    const token = await this.tokenService.getValidToken(store.shop);
    const created = await this.shopifyProductsService.createProductInShopify(token, store.shop, product);
    const saved = await this.productsService.markImported(product, String(created.id));
    return {
      success: true,
      message: 'Product imported as a Shopify draft',
      product: { id: saved.id, shopifyProductId: saved.shopifyProductId, status: saved.status },
    };
  }
}
