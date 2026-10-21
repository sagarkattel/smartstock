"use client";

import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

/** Tiny trend line for a KPI card: no axes, no tooltip (spec §7.11). Takes its colour from the card. */
export default function Sparkline({ data }) {
  const id = useId();
  const rows = data.map((v, i) => ({ i, v }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 4, right: 0, bottom: 2, left: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--kpi-color)", stopOpacity: 0.4 }} />
            <stop offset="100%" style={{ stopColor: "var(--kpi-color)", stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Area
          type="monotone"
          dataKey="v"
          stroke="var(--kpi-color)"
          strokeWidth={2}
          fill={`url(#${id})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
