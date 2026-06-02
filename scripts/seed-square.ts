// scripts/seed-square.ts
// Bulk-seed the Square SANDBOX with customers + orders + COMPLETED payments.
//
//   npm run seed:square          (or: npx tsx scripts/seed-square.ts)
//
// Reads SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID from .env.local.
// Runs sequentially and awaits each call so IDs are resolved before they're used.
//
// NOTE: Square assigns created_at/closed_at server-side — there is no way to
// backdate. Every order created here timestamps at "now". See README/DEMO_SETUP
// for how the date spread is handled (mock clinics carry the history).

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// --- minimal .env.local loader (avoids adding a dotenv dependency) ----------
(function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no .env.local — rely on real env */
  }
})();

const TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const BASE = "https://connect.squareupsandbox.com";
const VERSION = "2025-04-16";

if (!TOKEN || !LOCATION_ID) {
  console.error("Missing SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID in .env.local");
  process.exit(1);
}

async function sq(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Square-Version": VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

// --- what to seed -----------------------------------------------------------
const ORDER_COUNT = 24;

const ITEMS = [
  { name: "PRP Therapy", min: 600, max: 950 },
  { name: "Hair Restoration Package", min: 2800, max: 6500 },
  { name: "Consult + Treatment", min: 350, max: 800 },
  { name: "Follow-up Session", min: 200, max: 450 },
];

// Emails that will ALSO exist as GHL contacts, so the cross-system join fires.
// ~1/3 of orders get one of these; the rest are anonymous walk-ins.
const JOIN_EMAILS = ["patient1@demo.test", "patient2@demo.test", "patient3@demo.test"];

const cents = (min: number, max: number) =>
  Math.round((min + Math.random() * (max - min)) * 100);
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

async function ensureCustomer(email: string): Promise<string> {
  const { customer } = await sq("/v2/customers", {
    idempotency_key: randomUUID(),
    given_name: email.split("@")[0],
    family_name: "Demo",
    email_address: email,
  });
  return customer.id;
}

async function seed() {
  console.log(`Seeding ${ORDER_COUNT} orders into location ${LOCATION_ID}\n`);

  // create the join customers once and reuse their ids
  const customerIds = new Map<string, string>();
  for (const email of JOIN_EMAILS) {
    const id = await ensureCustomer(email);
    customerIds.set(email, id);
    console.log(`  customer ${email} -> ${id}`);
  }
  console.log("");

  let total = 0;
  for (let i = 0; i < ORDER_COUNT; i++) {
    const item = pick(ITEMS);
    const amount = cents(item.min, item.max);
    const email = Math.random() < 0.33 ? pick(JOIN_EMAILS) : undefined;
    const customerId = email ? customerIds.get(email) : undefined;

    const { order } = await sq("/v2/orders", {
      idempotency_key: randomUUID(),
      order: {
        location_id: LOCATION_ID,
        ...(customerId ? { customer_id: customerId } : {}),
        line_items: [
          { name: item.name, quantity: "1", base_price_money: { amount, currency: "USD" } },
        ],
      },
    });

    await sq("/v2/payments", {
      idempotency_key: randomUUID(),
      source_id: "cnon:card-nonce-ok", // sandbox test nonce (always succeeds)
      amount_money: { amount, currency: "USD" },
      order_id: order.id,
      location_id: LOCATION_ID,
      ...(customerId ? { customer_id: customerId } : {}),
    });

    total += amount;
    console.log(
      `  #${String(i + 1).padStart(2)} ${item.name.padEnd(26)} $${(amount / 100)
        .toFixed(2)
        .padStart(8)}${email ? `  ${email}` : ""}`
    );

    await new Promise((r) => setTimeout(r, 120)); // gentle on rate limits
  }

  console.log(`\n✓ Done — ${ORDER_COUNT} COMPLETED orders, $${(total / 100).toFixed(2)} total.`);
}

seed().catch((e) => {
  console.error("\nSeed failed:", e);
  process.exit(1);
});
