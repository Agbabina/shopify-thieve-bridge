import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebhookEvent } from './entities/webhook-event.entity';

export type WebhookClaim = 'claimed' | 'processed' | 'processing';

@Injectable()
export class WebhookEventsService {
  constructor(@InjectRepository(WebhookEvent) private readonly repository: Repository<WebhookEvent>) {}

  async claim(webhookId: string, topic: string, shop: string): Promise<WebhookClaim> {
    const existing = await this.repository.findOne({ where: { webhookId } });
    if (existing?.status === 'processed') return 'processed';
    if (existing?.status === 'processing') return 'processing';

    if (existing?.status === 'failed') {
      const retry = await this.repository.createQueryBuilder()
        .update(WebhookEvent)
        .set({ status: 'processing', lastError: null, topic, shop, processedAt: new Date() })
        .where('webhookId = :webhookId AND status = :failed', { webhookId, failed: 'failed' })
        .execute();
      return retry.affected ? 'claimed' : 'processing';
    }

    try {
      await this.repository.insert({ webhookId, topic, shop, status: 'processing', lastError: null });
      return 'claimed';
    } catch (error) {
      const current = await this.repository.findOne({ where: { webhookId } });
      if (!current) throw error;
      if (current.status === 'processed') return 'processed';
      if (current.status === 'failed') {
        const retry = await this.repository.createQueryBuilder()
          .update(WebhookEvent)
          .set({ status: 'processing', lastError: null, topic, shop, processedAt: new Date() })
          .where('webhookId = :webhookId AND status = :failed', { webhookId, failed: 'failed' })
          .execute();
        return retry.affected ? 'claimed' : 'processing';
      }
      return 'processing';
    }
  }

  async markProcessed(webhookId: string): Promise<void> {
    await this.repository.update(
      { webhookId },
      { status: 'processed', lastError: null, processedAt: new Date() },
    );
  }

  async markFailed(webhookId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : 'Unknown webhook processing error';
    await this.repository.update(
      { webhookId },
      { status: 'failed', lastError: message.slice(0, 1000) },
    );
  }

  async recent(limit = 10) {
    return this.repository.find({ order: { processedAt: 'DESC' }, take: limit });
  }

  async lastProcessedAt(): Promise<Date | null> {
    const latest = await this.repository.findOne({ where: { status: 'processed' }, order: { processedAt: 'DESC' } });
    return latest?.processedAt ?? null;
  }
}
