"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertIcon, CheckIcon, InfoIcon } from "@/components/ui/icons";
import { pagePaths } from "@/config/paths";
import { formatChange, formatMoney, formatPercentPrecise, formatWhole } from "@/lib/format";
import { OVERVIEW_METRICS, buildOverviewRows, summariseComparison, summariseLastYear } from "@/lib/overview";

const OverviewChart = dynamic(() => import("@/components/charts/OverviewChart"), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse rounded-xl bg-border/50" role="status" aria-label="Loading chart" />,
});

function Swatch({ className, children, style }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden="true" style={style} className={`inline-block h-2.5 w-5 rounded-full ${className}`} />
      {children}
    </li>
  );
}

/** An on/off switch styled as a pill. */
function Toggle({ checked, onChange, disabled, title, children }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-45 ${
        checked ? "border-primary bg-primary/15 text-foreground" : "border-border bg-surface-2 text-muted hover:text-foreground"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex size-4 items-center justify-center rounded-md border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
      >
        {checked && <CheckIcon className="size-3" />}
      </span>
      {children}
    </button>
  );
}

/**
 * The forecast overview: expected sales per week or month, with optional real past data and the same
 * time last year. `periods` use the backend summary shape; `history` is weekly real sales and
 * `monthHistory` complete real months; `comparison` is the backend's accuracy response (present once newer
 * sales have arrived for weeks an earlier model forecast); `missed` are passed weeks with no real sales yet.
 */
export function OverviewCard({
  periods,
  granularity,
  highlightCount,
  highlightFrom = 0,
  history = [],
  monthHistory = [],
  comparison = null,
  missed = [],
  weeklyPeriods = [],
  className = "",
}) {
  const [metricId, setMetricId] = useState("sales");
  const [showPast, setShowPast] = useState(false);
  const [compareLastYear, setCompareLastYear] = useState(false);
  const metric = OVERVIEW_METRICS.find((m) => m.id === metricId);
  const hasRealData = Boolean(metric.actualKey);
  const unit = granularity === "week" ? "week" : "month";

  const rows = useMemo(
    () => buildOverviewRows({ periods, granularity, highlightCount, highlightFrom, metric, history, monthHistory, comparison, missed, weeklyPeriods, showPast, compareLastYear }),
    [periods, granularity, highlightCount, highlightFrom, metric, history, monthHistory, comparison, missed, weeklyPeriods, showPast, compareLastYear],
  );

  const has = (key) => rows.some((r) => r[key] !== null && r[key] !== undefined);
  const hasActual = has("actual");
  const hasEarlier = has("earlier");
  const hasMissed = has("missed");
  const hasLastYear = has("lastYear");
  // The notice counts weeks (the gap is whole weeks), in both the Weeks and the Months view.
  const missedCount = metric.id === "stock" ? 0 : missed.length;
  const facts = showPast && granularity === "week" ? summariseComparison(comparison) : null;
  const yearFacts = compareLastYear && hasRealData ? summariseLastYear(rows) : null;
  const show = (v) => (metric.money ? formatMoney(v) : `${formatWhole(v)} units`);
  const summary = `${metric.noun} per ${unit}: ${rows.map((r) => `${r.label} ${Math.round(r.actual ?? r.forecast ?? r.missed ?? 0)}`).join(", ")}.`;

  return (
    <section className={`min-w-0 rounded-2xl border border-border bg-surface p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Forecast overview</h2>
          <p className="text-xs text-muted">
            Expected {metric.noun.toLowerCase()} for the next {periods.length} {unit}s. Brighter blue bars are the selected period.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div role="tablist" aria-label="Measure" className="flex overflow-hidden rounded-xl border border-border bg-surface-2">
            {OVERVIEW_METRICS.map((m) => (
              <button
                key={m.id}
                role="tab"
                type="button"
                aria-selected={metricId === m.id}
                onClick={() => setMetricId(m.id)}
                className={`px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring ${
                  metricId === m.id ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {m.tab}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Toggle checked={showPast} onChange={setShowPast} disabled={!hasRealData} title={hasRealData ? undefined : "Real sales are not recorded for stock value"}>
              Show past data
            </Toggle>
            <Toggle checked={compareLastYear} onChange={setCompareLastYear} disabled={!hasRealData} title={hasRealData ? undefined : "Real sales are not recorded for stock value"}>
              Compare with last year
            </Toggle>
          </div>
        </div>
      </div>

      {yearFacts && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-surface-2/70 px-3 py-2 text-xs">
          <span className="font-medium">Same time last year:</span>
          <span className="text-muted">
            expected {show(yearFacts.expected)} vs {show(yearFacts.last)} then
          </span>
          {yearFacts.change !== null && (
            <span className={`font-semibold ${yearFacts.change >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
              {formatChange(yearFacts.change)}
            </span>
          )}
          {yearFacts.periods < yearFacts.of && (
            <span className="text-muted">
              (only {yearFacts.periods} of {yearFacts.of} {unit}s have last-year data)
            </span>
          )}
        </p>
      )}
      {compareLastYear && hasRealData && !yearFacts && (
        <p className="mt-3 rounded-xl bg-surface-2/70 px-3 py-2 text-xs text-muted">There is no data from last year for this period.</p>
      )}

      {missedCount > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-surface-2/70 px-3 py-2 text-xs text-muted">
          <InfoIcon className="size-4 shrink-0 text-[var(--chart-2)]" />
          <span>
            {missedCount} {missedCount === 1 ? "week has" : "weeks have"} passed without real sales in the data. {missedCount === 1 ? "Its" : "Their"} expected value is shown hatched.
          </span>
          <Link href={pagePaths.settingsGeneral} className="font-medium text-primary-hover underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring">
            Upload newer sales to compare
          </Link>
        </p>
      )}

      {facts && metric.comparable && (
        <p className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-xs ${facts.drift ? "status-warn" : "status-ok"}`}>
          {facts.drift && <AlertIcon className="size-4 shrink-0" />}
          <span className="font-medium">Earlier forecast vs real, {facts.weeks} {facts.weeks === 1 ? "week" : "weeks"}:</span>
          <span>off by {formatPercentPrecise(facts.wape)} on average</span>
          {facts.drift && <span>· higher than usual, consider retraining</span>}
        </p>
      )}
      {facts && !metric.comparable && hasRealData && (
        <p className="mt-3 rounded-xl bg-surface-2/70 px-3 py-2 text-xs text-muted">Earlier forecasts can be compared with real sales on the Units tab.</p>
      )}
      {showPast && hasRealData && granularity === "month" && !hasActual && (
        <p className="mt-3 rounded-xl bg-surface-2/70 px-3 py-2 text-xs text-muted">There are no complete past months to show.</p>
      )}

      <div role="img" aria-label={summary} className="mt-4 h-64 w-full">
        <OverviewChart rows={rows} money={metric.money} />
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted">
        {hasActual && <Swatch className="bg-[var(--chart-3)]">Real sales</Swatch>}
        <Swatch className="bg-[var(--chart-2)]">Expected</Swatch>
        {hasMissed && (
          <Swatch
            className="border border-dashed border-[var(--chart-2)]"
            style={{ backgroundImage: "repeating-linear-gradient(45deg, var(--chart-2) 0 2px, transparent 2px 5px)" }}
          >
            Expected for time that has passed (not fully uploaded)
          </Swatch>
        )}
        {hasEarlier && <Swatch className="bg-[var(--chart-5)]">Earlier forecast for the same week</Swatch>}
        {hasLastYear && (
          <Swatch className="border-y-2 border-dashed border-[var(--chart-4)] bg-transparent">Same {unit} last year</Swatch>
        )}
      </ul>
    </section>
  );
}
