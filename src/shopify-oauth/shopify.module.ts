import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShopifyController } from './shopify.controller';
import { ShopifyOAuthService } from './shopify-oauth.service';
import { ShopifyStoresService } from './shopify-stores.service';
import { ProductsService } from './product.service';
import { ShopifyStore } from './entities/shopify-store.entity';
import { Product } from './entities/product.entity';
import { ShopifyTokenService } from './shopify-token.service';
import { ShopifyProductsService } from './shopify-products.service';
import { ShopifyProductPushController } from './shopify-productpush.controller';
import { Order } from './entities/order.entity';
import { OrdersService } from './orders.service';

@Module({
  imports: [TypeOrmModule.forFeature([ShopifyStore, Product, Order])],
  controllers: [ShopifyController, ShopifyProductPushController],
  providers: [
    ShopifyOAuthService,
    ShopifyStoresService,
    ProductsService,
    ShopifyProductsService,
    ShopifyTokenService,
    OrdersService,
  ],
  exports: [
    ShopifyStoresService,
    ProductsService,
    ShopifyProductsService,
    ShopifyTokenService,
    OrdersService,
  ],
})
export class ShopifyModule {}
