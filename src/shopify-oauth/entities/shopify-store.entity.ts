import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Order } from './order.entity';
import { Product } from './product.entity';

@Entity('shopify_stores')
export class ShopifyStore {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'text',
    unique: true,
  })
  shop: string;

  @Column({
    name: 'access_token',
    type: 'text',
  })
  accessToken: string;

  @Column({
    name: 'refresh_token',
    type: 'text',
    nullable: true,
  })
  refreshToken: string | null;

  @Column({
    name: 'token_expires_at',
    type: 'datetime',
    nullable: true,
  })
  tokenExpiresAt: Date | null;

  @Column({
    name: 'last_refresh_at',
    type: 'datetime',
    nullable: true,
  })
  lastRefreshAt: Date | null;

  @Column({
    type: 'text',
    nullable: true,
  })
  scope: string | null;

  @CreateDateColumn({
    name: 'created_at',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
  })
  updatedAt: Date;

  @OneToMany(() => Order, (order) => order.store)
  orders: Order[];

  @OneToMany(() => Product, (product) => product.store)
  products: Product[];
}
