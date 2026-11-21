import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type FulfillmentTaskStatus =
  | 'awaiting_supplier'
  | 'supplier_ordered'
  | 'processing'
  | 'shipped'
  | 'fulfilled'
  | 'delivered'
  | 'cancelled'
  | 'exception';

@Entity('fulfillment_tasks')
@Index('IDX_fulfillment_task_shop_order', ['shop', 'shopifyOrderId'], { unique: true })
export class FulfillmentTask {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() shop: string;
  @Column() shopifyOrderId: string;
  @Column({ type: 'varchar', nullable: true }) orderNumber: string | null;
  @Column({ type: 'varchar', nullable: true }) orderRecordId: string | null;
  @Column({ type: 'varchar', nullable: true }) customerName: string | null;
  @Column('decimal', { default: 0 }) orderTotal: number;
  @Column({ type: 'varchar', length: 3 }) currency: string;
  @Column({ type: 'varchar', length: 32, default: 'awaiting_supplier' }) status: FulfillmentTaskStatus;
  @Column({ type: 'varchar', nullable: true }) supplierOrderReference: string | null;
  @Column({ type: 'varchar', nullable: true }) trackingNumber: string | null;
  @Column({ type: 'varchar', nullable: true }) trackingCompany: string | null;
  @Column({ type: 'text', nullable: true }) trackingUrl: string | null;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @Column({ type: 'datetime', nullable: true }) shopifySyncedAt: Date | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
