// SIMULATED marketing spend placeholder.
// Real spend should come from Google Ads / Meta integrations once those
// sources are connected. These values exist only so the dashboard can scaffold
// ROAS without pretending spend is live.
const SIMULATED_SPEND_BY_SOURCE: Record<string, number> = {
  google_ads: 9200,
  meta_ads: 11200,
  instagram: 5200,
  referral: 1800,
  organic: 0,
  unattributed: 0,
};

/**
 * Returns a placeholder ad-spend figure (in USD) for a given marketing source.
 *
 * **These values are entirely simulated.** Real spend should be pulled from
 * Google Ads and Meta integrations once those sources are connected. The stubs
 * exist so the dashboard can display ROAS (`revenue / spend`) without implying
 * the figures are live data.
 *
 * @param source - Normalized source key matching `SourceMetric.source`
 *   (e.g. `"google_ads"`, `"meta_ads"`, `"organic"`).
 * @returns Simulated spend in USD, or `0` for any unrecognized source.
 */
export function getSimulatedSpendForSource(source: string) {
  return SIMULATED_SPEND_BY_SOURCE[source] ?? 0;
}
