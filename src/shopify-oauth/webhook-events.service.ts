import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebhookEvent } from './entities/webhook-event.entity';

@Injectable()
export class WebhookEventsService {
  constructor(@InjectRepository(WebhookEvent) private readonly repository: Repository<WebhookEvent>) {}

  async wasProcessed(webhookId: string): Promise<boolean> {
    return !!(await this.repository.findOne({ where: { webhookId } }));
  }

  async markProcessed(webhookId: string, topic: string, shop: string): Promise<void> {
    await this.repository.save(this.repository.create({ webhookId, topic, shop }));
  }

  async recent(limit = 10) {
    return this.repository.find({ order: { processedAt: 'DESC' }, take: limit });
  }

  async lastProcessedAt(): Promise<Date | null> {
    const latest = await this.repository.findOne({ order: { processedAt: 'DESC' } });
    return latest?.processedAt ?? null;
  }
}
