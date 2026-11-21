# Thieve → Shopify Bridge

A private NestJS backend for moving products from Thieve's supported Shopify integration into a validated Bridge workflow, then managing Shopify orders and fulfillment.

## Product sourcing: supported integration path

Bridge does **not** scrape Thieve pages. Thieve's Terms of Service prohibit scraping and automated crawling. Use Thieve's official Shopify app to import products into your Shopify store; Bridge reads those Shopify draft products through the authenticated Shopify Admin GraphQL API.

Configure:

```env
THIEVE_SOURCE_URL=https://your-store.myshopify.com
THIEVE_SOURCE_SYNC_INTERVAL_MINUTES=30
# Optional; if omitted Bridge inspects all Shopify draft products.
THIEVE_SOURCE_TAG=bridge-source
```

`THIEVE_SOURCE_URL` is the canonical Shopify store URL connected to Thieve, **not** a `thieve.co` product/catalog URL. Products should arrive in Shopify as drafts. If you set `THIEVE_SOURCE_TAG`, tag the intended source drafts with that tag in Shopify. Without a tag, every draft product in that connected store is inspected.

When the app starts, Bridge performs an initial sync and then polls at the configured interval (minimum five minutes). You can also trigger it manually:

```http
POST /api/scraper/source/sync
Authorization: Bearer <ADMIN_API_KEY>
```

The source importer reads title, description, vendor, images, variant price, variant SKU, and Shopify inventory-item unit cost. Supplier cost must be present and positive; currency is taken from the cost record, while the selling currency is taken from the Shopify store. Missing cost, missing images, invalid prices, or multi-variant products are marked for review and cannot be approved. This version intentionally blocks multi-variant approval until variant-level pricing and mapping are implemented.

Products enter Bridge as `pending_review`. A passing product must be explicitly approved:

```http
POST /api/scraper/:productId/approve
Authorization: Bearer <ADMIN_API_KEY>
```

Then:

```http
POST /api/shopify-products/:productId/push
Authorization: Bearer <ADMIN_API_KEY>
```

For Thieve-sourced products, the push operation updates the existing Shopify draft rather than creating a duplicate. It remains a draft; Bridge does not silently publish it live. Manually sourced products are also validated and require approval before publishing.

The source sync needs Shopify OAuth scopes `read_products` and `read_inventory`. Reinstall/re-authorize the app after changing scopes. If the Thieve Shopify app does not populate Shopify's inventory-item cost, Bridge will deliberately leave the product in review; do not substitute the retail price for supplier cost.

## Other existing functionality

- Shopify OAuth install/callback with HMAC and state validation.
- Store token persistence and refresh support.
- Manual AliExpress product URL parsing (not a Thieve scraper).
- Product drafts, review/approval, and Shopify draft publishing.
- Shopify order webhooks for `orders/create` and `orders/paid`.
- Fulfillment tracking sent to Shopify and synced back through `fulfillments/create`.
- Private admin dashboard at `/admin` for products, orders, connected stores, payment visibility, currency display conversion, and manual tracking submission.

Supplier checkout/payment is not automated by Bridge. Thieve's own service may handle supplier procurement when using its app and wallet; Bridge does not access that wallet or claim to place supplier orders.

## Requirements and setup

- Node.js 20+ (current LTS recommended)
- npm
- Shopify development store and app credentials
- Public HTTPS callback URL (ngrok is fine for local testing)

Copy `.env.example` to `shopify.env` and fill in your values. Never commit `shopify.env`, `.env`, database files, Shopify tokens, or encryption keys.

Required:
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`
- `SHOPIFY_SCOPES`
- `SHOPIFY_APP_URL` (public base URL, no trailing slash)
- `SHOPIFY_REDIRECT_URL` (must exactly match the Shopify app callback URL)
- `ADMIN_API_KEY` (long random secret)
- `TOKEN_ENCRYPTION_KEY` (64 hex characters / 32 random bytes; required in production)

For a CLI that sends a short simulated shop name, set either:
- `CLI_SIMULATED_SHOP=demo` and `SHOPIFY_DEFAULT_SHOP_DOMAIN=your-store.myshopify.com`, or
- `SHOPIFY_SHOP_ALIASES=demo=your-store.myshopify.com,staging=other-store.myshopify.com`

In development only, an unknown short shop alias falls back to the sole connected store when exactly one store exists. Production requires explicit aliases or the full canonical `*.myshopify.com` domain.

Run locally:

```bash
npm install
npx playwright install chromium
npm run start:dev
```

The app listens on `http://localhost:3000`. Open `/admin` and enter `ADMIN_API_KEY`.

## Shopify setup

1. Configure the app URL and callback URL in the Shopify Dev Dashboard.
2. Ensure scopes include `read_products,write_products,read_orders,write_orders,read_inventory,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders`.
3. Expose the local server over HTTPS and set `SHOPIFY_APP_URL` and `SHOPIFY_REDIRECT_URL`.
4. Install/reinstall the app to grant the required scopes.
5. Connect Thieve's official Shopify app to the same store and import products as drafts.
6. Check Shopify's webhook delivery log after creating and paying a test order in the development store.

Webhook endpoints verify Shopify's HMAC using the raw request body. Do not disable signature verification. If you change the public URL, update the app URL, redirect URL, and environment file, then re-register webhooks.

## Operations endpoints

- `GET /api/admin/dashboard` — metrics, revenue grouped by currency, stores, recent orders and products.
- `GET /api/admin/orders` — recent orders.
- `GET /api/admin/products` — recent products including validation details.
- `GET /api/admin/currency/rate?from=USD&to=NGN` — FX rate (or provide `manualRate`).
- `GET /api/admin/payments/status` — payment-provider configuration label, not live verification.
- `POST /api/scraper/source/sync` — manually sync configured Shopify drafts.
- `POST /api/scraper/:productId/approve` — approve a product only if validation passed.
- `POST /api/shopify-products/:productId/push` — create/update an approved Shopify draft.
- `POST /api/shopify/orders/:shopifyOrderId/fulfill` — submit tracking and create a Shopify fulfillment.
- `POST /api/scraper/import` — manually parse an allowed AliExpress product URL.
- `POST /api/scraper/seed-mock` — seed development-only sample products.

All admin, scraper, product-push, and fulfillment operations require:
`Authorization: Bearer <ADMIN_API_KEY>`.

Orders must enter through verified Shopify webhooks; there is no manual order-creation endpoint.

## Currency and payments caveats

- Supplier cost and selling price are stored with separate ISO currency codes. Never treat an absent currency as USD.
- FX rates are indicative. The service caches fresh rates for ten minutes and may use a stale cached rate for up to 24 hours during provider outages. The API identifies stale results. Confirm actual supplier/bank rates before paying.
- The dashboard's manual USD→NGN rate is for display/estimation only. It does not move money, change Shopify checkout currency, or change supplier invoices.
- Revenue is reported by original order currency. Bridge does not sum NGN, USD, GBP, etc. into one misleading total.
- `SHOPIFY_PAYMENT_PROVIDER=Paystack` is only a dashboard label. It does not activate Paystack, verify merchant onboarding, or prove that a live payment succeeded. The store owner must configure an available gateway in Shopify Admin and complete test and live checks. Bridge records Shopify payment events; it never handles card details.
- A missing supplier cost, multi-variant product, or invalid image blocks approval. A validation pass is not a guarantee of demand, product quality, delivery, or profitability.

## Database and deployment caveats

The repository currently uses SQLite. Back up the database before migrations. For an existing SQLite database, apply these once and in order:
1. `migrations/2026-11-01-payment-currency.sql`
2. `migrations/2026-11-21-thieve-source-pipeline.sql`

TypeORM synchronization is disabled when `NODE_ENV=production`; migrations must be applied before deploying the new entity fields. Do not run either migration twice. PostgreSQL is not yet configured as the active database adapter in this codebase; use SQLite only for local/single-instance testing until a PostgreSQL configuration and migration path are added.

Other production checks still required:
- Verify OAuth, product sync, webhooks, and fulfillment against a real Shopify development store.
- Keep `TOKEN_ENCRYPTION_KEY` stable and backed up; losing it makes stored Shopify tokens unreadable.
- Rotate any Shopify credentials/tokens that were ever committed. Deleting a secret from the latest commit does not remove it from Git history.
- The dashboard is a single-admin operations surface, not a merchant-facing multi-tenant UI.
- Supplier procurement, supplier payments, refunds, chargebacks, and full delivery reconciliation are not implemented by Bridge.
- Automated tests and a real deployment smoke test are required before treating this as production-ready.
