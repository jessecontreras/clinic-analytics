// ---------------------------------------------------------------------------
// Unified data model
//
// The whole point of this layer is that NEITHER Square's shapes NOR GHL's
// shapes leak into the dashboard. Every source gets normalized into these
// types. When you add a 3rd source (e.g. a marketing platform), you write one
// more adapter that emits these same types — nothing downstream changes.
// ---------------------------------------------------------------------------

/** One licensed clinic. In this network each clinic is its own Square seller
 *  account AND its own GHL sub-account (location), so we store both refs. */
export interface Clinic {
  id: string; // our internal id
  name: string;
  region?: string;
  squareAccountId: string; // the Square merchant this clinic's OAuth token belongs to
  squareLocationId: string; // a seller can have >1 physical location
  ghlLocationId: string; // GHL sub-account id
}

/** A completed sale, sourced from Square Orders/Payments. */
export interface Sale {
  id: string;
  clinicId: string;
  squareOrderId: string;
  amount: number; // in major units (dollars), already divided by 100
  currency: string;
  occurredAt: string; // ISO 8601
  customerEmail?: string; // used to join back to a GHL lead/consultant
  customerPhone?: string;
  itemSummary?: string;
}

/** A lead, sourced from GHL Contacts. */
export interface Lead {
  id: string;
  clinicId: string;
  ghlContactId: string;
  email?: string;
  phone?: string;
  source?: string; // GHL attributionSource — how marketing spend maps to revenue
  assignedUserId?: string; // sales consultant
  createdAt: string;
}

/** A pipeline opportunity, sourced from GHL Opportunities. This is where
 *  close rates live (status won/lost + assigned consultant). */
export interface Opportunity {
  id: string;
  clinicId: string;
  ghlOpportunityId: string;
  contactId: string;
  assignedUserId?: string;
  pipelineStage: string;
  status: "open" | "won" | "lost" | "abandoned";
  monetaryValue: number;
  createdAt: string;
  updatedAt: string;
}

export interface Consultant {
  id: string; // matches Opportunity.assignedUserId
  clinicId: string;
  name: string;
}

// --- Rollups the dashboard actually reads -----------------------------------

export interface ClinicMetric {
  clinicId: string;
  clinicName: string;
  revenue: number;
  royalty: number;
  leadCount: number;
  wonCount: number;
  lostCount: number;
  closeRate: number; // wonCount / (wonCount + lostCount)
  dataSource?: "live" | "mock";
}

export interface ConsultantMetric {
  consultantId: string;
  consultantName: string;
  clinicName: string;
  won: number;
  lost: number;
  closeRate: number;
  revenueInfluenced: number;
}

export interface SourceMetric {
  source: string;
  leads: number;
  revenue: number; // revenue attributed to leads from this source
  spend: number; // SIMULATED until ad-platform integrations are connected
  roas: number; // revenue / spend
}

export interface NetworkSnapshot {
  generatedAt: string;
  totalRevenue: number;
  totalRoyalties: number;
  totalLeads: number;
  networkCloseRate: number;
  kpiDeltas?: KpiDeltas;
  byClinic: ClinicMetric[];
  byConsultant: ConsultantMetric[];
  bySource: SourceMetric[];
  revenueByDay: { date: string; revenue: number }[];
  debug?: MetricsDebug;
}

export interface KpiDeltas {
  totalRevenue: number | null;
  totalRoyalties: number | null;
  totalLeads: number | null;
  networkCloseRate: number | null;
  activeClinics: number | null;
}

/** Live-fetch diagnostics (only set in LIVE mode from /api/metrics). */
export interface MetricsDebug {
  live: boolean;
  counts: {
    sales: number;
    leads: number;
    opportunities: number;
    consultants: number;
    salesWithEmail: number;
  };
  errors: Record<string, string>;
}
