import { addDays, addMonths, formatMonthShort, formatShortDate, parseDate } from "@/lib/format";

export const OVERVIEW_METRICS = [
  { id: "sales", tab: "Sales", forecastKey: "revenue_expected", actualKey: "revenue", money: true, noun: "Sales" },
  { id: "units", tab: "Units", forecastKey: "expected", actualKey: "units", money: false, noun: "Units", comparable: true },
  { id: "stock", tab: "Stock value", forecastKey: "revenue_safe", actualKey: null, money: true, noun: "Suggested stock value" },
];

const PAST_WEEKS = 12; // real weeks shown to the left when "Show past data" is on
const PAST_MONTHS = 6; // real months shown to the left when "Show past data" is on
const YEAR_DAYS = 364; // 52 weeks: the same week of last year, on the same weekday

const isNum = (v) => v !== null && v !== undefined;

/**
 * Rows for the overview chart. Each row is one week (or month) with whichever of these it has:
 *   actual    real sales (past weeks/months, when "Show past data" is on)
 *   earlier   what an earlier model forecast for a week that now has real sales (weeks only)
 *   missed    expected value for a week that has passed but has no real sales uploaded yet
 *   forecast  the expected value for the future (`selected` when inside the chosen period)
 *   lastYear  real sales for the same week/month a year earlier (when "Compare with last year" is on)
 *
 * `periods`: backend summary periods. `history`: weekly real sales [{ week_start, units, revenue }].
 * `monthHistory`: complete real months [{ period_start, units, revenue }]. `comparison`: the backend's
 * /admin/monitoring/accuracy response. `missed`: weeks that have no real sales yet.
 */
export function buildOverviewRows({
  periods,
  granularity,
  highlightCount,
  highlightFrom = 0,
  metric,
  history = [],
  monthHistory = [],
  comparison = null,
  missed = [],
  weeklyPeriods = [],
  showPast = false,
  compareLastYear = false,
}) {
  const hasReal = Boolean(metric.actualKey); // nothing was recorded for "stock value"
  return granularity === "week"
    ? weekRows({ periods, highlightCount, metric, history, comparison, missed, showPast: showPast && hasReal, compareLastYear: compareLastYear && hasReal })
    : monthRows({ periods, highlightCount, highlightFrom, metric, history, monthHistory, missed, weeklyPeriods, showPast: showPast && hasReal, compareLastYear: compareLastYear && hasReal });
}

function weekRows({ periods, highlightCount, metric, history, comparison, missed, showPast, compareLastYear }) {
  const realByWeek = new Map(history.map((h) => [h.week_start, h[metric.actualKey]]));
  const actualByWeek = new Map(showPast ? history.slice(-PAST_WEEKS).map((h) => [h.week_start, h[metric.actualKey]]) : []);
  const earlierByWeek = new Map();
  if (showPast && metric.comparable && comparison?.weeks) {
    for (const w of comparison.weeks) {
      earlierByWeek.set(w.week_start, w.forecast_p50);
      actualByWeek.set(w.week_start, w.actual); // same series as the earlier forecast, so the pair is like for like
    }
  }
  const forecastByWeek = new Map(periods.map((p, i) => [p.period_start, { p, i }]));
  // The stock measure has no value for past weeks (nothing was being stocked against them).
  const missedKey = metric.id === "units" ? "expected" : metric.id === "sales" ? "revenue_expected" : null;
  const missedByWeek = new Map(missedKey ? missed.map((w) => [w.period_start, w]) : []);

  // One slot for every week from the first to the last, so gaps show as gaps.
  const starts = [...actualByWeek.keys(), ...missedByWeek.keys(), ...forecastByWeek.keys()].sort();
  const rows = [];
  for (let day = starts[0]; parseDate(day) <= parseDate(starts.at(-1)); day = addDays(day, 7)) {
    const entry = forecastByWeek.get(day);
    const gap = missedByWeek.get(day);
    rows.push({
      key: day,
      label: formatShortDate(day),
      title: entry ? entry.p.period_label : (gap?.period_label ?? `Week of ${formatShortDate(day)}`),
      actual: actualByWeek.get(day) ?? null,
      earlier: earlierByWeek.get(day) ?? null,
      missed: gap && !actualByWeek.has(day) ? gap[missedKey] : null,
      forecast: entry ? entry.p[metric.forecastKey] : null,
      // The first forecast week is the current one: part of it has passed, but it is not over, so it counts as expected.
      note: entry?.i === 0 ? "This week is still in progress, so it is counted as expected" : null,
      lastYear: compareLastYear ? (realByWeek.get(addDays(day, -YEAR_DAYS)) ?? null) : null,
      selected: entry ? entry.i < highlightCount : false,
      confidence: entry?.p.horizon_confidence ?? gap?.horizon_confidence ?? null,
    });
  }
  return rows;
}

const monthOf = (day) => `${day.slice(0, 7)}-01`;

function daysInMonth(month) {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

/**
 * Spreads weekly values evenly over their 7 days and totals them by calendar month, so a month that is only
 * partly covered by one source (e.g. August: real sales up to the 30th) still gets its share.
 * `days` is how many days of the month came from this source. `skipFrom` leaves out days in or after that month.
 */
function spreadWeeks(weeks, startOf, valueOf, skipFrom = null) {
  const totals = new Map();
  for (const w of weeks) {
    const value = valueOf(w);
    if (value === null || value === undefined) continue;
    for (let d = 0; d < 7; d++) {
      const month = monthOf(addDays(startOf(w), d));
      if (skipFrom && month >= skipFrom) continue;
      const entry = totals.get(month) ?? { value: 0, days: 0 };
      entry.value += value / 7;
      entry.days += 1;
      totals.set(month, entry);
    }
  }
  return totals;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Month rows. Every month is exactly ONE of three kinds, so a bar never mixes real and expected values:
 *   real      the whole month is covered by uploaded sales        -> `actual` (only with "Show past data")
 *   past      the month is over, but the upload does not cover all of it (e.g. August: 30 real days and 1
 *             missing day, or September: none)                    -> `missed`, drawn hatched as "expected"
 *   expected  the month is still in progress or in the future (e.g. October: 4 days without real sales,
 *             then forecast days; November on: the backend's monthly forecast)  -> `forecast`
 * For past and in-progress months the value is the whole month: real days plus expected days.
 */
function monthRows({ periods, highlightCount, highlightFrom, metric, history, monthHistory, missed, weeklyPeriods, showPast, compareLastYear }) {
  const realByMonthFull = new Map(monthHistory.map((m) => [m.period_start, m[metric.actualKey]]));
  const forecastByMonth = new Map(periods.map((p, i) => [p.period_start, { p, i }]));
  const firstForecastMonth = periods[0]?.period_start ?? null;
  const missedKey = metric.id === "units" ? "expected" : metric.id === "sales" ? "revenue_expected" : null;

  const realMonths = spreadWeeks(history, (h) => h.week_start, (h) => h[metric.actualKey]);
  // The loaded history starts partway through some month; that month is cut off by the window, not missing data.
  const loadedFrom = history[0]?.week_start;
  if (loadedFrom) for (const month of [...realMonths.keys()]) if (month < loadedFrom) realMonths.delete(month);
  const missedMonths = missedKey ? spreadWeeks(missed, (w) => w.period_start, (w) => w[missedKey]) : new Map();
  // The weekly forecast only fills the part of the current month before the first full forecast month.
  const weeklyMonths = spreadWeeks(weeklyPeriods, (p) => p.period_start, (p) => p[metric.forecastKey], firstForecastMonth);

  const monthSet = new Set([...realMonths.keys(), ...missedMonths.keys(), ...weeklyMonths.keys(), ...forecastByMonth.keys()]);
  const kindOf = (month) => {
    if (forecastByMonth.has(month) || weeklyMonths.has(month)) return "expected"; // not over yet
    const real = realMonths.get(month);
    if (real && real.days === daysInMonth(month) && !missedMonths.has(month)) return "real";
    return "past";
  };
  const realMonthKeys = [...monthSet].filter((m) => kindOf(m) === "real").sort().slice(-PAST_MONTHS);
  const shownReal = new Set(showPast ? realMonthKeys : []);
  const visible = (month) => kindOf(month) !== "real" || shownReal.has(month);

  const starts = [...monthSet].filter(visible).sort();
  if (starts.length === 0) return [];

  const rows = [];
  for (let month = starts[0]; month <= starts.at(-1); month = addMonths(month, 1)) {
    // Hidden real months are skipped; a month with nothing at all stays as an empty slot so the axis stays honest.
    if (monthSet.has(month) && !visible(month)) continue;
    const kind = monthSet.has(month) ? kindOf(month) : null;
    const entry = forecastByMonth.get(month);
    const real = realMonths.get(month);
    const gap = missedMonths.get(month);
    const ahead = weeklyMonths.get(month);

    // Whole-month value for a month that is not simply real or simply the backend's monthly forecast.
    const wholeMonth = (real?.value ?? 0) + (gap?.value ?? 0) + (ahead?.value ?? 0);
    const notes = [];
    if (kind === "past" || (kind === "expected" && !entry)) {
      if (real) notes.push(`${plural(real.days, "day")} with real sales`);
      if (gap) notes.push(`${plural(gap.days, "day")} passed with no real sales uploaded (expected)`);
      if (ahead) notes.push(`${plural(ahead.days, "day")} still to come (forecast)`);
    }
    // Some days have passed but the month is not over: it is expected, never "expected for time that has passed".
    if (kind === "expected" && (real || gap) && (ahead || entry?.i === 0)) notes.unshift("This month is still in progress, so it is counted as expected");
    if (kind === "past") notes.push("Counted as expected until the whole month is uploaded");

    rows.push({
      key: month,
      label: formatMonthShort(month),
      title: entry ? entry.p.period_label : new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", month: "long", year: "numeric" }).format(parseDate(month)),
      actual: kind === "real" ? real.value : null,
      earlier: null,
      missed: kind === "past" ? wholeMonth : null,
      forecast: kind === "expected" ? (entry ? entry.p[metric.forecastKey] : wholeMonth) : null,
      note: notes.length > 0 ? notes.join(" · ") : null,
      lastYear: compareLastYear ? (realByMonthFull.get(addMonths(month, -12)) ?? null) : null,
      selected: entry ? entry.i >= highlightFrom && entry.i < highlightFrom + highlightCount : false,
      confidence: entry?.p.horizon_confidence ?? null,
    });
  }
  return rows;
}

/** "Earlier forecast vs real" facts for the strip above the chart (null when there is nothing to compare). */
export function summariseComparison(comparison) {
  if (!comparison?.weeks?.length) return null;
  return { weeks: comparison.weeks.length, wape: comparison.wape, drift: Boolean(comparison.drift), threshold: comparison.drift_threshold };
}

/** Expected total for the chosen period against the same period last year (null when last year is unknown). */
export function summariseLastYear(rows) {
  const selected = rows.filter((r) => r.selected && isNum(r.forecast));
  const withLast = selected.filter((r) => isNum(r.lastYear));
  if (selected.length === 0 || withLast.length === 0) return null;
  const expected = withLast.reduce((sum, r) => sum + r.forecast, 0);
  const last = withLast.reduce((sum, r) => sum + r.lastYear, 0);
  return { expected, last, change: last > 0 ? (expected - last) / last : null, periods: withLast.length, of: selected.length };
}

