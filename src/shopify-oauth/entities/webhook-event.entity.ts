import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('webhook_events')
@Unique(['webhookId'])
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() webhookId: string;
  @Column() topic: string;
  @Column() shop: string;
  @Column({ type: 'varchar', length: 16, default: 'processed' }) status: string;
  @Column({ type: 'text', nullable: true }) lastError: string | null;
  @CreateDateColumn() processedAt: Date;
}
