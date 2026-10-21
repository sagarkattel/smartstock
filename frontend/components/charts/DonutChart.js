"use client";

import { useSyncExternalStore } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoney, formatWhole } from "@/lib/format";
import { DONUT_COLORS } from "./colors";

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

function DonutTooltip({ active, payload, unitLabel, money }) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{name}</p>
      <p className="text-muted">
        {money ? formatMoney(value) : `${formatWhole(value)} ${unitLabel}`}
      </p>
    </div>
  );
}

// Loaded without server rendering (spec §7.11); screens use it through DonutCard.
export default function DonutChart({ data, unitLabel = "units", money = false }) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Tooltip content={<DonutTooltip unitLabel={unitLabel} money={money} />} />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="68%"
          outerRadius="100%"
          paddingAngle={2}
          stroke="var(--surface)"
          strokeWidth={2}
          isAnimationActive={!reducedMotion}
        >
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
