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
}
