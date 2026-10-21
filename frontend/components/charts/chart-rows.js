import { formatShortDate } from "@/lib/format";

/** Rows for the chart: recent actual sales (weekly view only), then the forecast periods. */
export function buildChartRows(granularity, history, periods) {
  const rows = [];
  if (granularity === "week") {
    for (const h of history) rows.push({ label: formatShortDate(h.week_start), actual: h.units, kind: "actual" });
  }
  for (const p of periods) {
    rows.push({
      label: granularity === "week" ? formatShortDate(p.period_start) : p.period_label,
      kind: "forecast",
      p50: p.p50,
      p90: p.p90,
      range: p.p10 === null ? null : [p.p10, p.p90],
      safe: p.safe_qty,
      min: p.min_qty,
      serviceLevel: p.service_level,
      periodLabel: p.period_label,
      confidence: p.horizon_confidence,
    });
  }
  return rows;
}
