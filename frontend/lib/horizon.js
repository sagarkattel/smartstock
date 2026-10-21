import { addDays, formatDate } from "@/lib/format";

// Horizon choices on the dashboards (spec §7.2): weeks 1–4 and months 1 / 3 / 6, capped by what the
// backend allows today (/meta max_horizon_weeks / max_horizon_months). Defaults are 4 weeks and 6 months.
// "month" is the current month only ("This month"); "nextmonth" starts with the month after it ("Next month", 3, 6).
export const HORIZON_OPTIONS = { week: [1, 2, 3, 4], month: [1], nextmonth: [1, 3, 6] };
export const DEFAULT_HORIZON = { week: 4, month: 1, nextmonth: 6 };

/** The backend only knows weeks and months; "nextmonth" is months that skip the current one. */
export const baseGranularity = (granularity) => (granularity === "nextmonth" ? "month" : granularity);

function maxFor(granularity, meta) {
  if (granularity === "week") return meta.max_horizon_weeks;
  return granularity === "nextmonth" ? Math.max(0, meta.max_horizon_months - 1) : Math.min(1, meta.max_horizon_months);
}

export function allowedHorizons(granularity, meta) {
  return HORIZON_OPTIONS[granularity].filter((count) => count <= maxFor(granularity, meta));
}

/** The default horizon, or the longest allowed one when the default is over the cap. */
export function defaultHorizon(granularity, meta) {
  const allowed = allowedHorizons(granularity, meta);
  return allowed.includes(DEFAULT_HORIZON[granularity]) ? DEFAULT_HORIZON[granularity] : (allowed.at(-1) ?? 0);
}

/** Why some choices are missing, or null when none are (spec §7.2: explain the cap). */
export function horizonLimitNote(granularity, meta) {
  const missing = HORIZON_OPTIONS[granularity].filter((count) => count > maxFor(granularity, meta));
  if (missing.length === 0) return null;
  const unit = granularity === "week" ? "week" : "month";
  if (granularity === "month") return null;
  const list = missing.map((n) => `${n} ${n === 1 ? unit : `${unit}s`}`).join(", ");
  const age = meta.data_age_weeks;
  return `${list} not available: sales data is ${age} ${age === 1 ? "week" : "weeks"} old.`;
}

export function unitName(granularity, count) {
  const base = granularity === "week" ? "week" : "month";
  return count === 1 ? base : `${base}s`;
}

export function horizonCaption(granularity, count) {
  if (granularity === "week") return count === 1 ? "This week" : `Next ${count} weeks`;
  if (granularity === "month") return "This month";
  return count === 1 ? "Next month" : `Next ${count} months`;
}

/** "5 Oct 2026 – 1 Nov 2026", "Nov 2026 – Jan 2027", or a single period label. */
export function periodText(granularity, periods) {
  const first = periods[0];
  const last = periods.at(-1);
  if (periods.length === 1) return first.period_label;
  if (granularity === "week") return `${formatDate(first.period_start)} – ${formatDate(addDays(last.period_start, 6))}`;
  return `${first.period_label} – ${last.period_label}`;
}

/** How many weeks a period covers (a month is its days / 7). */
export function periodWeeks(granularity, period) {
  if (granularity === "week") return 1;
  const [year, month] = period.period_start.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate() / 7;
}

/** Totals for the cards from a backend summary (App 1 / App 2a): its periods are already the horizon. */
export function totalsFromSummary(summary) {
  const totals = { units: 0, sales: 0, order: 0, orderValue: 0, weeks: 0 };
  for (const p of summary.periods) {
    totals.units += p.expected;
    totals.sales += p.revenue_expected;
    totals.order += p.safe;
    totals.orderValue += p.revenue_safe;
    totals.weeks += periodWeeks(summary.granularity, p);
  }
  return totals;
}

/** Totals for the cards from full forecast periods (one machine). */
export function totalsFromPeriods(granularity, periods) {
  const totals = { units: 0, sales: 0, order: 0, orderValue: 0, weeks: 0 };
  for (const p of periods) {
    totals.units += p.p50;
    totals.sales += p.revenue_p50;
    totals.order += p.safe_qty;
    totals.orderValue += p.revenue_safe;
    totals.weeks += periodWeeks(granularity, p);
  }
  return totals;
}

export const sum = (values) => values.reduce((total, v) => total + v, 0);

/** The entry with the most units over the horizon, from a list of { name, units }. */
export function topEntry(entries) {
  return entries.reduce((best, e) => (e.units > best.units ? e : best), { name: "—", units: 0 });
}

/** Top and bottom five (by units), skipping entries with nothing expected. */
export function topAndBottom(entries, count = 5) {
  const ranked = entries
    .map((e) => ({ name: e.name, value: Math.round(e.units) }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value);
  return { best: ranked.slice(0, count), least: ranked.slice(-count).reverse() };
}
