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

@Injectable()
export class FulfillmentTasksService {
  constructor(
    @InjectRepository(FulfillmentTask) private readonly tasks: Repository<FulfillmentTask>,
    private readonly orders: OrdersService,
    private readonly stores: ShopifyStoresService,
    private readonly shopifyFulfillment: FulfillmentService,
  ) {}

  async ensureForPaidOrder(shopifyOrderId: string, shop: string) {
    const order = await this.orders.findByShopifyOrderId(shopifyOrderId, shop);
    if (!order || !['paid', 'partially_paid'].includes(String(order.financialStatus).toLowerCase())) return null;
    const existing = await this.tasks.findOne({ where: { shop: order.store.shop, shopifyOrderId } });
    if (existing) return existing;
    return this.tasks.save(this.tasks.create({
      shop: order.store.shop,
      shopifyOrderId,
      orderRecordId: order.id,
      orderNumber: String(shopifyOrderId),
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
    const where: Record<string, unknown> = {};
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
    if (task.status === 'fulfilled' || task.status === 'delivered' || task.status === 'cancelled') {
      throw new BadRequestException('This fulfillment task is already closed');
    }
    if (input.trackingUrl && !/^https:\/\//i.test(input.trackingUrl)) {
      throw new BadRequestException('Tracking URL must use HTTPS');
    }
    if (input.status === 'shipped' && !(input.trackingNumber ?? task.trackingNumber)?.trim()) {
      throw new BadRequestException('A tracking number is required before marking an order shipped');
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
    const tracking = payload.tracking_info ?? {};
    if (tracking.number) task.trackingNumber = String(tracking.number);
    if (tracking.company) task.trackingCompany = String(tracking.company);
    if (tracking.url) task.trackingUrl = String(tracking.url);
    if (String(payload.status).toLowerCase() === 'success') {
      task.status = 'fulfilled';
      task.shopifySyncedAt = new Date();
    }
    return this.tasks.save(task);
  }
}
