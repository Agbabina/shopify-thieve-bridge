import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { ShopifyModule } from './shopify-oauth/shopify.module';
import { ProductScraperModule } from './product-scraper/product-scraper.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [path.resolve(process.cwd(), 'shopify.env'), path.resolve(process.cwd(), '.env')],
    }),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: process.env.SHOPIFY_DB_PATH || 'shopify.db',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: process.env.NODE_ENV !== 'production',
    }),
    ShopifyModule,
    ProductScraperModule,
  ],
})
export class AppModule {}
