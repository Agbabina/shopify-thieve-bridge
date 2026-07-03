import { Module } from '@nestjs/common';
import { ShopifyController } from './shopify.controller';
import { ShopifyOAuthService } from './shopify-oauth.service';

@Module({
  controllers: [ShopifyController],
  providers: [ShopifyOAuthService],
})
export class ShopifyModule {}