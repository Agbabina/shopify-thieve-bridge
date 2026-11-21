import { Module } from '@nestjs/common';
import { ProductScraperController } from './product-scraper.controller';
import { ProductScraperService } from './product-scraper.service';
import { ThieveSourceService } from './thieve-source.service';
import { ShopifyModule } from '../shopify-oauth/shopify.module';

@Module({
  imports: [ShopifyModule],
  controllers: [ProductScraperController],
  providers: [ProductScraperService, ThieveSourceService],
})
export class ProductScraperModule {}
