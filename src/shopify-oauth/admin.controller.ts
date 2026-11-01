import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { Product } from './entities/product.entity';
import { ShopifyStore } from './entities/shopify-store.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import { OrdersService } from './orders.service';
import { CurrencyService } from './currency.service';
import { ConfigService } from '@nestjs/config';

@Controller('api/admin')
@UseGuards(AdminApiKeyGuard)
export class AdminController {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(ShopifyStore) private readonly stores: Repository<ShopifyStore>,
    @InjectRepository(WebhookEvent) private readonly webhookEvents: Repository<WebhookEvent>,
    private readonly ordersService: OrdersService,
    private readonly currency: CurrencyService,
    private readonly config: ConfigService,
  ) {}

  @Get('dashboard')
  async dashboard() {
    const [orderCount, productCount, pendingOrders, draftProducts, revenue, stores, recentOrders, recentProducts, recentWebhooks] = await Promise.all([
      this.orders.count(),
      this.products.count(),
      this.orders.count({ where: [{ status: 'pending' }, { status: 'paid' }, { status: 'fulfillment_in_progress' }] }),
      this.products.count({ where: { status: 'draft' } }),
      this.orders.createQueryBuilder('order').select('COALESCE(SUM(order.total), 0)', 'total').getRawOne(),
      this.stores.find({ select: { id: true, shop: true, scope: true, updatedAt: true, lastRefreshAt: true }, order: { updatedAt: 'DESC' } }),
      this.ordersService.dashboardOrders(15),
      this.products.find({ relations: { store: true }, order: { id: 'DESC' }, take: 15 }),
      this.webhookEvents.find({ order: { processedAt: 'DESC' }, take: 10 }),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      metrics: { orderCount, productCount, pendingOrders, draftProducts, revenue: Number(revenue?.total ?? 0) },
      payment: { provider: this.config.get<string>('SHOPIFY_PAYMENT_PROVIDER') ?? null, storeCurrency: this.config.get<string>('SHOPIFY_STORE_CURRENCY') ?? 'NGN', setupRequired: !this.config.get<string>('SHOPIFY_PAYMENT_PROVIDER') },
      stores,
      recentOrders,
      recentWebhooks,
      recentProducts: recentProducts.map((product) => ({
        id: product.id, title: product.description, supplierPrice: product.supplierPrice, supplierCurrency: product.supplierCurrency || 'USD',
        sellingPrice: product.sellingPrice, status: product.status,
        shopifyProductId: product.shopifyProductId, shop: product.store?.shop,
      })),
    };
  }

  @Get('currency/rate')
  currencyRate(@Query('from') from: string, @Query('to') to: string, @Query('manualRate') manualRate?: string) {
    if (!from || !to) throw new BadRequestException('Both from and to currency codes are required.');
    return this.currency.getRate(from, to, manualRate);
  }

  @Get('payments/status')
  paymentStatus() {
    const provider = this.config.get<string>('SHOPIFY_PAYMENT_PROVIDER') ?? null;
    return { provider, storeCurrency: this.config.get<string>('SHOPIFY_STORE_CURRENCY') ?? 'NGN', setupRequired: !provider, dashboardUrl: 'https://admin.shopify.com', setupPath: 'Settings > Payments > Add payment methods', note: 'The store owner must activate the gateway in Shopify. Bridge does not collect card details.' };
  }

  @Get('orders')
  listOrders() { return this.ordersService.dashboardOrders(100); }

  @Get('products')
  async listProducts() {
    const products = await this.products.find({ relations: { store: true }, order: { id: 'DESC' }, take: 100 });
    return products.map((product) => ({
      id: product.id, title: product.description, supplierPrice: product.supplierPrice, supplierCurrency: product.supplierCurrency || 'USD',
      sellingPrice: product.sellingPrice, status: product.status,
      shopifyProductId: product.shopifyProductId, shop: product.store?.shop,
    }));
  }
}
