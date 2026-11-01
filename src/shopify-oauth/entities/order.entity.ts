import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, Index } from 'typeorm';
import { ShopifyStore } from './shopify-store.entity';

@Entity('orders')
@Index('IDX_order_shop_order_id', ['shopifyOrderId', 'store'], { unique: true })
export class Order {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() shopifyOrderId: string;
  @Column({ nullable: true }) customerName: string;
  @Column({ nullable: true }) customerEmail: string;
  @Column('decimal', { default: 0 }) total: number;
  @Column({ type: 'varchar', default: 'NGN' }) currency: string;
  @Column({ default: 'pending' }) status: string;
  @Column({ type: 'text', nullable: true }) lineItemsJson: string | null;
  @Column({ type: 'text', nullable: true }) shippingAddressJson: string | null;
  @Column({ type: 'varchar', nullable: true }) trackingNumber: string | null;
  @Column({ type: 'varchar', nullable: true }) trackingCompany: string | null;
  @Column({ type: 'varchar', nullable: true }) trackingUrl: string | null;
  @Column({ type: 'datetime', nullable: true }) fulfilledAt: Date | null;
  @CreateDateColumn() createdAt: Date;
  @ManyToOne(() => ShopifyStore, (store) => store.orders, { nullable: false }) store: ShopifyStore;
}
