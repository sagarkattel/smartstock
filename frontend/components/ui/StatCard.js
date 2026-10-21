"use client";

import dynamic from "next/dynamic";
import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from "@/components/ui/icons";
import { formatChange } from "@/lib/format";

const Sparkline = dynamic(() => import("@/components/charts/Sparkline"), {
  ssr: false,
  loading: () => <div className="size-full" />,
});

const TONES = { green: "green", blue: "blue", purple: "purple", amber: "amber", violet: "purple", sky: "blue" };

/** KPI card: icon, label, big number, optional sparkline and trend. `trend` is a fraction (0.12 = +12%). */
export function StatCard({ label, value, caption, tone = "blue", icon: Icon, spark, trend, trendTitle, className = "" }) {
  const hasTrend = typeof trend === "number" && Number.isFinite(trend);
  const direction = !hasTrend || Math.abs(trend) < 0.005 ? "flat" : trend > 0 ? "up" : "down";
  const TrendIcon = direction === "up" ? ArrowUpIcon : direction === "down" ? ArrowDownIcon : MinusIcon;
  const trendColor = direction === "up" ? "text-[var(--positive)]" : direction === "down" ? "text-[var(--negative)]" : "text-muted";

  return (
    <div className={`kpi kpi-${TONES[tone] ?? "blue"} min-w-0 rounded-2xl p-4 ${className}`}>
      <div className="flex items-center gap-3">
        {Icon && (
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-xl text-[var(--kpi-color)]"
            style={{ background: "var(--kpi-tile)" }}
          >
            <Icon className="size-5" />
          </span>
        )}
        <p className="min-w-0 truncate text-sm font-medium text-foreground/90">{label}</p>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <p
          className={`min-w-0 truncate font-semibold tabular-nums ${
            typeof value === "string" && value.length > 11 ? "text-xl" : "text-3xl"
          }`}
          title={typeof value === "string" ? value : undefined}
        >
          {value}
        </p>
        {spark && spark.length > 1 && (
          <div aria-hidden="true" className="h-10 w-20 shrink-0 sm:w-24">
            <Sparkline data={spark} />
          </div>
        )}
      </div>

      {(hasTrend || caption) && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs">
          {hasTrend && (
            <span title={trendTitle} className={`inline-flex items-center gap-0.5 font-semibold ${trendColor}`}>
              <TrendIcon className="size-3.5" />
              {formatChange(trend)}
            </span>
          )}
          {caption && <span className="min-w-0 truncate text-muted">{caption}</span>}
        </p>
      )}
    </div>
  );
}
