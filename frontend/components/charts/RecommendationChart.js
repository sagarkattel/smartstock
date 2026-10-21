"use client";

import { useSyncExternalStore } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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

function shorten(name) {
  return name.length > 23 ? `${name.slice(0, 22)}…` : name;
}

// One-line axis label (Recharts would otherwise wrap long product names).
function NameTick({ x, y, payload }) {
  return (
    <text x={x - 4} y={y} dy={4} textAnchor="end" fill="var(--muted)" fontSize={12}>
      {payload.value}
    </text>
  );
}

function RecommendationTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="space-y-0.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{row.name}</p>
      {row.lines.map((line) => (
        <p key={line} className="text-muted">
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * Horizontal bars for one recommendation list (spec §7.11). `kind` "chance" plots the chance of a
 * regular sale (0–100%); "lift" plots lift vs the fleet with a reference line at 1.
 */
export default function RecommendationChart({ rows, kind }) {
  const animate = !usePrefersReducedMotion();
  const tick = { fill: "var(--muted)", fontSize: 12 };
  const data = rows.map((row) => ({ ...row, short: shorten(row.name) }));

  // Clean axis steps: 25% for chances, 0.5× for lift (always reaching past the fleet-average line at 1×).
  const largest = Math.max(...rows.map((row) => row.value));
  const top = kind === "chance" ? 100 : Math.max(1.5, Math.ceil(largest * 2) / 2);
  const ticks = kind === "chance" ? [0, 25, 50, 75, 100] : Array.from({ length: top * 2 + 1 }, (_, i) => i / 2);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 52, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          domain={[0, top]}
          ticks={ticks}
          tickFormatter={(v) => (kind === "chance" ? `${v}%` : `${v}×`)}
        />
        <YAxis type="category" dataKey="short" width={188} tick={<NameTick />} tickLine={false} axisLine={false} interval={0} />
        <Tooltip content={<RecommendationTooltip />} cursor={{ fill: "var(--background)" }} />
        <Bar dataKey="value" fill={kind === "chance" ? "var(--chart-1)" : "var(--chart-2)"} radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={animate}>
          <LabelList dataKey="label" position="right" fill="var(--foreground)" fontSize={12} />
        </Bar>
        {kind === "lift" && (
          <ReferenceLine
            x={1}
            stroke="var(--muted)"
            strokeDasharray="4 4"
            label={{ value: "Fleet average", position: "insideTopRight", fill: "var(--muted)", fontSize: 11 }}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
