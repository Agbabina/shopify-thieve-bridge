import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
} from '@nestjs/common';
import { FulfillmentService } from './fulfillment.service';

@Controller('api/shopify/orders')
export class FulfillmentController {
  constructor(private readonly fulfillmentService: FulfillmentService) {}

  @Post(':shopifyOrderId/fulfill')
  async fulfill(
    @Param('shopifyOrderId') shopifyOrderId: string,
    @Body()
    body: {
      shop?: string;
      trackingNumber?: string;
      trackingCompany?: string;
      trackingUrl?: string;
    },
  ) {
    if (!body.shop || !body.trackingNumber) {
      throw new BadRequestException('shop and trackingNumber are required');
    }

    return this.fulfillmentService.fulfillOrder(body.shop, shopifyOrderId, {
      number: body.trackingNumber,
      company: body.trackingCompany,
      url: body.trackingUrl,
    });
  }
}
