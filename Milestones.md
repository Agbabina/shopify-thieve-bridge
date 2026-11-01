# Thieve → Shopify Automation

## What this is

A dropshipping automation backend connecting a Shopify store to **Thieve** (a curated product discovery site) so a store owner can:

1. **Log in by installing the app on their Shopify store** — no separate signup. Shopify OAuth install *is* the login, and it hands the app an Admin API access token to act on their store.
2. **Discover products** — scrape product listings from Thieve (title, images, price, description, source URL).
3. **Import selected products into Shopify** as draft or live listings, with an automatic price markup applied.
4. **Catch incoming orders** — when a customer buys something, Shopify sends a webhook; the app logs the order and creates a fulfillment task for the owner.
5. **Manual fulfillment loop** — the owner orders the item from the supplier (Thieve/AliExpress) by hand, comes back, pastes the tracking number, and the app pushes that to Shopify so the customer sees "shipped."

No inventory of your own, no warehouse — classic dropship middleman pattern, automated on the Shopify/data side.

### Why fulfillment/ordering is manual, not automatic

Auto-purchasing from a supplier site means scripting a real checkout — card details, CAPTCHAs, login walls. It's fragile and usually against that site's terms of service. Tools that try to fully automate this tend to break constantly or get accounts flagged.

The plan is built so this can change later without a rewrite: Milestone 5 is scoped so the manual "paste tracking number" step can be swapped for an automated `placeOrder()` service down the line — same interface, no other code changes required elsewhere. Manual-for-now keeps things stable while the rest of the stack is still being learned.

---

## Stack

- **NestJS** (backend framework)
- **TypeORM** + **SQLite** for local dev (was Postgres, switched for simpler local setup — will move back to Postgres before production, since SQLite doesn't handle concurrent writes well and most hosts don't support file-based DBs)
- **Shopify Admin API** via OAuth
- **Firecrawl** for scraping Thieve
- Built from scratch — no Shopify CLI scaffolding, no Lovable, no Supabase-as-platform

---

## Folder structure (current)

```
src/shopify-oauth/
├── shopify-oauth.service.ts      — buildInstallUrl(), verifyHmac(), exchangeCodeForToken()
├── shopify.controller.ts         — GET /api/shopify/install, GET /api/shopify/callback
├── shopify-stores.service.ts     — upsertStore(), findByShop()
├── shopify.module.ts
└── entities/
    └── shopify-store.entity.ts   — shopDomain, accessToken, scope, installedAt
```

---

## Milestones

### M1 — Foundation & Shopify OAuth login ✅ (core flow working)
- [x] NestJS project scaffolded
- [x] Shopify Partner account + dev store created (`sharon-aptmdt0n.myshopify.com`)
- [x] Shopify app created in the **new Shopify Dev Dashboard** (dev.shopify.com — URL/redirect config lives under Versions → Create version → Release, different from the old Partner Dashboard)
- [x] ngrok tunnel wired to localhost:3000
- [x] OAuth install → consent → callback flow tested end-to-end, successfully exchanges code for access token
- [x] Switched DB to SQLite for local dev
- [ ] Persist access token to DB via `shopify-stores.service.ts` (in progress)
- [ ] Create a session so the browser is actually "logged in" (not just returning JSON)
- [ ] Remaining DB entities: `profiles`, `user_roles`, `products`, `orders`, `supplier_tasks`, `scrape_jobs`

**Known issues to fix (not urgent yet):**
- Token returned is `shpua_` (per-user/online) not `shpat_` (offline) — need offline token for webhooks/background work later. Requires adjusting the OAuth grant type in `buildInstallUrl()`.
- `scope` came back empty in one test — verify `SHOPIFY_SCOPES` env var is being read correctly (no spaces around `=` in `.env`).

### M2 — Product discovery (Thieve scraping)
- Connect Firecrawl
- `thieve.service.ts` — `scrapeUrl(url)`, `scrapeFeed(url, limit)`
- Zod schemas for scraped product shape
- UI/endpoint to preview scraped products and save as drafts

### M3 — Import drafts to Shopify
- `shopify-admin.service.ts` — wraps Shopify Admin GraphQL
- `pricing.service.ts` — markup rule (e.g. source × 2.5, rounded to `.99`)
- `importProduct()`, `importBulk()` — writes back `shopify_product_id`, flips status to live

### M4 — Order intake (Shopify webhooks)
- Register webhooks on install: `orders/create`, `orders/paid`, `fulfillments/create`
- `webhook.ts` route — verifies HMAC, routes by `X-Shopify-Topic` header
- On `orders/paid`: insert `orders` row + one `supplier_tasks` row per line item
- Email the owner: buyer address + source URL + "mark fulfilled" link

### M5 — Manual fulfillment loop
- UI: list of open tasks → buyer address, source URL, paste tracking, mark shipped
- `markShipped(taskId, trackingNumber)` → `ShopifyAdminService.createFulfillment()`
- *(Later hook: swap manual step for an automated `placeOrder()` service — same interface)*

### M6 — Polish & publish
- Dashboard home: KPI cards (orders today, revenue, pending tasks, drafts to import)
- Global error handling + toasts
- SEO metadata
- Publish + verify webhook URLs point at the real production domain

---

## Local dev quirks worth remembering

- **ngrok free tier** — URL changes every restart. Each time: update Shopify app's "App URL" + "Redirect URLs" (under Versions → new version → Release) *and* `.env`'s `SHOPIFY_APP_URL` / `SHOPIFY_REDIRECT_URL`.
- **`.env` spacing** — no spaces around `=`, or values silently become `undefined`.
- **Env changes need a server restart** — hot reload doesn't pick up `.env` edits.
- **New Shopify Dev Dashboard** — App URL / Redirect URLs are configured per-**version**, not in Settings. Settings only holds credentials/webhooks/navigation. Create a new version → fill URLs → click **Release** to make it live.
