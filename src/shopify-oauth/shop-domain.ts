import { BadRequestException } from '@nestjs/common';

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function normalizeShopDomain(input: string): string {
  if (!input || typeof input !== 'string') throw new BadRequestException('Shop domain is required');
  let value = input.trim().toLowerCase();
  if (!value) throw new BadRequestException('Shop domain is required');
  if (value.includes('://')) {
    try { value = new URL(value).hostname; }
    catch { throw new BadRequestException('Invalid shop domain'); }
  } else {
    value = value.split('/')[0].split('?')[0].replace(/:\d+$/, '');
  }
  value = value.replace(/\.$/, '');
  if (!value.includes('.')) value += '.myshopify.com';
  if (!SHOP_DOMAIN.test(value)) throw new BadRequestException('Shop must be a valid *.myshopify.com domain');
  return value;
}
