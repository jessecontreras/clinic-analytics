"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import type { NetworkSnapshot } from "@/lib/types";

const money = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
const pct = (n: number) => `${Math.round(n * 100)}%`;
const ratio = (n: number) => (n > 0 ? `${n.toFixed(1)}x` : "n/a");
const deltaText = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "new";
  if (n === 0) return "0%";
  const sign = n > 0 ? "▲" : "▼";
  return `${sign} ${Math.abs(Math.round(n * 100))}%`;
};

const tooltipStyle = {
  background: "#ffffff",
  border: "1px solid #e6e4f2",
  borderRadius: 10,
  color: "#16131f",
  boxShadow: "0 4px 16px rgba(20,16,40,0.10)",
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const fmtDay = (d: string) => {
  const [, m, day] = d.split("-");
  return `${MONTHS[+m - 1]} ${+day}`;
};
const DAY_OPTIONS = [7, 30, 90] as const;
const CONSULTANT_PAGE_SIZE = 6;

export default function Dashboard() {
  const [data, setData] = useState<NetworkSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredSourceIndex, setHoveredSourceIndex] = useState<number | null>(null);
  const sourceResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [consultantPage, setConsultantPage] = useState(0);
  const [consultantMode, setConsultantMode] = useState<
    "consultant" | "consultantClinic"
  >("consultantClinic");
  const [days, setDays] = useState<(typeof DAY_OPTIONS)[number]>(() => {
    if (typeof window === "undefined") return 30;
    const value = Number(new URLSearchParams(window.location.search).get("days"));
    return DAY_OPTIONS.includes(value as (typeof DAY_OPTIONS)[number])
      ? (value as (typeof DAY_OPTIONS)[number])
      : 30;
  });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    fetch(`/api/metrics?days=${days}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Metrics request failed: ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((err) => {
        if ((err as Error).name !== "AbortError") console.error(err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [days]);

  const setRange = (nextDays: (typeof DAY_OPTIONS)[number]) => {
    if (nextDays === days) return;
    setConsultantPage(0);
    setDays(nextDays);
    const params = new URLSearchParams(window.location.search);
    params.set("days", String(nextDays));
    window.history.replaceState(null, "", `?${params.toString()}`);
  };

  const consultantRows = useMemo(() => {
    const rows = data?.byConsultant ?? [];
    if (consultantMode === "consultantClinic") return rows;

    const byName = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const current = byName.get(row.consultantName) ?? {
        consultantId: row.consultantName,
        consultantName: row.consultantName,
        clinicName: "Network",
        won: 0,
        lost: 0,
        closeRate: 0,
        revenueInfluenced: 0,
      };
      current.won += row.won;
      current.lost += row.lost;
      current.revenueInfluenced += row.revenueInfluenced;
      byName.set(row.consultantName, current);
    }

    return [...byName.values()]
      .map((row) => ({
        ...row,
        closeRate:
          row.won + row.lost
            ? Math.round((row.won / (row.won + row.lost)) * 100) / 100
            : 0,
        revenueInfluenced: Math.round(row.revenueInfluenced * 100) / 100,
      }))
      .sort((a, b) => b.revenueInfluenced - a.revenueInfluenced);
  }, [consultantMode, data?.byConsultant]);
  const consultantPageCount = Math.max(
    1,
    Math.ceil(consultantRows.length / CONSULTANT_PAGE_SIZE),
  );
  useEffect(() => {
    if (consultantPage >= consultantPageCount) {
      setConsultantPage(consultantPageCount - 1);
    }
  }, [consultantPage, consultantPageCount]);
  const visibleConsultants = consultantRows.slice(
    consultantPage * CONSULTANT_PAGE_SIZE,
    consultantPage * CONSULTANT_PAGE_SIZE + CONSULTANT_PAGE_SIZE,
  );
  const changeConsultantMode = (
    mode: "consultant" | "consultantClinic",
  ) => {
    setConsultantPage(0);
    setConsultantMode(mode);
  };

  if (!data)
    return (
      <div className="wrap">
        <div className="page-loading">Loading network…</div>
      </div>
    );

  const liveCount = data.byClinic.filter((c) => c.dataSource === "live").length;
  const simCount = data.byClinic.length - liveCount;
  const updatedAt = new Date(data.generatedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="wrap">
      <div className="masthead">
        <div className="brand-title">
          <div className="brand-mark">AE</div>
          <div>
            <div className="wordmark">
              <span>Aesthetic</span>
              <span>Enterprises</span>
            </div>
          </div>
        </div>
        <div className="masthead-actions">
          <div
            className={`segment${loading ? " is-loading" : ""}`}
            aria-label="Date range"
            aria-busy={loading}
          >
            {DAY_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={days === option ? "active" : ""}
                onClick={() => setRange(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <span className="tag">
            {liveCount} live · {simCount} sim
          </span>
        </div>
      </div>
      <p className="sub">
        Royalty, revenue, lead flow, and consultant performance across the AE
        license network · updated {updatedAt}
      </p>

      {data.debug && (
        <div className="debug">
          <Chip
            label={`${data.debug.counts.sales} live sales`}
            tip="Real Square orders pulled for the one connected clinic (Scottsdale). The other four clinics are simulated."
          />
          <Chip
            label={`${data.debug.counts.salesWithEmail} sales w/ email`}
            tone={data.debug.counts.salesWithEmail === 0 ? "warn" : "default"}
            tip={`${data.debug.counts.salesWithEmail} of ${data.debug.counts.sales} orders carry a customer email — the only key that joins Square revenue to a GoHighLevel lead, source, and consultant. Orders without one show as "unattributed."`}
          />
          <Chip
            label={`${data.debug.counts.leads} live leads`}
            tip="Contacts pulled live from GoHighLevel for Scottsdale."
          />
          <Chip
            label={`${data.debug.counts.opportunities} live opps`}
            tip="Pipeline opportunities (won / lost / open) from GoHighLevel — these drive the close-rate-by-consultant table."
          />
          <Chip
            label={`${data.debug.counts.consultants} live consultants`}
            tip="GoHighLevel users mapped to the live clinic's deals — the names shown in the consultant table."
          />
          {Object.entries(data.debug.errors).map(([k, v]) => (
            <Chip
              key={k}
              label={`${k} failed`}
              tone="warn"
              tip={`The ${k.replace(/_/g, " ")} call failed: ${v} The rest of the data still loaded — the pipeline isolates failures. Reload to retry.`}
            />
          ))}
        </div>
      )}

      <div className="kpis">
        <Kpi
          label="Network Revenue"
          value={money(data.totalRevenue)}
          delta={data.kpiDeltas?.totalRevenue}
          accent
        />
        <Kpi
          label="Network Royalties"
          value={money(data.totalRoyalties)}
          delta={data.kpiDeltas?.totalRoyalties}
        />
        <Kpi
          label="Total Leads"
          value={data.totalLeads.toLocaleString()}
          delta={data.kpiDeltas?.totalLeads}
        />
        <Kpi
          label="Network Close Rate"
          value={pct(data.networkCloseRate)}
          delta={data.kpiDeltas?.networkCloseRate}
        />
        <Kpi
          label="Active Clinics"
          value={String(data.byClinic.length)}
        />
      </div>

      <div className="card full" style={{ marginBottom: 16 }}>
        <h2>Revenue over time</h2>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data.revenueByDay}>
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5b3df5" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#5b3df5" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#e6e4f2" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="#9a98ac"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: "#e6e4f2" }}
              tickMargin={10}
              minTickGap={40}
              interval="preserveStartEnd"
              tickFormatter={fmtDay}
            />
            <YAxis
              stroke="#9a98ac"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={46}
              tickCount={5}
              tickFormatter={(v) => (v === 0 ? "$0" : `$${v / 1000}k`)}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(label) => fmtDay(String(label ?? ""))}
              formatter={(value) => [money(Number(value ?? 0)), "Revenue"]}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#5b3df5"
              strokeWidth={2}
              fill="url(#g)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid">
        <div className="card clinic-card">
          <h2>Revenue by clinic</h2>
          <table>
            <thead>
              <tr>
                <th>Clinic</th>
                <th>Revenue</th>
                <th>Royalties</th>
                <th>Leads</th>
                <th>Close</th>
              </tr>
            </thead>
            <tbody>
              {data.byClinic.map((c) => (
                <tr key={c.clinicId}>
                  <td>
                    <span className="clinic-cell">
                      {c.clinicName}
                      <span
                        className={`pill ${c.dataSource === "live" ? "live" : "sim"}`}
                      >
                        {c.dataSource === "live" ? "live" : "sim"}
                      </span>
                    </span>
                  </td>
                  <td className="num">{money(c.revenue)}</td>
                  <td className="num">{money(c.royalty)}</td>
                  <td className="num">{c.leadCount}</td>
                  <td className="num rate">{pct(c.closeRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Revenue by source</h2>
            <span className="note">spend: simulated</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={data.bySource}
              layout="vertical"
              margin={{ left: 20 }}
            >
              <XAxis
                type="number"
                stroke="#716f86"
                fontSize={11}
                tickFormatter={(v) => `$${v / 1000}k`}
              />
              <YAxis
                type="category"
                dataKey="source"
                stroke="#716f86"
                fontSize={11}
                width={90}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => money(Number(value ?? 0))}
              />
              <Bar
                dataKey="revenue"
                radius={[0, 4, 4, 0]}
                onMouseEnter={(_: unknown, index: number) => {
                  if (sourceResetTimer.current) clearTimeout(sourceResetTimer.current);
                  setHoveredSourceIndex(index);
                }}
                onMouseLeave={() => {
                  sourceResetTimer.current = setTimeout(() => setHoveredSourceIndex(null), 400);
                }}
              >
                {data.bySource.map((_, i) => (
                  <Cell
                    key={i}
                    fill={i === (hoveredSourceIndex ?? 0) ? "#5b3df5" : "#b9aef9"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <table className="source-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Spend</th>
                <th>ROAS</th>
              </tr>
            </thead>
            <tbody>
              {data.bySource.map((s) => (
                <tr key={s.source}>
                  <td>{s.source}</td>
                  <td className="num">{money(s.spend)}</td>
                  <td className="num rate">{ratio(s.roas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card full consultant-card">
          <div className="card-head">
            <h2>Close rate by consultant</h2>
            <div className="toggle" aria-label="Consultant rollup">
              <button
                type="button"
                className={consultantMode === "consultant" ? "active" : ""}
                onClick={() => changeConsultantMode("consultant")}
              >
                By consultant
              </button>
              <button
                type="button"
                className={
                  consultantMode === "consultantClinic" ? "active" : ""
                }
                onClick={() => changeConsultantMode("consultantClinic")}
              >
                By consultant × clinic
              </button>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Consultant</th>
                <th>Clinic</th>
                <th>Won</th>
                <th>Lost</th>
                <th>Close rate</th>
                <th>Revenue influenced</th>
              </tr>
            </thead>
            <tbody>
              {visibleConsultants.map((c) => (
                <tr key={`${c.consultantId}_${c.clinicName}`}>
                  <td>{c.consultantName}</td>
                  <td style={{ color: "var(--muted)" }}>{c.clinicName}</td>
                  <td className="num">{c.won}</td>
                  <td className="num">{c.lost}</td>
                  <td className="num rate">{pct(c.closeRate)}</td>
                  <td className="num">{money(c.revenueInfluenced)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="table-pager">
            <span>
              Page {consultantPage + 1} of {consultantPageCount}
            </span>
            <div>
              <button
                type="button"
                onClick={() => setConsultantPage((page) => Math.max(0, page - 1))}
                disabled={consultantPage === 0}
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() =>
                  setConsultantPage((page) =>
                    Math.min(consultantPageCount - 1, page + 1),
                  )
                }
                disabled={consultantPage >= consultantPageCount - 1}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Displays a single top-level KPI tile with a label, formatted value, and an
 * optional period-over-period delta badge.
 *
 * @param label - Short metric name rendered above the value (e.g. "Network Revenue").
 * @param value - Pre-formatted display string (e.g. `"$142,000"` or `"38%"`).
 * @param delta - Fractional change vs. the prior period (0.12 = +12%, −0.05 = −5%).
 *   `null` renders as "new" (no prior baseline); `undefined` omits the delta row entirely.
 * @param accent - When `true`, renders the value in the brand indigo color.
 */
function Kpi({
  label,
  value,
  delta,
  accent,
}: {
  label: string;
  value: string;
  delta?: number | null;
  accent?: boolean;
}) {
  const deltaClass =
    delta === null || delta === undefined || delta === 0
      ? "flat"
      : delta > 0
        ? "up"
        : "down";
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className={`value${accent ? " accent" : ""}`}>{value}</div>
      {delta !== undefined && (
        <div className={`delta ${deltaClass}`}>{deltaText(delta)}</div>
      )}
    </div>
  );
}

/**
 * A small pill badge used in the live-mode debug bar. Reveals a tooltip on
 * hover or keyboard focus with additional context about the data it represents.
 *
 * @param label - Short text shown inside the pill (e.g. "42 live sales").
 * @param tip - Full explanatory text shown in the tooltip on hover/focus.
 * @param tone - Visual style: `"default"` (indigo) for informational chips,
 *   `"warn"` (orange) for error or attention states.
 */
function Chip({
  label,
  tip,
  tone = "default",
}: {
  label: string;
  tip: string;
  tone?: "default" | "warn";
}) {
  return (
    <span className={`chip${tone === "warn" ? " warn" : ""}`} tabIndex={0}>
      {label}
      <span className="chip-tip" role="tooltip">
        {tip}
      </span>
    </span>
  );
}
