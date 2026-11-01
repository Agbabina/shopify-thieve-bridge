import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { ShopifyStore } from './entities/shopify-store.entity';
import { normalizeShopDomain } from './shop-domain';

@Injectable()
export class OrdersService {
  constructor(@InjectRepository(Order) private readonly ordersRepo: Repository<Order>) {}

  private toResponse(order: Order) {
    return {
      id: order.id, shopifyOrderId: order.shopifyOrderId,
      customerName: order.customerName, customerEmail: order.customerEmail,
      total: order.total, currency: order.currency, status: order.status,
      trackingNumber: order.trackingNumber, trackingCompany: order.trackingCompany,
      trackingUrl: order.trackingUrl, fulfilledAt: order.fulfilledAt,
      lineItems: order.lineItemsJson ? JSON.parse(order.lineItemsJson) : [],
      shop: order.store?.shop, createdAt: order.createdAt,
    };
  }

  async saveFromWebhook(payload: any, store: ShopifyStore, paid = false) {
    if (!payload?.id) throw new Error('Shopify order webhook is missing its order ID');
    const shopifyOrderId = String(payload.id);
    let order = await this.ordersRepo.findOne({
      where: { shopifyOrderId, store: { id: store.id } },
      relations: { store: true },
    });
    const customer = payload.customer ?? {};
    const total = Number(payload.total_price ?? payload.current_total_price ?? 0);
    const preserveStatus = order?.status === 'fulfilled' || order?.status === 'fulfillment_in_progress';
    const status = preserveStatus ? order!.status : paid || order?.status === 'paid' ? 'paid' : 'pending';

    if (!order) {
      order = this.ordersRepo.create({
        shopifyOrderId,
        customerName: (String(customer.first_name ?? '') + ' ' + String(customer.last_name ?? '')).trim() || 'Guest',
        customerEmail: customer.email ?? payload.email ?? '',
        total: Number.isFinite(total) ? total : 0,
        currency: payload.currency ?? 'NGN',
        status,
        lineItemsJson: JSON.stringify(payload.line_items ?? []),
        shippingAddressJson: payload.shipping_address ? JSON.stringify(payload.shipping_address) : null,
        store,
      });
    } else {
      order.customerName = (String(customer.first_name ?? '') + ' ' + String(customer.last_name ?? '')).trim() || order.customerName || 'Guest';
      order.customerEmail = customer.email ?? payload.email ?? order.customerEmail;
      order.total = Number.isFinite(total) ? total : order.total;
      order.currency = payload.currency ?? order.currency;
      order.lineItemsJson = JSON.stringify(payload.line_items ?? []);
      order.shippingAddressJson = payload.shipping_address ? JSON.stringify(payload.shipping_address) : order.shippingAddressJson;
      order.status = status;
    }
    return this.toResponse(await this.ordersRepo.save(order));
  }

  async applyFulfillmentWebhook(payload: any, store: ShopifyStore) {
    if (!payload?.order_id) throw new Error('Fulfillment webhook is missing order_id');
    const order = await this.ordersRepo.findOne({
      where: { shopifyOrderId: String(payload.order_id), store: { id: store.id } },
      relations: { store: true },
    });
    if (!order) throw new NotFoundException('Order not found for fulfillment webhook');
    const tracking = payload.tracking_info ?? {};
    if (tracking.number) order.trackingNumber = String(tracking.number);
    if (tracking.company) order.trackingCompany = String(tracking.company);
    if (tracking.url) order.trackingUrl = String(tracking.url);
    order.status = payload.status === 'success' ? 'fulfilled' : 'fulfillment_in_progress';
    if (order.status === 'fulfilled') order.fulfilledAt = new Date();
    return this.toResponse(await this.ordersRepo.save(order));
  }

  async findByShopifyOrderId(shopifyOrderId: string, shopInput: string): Promise<Order | null> {
    const shop = normalizeShopDomain(shopInput);
    return this.ordersRepo.findOne({
      where: { shopifyOrderId, store: { shop } },
      relations: { store: true },
    });
  }

  async markFulfilled(order: Order, tracking: { number: string; company?: string; url?: string }) {
    order.status = 'fulfilled';
    order.trackingNumber = tracking.number;
    order.trackingCompany = tracking.company ?? null;
    order.trackingUrl = tracking.url ?? null;
    order.fulfilledAt = new Date();
    return this.toResponse(await this.ordersRepo.save(order));
  }

  async dashboardOrders(limit = 25) {
    const orders = await this.ordersRepo.find({ relations: { store: true }, order: { createdAt: 'DESC' }, take: limit });
    return orders.map((order) => this.toResponse(order));
  }
}
