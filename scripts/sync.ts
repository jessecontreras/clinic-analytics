// ---------------------------------------------------------------------------
// scripts/sync.ts  —  run on a cron (e.g. every 15 min) in production.
//
// This is the REAL data path. Dashboard requests should never trigger live API
// calls to 40+ clinics; they read pre-computed rollups. This script does the
// fan-out, normalizes, and upserts. Run with: npm run sync
//
// Wire it to: Vercel Cron / a worker / GitHub Actions schedule.
// ---------------------------------------------------------------------------

import { buildSnapshot } from "../lib/normalize";
import { generateMock } from "../lib/mock";
// import { fetchSalesForClinic } from "../lib/square";
// import { fetchLeadsForClinic, fetchOpportunitiesForClinic, fetchConsultantsForClinic } from "../lib/gohighlevel";

async function main() {
  // const clinics = await db.clinics.findAll();  // each row stores encrypted per-clinic tokens
  // const begin = lastSyncCursor(); const end = new Date().toISOString();
  //
  // Fan out across clinics with bounded concurrency so you don't blow rate limits.
  // Square rate limits per app; GHL per location. A simple p-limit(5) is plenty.
  //
  // const results = await Promise.allSettled(clinics.map(async (c) => ({
  //   sales: await fetchSalesForClinic(c.id, c.squareLocationId, { accessToken: c.squareToken }, begin, end),
  //   leads: await fetchLeadsForClinic(c.id, c.ghlLocationId, c.ghlToken),
  //   opportunities: await fetchOpportunitiesForClinic(c.id, c.ghlLocationId, c.ghlToken),
  //   consultants: await fetchConsultantsForClinic(c.id, c.ghlLocationId, c.ghlToken),
  // })));
  //
  // Persist raw rows (idempotent upsert on source id), then:
  // await db.snapshots.upsert(buildSnapshot(aggregate(results)));

  // For the demo, just prove the pipeline shape end to end:
  const snapshot = buildSnapshot(generateMock());
  console.log(JSON.stringify(snapshot, null, 2).slice(0, 800));
  console.log(`\n✓ Synced ${snapshot.byClinic.length} clinics — $${snapshot.totalRevenue} network revenue`);
}

main();
