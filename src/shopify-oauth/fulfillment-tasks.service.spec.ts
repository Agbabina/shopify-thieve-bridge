import { BadRequestException } from '@nestjs/common';
import { FulfillmentTasksService } from './fulfillment-tasks.service';

describe('FulfillmentTasksService', () => {
  const repository = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((value) => value),
  };
  const orders = { findByShopifyOrderId: jest.fn() };
  const stores = { findByShop: jest.fn() };
  const shopifyFulfillment = { fulfillOrder: jest.fn() };
  let service: FulfillmentTasksService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FulfillmentTasksService(
      repository as any,
      orders as any,
      stores as any,
      shopifyFulfillment as any,
    );
  });

  it('lists tasks newest first with an optional status filter', async () => {
    repository.find.mockResolvedValue([]);
    await service.list('processing');
    expect(repository.find).toHaveBeenCalledWith({
      where: { status: 'processing' },
      order: { updatedAt: 'DESC' },
      take: 100,
    });
  });

  it('rejects invalid task transitions', async () => {
    repository.findOne.mockResolvedValue({ id: 'task-1', status: 'awaiting_supplier' });
    await expect(service.update('task-1', { status: 'shipped' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires tracking number before a task can be marked shipped', async () => {
    repository.findOne.mockResolvedValue({ id: 'task-1', status: 'processing', trackingNumber: null, trackingUrl: null });
    await expect(service.update('task-1', { status: 'shipped' }))
      .rejects.toThrow('A tracking number is required');
  });

  it('requires an HTTPS tracking URL before a task can be marked shipped', async () => {
    repository.findOne.mockResolvedValue({ id: 'task-1', status: 'processing', trackingNumber: 'TRACK-1', trackingUrl: null });
    await expect(service.update('task-1', { status: 'shipped' }))
      .rejects.toThrow('An HTTPS tracking URL is required');
  });
});
