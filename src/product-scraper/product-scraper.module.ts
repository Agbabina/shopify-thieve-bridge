import { Module } from '@nestjs/common';
import { ProductScraperController } from './product-scraper.controller';
import { ProductScraperService } from './product-scraper.service';
import { ShopifyModule } from '../shopify-oauth/shopify.module';

@Module({
  imports: [ShopifyModule],
  controllers: [ProductScraperController],
  providers: [ProductScraperService],
})
export class ProductScraperModule {}
