import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, Index } from 'typeorm';

import { ShopifyStore } from './shopify-store.entity';

@Entity('products')
@Index('IDX_product_store_source_shopify_id', ['sourceShopifyProductId', 'store'], { unique: true })
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  shopifyProductId: string;

  @Column({ type: 'varchar', nullable: true })
  sourceShopifyProductId: string | null;

  @Column({ type: 'text', nullable: true })
  sourceUrl: string | null;

  @Column()
  supplierName: string;

  @Column('text')
  description: string;

  @Column({ type: 'text', nullable: true })
  bodyHtml: string | null;

  @Column('decimal')
  supplierPrice: number;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  supplierCurrency: string;

  @Column('decimal', { nullable: true })
  sellingPrice: number;

  @Column({ type: 'varchar', length: 3, default: 'NGN' })
  sellingCurrency: string;

  @Column('decimal', { nullable: true })
  grossMarginPercent: number | null;

  @Column('simple-array', { nullable: true })
  imageUrls: string[];

  @Column({ type: 'text', nullable: true })
  sourceVariantsJson: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  validationStatus: string;

  @Column({ type: 'text', nullable: true })
  validationErrorsJson: string | null;

  @Column({ type: 'datetime', nullable: true })
  lastValidatedAt: Date | null;

  @Column({ default: 'draft' })
  status: string;

  @ManyToOne(() => ShopifyStore, (store) => store.products, { nullable: false })
  store: ShopifyStore;
}
