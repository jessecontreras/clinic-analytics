# Clinic Network Analytics — demo

A working proof-of-concept for the Aesthetic Enterprises Founding Engineer role:
a unified dashboard over **Square POS** (revenue) and **GoHighLevel CRM** (leads,
pipeline, consultants) across a network of clinics.

It runs out of the box with mock data, then flips to real sandbox data with a
single env var. The point is to demonstrate the *architecture* — not to ship 40
real integrations in a weekend.

## Run it

```bash
npm install
cp .env.example .env.local   # USE_MOCK=true by default
npm run dev                  # http://localhost:3000
npm run sync                 # prints the same pipeline running headless (cron path)
```

## The architecture in one paragraph

Each clinic is an independent operator, so each one is its **own Square seller
account** and its **own GoHighLevel sub-account** — there is no master token
that sees everything. A scheduled sync fans out across clinics, calls Square and
GHL *per clinic* with that clinic's stored OAuth token, normalizes every
response into one **source-agnostic data model** (`lib/types.ts`), joins the two
worlds on customer email/phone, and writes pre-computed rollups. The dashboard
reads rollups only — it never calls a vendor API on a page load.

```
┌────────────┐   per-clinic OAuth    ┌──────────────┐
│  Square ×N │ ───────────────────▶  │              │   normalize    ┌──────────┐
│  (revenue) │                       │  sync (cron) │ ─────────────▶ │ Postgres │
├────────────┤   per-location OAuth  │   fan-out    │   + join on    │ rollups  │
│   GHL ×N   │ ───────────────────▶  │              │   email/phone  └────┬─────┘
│ (leads/CRM)│                       └──────────────┘                     │
└────────────┘                                                            ▼
                                                              ┌────────────────────┐
                                                              │  Next.js dashboard  │
                                                              │  (reads rollups)    │
                                                              └────────────────────┘
```

## The hard part: joining Square to GHL

Square knows **money**; GHL knows **leads, sources, and consultants**. They
share no key. `lib/normalize.ts` bridges them by matching a Square sale's
customer email/phone to a GHL contact, which is what makes
"revenue by marketing source" and "revenue influenced per consultant" possible.
In production you'd harden this (phone normalization, name+date fallback, a
confidence score) — the v1 match is intentionally simple and visible.

## Endpoints used

**Square** (`https://connect.squareup.com`, sandbox `…squareupsandbox.com`)
- `POST /oauth2/token` — exchange / refresh per-clinic tokens
- `POST /v2/orders/search` — completed orders → revenue (core)
- `GET /v2/payments` — payment-level amounts
- `POST /v2/customers/search` — email/phone for the join
- `GET /v2/locations` — locations within an account

**GoHighLevel v2** (`https://services.leadconnectorhq.com`, header `Version: 2021-07-28`)
- `POST /oauth/token` — marketplace-app OAuth
- `POST /opportunities/search` — pipeline → close rates (won/lost by consultant)
- `GET /contacts/` — leads (`attributionSource` → marketing source)
- `GET /users/` — sales consultants
- `GET /opportunities/pipelines` — stage definitions

## Data model

`lib/types.ts` — `Clinic`, `Sale`, `Lead`, `Opportunity`, `Consultant` are the
normalized inputs; `NetworkSnapshot` (with `ClinicMetric`, `ConsultantMetric`,
`SourceMetric`) is what the dashboard consumes.

## File map

```
lib/types.ts        unified data model
lib/square.ts       Square adapter (orders/payments → Sale[])
lib/gohighlevel.ts  GHL adapter (contacts/opportunities/users)
lib/normalize.ts    metric computation + the Square↔GHL join
lib/mock.ts         synthetic 5-clinic dataset (overlapping emails)
app/api/metrics     snapshot endpoint (mock now, live path sketched)
app/page.tsx        the dashboard
scripts/sync.ts     the real cron/ETL path
```

## Notes for the live demo
- Square sandbox is free and seeded with sample data — flip `SQUARE_ENV=sandbox`.
- GHL needs a trial account (API access is on the Unlimited tier). Don't wire up
  Twilio/SMS sends — those bill at usage rates even during the trial.
- This is deliberately a proof-of-concept. The talking point is the *shape*:
  per-clinic OAuth, source-agnostic model, the email/phone join, cron rollups.
