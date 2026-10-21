"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { buildChartRows } from "@/components/charts/chart-rows";
import { formatMoney, formatUnits, formatWhole } from "@/lib/format";

const ForecastBandChart = dynamic(() => import("@/components/charts/ForecastBandChart"), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse rounded-xl bg-border/50" role="status" aria-label="Loading chart" />,
});

const CONFIDENCE_HELP = {
  High: "Weeks 1–4 after the data ends: normal confidence.",
  Medium: "Weeks 5–12 after the data ends: medium confidence.",
  "Planning estimate": "More than 12 weeks after the data ends: use for planning only.",
};

const segment =
  "px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-40";

export function ProductForecast({ history = [], weekly, monthly = [], title = "Forecast" }) {
  const [granularity, setGranularity] = useState("week");
  const hasMonths = monthly.length > 0;
  const periods = granularity === "week" || !hasMonths ? weekly : monthly;
  const rows = useMemo(() => buildChartRows(granularity, history, periods), [granularity, history, periods]);

  const first = periods[0];
  const summary =
    `Expected ${formatUnits(first.p50)} units in ${first.period_label}` +
    (first.p10 === null
      ? `, up to ${formatUnits(first.p90)}.`
      : `, likely range ${formatUnits(first.p10)} to ${formatUnits(first.p90)}.`);

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-xs text-muted">
            {granularity === "week"
              ? `${history.length > 0 ? `Last ${history.length} weeks of actual sales, then the next ` : "The next "}${weekly.length} weeks`
              : `The next ${monthly.length} ${monthly.length === 1 ? "month" : "months"}`}
          </p>
        </div>
        <div role="group" aria-label="Period type" className="flex overflow-hidden rounded-xl border border-border bg-surface-2">
          {[
            { value: "week", label: "Weeks" },
            { value: "month", label: "Months" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={granularity === option.value}
              disabled={option.value === "month" && !hasMonths}
              onClick={() => setGranularity(option.value)}
              className={`${segment} ${
                granularity === option.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted hover:bg-background hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p className="sr-only">{summary}</p>
      <div role="img" aria-label={summary} className="mt-4 h-72 w-full">
        <ForecastBandChart rows={rows} granularity={granularity} />
      </div>

      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        {granularity === "week" && history.length > 0 && <li>Solid grey: actual sales</li>}
        <li>Dashed dark: expected</li>
        <li>{granularity === "week" ? "Shaded: likely range (8 times in 10)" : "Dotted light: high estimate"}</li>
        <li>Dotted purple: safe stock</li>
      </ul>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Forecast by {granularity === "week" ? "week" : "month"}</caption>
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="py-2 pr-3 text-left font-medium">Period</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Expected</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Likely range</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">At least</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Safe stock</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Sales</th>
              <th scope="col" className="py-2 pl-3 text-left font-medium">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.period_start} className="border-b border-border last:border-b-0">
                <th scope="row" className="py-2 pr-3 text-left font-medium">{p.period_label}</th>
                <td className="px-3 py-2 text-right tabular-nums">{formatUnits(p.p50)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">
                  {p.p10 === null ? `up to ${formatUnits(p.p90)}` : `${formatUnits(p.p10)} to ${formatUnits(p.p90)}`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{formatWhole(p.min_qty)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatWhole(p.safe_qty)}
                  <span className="ml-1 text-xs text-muted">({Math.round(p.service_level * 100)}%)</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(p.revenue_p50)}</td>
                <td className="py-2 pl-3" title={CONFIDENCE_HELP[p.horizon_confidence]}>
                  {p.horizon_confidence}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* TODO(spec): CSV export of this table (spec §2.1). */}
    </section>
  );
}
