import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

const PRODUCT_SET_MUTATION = `
  mutation BridgeProductSet(
    $input: ProductSetInput!
    $synchronous: Boolean!
    $identifier: ProductSetIdentifiers
  ) {
    productSet(input: $input, synchronous: $synchronous, identifier: $identifier) {
      product {
        id
        title
        status
        variants(first: 5) {
          nodes { id price }
        }
      }
      userErrors { field message }
    }
  }
`;

@Injectable()
export class ShopifyProductsService {
  private readonly logger = new Logger(ShopifyProductsService.name);

  private async productSet(
    accessToken: string,
    shop: string,
    input: Record<string, unknown>,
    identifier: { id: string } | null,
  ) {
    const version = process.env.SHOPIFY_ADMIN_API_VERSION || '2026-07';
    const response = await fetch('https://' + shop + '/admin/api/' + version + '/graphql.json', {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: PRODUCT_SET_MUTATION,
        variables: { input, synchronous: true, identifier },
      }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.json().catch(() => ({})) as {
      data?: {
        productSet?: {
          product?: { id: string; title: string; status: string } | null;
          userErrors?: { field?: string[]; message: string }[];
        };
      };
      errors?: { message?: string }[];
    };
    if (!response.ok || body.errors?.length) {
      const reason = body.errors?.map((error) => error.message).filter(Boolean).join('; ');
      this.logger.error('Shopify GraphQL productSet failed: HTTP ' + response.status);
      throw new BadGatewayException('Shopify product sync failed (' + response.status + ')' + (reason ? ': ' + reason : ''));
    }
    const result = body.data?.productSet;
    const userErrors = result?.userErrors ?? [];
    if (!result?.product || userErrors.length) {
      throw new BadGatewayException(
        'Shopify rejected product sync: ' + userErrors.map((error) => error.message).join('; '),
      );
    }
    return result.product;
  }

  async createProductInShopify(accessToken: string, shop: string, product: any) {
    const price = Number(product.sellingPrice);
    if (!Number.isFinite(price) || price <= 0) {
      throw new BadGatewayException('A validated selling price is required before creating a Shopify product');
    }
    const images = Array.isArray(product.imageUrls)
      ? product.imageUrls.filter((url: unknown) => typeof url === 'string' && /^https:\/\//i.test(url))
      : [];
    const files = images.map((url: string, index: number) => ({
      originalSource: url,
      alt: product.description,
      filename: 'bridge-product-' + (index + 1) + '.jpg',
      contentType: 'IMAGE',
    }));
    return this.productSet(accessToken, shop, {
      title: product.description,
      descriptionHtml: product.bodyHtml || product.description,
      vendor: product.supplierName || 'Bridge',
      status: 'DRAFT',
      files,
      productOptions: [{
        name: 'Title',
        position: 1,
        values: [{ name: 'Default Title' }],
      }],
      variants: [{
        optionValues: [{ optionName: 'Title', name: 'Default Title' }],
        price: price.toFixed(2),
      }],
    }, null);
  }

  async updateSourcedProductInShopify(accessToken: string, shop: string, product: any, sourceProductGid: string) {
    if (!/^gid:\/\/shopify\/Product\/\d+$/.test(sourceProductGid)) {
      throw new BadGatewayException('Source Shopify product ID is invalid');
    }
    let sourceVariants: { id?: string }[] = [];
    try {
      sourceVariants = JSON.parse(product.sourceVariantsJson ?? '[]');
    } catch {
      throw new BadGatewayException('Stored source variant data is invalid; re-sync the source product');
    }
    if (sourceVariants.length !== 1 || !sourceVariants[0].id ||
      !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(sourceVariants[0].id)) {
      throw new BadGatewayException('Only a single mapped source variant can be updated in this Bridge version');
    }
    const price = Number(product.sellingPrice);
    if (!Number.isFinite(price) || price <= 0) {
      throw new BadGatewayException('Approved selling price must be greater than zero');
    }
    return this.productSet(accessToken, shop, {
      title: product.description,
      descriptionHtml: product.bodyHtml || product.description,
      vendor: product.supplierName || 'Thieve',
      status: 'DRAFT',
      variants: [{
        id: sourceVariants[0].id,
        price: price.toFixed(2),
      }],
    }, { id: sourceProductGid });
  }
}
