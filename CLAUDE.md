# CLAUDE.md — Clinic Network Analytics

Context for Claude Code working in this repo. Read this before editing anything.

## What this is
A Next.js 14 (App Router) + TypeScript dashboard that unifies **Square POS** (revenue)
and **GoHighLevel CRM** (leads, pipeline, consultants) across a clinic network. It's a
demo: clinic #1 ("Scottsdale Regenerative") runs on REAL Square sandbox + GHL trial data;
clinics #2–5 are simulated. It should look and behave like a real BI tool.

## Run / verify
- `npm run dev` → http://localhost:3000 — **RESTART after any `.env.local` change** (env is read at boot).
- `npm run sync` → runs the ETL pipeline headless.
- `npx tsx scripts/seed-square.ts` → seeds the Square sandbox with orders + customers.
- After every change, run `npm run dev` and confirm the dashboard renders with no console/server errors.

## Data flow
Sources (Square per-account, GHL per-location) → fetch per clinic → normalize into a
source-agnostic model → **join Square↔GHL on customer email** → snapshot → dashboard reads the snapshot.

## Files
- `lib/types.ts` — unified model (Clinic, Sale, Lead, Opportunity, Consultant) + rollups (NetworkSnapshot).
- `lib/square.ts` — Square adapter. Orders/search (COMPLETED only), hydrates `customerEmail` from `customer_id`.
- `lib/gohighlevel.ts` — GHL v2 adapter (contacts, opportunities, users). `ghlFetch` retries transient failures.
- `lib/normalize.ts` — metric computation, the email join, and revenue attribution.
- `lib/mock.ts` — synthetic data for the simulated clinics.
- `app/api/metrics/route.ts` — builds the snapshot. Mock vs live via `USE_MOCK`; live touches clinic_1 only; uses `Promise.allSettled`.
- `app/page.tsx` — the dashboard (recharts).
- `app/globals.css` — design tokens.

## Hard-won gotchas — DO NOT regress these
- GHL **opportunities** = `GET /opportunities/search?location_id=...` (snake_case, QUERY param). NOT a POST body. (Contacts/users use `?locationId=` camelCase — GHL is inconsistent across endpoints.)
- Square amounts are in **cents** (÷100). Orders are OPEN until paid; only COMPLETED count.
- The Square↔GHL **join is on email**, normalized (trim + lowercase). Square sales must hydrate `customerEmail` from the linked customer or nothing attributes.
- **Revenue attribution** routes through the **opportunity's `assignedTo`**, not the contact owner (contact owner is often unset).
- Route uses `Promise.allSettled` per source — one failing call must NOT blank the others. Keep the `debug` block and the per-clinic `dataSource` ("live"/"mock") tags.
- GHL token is a **read-only Private Integration Token**. Do NOT add write scopes. Do NOT call Twilio/SMS/email-send endpoints (they bill during the trial).
- Env vars: `USE_MOCK`, `SQUARE_ENV`, `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `GHL_ACCESS_TOKEN`, `GHL_LOCATION_ID`. (`LT38…` is the Square location id; the GHL location id is a 20-char string.)

## Conventions
- TypeScript, Next 14 App Router, recharts. **No browser storage** (useState only).
- Theme = client brand (Aesthetic Enterprises): indigo `--brand:#5b3df5`, orange `--accent:#f4511e`, light surfaces, Plus Jakarta Sans. Use the CSS vars in `globals.css`; don't invent new palettes.
- Keep edits minimal and fully typed. Don't add dependencies without a clear need.
