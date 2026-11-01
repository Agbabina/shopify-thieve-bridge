# Thieve → Shopify Bridge

A private NestJS backend for connecting a Shopify store to product sourcing workflows. It supports Shopify OAuth, product scraping/import, draft publishing, order webhooks, and manual supplier fulfillment with Shopify tracking sync.

## Current scope

- Shopify OAuth install and callback with HMAC + state validation.
- Store token persistence and refresh support.
- AliExpress/Thieve URL allow-list for scraping; JSON-LD parsing and mock seed data for development.
- Product drafts, markup/selling price, and Shopify draft publishing.
- Idempotent order ingestion for `orders/create` and `orders/paid`.
- Fulfillment tracking sent to Shopify and synced back through `fulfillments/create`.
- Private admin dashboard at `/admin` for products, orders, connected stores, payment visibility, currency display conversion, and manual tracking submission.

Supplier checkout remains manual by design: supplier sites often require interactive login, payment, and CAPTCHA. The app automates the Shopify-side workflow, not supplier payment.

## Requirements

- Node.js 20+ (use a current LTS release)
- npm
- Shopify development store and app credentials
- Public HTTPS callback URL (ngrok is fine for local testing)

## Configuration

Copy `.env.example` to `shopify.env` and fill in your values. Never commit the real file.

Required values:

- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`
- `SHOPIFY_SCOPES`
- `SHOPIFY_APP_URL` — public base URL, no trailing slash
- `SHOPIFY_REDIRECT_URL` — must exactly match Shopify app's callback URL
- `ADMIN_API_KEY` — long random secret for the private dashboard and operational endpoints

For a CLI that sends a short simulated shop name, set either:
- `CLI_SIMULATED_SHOP=demo` and `SHOPIFY_DEFAULT_SHOP_DOMAIN=your-store.myshopify.com`, or
- `SHOPIFY_SHOP_ALIASES=demo=your-store.myshopify.com,staging=other-store.myshopify.com`

In development only, an unknown short shop alias falls back to the sole connected store when exactly one store exists. Production requires explicit aliases or the full canonical `*.myshopify.com` domain.

Optional:
- `SHOPIFY_DB_PATH=shopify.db`
- `NODE_ENV=development`

## Run locally

```bash
npm install
npx playwright install chromium
npm run start:dev
```

The app listens on `http://localhost:3000`. Open `/admin`, enter `ADMIN_API_KEY`, and use the dashboard.

## Shopify setup

1. Configure the app URL and callback URL in the Shopify Dev Dashboard.
2. Ensure scopes include `read_products,write_products,read_orders,write_orders,read_products,write_products,read_orders,write_orders,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders`.
3. Expose the local server over HTTPS and set `SHOPIFY_APP_URL` and `SHOPIFY_REDIRECT_URL` to that exact host.
4. Install/reinstall the app. The OAuth callback registers `orders/create`, `orders/paid`, and `fulfillments/create`.
5. Check Shopify's webhook delivery log after creating and paying a test order in the development store.

Webhook endpoints verify Shopify's HMAC using the raw request body. Do not disable signature verification. If you change the public URL, update the app URL, redirect URL, and environment file, then reinstall or re-run webhook registration.

## Operations

- `GET /api/admin/dashboard` — metrics, stores, recent orders and products.
- `GET /api/admin/orders` — recent orders.
- `GET /api/admin/products` — recent products.
- `POST /api/shopify-products/:productId/push` — create a Shopify draft and persist its Shopify product ID.
- `POST /api/shopify/orders/:shopifyOrderId/fulfill` — submit tracking and create a Shopify fulfillment.
- `POST /api/scraper/import` — save a scraped product as a draft.
- `POST /api/scraper/seed-mock` — seed development-only sample products.

All admin, scraper, product-push, and fulfillment operations require:
`Authorization: Bearer <ADMIN_API_KEY>`.

The former manual order-creation endpoint is intentionally removed. Orders must enter through verified Shopify webhooks.

## Database migration before production

The new dashboard fields add `products.supplierCurrency`, `orders.financialStatus`, and `orders.paymentGateway`. Development auto-sync creates these columns automatically. Because production disables TypeORM synchronization, apply `migrations/2026-11-01-payment-currency.sql` to the existing SQLite database once before deploying this version. Back up the database first; do not run the migration twice.

## Important deployment notes

- SQLite is for local development. Use PostgreSQL and migrations before a multi-user/production deployment.
- TypeORM schema synchronization is disabled when `NODE_ENV=production`; create and run migrations before deploying there.
- Do not commit `shopify.env`, `.env`, or database files. Removing a file from the latest commit does not erase earlier Git history. Rotate any credentials/tokens that were ever committed.
- The dashboard is a single-admin operations surface, not a merchant-facing multi-tenant UI.
- Live webhook delivery and Shopify fulfillment require a real installed development store and valid scopes. Unit/local simulation is not proof of a live Shopify delivery.


## Payments and currency operations

Bridge does not process customer payments itself. The Shopify store owner activates a supported payment provider in Shopify Admin → Settings → Payments. For a Nigerian store, check whether Paystack is offered in that store's provider list, connect the merchant's Paystack account, and test in Paystack test mode before switching to live mode. Shopify automatically updates orders after successful Paystack payments; Bridge records the resulting order/payment webhook. The provider's availability depends on the store's country and Shopify configuration.

Set `SHOPIFY_PAYMENT_PROVIDER=Paystack` and `SHOPIFY_STORE_CURRENCY=NGN` in `shopify.env` after configuring the gateway. These values label the dashboard readiness panel; they do not activate a gateway or verify that a live payment account is approved.

The dashboard currency selector converts displayed order totals and supplier costs into NGN, USD, GBP, EUR, GHS, or KES. Market rates are fetched from an external FX feed and cached for ten minutes. A manual USD→NGN rate can override the feed for dashboard calculations. Product supplier prices default to USD unless you set their source currency explicitly. This is a display/estimation feature only: it does not move money, change the Shopify checkout currency, change supplier invoices, or guarantee the rate charged by a bank or card issuer. Confirm the final amount in the payment provider before paying a supplier.
