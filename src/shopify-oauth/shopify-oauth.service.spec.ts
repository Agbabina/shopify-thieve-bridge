import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../app.module';
import { ShopifyOAuthService } from './shopify-oauth.service';

describe('ShopifyOAuthService', () => {
  let service: ShopifyOAuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    service = module.get<ShopifyOAuthService>(ShopifyOAuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('loads Shopify credentials from the environment file', () => {
    const configService = Test.createTestingModule({
      imports: [AppModule],
    }).get(ConfigService);

    expect(configService.get('SHOPIFY_API_KEY')).toBeDefined();
    expect(configService.get('SHOPIFY_API_SECRET')).toBeDefined();
  });
});
