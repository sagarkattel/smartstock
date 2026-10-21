"use client";

import { useSyncExternalStore } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompactMoney, formatCompactNumber, formatMoney, formatPercent, formatWhole } from "@/lib/format";

function subscribeReducedMotion(callback) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

function OverviewTooltip({ active, payload, money }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const show = (v) => (money ? formatMoney(v) : `${formatWhole(v)} units`);
  const has = (v) => v !== null && v !== undefined;
  const hasAny = has(row.actual) || has(row.forecast) || has(row.earlier) || has(row.missed) || has(row.lastYear);
  const base = has(row.actual) ? row.actual : has(row.forecast) ? row.forecast : has(row.missed) ? row.missed : null;

  return (
    <div className="space-y-0.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-xl">
      <p className="font-medium">{row.title}</p>
      {row.actual !== null && row.actual !== undefined && <p>Real sales: {show(row.actual)}</p>}
      {row.earlier !== null && row.earlier !== undefined && (
        <p className="text-muted">
          Earlier forecast: {show(row.earlier)}
          {row.actual > 0 && ` (${row.earlier >= row.actual ? "+" : "−"}${formatPercent(Math.abs(row.earlier - row.actual) / row.actual)} vs real)`}
        </p>
      )}
      {has(row.missed) && <p>Expected: {show(row.missed)}</p>}
      {has(row.missed) && !row.note && <p className="text-muted">No real sales for this week have been uploaded yet</p>}
      {row.note && <p className="max-w-64 text-muted">{row.note}</p>}
      {row.forecast !== null && row.forecast !== undefined && <p>Expected: {show(row.forecast)}</p>}
      {row.forecast !== null && row.forecast !== undefined && <p className="text-muted">{row.selected ? "In the selected period" : "Later in the forecast"}</p>}
      {row.confidence && <p className="text-muted">Confidence: {row.confidence}</p>}
      {has(row.lastYear) && (
        <p className="text-muted">
          Same time last year: {show(row.lastYear)}
          {has(base) && row.lastYear > 0 && ` (${base >= row.lastYear ? "+" : "−"}${formatPercent(Math.abs(base - row.lastYear) / row.lastYear)} now)`}
        </p>
      )}
      {!hasAny && <p className="text-muted">No data for this period</p>}
    </div>
  );
}

/**
 * Real sales (green bars, past weeks) and expected sales (blue bars, future weeks, the selected
 * period brighter), with the earlier forecast as an amber line where it can be compared with what
 * really sold (spec §7.11 "Totals trend chart" / "Monitoring chart").
 */
export default function OverviewChart({ rows, money }) {
  const animate = !usePrefersReducedMotion();
  const labelByKey = new Map(rows.map((r) => [r.key, r.label]));
  const tick = { fill: "var(--muted)", fontSize: 12 };
  const hasEarlier = rows.some((r) => r.earlier !== null && r.earlier !== undefined);
  const hasLastYear = rows.some((r) => r.lastYear !== null && r.lastYear !== undefined);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="overview-forecast" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-2)" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.55} />
          </linearGradient>
          <pattern id="overview-missed" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
            <rect width="7" height="7" fill="var(--chart-2)" fillOpacity="0.14" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--chart-2)" strokeWidth="3" strokeOpacity="0.55" />
          </pattern>
          <linearGradient id="overview-actual" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-3)" />
            <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.45} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" vertical={false} />
        <XAxis dataKey="key" tickFormatter={(k) => labelByKey.get(k) ?? k} tick={tick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
        <YAxis
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v) => (money ? formatCompactMoney(v) : formatCompactNumber(v))}
        />
        <Tooltip content={<OverviewTooltip money={money} />} cursor={{ fill: "rgba(143,176,255,0.06)" }} />
        <Bar dataKey="actual" stackId="week" fill="url(#overview-actual)" radius={[6, 6, 0, 0]} maxBarSize={34} isAnimationActive={animate} />
        <Bar dataKey="missed" stackId="week" fill="url(#overview-missed)" stroke="var(--chart-2)" strokeDasharray="4 3" radius={[6, 6, 0, 0]} maxBarSize={34} isAnimationActive={animate} />
        <Bar dataKey="forecast" stackId="week" fill="url(#overview-forecast)" radius={[6, 6, 0, 0]} maxBarSize={34} isAnimationActive={animate}>
          {rows.map((row) => (
            <Cell key={row.key} fillOpacity={row.selected ? 1 : 0.3} />
          ))}
        </Bar>
        {hasLastYear && (
          <Line
            dataKey="lastYear"
            type="monotone"
            stroke="var(--chart-4)"
            strokeWidth={2.5}
            strokeDasharray="7 4"
            dot={{ r: 3.5, fill: "var(--chart-4)", stroke: "var(--surface)", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={animate}
          />
        )}
        {hasEarlier && (
          <Line
            dataKey="earlier"
            type="monotone"
            stroke="var(--chart-5)"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "var(--chart-5)", stroke: "var(--surface)", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={animate}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
