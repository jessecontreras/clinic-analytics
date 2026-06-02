// ---------------------------------------------------------------------------
// GET /api/metrics
//
// MOCK mode (USE_MOCK !== "false"): everything simulated.
// LIVE mode (USE_MOCK === "false"): clinic_1 ("Scottsdale") is pulled from real
// Square + GHL; clinics 2-5 stay simulated.
//
// Robustness: each source is fetched independently with Promise.allSettled, so
// one failing call (e.g. Square) can no longer hide the others (e.g. GHL). Every
// failure is logged AND returned in `debug.errors` so the UI can show it. A
// per-clinic `dataSource` tag drives the live/sim badge in the dashboard.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { generateMock } from "@/lib/mock";
import { buildSnapshot } from "@/lib/normalize";
import { fetchSalesForClinic } from "@/lib/square";
import {
  fetchLeadsForClinic,
  fetchOpportunitiesForClinic,
  fetchConsultantsForClinic,
} from "@/lib/gohighlevel";
import type {
  Clinic,
  KpiDeltas,
  Lead,
  NetworkSnapshot,
  Opportunity,
  Sale,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const LIVE_CLINIC_ID = "clinic_1";

const LIVE: Clinic = {
  id: LIVE_CLINIC_ID,
  name: "Scottsdale Regenerative",
  region: "AZ",
  squareAccountId: "live",
  squareLocationId: process.env.SQUARE_LOCATION_ID ?? "",
  ghlLocationId: process.env.GHL_LOCATION_ID ?? "",
};

const DEFAULT_DAYS = 30;
const ALLOWED_DAYS = new Set([7, 30, 90]);

/**
 * Parses and validates the `?days=` query parameter.
 * Only accepts values from the allowed set (7, 30, 90); falls back to
 * {@link DEFAULT_DAYS} for missing, non-numeric, or out-of-set values.
 *
 * @param request - The incoming Next.js route request.
 * @returns A validated day-count integer (7 | 30 | 90).
 */
function parseDays(request: Request) {
  const raw = new URL(request.url).searchParams.get("days");
  const days = Number(raw ?? DEFAULT_DAYS);
  return ALLOWED_DAYS.has(days) ? days : DEFAULT_DAYS;
}

/**
 * Returns `true` if an ISO 8601 date string falls within [begin, end] (inclusive).
 * Returns `false` for missing, unparseable, or non-finite timestamps so records
 * without a valid date are excluded rather than silently included.
 *
 * @param date - ISO 8601 date string to test. May be `undefined`.
 * @param begin - Window start (inclusive).
 * @param end - Window end (inclusive).
 */
function inWindow(date: string | undefined, begin: Date, end: Date) {
  if (!date) return false;
  const value = new Date(date).getTime();
  return Number.isFinite(value) && value >= begin.getTime() && value <= end.getTime();
}

/**
 * Filters an array of time-stamped records to those whose primary date falls
 * within [begin, end]. Sales are keyed on `occurredAt`; leads and opportunities
 * on `createdAt`. Used for both the current window and the prior comparison window
 * so the two snapshots are always computed over equal-length, non-overlapping periods.
 *
 * @param rows - Array of {@link Sale}, {@link Lead}, or {@link Opportunity} records.
 * @param begin - Window start (inclusive).
 * @param end - Window end (inclusive).
 * @returns The subset of `rows` whose timestamp falls within the window.
 */
function filterToWindow<T extends Sale | Lead | Opportunity>(
  rows: T[],
  begin: Date,
  end: Date,
) {
  return rows.filter((row) => {
    if ("occurredAt" in row) return inWindow(row.occurredAt, begin, end);
    return inWindow(row.createdAt, begin, end);
  });
}

/**
 * Computes period-over-period percentage deltas for the top-level KPIs and
 * writes them into `current.kpiDeltas` in place.
 *
 * - A `null` delta signals a new metric (prior was 0, current is non-zero) and
 *   renders as "new" in the UI.
 * - `0` means no change between periods.
 * - All other values are fractional ratios (0.12 = +12%, −0.05 = −5%).
 *
 * @param current - Snapshot for the selected window; mutated in place.
 * @param prior - Snapshot for the equal-length window immediately preceding it.
 */
function attachKpiDeltas(current: NetworkSnapshot, prior: NetworkSnapshot) {
  current.kpiDeltas = {
    totalRevenue: delta(current.totalRevenue, prior.totalRevenue),
    totalRoyalties: delta(current.totalRoyalties, prior.totalRoyalties),
    totalLeads: delta(current.totalLeads, prior.totalLeads),
    networkCloseRate: delta(current.networkCloseRate, prior.networkCloseRate),
    // In mock mode all 5 clinics appear in both windows regardless of date,
    // so this delta is always 0 by design.
    activeClinics: delta(current.byClinic.length, prior.byClinic.length),
  };
}

/**
 * Computes a period-over-period change ratio rounded to three decimal places.
 *
 * - Returns `null` when `previous` is 0 and `current` is non-zero (new metric, no baseline).
 * - Returns `0` when both values are 0 (no activity in either period).
 * - Otherwise returns `(current − previous) / previous`.
 *
 * @param current - Metric value for the current window.
 * @param previous - Metric value for the prior equal-length window.
 */
function delta(current: number, previous: number): KpiDeltas[keyof KpiDeltas] {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 1000;
}

/**
 * GET /api/metrics?days=7|30|90
 *
 * Returns a {@link NetworkSnapshot} for the requested time window, including
 * period-over-period KPI deltas computed against the equal-length window
 * immediately preceding it.
 *
 * **Mock mode** (`USE_MOCK !== "false"`): all data comes from {@link generateMock}
 * filtered to the requested window — no external calls are made.
 *
 * **Live mode** (`USE_MOCK === "false"`): clinic_1 ("Scottsdale Regenerative") is
 * fetched from real Square and GHL APIs; clinics 2–5 remain simulated. Each source
 * is fetched independently via `Promise.allSettled` so one failing call cannot blank
 * the others. All failures are recorded in `debug.errors` and surfaced in the UI.
 *
 * @param request - Incoming Next.js route request. Reads `?days=` for the window size.
 */
export async function GET(request: Request) {
  const days = parseDays(request);
  const endDate = new Date();
  const beginDate = new Date(endDate.getTime() - days * 86_400_000);
  const priorEndDate = beginDate;
  const priorBeginDate = new Date(priorEndDate.getTime() - days * 86_400_000);
  const begin = beginDate.toISOString();
  const end = endDate.toISOString();
  const priorBegin = priorBeginDate.toISOString();
  const priorEnd = priorEndDate.toISOString();
  const mock = generateMock();
  const windowedMock = {
    ...mock,
    sales: filterToWindow(mock.sales, beginDate, endDate),
    leads: filterToWindow(mock.leads, beginDate, endDate),
    opportunities: filterToWindow(mock.opportunities, beginDate, endDate),
  };
  const priorMock = {
    ...mock,
    sales: filterToWindow(mock.sales, priorBeginDate, priorEndDate),
    leads: filterToWindow(mock.leads, priorBeginDate, priorEndDate),
    opportunities: filterToWindow(
      mock.opportunities,
      priorBeginDate,
      priorEndDate,
    ),
  };

  if (process.env.USE_MOCK !== "false") {
    const snap = buildSnapshot(windowedMock);
    const priorSnap = buildSnapshot(priorMock);
    attachKpiDeltas(snap, priorSnap);
    snap.byClinic = snap.byClinic.map((c) => ({
      ...c,
      dataSource: "mock" as const,
    }));
    return NextResponse.json(snap);
  }

  // --- LIVE: clinic_1 from real APIs, rest simulated -----------------------
  const sq = process.env.SQUARE_ACCESS_TOKEN ?? "";
  const ghl = process.env.GHL_ACCESS_TOKEN ?? "";

  const [salesR, priorSalesR, leadsR, oppsR, consR] = await Promise.allSettled([
    fetchSalesForClinic(
      LIVE.id,
      LIVE.squareLocationId,
      { accessToken: sq },
      begin,
      end,
    ),
    fetchSalesForClinic(
      LIVE.id,
      LIVE.squareLocationId,
      { accessToken: sq },
      priorBegin,
      priorEnd,
    ),
    fetchLeadsForClinic(LIVE.id, LIVE.ghlLocationId, ghl),
    fetchOpportunitiesForClinic(LIVE.id, LIVE.ghlLocationId, ghl),
    fetchConsultantsForClinic(LIVE.id, LIVE.ghlLocationId, ghl),
  ]);

  const errors: Record<string, string> = {};
  const take = <T>(r: PromiseSettledResult<T[]>, label: string): T[] => {
    if (r.status === "fulfilled") return r.value;
    errors[label] = String((r.reason as Error)?.message ?? r.reason);
    console.error(`Live ${label} failed:`, r.reason);
    return [];
  };

  const sales = filterToWindow(take(salesR, "square_sales"), beginDate, endDate);
  const priorSales = filterToWindow(
    take(priorSalesR, "square_sales_prior"),
    priorBeginDate,
    priorEndDate,
  );
  const allLeads = take(leadsR, "ghl_leads");
  const leads = filterToWindow(allLeads, beginDate, endDate);
  const priorLeads = filterToWindow(allLeads, priorBeginDate, priorEndDate);

  const allOpps = take(oppsR, "ghl_opportunities");
  const opportunities = filterToWindow(allOpps, beginDate, endDate);
  const priorOpportunities = filterToWindow(allOpps, priorBeginDate, priorEndDate);
  const consultants = take(consR, "ghl_consultants");

  const anyLive = [salesR, leadsR, oppsR].some((r) => r.status === "fulfilled");
  const keep = <T extends { clinicId: string }>(arr: T[]) =>
    arr.filter((x) => x.clinicId !== LIVE_CLINIC_ID);

  const snap = buildSnapshot(
    anyLive
      ? {
          clinics: [
            LIVE,
            ...windowedMock.clinics.filter((c) => c.id !== LIVE_CLINIC_ID),
          ],
          sales: [...sales, ...keep(windowedMock.sales)],
          leads: [...leads, ...keep(windowedMock.leads)],
          opportunities: [...opportunities, ...keep(windowedMock.opportunities)],
          consultants: [...consultants, ...keep(windowedMock.consultants)],
        }
      : windowedMock, // total failure -> all mock so the row isn't blank (debug shows why)
  );
  const priorSnap = buildSnapshot(
    anyLive
      ? {
          clinics: [
            LIVE,
            ...priorMock.clinics.filter((c) => c.id !== LIVE_CLINIC_ID),
          ],
          sales: [...priorSales, ...keep(priorMock.sales)],
          leads: [...priorLeads, ...keep(priorMock.leads)],
          opportunities: [
            ...priorOpportunities,
            ...keep(priorMock.opportunities),
          ],
          consultants: [...consultants, ...keep(priorMock.consultants)],
        }
      : priorMock,
  );
  attachKpiDeltas(snap, priorSnap);

  snap.byClinic = snap.byClinic.map((c) => ({
    ...c,
    dataSource: anyLive && c.clinicId === LIVE_CLINIC_ID ? "live" : "mock",
  }));
  snap.debug = {
    live: anyLive,
    counts: {
      sales: sales.length,
      leads: leads.length,
      opportunities: opportunities.length,
      consultants: consultants.length,
      salesWithEmail: sales.filter((s) => s.customerEmail).length,
    },
    errors,
  };

  return NextResponse.json(snap);
}
