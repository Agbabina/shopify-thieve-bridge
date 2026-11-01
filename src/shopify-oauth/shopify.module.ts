import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShopifyController } from './shopify.controller';
import { ShopifyOAuthService } from './shopify-oauth.service';
import { ShopifyStoresService } from './shopify-stores.service';
import { ProductsService } from './product.service';
import { ShopifyStore } from './entities/shopify-store.entity';
import { Product } from './entities/product.entity';
import { Order } from './entities/order.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { ShopifyTokenService } from './shopify-token.service';
import { ShopifyProductsService } from './shopify-products.service';
import { ShopifyProductPushController } from './shopify-productpush.controller';
import { OrdersService } from './orders.service';
import { FulfillmentController } from './fulfillment.controller';
import { FulfillmentService } from './fulfillment.service';
import { AdminController } from './admin.controller';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import { WebhookEventsService } from './webhook-events.service';

@Module({
  imports: [TypeOrmModule.forFeature([ShopifyStore, Product, Order, WebhookEvent])],
  controllers: [ShopifyController, ShopifyProductPushController, FulfillmentController, AdminController],
  providers: [
    ShopifyOAuthService, ShopifyStoresService, ProductsService, ShopifyProductsService,
    ShopifyTokenService, OrdersService, FulfillmentService, AdminApiKeyGuard, WebhookEventsService,
  ],
  exports: [ShopifyStoresService, ProductsService, ShopifyProductsService, ShopifyTokenService, OrdersService],
})
export class ShopifyModule {}
