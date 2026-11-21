import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ShopifyProductsService {
  private readonly logger = new Logger(ShopifyProductsService.name);

  async createProductInShopify(accessToken: string, shop: string, product: any) {
    const images = Array.isArray(product.imageUrls)
      ? product.imageUrls.filter((url: unknown) => typeof url === 'string' && /^https:\/\//i.test(url))
      : [];
    const price = Number(product.sellingPrice ?? product.supplierPrice);
    if (!Number.isFinite(price) || price <= 0) throw new Error('Product selling price must be greater than zero');

    const response = await fetch('https://' + shop + '/admin/api/2026-07/products.json', {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: {
          title: product.description,
          body_html: product.description,
          status: 'draft',
          images: images.map((src: string) => ({ src })),
          variants: [{ price: price.toFixed(2) }],
        },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.product?.id) {
      this.logger.error('Shopify product creation failed: ' + response.status);
      throw new BadGatewayException('Shopify product creation failed with HTTP ' + response.status);
    }
    return data.product;
  }

  async updateSourcedProductInShopify(accessToken: string, shop: string, product: any, sourceProductGid: string) {
    const productId = sourceProductGid.split('/').pop();
    if (!productId || !/^\d+$/.test(productId)) throw new BadGatewayException('Source Shopify product ID is invalid');
    let sourceVariants: { id?: string }[] = [];
    try {
      sourceVariants = JSON.parse(product.sourceVariantsJson ?? '[]');
    } catch {
      throw new BadGatewayException('Stored source variant data is invalid; re-sync the source product');
    }
    if (sourceVariants.length !== 1 || !sourceVariants[0].id) {
      throw new BadGatewayException('Only a single mapped source variant can be updated in this Bridge version');
    }
    const variantId = String(sourceVariants[0].id).split('/').pop();
    if (!variantId || !/^\d+$/.test(variantId)) throw new BadGatewayException('Source Shopify variant ID is invalid');
    const price = Number(product.sellingPrice);
    if (!Number.isFinite(price) || price <= 0) throw new BadGatewayException('Approved selling price must be greater than zero');

    const images = Array.isArray(product.imageUrls)
      ? product.imageUrls.filter((url: unknown) => typeof url === 'string' && /^https:\/\//i.test(url))
      : [];
    const response = await fetch('https://' + shop + '/admin/api/2026-07/products/' + productId + '.json', {
      method: 'PUT',
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: {
          id: Number(productId),
          title: product.description,
          body_html: product.description,
          status: 'draft',
          variants: [{ id: Number(variantId), price: price.toFixed(2) }],
        },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.product?.id) {
      this.logger.error('Shopify source product update failed: ' + response.status);
      throw new BadGatewayException('Shopify source product update failed with HTTP ' + response.status);
    }
    return data.product;
  }
}
