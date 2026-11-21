import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { ShopifyTokenService } from './shopify-token.service';
import { ShopifyStoresService } from './shopify-stores.service';

const FULFILLMENT_ORDERS_QUERY =
  'query ($id: ID!) { order(id: $id) { fulfillmentOrders(first: 50) { nodes { id status } pageInfo { hasNextPage } } } }';
const FULFILLMENT_CREATE_MUTATION =
  'mutation fulfillmentCreate($fulfillment: FulfillmentInput!) { fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id status trackingInfo { company number url } } userErrors { field message } } }';

@Injectable()
export class FulfillmentService {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly tokenService: ShopifyTokenService,
    private readonly storesService: ShopifyStoresService,
  ) {}

  private async graphql<T>(shop: string, token: string, query: string, variables: Record<string, unknown>): Promise<T> {
    const version = process.env.SHOPIFY_ADMIN_API_VERSION || '2026-07';
    const response = await fetch('https://' + shop + '/admin/api/' + version + '/graphql.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20000),
    });
    const json = await response.json().catch(() => ({})) as {
      data?: T;
      errors?: { message?: string }[];
    };
    const errors = (json.errors ?? []).map((error) => error.message).filter(Boolean);
    if (!response.ok || errors.length || !json.data) {
      throw new BadGatewayException(
        'Shopify fulfillment API failed (' + response.status + ')' + (errors.length ? ': ' + errors.join('; ') : ''),
      );
    }
    return json.data;
  }

  async fulfillOrder(shopInput: string, shopifyOrderId: string, tracking: { number: string; company?: string; url?: string }) {
    if (!/^\d+$/.test(String(shopifyOrderId))) throw new BadRequestException('Shopify order ID must be numeric');
    if (!tracking.number?.trim()) throw new BadRequestException('Tracking number is required');
    if (tracking.url && !/^https:\/\//i.test(tracking.url)) throw new BadRequestException('Tracking URL must use HTTPS');
    const store = await this.storesService.findByShop(shopInput);
    if (!store) throw new NotFoundException('Connected Shopify store not found');
    const order = await this.ordersService.findByShopifyOrderId(shopifyOrderId, store.shop);
    if (!order) throw new NotFoundException('Order not found for this shop');
    if (order.status === 'fulfilled') throw new BadRequestException('Order is already fulfilled');

    const token = await this.tokenService.getValidToken(store.shop);
    const lookup = await this.graphql<{
      order: { fulfillmentOrders: { nodes: { id: string; status: string }[]; pageInfo: { hasNextPage: boolean } } } | null;
    }>(store.shop, token, FULFILLMENT_ORDERS_QUERY, { id: 'gid://shopify/Order/' + shopifyOrderId });

    if (!lookup.order) throw new NotFoundException('Order not found in Shopify');
    if (lookup.order.fulfillmentOrders.pageInfo.hasNextPage) {
      throw new BadRequestException('More than 50 fulfillment orders found; split the fulfillment before retrying');
    }
    const open = lookup.order.fulfillmentOrders.nodes.filter((item) => item.status === 'OPEN' || item.status === 'IN_PROGRESS');
    if (!open.length) throw new BadRequestException('No open fulfillment orders in Shopify');

    const result = await this.graphql<{
      fulfillmentCreate: {
        fulfillment: { id: string; status: string; trackingInfo?: unknown } | null;
        userErrors: { field: string[]; message: string }[];
      };
    }>(store.shop, token, FULFILLMENT_CREATE_MUTATION, {
      fulfillment: {
        notifyCustomer: true,
        trackingInfo: { number: tracking.number.trim(), company: tracking.company, url: tracking.url },
        lineItemsByFulfillmentOrder: open.map((item) => ({ fulfillmentOrderId: item.id })),
      },
    });
    const { fulfillment, userErrors } = result.fulfillmentCreate;
    if (userErrors?.length || !fulfillment) {
      throw new BadRequestException('Shopify rejected fulfillment: ' + (userErrors ?? []).map((error) => error.message).join('; '));
    }
    const saved = await this.ordersService.markFulfilled(order, tracking);
    return { order: saved, shopifyFulfillment: fulfillment };
  }
}
