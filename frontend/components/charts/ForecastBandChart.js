"use client";

import { useSyncExternalStore } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatUnits, formatWhole } from "@/lib/format";

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

function ForecastTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  if (row.kind === "actual") {
    return (
      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
        <p className="font-medium">Week of {row.label}</p>
        <p className="text-muted">Actual sales: {formatWhole(row.actual)} units</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{row.periodLabel}</p>
      <p>Expected: {formatUnits(row.p50)} units</p>
      <p className="text-muted">
        Likely range: {row.range ? `${formatUnits(row.range[0])} to ` : "up to "}
        {formatUnits(row.p90)}
      </p>
      <p className="text-muted">At least: {formatWhole(row.min)}</p>
      <p className="text-muted">
        Safe stock: {formatWhole(row.safe)} ({Math.round(row.serviceLevel * 100)}% of periods)
      </p>
      <p className="text-muted">Confidence: {row.confidence}</p>
    </div>
  );
}

// Loaded without server rendering (spec §7.11); screens use it through ProductForecast.
export default function ForecastBandChart({ rows, granularity }) {
  const reducedMotion = usePrefersReducedMotion();
  const animate = !reducedMotion;
  const firstForecast = rows.find((r) => r.kind === "forecast");
  const tick = { fill: "var(--muted)", fontSize: 12 };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" minTickGap={16} />
        <YAxis tick={tick} tickLine={false} axisLine={false} width={44} />
        <Tooltip content={<ForecastTooltip />} />

        {granularity === "week" && (
          <Area
            dataKey="range"
            name="Likely range"
            stroke="none"
            fill="var(--chart-band)"
            fillOpacity={0.22}
            isAnimationActive={animate}
          />
        )}
        {granularity === "month" && (
          <Line
            dataKey="p90"
            name="High estimate"
            stroke="var(--chart-band)"
            strokeWidth={2}
            strokeDasharray="2 4"
            dot={false}
            isAnimationActive={animate}
          />
        )}
        <Line
          dataKey="safe"
          name="Safe stock"
          type="stepAfter"
          stroke="var(--chart-4)"
          strokeWidth={2}
          strokeDasharray="1 4"
          dot={false}
          isAnimationActive={animate}
        />
        <Line
          dataKey="actual"
          name="Actual sales"
          stroke="var(--chart-history)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={animate}
        />
        <Line
          dataKey="p50"
          name="Expected"
          stroke="var(--chart-line)"
          strokeWidth={2.5}
          strokeDasharray="7 4"
          dot={{ r: 2.5 }}
          isAnimationActive={animate}
        />
        {granularity === "week" && firstForecast && rows.some((r) => r.kind === "actual") && (
          <ReferenceLine
            x={firstForecast.label}
            stroke="var(--muted)"
            strokeDasharray="4 4"
            label={{ value: "Forecast starts", position: "insideTopLeft", fill: "var(--muted)", fontSize: 11 }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
