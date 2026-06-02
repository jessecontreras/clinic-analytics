// ---------------------------------------------------------------------------
// Normalization & metric computation
//
// This is the genuinely hard part and the part worth showing off in the demo:
// Square knows about MONEY, GHL knows about LEADS and CONSULTANTS, and there is
// no shared key between them. We bridge the two by matching on email/phone:
//
//   Square Sale.customerEmail  ==  GHL Lead.email  ->  Lead.source, Lead.assignedUserId
//
// That join is what lets us say "revenue by marketing source" and "revenue
// influenced by consultant" even though Square has no idea those concepts
// exist. In production you'd want a fuzzier matcher (normalize phone formats,
// lowercase emails, fall back to name+date) — this is the v1.
// ---------------------------------------------------------------------------

import type {
  Sale,
  Lead,
  Opportunity,
  Consultant,
  Clinic,
  NetworkSnapshot,
  ClinicMetric,
  ConsultantMetric,
  SourceMetric,
} from "./types";
import { ROYALTY_RATE } from "./config";
import { getSimulatedSpendForSource } from "./spend";

/**
 * Normalizes a string to a canonical lookup key: trimmed and lowercased.
 * Returns `undefined` for falsy or whitespace-only input so callers can use
 * a plain truthy check before Map operations instead of a separate null guard.
 */
const norm = (s?: string) => s?.trim().toLowerCase() || undefined;

/**
 * Builds a {@link NetworkSnapshot} from raw records fetched from Square and GHL.
 *
 * This is the core cross-source join: Square knows about money, GHL knows about
 * leads and consultants, and there is no shared key between them. The two are
 * bridged by matching `Sale.customerEmail` to `Lead.email` (both normalized via
 * {@link norm}). Revenue attribution then follows the opportunity's `assignedUserId`
 * rather than the contact's owner field, which is often unset.
 *
 * All arrays are pre-filtered to a single time window by the caller; this function
 * does not apply any date logic itself.
 *
 * @param input - Raw, pre-windowed records from all sources for one clinic network.
 * @returns A fully computed snapshot ready to be serialized and returned by the API route.
 */
export function buildSnapshot(input: {
  clinics: Clinic[];
  sales: Sale[];
  leads: Lead[];
  opportunities: Opportunity[];
  consultants: Consultant[];
}): NetworkSnapshot {
  const { clinics, sales, leads, opportunities, consultants } = input;

  // Index leads by contact key so a sale can find its originating lead.
  const leadByEmail = new Map<string, Lead>();
  for (const l of leads) if (norm(l.email)) leadByEmail.set(norm(l.email)!, l);

  const clinicName = new Map(clinics.map((c) => [c.id, c.name]));
  const consultantName = new Map(consultants.map((c) => [c.id, c.name]));

  // ---- per-clinic ----
  const byClinic: ClinicMetric[] = clinics.map((c) => {
    const cSales = sales.filter((s) => s.clinicId === c.id);
    const cLeads = leads.filter((l) => l.clinicId === c.id);
    const cOpps = opportunities.filter((o) => o.clinicId === c.id);
    const won = cOpps.filter((o) => o.status === "won").length;
    const lost = cOpps.filter((o) => o.status === "lost").length;
    const revenue = round(cSales.reduce((sum, s) => sum + s.amount, 0));
    return {
      clinicId: c.id,
      clinicName: c.name,
      revenue,
      royalty: round(revenue * ROYALTY_RATE),
      leadCount: cLeads.length,
      wonCount: won,
      lostCount: lost,
      closeRate: won + lost ? round(won / (won + lost)) : 0,
    };
  });

  // ---- per-consultant (close rate from GHL opps) ----
  const consMap = new Map<string, ConsultantMetric>();
  for (const o of opportunities) {
    if (!o.assignedUserId) continue;
    const m = consMap.get(o.assignedUserId) ?? {
      consultantId: o.assignedUserId,
      consultantName: consultantName.get(o.assignedUserId) ?? "Unknown",
      clinicName: clinicName.get(o.clinicId) ?? "Unknown",
      won: 0,
      lost: 0,
      closeRate: 0,
      revenueInfluenced: 0,
    };
    if (o.status === "won") m.won++;
    if (o.status === "lost") m.lost++;
    consMap.set(o.assignedUserId, m);
  }
  // attribute Square revenue to a consultant.
  // Map customer email -> consultant. Prefer the OPPORTUNITY's assignedTo (it's
  // reliably set), falling back to the contact's owner if present.
  const leadByContactId = new Map<string, Lead>();
  for (const l of leads) leadByContactId.set(l.ghlContactId, l);

  const consultantByEmail = new Map<string, string>();
  for (const o of opportunities) {
    if (!o.assignedUserId) continue;
    const email = norm(leadByContactId.get(o.contactId)?.email);
    if (email) consultantByEmail.set(email, o.assignedUserId);
  }

  for (const s of sales) {
    const email = norm(s.customerEmail);
    if (!email) continue;
    const consId =
      consultantByEmail.get(email) ?? leadByEmail.get(email)?.assignedUserId;
    if (consId && consMap.has(consId)) {
      consMap.get(consId)!.revenueInfluenced += s.amount;
    }
  }
  const byConsultant = [...consMap.values()].map((m) => ({
    ...m,
    closeRate: m.won + m.lost ? round(m.won / (m.won + m.lost)) : 0,
    revenueInfluenced: round(m.revenueInfluenced),
  })).filter((m) => m.won + m.lost > 0 || m.revenueInfluenced > 0);

  // ---- per-source (the Square<>GHL join in action) ----
  // Collapse "no source set" and "no matching contact" into one bucket — to a
  // reader they're the same thing ("source unknown"), so don't show both.
  const SOURCE_FALLBACK = "unattributed";
  const cleanSource = (s?: string) =>
    s && s.toLowerCase() !== "unknown" ? s : SOURCE_FALLBACK;

  // Sorted descending by revenue; this order is preserved into the return value.
  const srcMap = new Map<string, SourceMetric>();
  for (const l of leads) {
    const key = cleanSource(l.source);
    const m =
      srcMap.get(key) ?? { source: key, leads: 0, revenue: 0, spend: 0, roas: 0 };
    m.leads++;
    srcMap.set(key, m);
  }
  for (const s of sales) {
    const emailKey = norm(s.customerEmail);
    const lead = emailKey ? leadByEmail.get(emailKey) : undefined;
    const key = cleanSource(lead?.source);
    const m =
      srcMap.get(key) ?? { source: key, leads: 0, revenue: 0, spend: 0, roas: 0 };
    m.revenue += s.amount;
    srcMap.set(key, m);
  }
  const bySource = [...srcMap.values()]
    .map((m) => {
      const revenue = round(m.revenue);
      const spend = getSimulatedSpendForSource(m.source);
      return {
        ...m,
        revenue,
        spend,
        roas: spend > 0 ? round(revenue / spend) : 0,
      };
    })
    // Lead-only sources (contacts not yet converted to sales) are intentionally
    // excluded; only revenue-generating sources appear in the source table.
    .filter((m) => m.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);

  // ---- revenue by day ----
  const dayMap = new Map<string, number>();
  for (const s of sales) {
    const day = s.occurredAt.slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + s.amount);
  }
  const revenueByDay = [...dayMap.entries()]
    .map(([date, revenue]) => ({ date, revenue: round(revenue) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalWon = byClinic.reduce((s, c) => s + c.wonCount, 0);
  const totalLost = byClinic.reduce((s, c) => s + c.lostCount, 0);

  return {
    generatedAt: new Date().toISOString(),
    totalRevenue: round(byClinic.reduce((s, c) => s + c.revenue, 0)),
    totalRoyalties: round(byClinic.reduce((s, c) => s + c.royalty, 0)),
    totalLeads: leads.length,
    networkCloseRate:
      totalWon + totalLost ? round(totalWon / (totalWon + totalLost)) : 0,
    byClinic: byClinic.sort((a, b) => b.revenue - a.revenue),
    byConsultant: byConsultant.sort((a, b) => b.closeRate - a.closeRate),
    bySource,
    revenueByDay,
  };
}

/** Rounds to two decimal places — safe for dollar amounts throughout this module. */
const round = (n: number) => Math.round(n * 100) / 100;
