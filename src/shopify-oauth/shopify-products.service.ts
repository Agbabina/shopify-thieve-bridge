import { Injectable, Logger } from '@nestjs/common';
//6.99
@Injectable()
export class ShopifyProductsService {
  private readonly logger = new Logger(ShopifyProductsService.name);

  async createProductInShopify(
    accessToken: string,
    shop: string,
    product: any,
  ) {
    const shopifyProduct = {
      product: {
        title: product.description,
        body_html: product.description,
        images: product.imageUrls.map((url: string) => ({
          src: url,
        })),
        variants: [
          {
            price: product.sellingPrice ?? product.supplierPrice,
          },
        ],
      },
    };

    const response = await fetch(
      `https://${shop}/admin/api/2026-07/products.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(shopifyProduct),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();

      this.logger.error(`Shopify API error: ${response.status} ${errorText}`);

      if (response.status === 401) {
        throw new Error('Shopify token invalid, please reconnect your store.');
      }

      throw new Error(errorText);
    }

    const data = await response.json();

    this.logger.log(`Created Shopify product ${data.product.id}`);

    return data.product;
  }
}
