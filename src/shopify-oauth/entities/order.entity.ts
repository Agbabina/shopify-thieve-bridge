import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { ShopifyStore } from './shopify-store.entity';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  shopifyOrderId: string;

  @Column({ nullable: true })
  customerName: string;

  @Column({ nullable: true })
  customerEmail: string;

  @Column({ nullable: true })
  total: number;

  @Column({ default: 'pending' })
  status: string;

  @Column({ type: 'varchar', nullable: true })
  trackingNumber: string | null;

  @Column({ type: 'varchar', nullable: true })
  trackingCompany: string | null;

  @Column({ type: 'varchar', nullable: true })
  trackingUrl: string | null;

  @Column({ type: 'datetime', nullable: true })
  fulfilledAt: Date | null;

  @ManyToOne(() => ShopifyStore, (store) => store.orders, { nullable: false })
  store: ShopifyStore;
}
