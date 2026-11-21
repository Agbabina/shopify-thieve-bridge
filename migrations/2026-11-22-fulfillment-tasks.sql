-- SQLite migration. Back up shopify.db and apply once after the existing 2026-11 migrations.
CREATE TABLE IF NOT EXISTS fulfillment_tasks (
  id varchar PRIMARY KEY NOT NULL,
  shop varchar NOT NULL,
  shopifyOrderId varchar NOT NULL,
  orderNumber varchar,
  orderRecordId varchar,
  customerName varchar,
  orderTotal decimal NOT NULL DEFAULT 0,
  currency varchar(3) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'awaiting_supplier',
  supplierOrderReference varchar,
  trackingNumber varchar,
  trackingCompany varchar,
  trackingUrl text,
  notes text,
  shopifySyncedAt datetime,
  createdAt datetime NOT NULL DEFAULT (datetime('now')),
  updatedAt datetime NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS IDX_fulfillment_task_shop_order
  ON fulfillment_tasks(shop, shopifyOrderId);
CREATE INDEX IF NOT EXISTS IDX_fulfillment_task_status_updated
  ON fulfillment_tasks(status, updatedAt);
