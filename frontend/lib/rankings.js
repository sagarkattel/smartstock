import { sum } from "@/lib/horizon";

/** Change from the first to the last value, as a fraction (null when it cannot be told). */
export function trendOf(values) {
  if (!values || values.length < 2 || !(values[0] > 0)) return null;
  return (values.at(-1) - values[0]) / values[0];
}

/**
 * Top five and bottom five by expected sales. `items` need { sparkline (units per period), price_recent }
 * (the backend's list items); `describe(item)` gives { key, name, sub, href, Icon } for the row.
 */
export function topAndBottomEntries(items, describe, count = 5) {
  const scored = items
    .map((item) => ({ item, sales: sum(item.sparkline) * item.price_recent, trend: trendOf(item.sparkline) }))
    .filter((s) => s.sales > 0)
    .sort((a, b) => b.sales - a.sales);

  const build = (list) => {
    const total = sum(list.map((s) => s.sales));
    return list.map((s) => ({ ...describe(s.item), value: s.sales, share: total > 0 ? s.sales / total : 0, trend: s.trend }));
  };
  return { best: build(scored.slice(0, count)), least: build(scored.slice(-count).reverse()) };
}

/** A forecast period (/app2a/forecast, /app2b) in the shape the summary endpoints use. */
export function toSummaryPeriod(p) {
  return {
    period_start: p.period_start,
    period_label: p.period_label,
    horizon_confidence: p.horizon_confidence,
    expected: p.p50,
    revenue_expected: p.revenue_p50,
    safe: p.safe_qty,
    revenue_safe: p.revenue_safe,
  };
}
