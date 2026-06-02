// ---------------------------------------------------------------------------
// GoHighLevel (LeadConnector) adapter — API v2
//
// GHL also uses OAuth 2.0 via a Marketplace app. You install the app on the
// agency, which grants access to each sub-account (location). You call the API
// once PER LOCATION with that location's access token, scoped by locationId.
//
// Base URL: https://services.leadconnectorhq.com
// Required headers: Authorization: Bearer <token>, Version: 2021-07-28
//
// Endpoints used:
//   POST /oauth/token                                  -> exchange/refresh tokens
//   GET  /contacts/?locationId=                        -> leads  (source = attributionSource)
//   POST /opportunities/search                         -> pipeline (close rates live here)
//   GET  /opportunities/pipelines?locationId=          -> stage definitions
//   GET  /users/?locationId=                           -> sales consultants
//
// "Close rate by consultant" = opportunities grouped by assignedTo, where
// status is 'won' vs 'lost'. "Marketing spend efficiency by source" starts
// from contact.attributionSource, then joins to revenue (see normalize.ts).
// ---------------------------------------------------------------------------

import type { Lead, Opportunity, Consultant } from "./types";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

/**
 * Authenticated fetch wrapper for the GoHighLevel (LeadConnector) v2 API.
 * Attaches the Bearer token and required `Version` header. Retries up to three
 * times on transient failures with linear back-off (400 ms then 800 ms) before
 * re-throwing, so callers don't need their own retry logic.
 *
 * @param path - API path relative to the GHL base URL, e.g. `/contacts/?locationId=...`.
 * @param token - GHL Private Integration Token (read-only; do not add write scopes).
 * @param init - Optional `RequestInit` overrides (method, body, additional headers).
 * @param attempt - Internal retry counter; always omit when calling externally.
 * @returns Parsed JSON response body.
 */
async function ghlFetch(
  path: string,
  token: string,
  init?: RequestInit,
  attempt = 1,
): Promise<unknown> {
  try {
    const res = await fetch(`${GHL_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok)
      throw new Error(`GHL ${path} -> ${res.status}: ${await res.text()}`);
    return res.json();
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 400 * attempt)); // 400ms, then 800ms
      return ghlFetch(path, token, init, attempt + 1);
    }
    throw err;
  }
}

/**
 * Fetches the first 100 contacts for a GHL location and normalizes them to
 * {@link Lead} records.
 *
 * `attributionSource.sessionSource` becomes `Lead.source`, which `buildSnapshot`
 * uses to group revenue by marketing channel. No date filter is applied at the API
 * level — the route filters by `createdAt` after the fact so the same response can
 * serve both the current and prior comparison windows without a second network call.
 *
 * @param clinicId - Internal clinic ID attached to every returned Lead.
 * @param locationId - GHL sub-account ID. This endpoint uses `?locationId=` (camelCase).
 * @param token - GHL access token scoped to this location.
 * @returns Normalized {@link Lead} array.
 */
export async function fetchLeadsForClinic(
  clinicId: string,
  locationId: string,
  token: string,
): Promise<Lead[]> {
  const data = await ghlFetch(
    `/contacts/?locationId=${locationId}&limit=100`,
    token,
  ) as { contacts?: Array<{ id: string; email?: string; phone?: string; attributionSource?: { sessionSource?: string }; assignedTo?: string; dateAdded?: string }> };
  return (data.contacts ?? []).map(
    (c: {
      id: string;
      email?: string;
      phone?: string;
      attributionSource?: { sessionSource?: string };
      assignedTo?: string;
      dateAdded?: string;
    }) => ({
      id: `ghl_${c.id}`,
      clinicId,
      ghlContactId: c.id,
      email: c.email,
      phone: c.phone,
      source: c.attributionSource?.sessionSource ?? "unknown",
      assignedUserId: c.assignedTo,
      createdAt: c.dateAdded ?? new Date().toISOString(),
    }),
  );
}

/**
 * Fetches pipeline opportunities for a GHL location and normalizes them to
 * {@link Opportunity} records.
 *
 * Opportunities are the source of truth for close rates and consultant revenue
 * attribution. `assignedTo` (mapped to `assignedUserId`) is more reliably populated
 * than the contact's owner field, which is often unset. Note: this endpoint requires
 * `?location_id=` in snake_case — unlike contacts and users which use camelCase.
 *
 * @param clinicId - Internal clinic ID attached to every returned Opportunity.
 * @param locationId - GHL sub-account ID. This endpoint uses `?location_id=` (snake_case).
 * @param token - GHL access token scoped to this location.
 * @returns Normalized {@link Opportunity} array.
 */
export async function fetchOpportunitiesForClinic(
  clinicId: string,
  locationId: string,
  token: string,
): Promise<Opportunity[]> {
  const data = await ghlFetch(
    `/opportunities/search?location_id=${locationId}&limit=100`,
    token,
  ) as { opportunities?: Array<{ id: string; contactId: string; assignedTo?: string; pipelineStageId: string; status: string; monetaryValue?: number; createdAt: string; updatedAt: string }> };
  return (data.opportunities ?? []).map(
    (o: {
      id: string;
      contactId: string;
      assignedTo?: string;
      pipelineStageId: string;
      status: string;
      monetaryValue?: number;
      createdAt: string;
      updatedAt: string;
    }) => ({
      id: `ghlopp_${o.id}`,
      clinicId,
      ghlOpportunityId: o.id,
      contactId: o.contactId,
      assignedUserId: o.assignedTo,
      pipelineStage: o.pipelineStageId,
      status: (o.status as Opportunity["status"]) ?? "open",
      monetaryValue: o.monetaryValue ?? 0,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }),
  );
}

/**
 * Fetches GHL users (sales consultants) for a location and normalizes them to
 * {@link Consultant} records. User IDs are matched against `Opportunity.assignedUserId`
 * in `buildSnapshot` to resolve display names in the consultant performance table.
 *
 * @param clinicId - Internal clinic ID attached to every returned Consultant.
 * @param locationId - GHL sub-account ID. This endpoint uses `?locationId=` (camelCase).
 * @param token - GHL access token scoped to this location.
 * @returns Normalized {@link Consultant} array.
 */
export async function fetchConsultantsForClinic(
  clinicId: string,
  locationId: string,
  token: string,
): Promise<Consultant[]> {
  const data = await ghlFetch(`/users/?locationId=${locationId}`, token) as { users?: Array<{ id: string; name: string }> };
  return (data.users ?? []).map((u) => ({
    id: u.id,
    clinicId,
    name: u.name,
  }));
}
