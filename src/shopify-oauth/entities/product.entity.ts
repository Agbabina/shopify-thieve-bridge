import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';

import { ShopifyStore } from './shopify-store.entity';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  shopifyProductId: string;

  @Column()
  supplierName: string;

  @Column('text')
  description: string;

  @Column('decimal')
  supplierPrice: number;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  supplierCurrency: string;

  @Column('decimal', { nullable: true })
  sellingPrice: number;

  @Column('simple-array', { nullable: true })
  imageUrls: string[];

  @Column({ default: 'draft' })
  status: string;

  @ManyToOne(() => ShopifyStore, (store) => store.products, { nullable: false })
  store: ShopifyStore;
}
