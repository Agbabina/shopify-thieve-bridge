import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { ShopifyTokenService } from './shopify-token.service';

const FULFILLMENT_ORDERS_QUERY = `
  query ($id: ID!) {
    order(id: $id) {
      fulfillmentOrders(first: 10) {
        nodes { id status }
      }
    }
  }
`;

const FULFILLMENT_CREATE_MUTATION = `
  mutation fulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment {
        id
        status
        trackingInfo { company number url }
      }
      userErrors { field message }
    }
  }
`;

@Injectable()
export class FulfillmentService {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly tokenService: ShopifyTokenService,
  ) {}

  private async graphql<T>(
    shop: string,
    token: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(
      `https://${shop}/admin/api/2026-07/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
        body: JSON.stringify({ query, variables }),
      },
    );

    const json = (await response.json()) as { data?: T; errors?: unknown };

    if (!response.ok || json.errors) {
      throw new BadGatewayException(
        `Shopify request failed: ${response.status} ${JSON.stringify(json.errors ?? json)}`,
      );
    }
    return json.data as T;
  }

  async fulfillOrder(
    shop: string,
    shopifyOrderId: string,
    tracking: { number: string; company?: string; url?: string },
  ) {
    const order = await this.ordersService.findByShopifyOrderId(
      shopifyOrderId,
      shop,
    );
    if (!order) {
      throw new NotFoundException('Order not found for this shop');
    }
    if (order.status === 'fulfilled') {
      throw new BadRequestException('Order is already fulfilled');
    }

    const token = await this.tokenService.getValidToken(shop);

    const lookup = await this.graphql<{
      order: {
        fulfillmentOrders: { nodes: { id: string; status: string }[] };
      } | null;
    }>(shop, token, FULFILLMENT_ORDERS_QUERY, {
      id: `gid://shopify/Order/${shopifyOrderId}`,
    });

    if (!lookup.order) {
      throw new NotFoundException('Order not found in Shopify');
    }

    const open = lookup.order.fulfillmentOrders.nodes.filter(
      (n) => n.status === 'OPEN' || n.status === 'IN_PROGRESS',
    );
    if (open.length === 0) {
      throw new BadRequestException(
        'No open fulfillment orders for this order in Shopify',
      );
    }

    const result = await this.graphql<{
      fulfillmentCreate: {
        fulfillment: { id: string; status: string } | null;
        userErrors: { field: string[]; message: string }[];
      };
    }>(shop, token, FULFILLMENT_CREATE_MUTATION, {
      fulfillment: {
        notifyCustomer: false,
        trackingInfo: {
          number: tracking.number,
          company: tracking.company,
          url: tracking.url,
        },
        lineItemsByFulfillmentOrder: open.map((fo) => ({
          fulfillmentOrderId: fo.id,
        })),
      },
    });

    const { fulfillment, userErrors } = result.fulfillmentCreate;
    if (userErrors.length > 0 || !fulfillment) {
      throw new BadRequestException(
        `Shopify rejected the fulfillment: ${userErrors.map((e) => e.message).join('; ')}`,
      );
    }

    const saved = await this.ordersService.markFulfilled(order, tracking);
    return { order: saved, shopifyFulfillment: fulfillment };
  }
}
