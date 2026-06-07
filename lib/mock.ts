// ---------------------------------------------------------------------------
// Mock data — lets the whole dashboard run with NO Square/GHL credentials.
//
// Demo strategy: ship this so the founder can `npm run dev` and see a working
// dashboard immediately. Then flip USE_MOCK=false to pull real sandbox data.
// The mock deliberately produces emails that overlap between sales and leads
// so the join logic in normalize.ts actually fires.
// ---------------------------------------------------------------------------

import type { Clinic, Sale, Lead, Opportunity, Consultant } from "./types";

const CLINIC_NAMES = [
  "Scottsdale Regenerative",
  "Phoenix Hair & Wellness",
  "Tempe Restoration Co.",
  "Mesa Aesthetics",
  "Chandler Vitality",
];
const SOURCES = ["google_ads", "meta_ads", "referral", "organic", "instagram"];
const CONSULTANTS = ["Dana R.", "Marcus L.", "Priya S.", "Jordan K."];

/**
 * Creates a deterministic pseudo-random number generator using a Mulberry32-style
 * integer hash. The same seed always produces the same sequence, so mock data is
 * stable across server restarts and does not drift between renders.
 *
 * @param seed - Integer seed value.
 * @returns A zero-argument function returning a float in [0, 1).
 */
function createRng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks a uniformly random element from an array using the provided RNG.
 *
 * @param arr - The array to sample from.
 * @param rng - A seeded RNG, e.g. from {@link createRng}.
 * @returns A randomly selected element.
 */
function rand<T>(arr: T[], rng: () => number) {
  return arr[Math.floor(rng() * arr.length)];
}
/**
 * Returns an ISO 8601 timestamp for a point `n` days before the current time.
 * The absolute dates shift daily since this uses `Date.now()`, but the relative
 * distribution across the 180-day window remains deterministic via the seeded RNG.
 *
 * @param n - Number of days to subtract from now.
 */
function daysAgo(n: number, baseDate: Date) {
  return new Date(baseDate.getTime() - n * 86_400_000).toISOString();
}

/**
 * Generates a complete, deterministic set of mock data covering all five clinics,
 * their consultants, leads, opportunities, and Square sales.
 *
 * Data spans ~180 days so it remains meaningful when the API route filters it to
 * 7, 30, or 90-day windows. Won opportunities always have a matching Square sale
 * on the same customer email so the Square↔GHL join in `buildSnapshot` fires
 * correctly. Baseline entries (one per consultant) are always within the last 6
 * days, including publish-day activity on June 7 in the default demo snapshot,
 * guaranteeing every consultant appears even in the narrowest 7-day window.
 *
 * @returns Raw arrays whose shape matches the live Square and GHL adapters,
 *   ready to be passed directly to {@link buildSnapshot}.
 */
export function generateMock(baseDate = new Date("2026-06-07T21:00:00.000Z")) {
  const rng = createRng(0xa37c1e);
  const clinics: Clinic[] = CLINIC_NAMES.map((name, i) => ({
    id: `clinic_${i + 1}`,
    name,
    region: "AZ",
    squareAccountId: `sq_acct_${i + 1}`,
    squareLocationId: `sq_loc_${i + 1}`,
    ghlLocationId: `ghl_loc_${i + 1}`,
  }));

  const consultants: Consultant[] = [];
  clinics.forEach((c, i) => {
    CONSULTANTS.slice(0, 2 + (i % 3)).forEach((name, j) =>
      consultants.push({ id: `${c.id}_u${j}`, clinicId: c.id, name })
    );
  });

  const leads: Lead[] = [];
  const sales: Sale[] = [];
  const opportunities: Opportunity[] = [];

  for (const c of clinics) {
    const clinicConsultants = consultants.filter((u) => u.clinicId === c.id);
    const leadCount = 40 + Math.floor(rng() * 60);

    for (let i = 0; i < leadCount; i++) {
      const email = `lead${i}@${c.id}.example`;
      const consultant = rand(clinicConsultants, rng);
      const created = daysAgo(Math.floor(rng() * 180), baseDate);
      leads.push({
        id: `lead_${c.id}_${i}`,
        clinicId: c.id,
        ghlContactId: `ghlc_${c.id}_${i}`,
        email,
        source: rand(SOURCES, rng),
        assignedUserId: consultant.id,
        createdAt: created,
      });

      // ~45% of leads become an opportunity
      if (rng() < 0.45) {
        const won = rng() < 0.4;
        opportunities.push({
          id: `opp_${c.id}_${i}`,
          clinicId: c.id,
          ghlOpportunityId: `ghlo_${c.id}_${i}`,
          contactId: `ghlc_${c.id}_${i}`,
          assignedUserId: consultant.id,
          pipelineStage: won ? "closed_won" : "consult_booked",
          status: won ? "won" : rng() < 0.6 ? "lost" : "open",
          monetaryValue: 2000 + Math.floor(rng() * 8000),
          createdAt: created,
          updatedAt: daysAgo(Math.floor(rng() * 30), baseDate),
        });

        // won opps generate a matching Square sale (same email -> join works)
        if (won) {
          sales.push({
            id: `sale_${c.id}_${i}`,
            clinicId: c.id,
            squareOrderId: `sqo_${c.id}_${i}`,
            amount: 2000 + Math.floor(rng() * 8000),
            currency: "USD",
            occurredAt: created,
            customerEmail: email,
            itemSummary: rand(
              ["PRP Therapy", "Hair Transplant", "Consult Package"],
              rng,
            ),
          });
        }
      }
    }
  }

  for (const [i, consultant] of consultants.entries()) {
    const email = `baseline${i}@${consultant.clinicId}.example`;
    const created = daysAgo(i % 7, baseDate);
    const amount = 3500 + i * 125;
    leads.push({
      id: `lead_${consultant.clinicId}_baseline_${i}`,
      clinicId: consultant.clinicId,
      ghlContactId: `ghlc_${consultant.clinicId}_baseline_${i}`,
      email,
      source: rand(SOURCES, rng),
      assignedUserId: consultant.id,
      createdAt: created,
    });
    opportunities.push({
      id: `opp_${consultant.clinicId}_baseline_${i}`,
      clinicId: consultant.clinicId,
      ghlOpportunityId: `ghlo_${consultant.clinicId}_baseline_${i}`,
      contactId: `ghlc_${consultant.clinicId}_baseline_${i}`,
      assignedUserId: consultant.id,
      pipelineStage: "closed_won",
      status: "won",
      monetaryValue: amount,
      createdAt: created,
      updatedAt: created,
    });
    sales.push({
      id: `sale_${consultant.clinicId}_baseline_${i}`,
      clinicId: consultant.clinicId,
      squareOrderId: `sqo_${consultant.clinicId}_baseline_${i}`,
      amount,
      currency: "USD",
      occurredAt: created,
      customerEmail: email,
      itemSummary: "Consult Package",
    });
  }

  return { clinics, sales, leads, opportunities, consultants };
}
