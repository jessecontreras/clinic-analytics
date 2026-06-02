// ---------------------------------------------------------------------------
// Square adapter — pulls completed orders for one clinic and hydrates the
// customer email so Square sales can be joined to GoHighLevel leads.
// ---------------------------------------------------------------------------

import type { Sale } from "./types";

const SQUARE_BASE =
  process.env.SQUARE_ENV === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

const SQUARE_VERSION = "2025-04-16"; // pin Square-Version explicitly

interface SquareTokens {
  accessToken: string; // per-clinic token loaded from your token store
}

/**
 * Authenticated fetch wrapper for the Square REST API.
 * Attaches the Bearer token and pinned `Square-Version` header, then throws a
 * descriptive error on any non-2xx response so callers can catch and log cleanly.
 *
 * @param path - API path relative to the base URL, e.g. `/v2/orders/search`.
 * @param token - Per-clinic Square access token.
 * @param init - Optional `RequestInit` overrides (method, body, additional headers).
 * @returns Parsed JSON response body.
 */
async function squareFetch(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${SQUARE_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Square ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/**
 * Pulls all COMPLETED Square orders for one clinic within a date range and
 * normalizes them to {@link Sale} records.
 *
 * Pagination is handled automatically via Square's cursor mechanism. Customer
 * emails are hydrated in a second pass (one request per unique `customer_id`,
 * de-duplicated via an in-memory cache) so that the Square↔GHL email join in
 * `buildSnapshot` can fire. Orders without a linked customer remain in the result
 * with `customerEmail: undefined` and will appear as "unattributed" in the dashboard.
 *
 * @param clinicId - Internal clinic ID attached to every returned Sale.
 * @param locationId - Square location ID for this clinic's physical site.
 * @param tokens - Square access token for this clinic's merchant account.
 * @param beginISO - Window start as an ISO 8601 string (inclusive).
 * @param endISO - Window end as an ISO 8601 string (inclusive).
 * @returns Normalized {@link Sale} array with amounts in dollars (Square cents ÷ 100).
 */
export async function fetchSalesForClinic(
  clinicId: string,
  locationId: string,
  tokens: SquareTokens,
  beginISO: string,
  endISO: string,
): Promise<Sale[]> {
  const sales: Sale[] = [];
  const pendingCustomer = new Map<string, string>(); // saleId -> customerId
  let cursor: string | undefined;

  do {
    const body = {
      location_ids: [locationId],
      cursor,
      query: {
        filter: {
          date_time_filter: {
            closed_at: { start_at: beginISO, end_at: endISO },
          },
          state_filter: { states: ["COMPLETED"] },
        },
        sort: { sort_field: "CLOSED_AT", sort_order: "DESC" },
      },
    };

    const data = await squareFetch("/v2/orders/search", tokens.accessToken, {
      method: "POST",
      body: JSON.stringify(body),
    });

    for (const order of data.orders ?? []) {
      const saleId = `sq_${order.id}`;
      if (order.customer_id) pendingCustomer.set(saleId, order.customer_id);
      sales.push({
        id: saleId,
        clinicId,
        squareOrderId: order.id,
        amount: (order.total_money?.amount ?? 0) / 100, // cents -> dollars
        currency: order.total_money?.currency ?? "USD",
        occurredAt: order.closed_at ?? order.created_at,
        customerEmail: undefined, // filled in below
        itemSummary: (order.line_items ?? [])
          .map((li: { name?: string }) => li.name)
          .filter(Boolean)
          .join(", "),
      });
    }
    cursor = data.cursor;
  } while (cursor);

  // Hydrate emails for orders that had a linked customer (the join key to GHL).
  const emailCache = new Map<string, string | undefined>();
  for (const sale of sales) {
    const custId = pendingCustomer.get(sale.id);
    if (!custId) continue;
    if (!emailCache.has(custId)) {
      emailCache.set(
        custId,
        await fetchCustomerEmail(custId, tokens.accessToken),
      );
    }
    sale.customerEmail = emailCache.get(custId);
  }

  return sales;
}

/**
 * Looks up a Square customer's email address by ID.
 * Returns `undefined` on any error (deleted or anonymous customers) rather than
 * throwing, so a single missing customer never aborts an entire batch sync.
 *
 * @param customerId - Square customer ID from an order's `customer_id` field.
 * @param token - Square access token.
 * @returns The customer's email address, or `undefined` if unavailable.
 */
async function fetchCustomerEmail(
  customerId: string,
  token: string,
): Promise<string | undefined> {
  try {
    const data = await squareFetch(`/v2/customers/${customerId}`, token);
    return data.customer?.email_address;
  } catch {
    return undefined; // a missing/deleted customer shouldn't break the sync
  }
}

/**
 * Exchanges a Square OAuth authorization code for an access + refresh token pair.
 * Run once per clinic during the OAuth onboarding flow. The returned tokens should
 * be stored securely and reused for all subsequent API calls to that clinic's account.
 *
 * @param code - The `code` query parameter received from Square's OAuth redirect URI.
 * @returns Raw Square OAuth token response including `access_token` and `refresh_token`.
 */
export async function exchangeSquareCode(code: string) {
  return squareFetch("/oauth2/token", "", {
    method: "POST",
    body: JSON.stringify({
      client_id: process.env.SQUARE_APP_ID,
      client_secret: process.env.SQUARE_APP_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });
}
