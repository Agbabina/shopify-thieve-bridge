-- SQLite migration. Back up shopify.db and apply this file once.
-- Existing payment/currency columns are added by 2026-11-01-payment-currency.sql.
ALTER TABLE products ADD COLUMN sourceShopifyProductId varchar;
ALTER TABLE products ADD COLUMN sourceUrl text;
ALTER TABLE products ADD COLUMN sellingCurrency varchar(3) NOT NULL DEFAULT 'NGN';
ALTER TABLE products ADD COLUMN sourceVariantsJson text;
ALTER TABLE products ADD COLUMN validationStatus varchar(32) NOT NULL DEFAULT 'pending';
ALTER TABLE products ADD COLUMN validationErrorsJson text;
ALTER TABLE products ADD COLUMN lastValidatedAt datetime;
CREATE UNIQUE INDEX IF NOT EXISTS IDX_product_store_source_shopify_id
  ON products(sourceShopifyProductId, storeId);
ALTER TABLE webhook_events ADD COLUMN status varchar(16) NOT NULL DEFAULT 'processed';
ALTER TABLE webhook_events ADD COLUMN lastError text;
ALTER TABLE products ADD COLUMN grossMarginPercent decimal;
ALTER TABLE products ADD COLUMN bodyHtml text;
