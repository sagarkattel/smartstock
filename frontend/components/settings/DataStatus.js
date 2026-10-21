"use client";

import { DataAgeBanner } from "@/components/ui/DataAgeBanner";
import { ErrorBlock, LoadingBlock } from "@/components/ui/StateViews";
import { formatDate } from "@/lib/format";
import { useMeta } from "@/lib/queries";

function Fact({ label, children }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2/70 p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-sm font-semibold">{children}</dd>
    </div>
  );
}

export function DataStatus() {
  const meta = useMeta();
  if (meta.isError) return <ErrorBlock error={meta.error} onRetry={() => meta.refetch()} title="Could not load the data status" />;
  if (!meta.data) return <LoadingBlock label="Loading the data status" className="h-40" />;
  const m = meta.data;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Data in use</h2>
          <p className="text-xs text-muted">What the current forecasts are based on.</p>
        </div>
        <DataAgeBanner meta={m} />
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Fact label="Sales data covers">
          {formatDate(m.data_start)} – {formatDate(m.data_end)}
        </Fact>
        <Fact label="Model forecasts from">{formatDate(m.forecast_start)}</Fact>
        <Fact label="Current week">Week of {formatDate(m.current_week_start)}</Fact>
        <Fact label="Model in use">{m.model_version}</Fact>
        <Fact label="Model trained on data up to">{formatDate(m.trained_until)}</Fact>
      </dl>
    </section>
  );
}
