import { ShopifyModule } from './shopify-oauth/shopify.module'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ShopifyModule,
    // ...your TypeORM config etc.
  ],
})
export class AppModule {}