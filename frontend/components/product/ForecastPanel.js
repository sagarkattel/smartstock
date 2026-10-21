"use client";

import { ProductForecast } from "@/components/product/ProductForecast";
import { ErrorBlock, LoadingBlock } from "@/components/ui/StateViews";

/**
 * The forecast chart and table for one series, fed by a weekly and a monthly query.
 * `read` turns each query's data into { periods, history }.
 */
export function ForecastPanel({ title, weeklyQuery, monthlyQuery, read }) {
  const failed = weeklyQuery.isError ? weeklyQuery : monthlyQuery.isError ? monthlyQuery : null;
  if (failed) {
    return <ErrorBlock error={failed.error} onRetry={() => failed.refetch()} title="Could not load the forecast" />;
  }
  const waiting = [weeklyQuery, monthlyQuery].some((q) => q.isPending && q.fetchStatus !== "idle");
  if (waiting || !weeklyQuery.data) return <LoadingBlock label="Loading the forecast" className="h-96" />;

  const weekly = read(weeklyQuery.data);
  const monthly = monthlyQuery.data ? read(monthlyQuery.data) : { periods: [] };
  return <ProductForecast title={title} history={weekly.history ?? []} weekly={weekly.periods} monthly={monthly.periods} />;
}
