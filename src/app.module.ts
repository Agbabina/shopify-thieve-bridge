import { ProductScraperModule } from './product-scraper/product-scraper.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';

import { ShopifyModule } from './shopify-oauth/shopify.module';

@Module({
  imports: [
    ProductScraperModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), 'shopify.env'),
    }),

    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'shopify.db',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: true,
    }),

    ShopifyModule,
  ],
})
export class AppModule {}
