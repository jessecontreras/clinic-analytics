# PLAN.md — Dashboard improvements

Do ONE task at a time, in order. After each: run `npm run dev`, verify in the browser,
keep the indigo theme, don't regress anything in CLAUDE.md "gotchas", then commit with a
short message. Ask me to review before moving to the next task.

## Task 1 — Royalty performance  (highest priority)
Why: the client is a licensor; royalty performance is core to their model (JD Priority 2).
- Add a royalty rate constant, e.g. `lib/config.ts` → `export const ROYALTY_RATE = 0.08;`
- `lib/types.ts`: add `royalty: number` to `ClinicMetric`; add `totalRoyalties: number` to `NetworkSnapshot`.
- `lib/normalize.ts`: per clinic `royalty = revenue * ROYALTY_RATE`; sum into `totalRoyalties`.
- `app/page.tsx`: add a "Network Royalties" KPI card and a "Royalties" column on the Revenue-by-clinic table.
Acceptance: KPI = sum of per-clinic royalties; each clinic row shows revenue × 8%.

## Task 2 — Date-range filter
- Add a segmented control in the masthead: **7 / 30 / 90 days** (default 30).
- It sets a `?days=` query param the dashboard sends to `/api/metrics`.
- `route.ts`: read `days`, compute `begin = now − days days`, pass to `fetchSalesForClinic`, AND filter the mock sales/leads/opportunities by date so the entire snapshot respects the window.
Acceptance: switching 7/30/90 changes the revenue-over-time chart, the KPIs, and the tables consistently.

## Task 3 — Marketing spend efficiency (ROAS)  — scaffold honestly
Real spend needs a Google/Meta integration we don't have yet. Scaffold it without faking that it's real:
- Add `lib/spend.ts` returning placeholder spend per source (clearly commented as SIMULATED).
- In `normalize.ts` `bySource`: add `spend` and `roas = revenue / spend` (guard divide-by-zero).
- In the source card: show ROAS, with a small "spend: simulated" label.
Acceptance: ROAS renders from the stub; code + UI clearly mark spend as not-yet-real.

## Task 4 — Consultant rollup + KPI deltas  (minor)
- Add a toggle on the consultant table: "By consultant" (aggregate across clinics) vs "By consultant × clinic" (current behavior).
- Add period-over-period deltas to the 4 KPIs: fetch the prior equal-length window and show ▲/▼ % vs prior.
Acceptance: toggle collapses repeated consultant names; each KPI shows a delta vs the previous period.

## Guardrails
- Live mode must keep working (USE_MOCK=false → clinic_1 real). Test both modes.
- Don't break the Square↔GHL email join or the allSettled/debug behavior.
- Stay on the existing design tokens. No new heavy dependencies.
