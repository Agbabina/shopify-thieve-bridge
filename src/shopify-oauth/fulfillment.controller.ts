import { BadRequestException, Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { FulfillmentService } from './fulfillment.service';
import { AdminApiKeyGuard } from './admin-api-key.guard';

@Controller('api/shopify/orders')
@UseGuards(AdminApiKeyGuard)
export class FulfillmentController {
  constructor(private readonly fulfillmentService: FulfillmentService) {}

  @Post(':shopifyOrderId/fulfill')
  async fulfill(
    @Param('shopifyOrderId') shopifyOrderId: string,
    @Body() body: { shop?: string; trackingNumber?: string; trackingCompany?: string; trackingUrl?: string },
  ) {
    if (!shopifyOrderId || !body.shop || !body.trackingNumber?.trim()) throw new BadRequestException('shop and trackingNumber are required');
    if (body.trackingUrl && !/^https:\/\//i.test(body.trackingUrl)) throw new BadRequestException('trackingUrl must use HTTPS');
    return this.fulfillmentService.fulfillOrder(body.shop, shopifyOrderId, {
      number: body.trackingNumber.trim(),
      company: body.trackingCompany?.trim(),
      url: body.trackingUrl?.trim(),
    });
  }
}
