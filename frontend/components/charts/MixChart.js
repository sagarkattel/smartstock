"use client";

import { useSyncExternalStore } from "react";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

/** Mix comparison bar (spec §7.11): drink share at this site type vs the whole fleet. */
export default function MixChart({ siteShare, fleetShare }) {
  const animate = !usePrefersReducedMotion();
  const data = [
    { name: "This site type", value: Math.round(siteShare * 100) },
    { name: "Fleet", value: Math.round(fleetShare * 100) },
  ];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }}>
        <XAxis type="number" domain={[0, 100]} hide />
        <YAxis
          type="category"
          dataKey="name"
          width={112}
          tick={({ x, y, payload }) => (
            <text x={x - 4} y={y} dy={4} textAnchor="end" fill="var(--muted)" fontSize={12}>
              {payload.value}
            </text>
          )}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: "var(--background)" }}
          formatter={(value) => [`${value}% drinks`, "Share"]}
          contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
        />
        <Bar dataKey="value" barSize={18} radius={[0, 4, 4, 0]} isAnimationActive={animate}>
          <Cell fill="var(--chart-1)" />
          <Cell fill="var(--chart-5)" />
          <LabelList dataKey="value" position="right" formatter={(v) => `${v}% drinks`} fill="var(--foreground)" fontSize={12} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
