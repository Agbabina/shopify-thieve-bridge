import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { Repository } from 'typeorm';
import { ShopifyStore } from './entities/shopify-store.entity';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private ordersRepo: Repository<Order>,
    @InjectRepository(ShopifyStore)
    private storeRepository: Repository<ShopifyStore>,
  ) {}

  private toResponse(order: Order) {
    return {
      id: order.id,
      shopifyOrderId: order.shopifyOrderId,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      total: order.total,
      status: order.status,
      trackingNumber: order.trackingNumber,
      trackingCompany: order.trackingCompany,
      trackingUrl: order.trackingUrl,
      fulfilledAt: order.fulfilledAt,
      shop: order.store?.shop,
    };
  }

  async saveFromWebhook(payload: any, store: ShopifyStore) {
    const order = this.ordersRepo.create({
      shopifyOrderId: payload.id.toString(),
      customerName:
        `${payload.customer?.first_name ?? ''} ${payload.customer?.last_name ?? ''}`.trim() ||
        'Guest',
      customerEmail: payload.customer?.email ?? payload.email ?? '',
      total: parseFloat(payload.total_price),
      status: 'pending',
      store,
    });
    return this.toResponse(await this.ordersRepo.save(order));
  }

  async create(data: {
    shopifyOrderId: string;
    customerName: string;
    customerEmail: string;
    total: number;
    status: string;
    shop: string;
  }) {
    const store = await this.storeRepository.findOne({
      where: { shop: data.shop },
    });
    if (!store) {
      throw new Error('Store not found');
    }
    const order = this.ordersRepo.create({
      shopifyOrderId: data.shopifyOrderId,
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      total: data.total,
      status: data.status,
      store,
    });
    return this.toResponse(await this.ordersRepo.save(order));
  }

  async findByShopifyOrderId(
    shopifyOrderId: string,
    shop: string,
  ): Promise<Order | null> {
    return this.ordersRepo.findOne({
      where: { shopifyOrderId, store: { shop } },
      relations: { store: true },
    });
  }

  async markFulfilled(
    order: Order,
    tracking: { number: string; company?: string; url?: string },
  ) {
    order.status = 'fulfilled';
    order.trackingNumber = tracking.number;
    order.trackingCompany = tracking.company ?? null;
    order.trackingUrl = tracking.url ?? null;
    order.fulfilledAt = new Date();
    return this.toResponse(await this.ordersRepo.save(order));
  }
}