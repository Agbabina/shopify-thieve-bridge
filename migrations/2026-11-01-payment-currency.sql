-- Apply once to an existing SQLite database before deploying the payment/currency dashboard.
-- Back up shopify.db before running this migration.
ALTER TABLE products ADD COLUMN supplierCurrency varchar(3) NOT NULL DEFAULT 'USD';
ALTER TABLE orders ADD COLUMN financialStatus varchar(255) NOT NULL DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN paymentGateway text;
