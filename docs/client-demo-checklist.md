# Bridge client demo and launch checklist

This guide is for a guided client demonstration using a Shopify development store. Do not use a live customer's store or real customer payment details for the demo.

## Before the demo

- [ ] Deploy the latest `master` build and confirm the public HTTPS app URL works.
- [ ] Set a unique, long `ADMIN_API_KEY` and a stable 32-byte `TOKEN_ENCRYPTION_KEY` in the hosting environment. Never share either secret with the client or put them in screenshots.
- [ ] Back up the SQLite database and apply production migrations in chronological order, including the Thieve source and fulfillment-task migrations. Do not run migrations twice.
- [ ] Configure the Shopify app URL, exact OAuth callback URL, API key/secret, and required scopes.
- [ ] Install/re-authorize Bridge on the development store after changing scopes.
- [ ] Connect Thieve using its official Shopify app. Import one test product into the same Shopify store.
- [ ] Confirm the imported product has an explicit supplier unit cost/currency, tracked inventory, an available quantity, and a valid selling price. Bridge deliberately blocks approval if these facts are missing.
- [ ] Configure the correct store currency and verify the FX source/rate. A manual FX override must be a verified quote for the exact currency pair.
- [ ] Configure a test payment provider in Shopify. Bridge does not activate payment providers or process card details.
- [ ] Check Shopify webhook delivery logs after the test events.

## Client walkthrough

1. Open `/admin` and connect using the admin key privately. Do not project or share the key.
2. Use the guided setup checklist to show the Shopify connection and operational progress.
3. Open **Product sourcing** and run **Sync source store**. Explain that the official Thieve Shopify app supplies the product data; Bridge does not scrape Thieve.
4. Open a product and explain supplier cost, selling price, currency, estimated gross margin, and validation warnings. Approve only a product whose validation passes.
5. Push the approved product as a Shopify draft. Publish it from Shopify only after the merchant confirms product details, shipping expectations, and retail price.
6. Place a test order in the development store and complete the test payment. Confirm the verified paid webhook creates an order and one fulfillment task.
7. In **Fulfillment queue**, record the supplier order reference and advance the task as the operator processes it. When a real test shipment has tracking details, enter the carrier, tracking number, and HTTPS tracking URL.
8. Select **Sync to Shopify** and verify the fulfillment and customer notification in Shopify.
9. Show **Activity** and the dashboard's revenue-by-currency view. Explain that currencies are kept separate and that estimated gross margin is not net profit.

## What Bridge automates today

- Reads products from the Shopify store connected to Thieve's official Shopify app.
- Validates supplier cost/currency, inventory information, selling price, FX availability, and estimated gross margin before approval.
- Creates/upserts Bridge orders and fulfillment tasks from verified Shopify webhooks.
- Tracks supplier procurement progress as an operator workflow.
- Sends shipment tracking to Shopify and reconciles fulfillment webhooks.

## What still requires an external integration or human action

- Bridge does not log into Thieve, scrape its catalogue, or place supplier checkouts/payments.
- A human operator still places the supplier order and records its reference.
- Carrier tracking ingestion and automatic delivery confirmation require a carrier integration.
- Shopify/payment-provider activation and settlement are configured by the merchant in Shopify.
- Refunds, chargebacks, supplier-payment reconciliation, and true net-profit accounting are not yet implemented.
- The dashboard is a single-admin operations surface, not a multi-tenant SaaS account/billing platform.

## Demo safety

Use only test products, test orders, and test payment methods. Never promise automatic supplier purchasing, guaranteed inventory availability, guaranteed delivery dates, or net profitability based only on the displayed gross margin. If Shopify does not expose supplier unit cost or inventory data for a product, leave it blocked and investigate the source mapping rather than guessing.
