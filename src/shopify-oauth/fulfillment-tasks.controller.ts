import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import { FulfillmentTasksService } from './fulfillment-tasks.service';

@Controller('api/fulfillment-tasks')
@UseGuards(AdminApiKeyGuard)
export class FulfillmentTasksController {
  constructor(private readonly tasks: FulfillmentTasksService) {}

  @Get()
  list(@Query('status') status?: string, @Query('shop') shop?: string) {
    return this.tasks.list(status, shop);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: {
    status?: 'awaiting_supplier' | 'supplier_ordered' | 'processing' | 'shipped' | 'fulfilled' | 'delivered' | 'cancelled' | 'exception';
    supplierOrderReference?: string;
    trackingNumber?: string;
    trackingCompany?: string;
    trackingUrl?: string;
    notes?: string;
  }) {
    return this.tasks.update(id, body);
  }

  @Post(':id/sync-shopify')
  syncToShopify(@Param('id') id: string) {
    return this.tasks.syncToShopify(id);
  }
}
