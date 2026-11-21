import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FulfillmentTask, FulfillmentTaskStatus } from './entities/fulfillment-task.entity';
import { OrdersService } from './orders.service';
import { ShopifyStoresService } from './shopify-stores.service';
import { FulfillmentService } from './fulfillment.service';

const STATUSES: FulfillmentTaskStatus[] = [
  'awaiting_supplier', 'supplier_ordered', 'processing', 'shipped',
  'fulfilled', 'delivered', 'cancelled', 'exception',
];
const TRANSITIONS: Record<FulfillmentTaskStatus, FulfillmentTaskStatus[]> = {
  awaiting_supplier: ['supplier_ordered', 'exception', 'cancelled'],
  supplier_ordered: ['processing', 'shipped', 'exception', 'cancelled'],
  processing: ['shipped', 'exception', 'cancelled'],
  shipped: ['exception'],
  fulfilled: ['delivered'],
  delivered: [],
  cancelled: [],
  exception: ['awaiting_supplier', 'supplier_ordered', 'processing', 'shipped', 'cancelled'],
};

@Injectable()
export class FulfillmentTasksService {
  constructor(
    @InjectRepository(FulfillmentTask) private readonly tasks: Repository<FulfillmentTask>,
    private readonly orders: OrdersService,
    private readonly stores: ShopifyStoresService,
    private readonly shopifyFulfillment: FulfillmentService,
  ) {}

  async ensureForPaidOrder(shopifyOrderId: string, shop: string, orderNumber?: string) {
    const order = await this.orders.findByShopifyOrderId(shopifyOrderId, shop);
    if (!order) return null;
    const existing = await this.tasks.findOne({ where: { shop: order.store.shop, shopifyOrderId } });
    if (existing) return existing;
    return this.tasks.save(this.tasks.create({
      shop: order.store.shop,
      shopifyOrderId,
      orderRecordId: order.id,
      orderNumber: orderNumber || shopifyOrderId,
      customerName: order.customerName,
      orderTotal: Number(order.total),
      currency: order.currency,
      status: 'awaiting_supplier',
    }));
  }

  async list(status?: string, shopInput?: string) {
    if (status && !STATUSES.includes(status as FulfillmentTaskStatus)) {
      throw new BadRequestException('Unsupported fulfillment task status');
    }
    const where: any = {};
    if (status) where.status = status;
    if (shopInput) {
      const store = await this.stores.findByShop(shopInput);
      if (!store) throw new NotFoundException('Connected Shopify store not found');
      where.shop = store.shop;
    }
    return this.tasks.find({ where, order: { updatedAt: 'DESC' }, take: 100 });
  }

  async update(id: string, input: {
    status?: FulfillmentTaskStatus;
    supplierOrderReference?: string;
    trackingNumber?: string;
    trackingCompany?: string;
    trackingUrl?: string;
    notes?: string;
  }) {
    const task = await this.tasks.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Fulfillment task not found');
    if (input.status && !STATUSES.includes(input.status)) throw new BadRequestException('Unsupported fulfillment task status');
    if (input.status && input.status !== task.status && !TRANSITIONS[task.status].includes(input.status)) {
      throw new BadRequestException('Invalid fulfillment transition: ' + task.status + ' → ' + input.status);
    }
    if (input.status === 'fulfilled') throw new BadRequestException('Use the Shopify sync action to complete fulfillment');
    if (input.status === 'delivered') throw new BadRequestException('Delivery confirmation must come from a carrier integration');
    if (input.trackingUrl && !/^https:\/\//i.test(input.trackingUrl)) {
      throw new BadRequestException('Tracking URL must use HTTPS');
    }
    if (input.status === 'shipped' && !(input.trackingNumber ?? task.trackingNumber)?.trim()) {
      throw new BadRequestException('A tracking number is required before marking an order shipped');
    }
    if (input.status === 'shipped' && !(input.trackingUrl ?? task.trackingUrl)?.trim()) {
      throw new BadRequestException('An HTTPS tracking URL is required before marking an order shipped');
    }
    if (input.supplierOrderReference !== undefined) task.supplierOrderReference = input.supplierOrderReference.trim() || null;
    if (input.trackingNumber !== undefined) task.trackingNumber = input.trackingNumber.trim() || null;
    if (input.trackingCompany !== undefined) task.trackingCompany = input.trackingCompany.trim() || null;
    if (input.trackingUrl !== undefined) task.trackingUrl = input.trackingUrl.trim() || null;
    if (input.notes !== undefined) task.notes = input.notes.trim() || null;
    if (input.status) task.status = input.status;
    return this.tasks.save(task);
  }

  async syncToShopify(id: string) {
    const task = await this.tasks.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Fulfillment task not found');
    if (task.status !== 'shipped') throw new BadRequestException('Mark the supplier shipment as shipped before syncing to Shopify');
    if (!task.trackingNumber) throw new BadRequestException('Tracking number is required');
    if (!task.trackingUrl || !/^https:\/\//i.test(task.trackingUrl)) throw new BadRequestException('A valid HTTPS tracking URL is required');
    const result = await this.shopifyFulfillment.fulfillOrder(task.shop, task.shopifyOrderId, {
      number: task.trackingNumber,
      company: task.trackingCompany ?? undefined,
      url: task.trackingUrl ?? undefined,
    });
    task.status = 'fulfilled';
    task.shopifySyncedAt = new Date();
    await this.tasks.save(task);
    return { task, shopify: result };
  }

  async applyShopifyWebhook(payload: any, shop: string) {
    if (!payload?.order_id) return null;
    const task = await this.tasks.findOne({ where: { shop, shopifyOrderId: String(payload.order_id) } });
    if (!task) return null;
    const info = Array.isArray(payload.tracking_info) ? payload.tracking_info[0] : payload.tracking_info;
    const number = info?.number ?? payload.tracking_number ?? payload.tracking_numbers?.[0];
    const company = info?.company ?? payload.tracking_company;
    const url = info?.url ?? payload.tracking_url ?? payload.tracking_urls?.[0];
    if (number) task.trackingNumber = String(number);
    if (company) task.trackingCompany = String(company);
    if (url) task.trackingUrl = String(url);
    if (String(payload.status).toLowerCase() === 'success') {
      task.status = 'fulfilled';
      task.shopifySyncedAt = new Date();
    }
    return this.tasks.save(task);
  }
}
