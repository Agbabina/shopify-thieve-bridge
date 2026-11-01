# Thieve → Shopify Bridge — Milestones

## Product intent
A private dropshipping operations backend. It discovers/imports products, publishes Shopify drafts, ingests Shopify orders, and lets the operator manually source goods before sending tracking back to Shopify. Supplier checkout remains manual.

## M1 — Foundation & Shopify OAuth
- [x] NestJS + TypeORM + SQLite development setup
- [x] Shopify OAuth install and token persistence
- [x] OAuth HMAC verification
- [x] OAuth state cookie validation
- [x] Store-domain normalization and CLI alias resolution
- [ ] Production token encryption and PostgreSQL migration

## M2 — Product discovery
- [x] AliExpress/Thieve scraping service and JSON-LD parsing
- [x] Mock product seed for development
- [x] Supplier URL allow-list to reduce SSRF exposure
- [ ] Reliable live Thieve product extraction (site access/anti-bot dependent)

## M3 — Product import
- [x] Save sourced products as local drafts
- [x] Selling-price/markup field
- [x] Push product to Shopify as a draft
- [x] Persist Shopify product ID and imported status
- [x] Prevent duplicate publishing and use POST for the mutation
- [ ] Add bulk import and product edit workflow

## M4 — Order intake / webhook sync
- [x] Register orders/create, orders/paid and fulfillments/create
- [x] Verify webhook HMAC from raw body
- [x] Match webhook shop domain to the connected store
- [x] Development CLI alias fallback when one store is connected
- [x] Idempotent order upsert by Shopify order ID + store
- [x] Remove manual order-creation workaround
- [ ] Trigger a real test order + payment in the Shopify development store
- [ ] Confirm successful deliveries in Shopify webhook delivery logs

## M5 — Fulfillment sync
- [x] Query Shopify fulfillment orders and create fulfillment with tracking
- [x] Send tracking/customer notification to Shopify
- [x] Sync fulfillment status and tracking from fulfillments/create webhook
- [x] Dashboard action for the operator to submit supplier tracking
- [ ] Test live fulfillment creation and webhook round-trip against the dev store
- [ ] Add retry/reconciliation job for Shopify/local state divergence

## M6 — Private admin dashboard
- [x] Private admin API protected by ADMIN_API_KEY
- [x] KPI cards for orders, products, pending work and drafts
- [x] Connected store list
- [x] Recent orders and product tables
- [x] Product draft push action
- [x] Manual tracking submission / mark shipped action
- [ ] Add pagination, filters, and audit log

## Release gate
Do not describe the system as production-ready until the live webhook test, live fulfillment round-trip, PostgreSQL migration, encrypted token storage, and deployment checks are complete.
