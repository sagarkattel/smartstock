"use client";

import dynamic from "next/dynamic";
import { DONUT_COLORS } from "@/components/charts/colors";
import { formatMoney, formatPercent, formatWhole } from "@/lib/format";

const DonutChart = dynamic(() => import("@/components/charts/DonutChart"), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse rounded-full bg-border/50" role="status" aria-label="Loading chart" />,
});

/** A donut with its total in the middle and a legend of shares (e.g. stock value by priority). */
export function BreakdownCard({ title, subtitle, data, money = true, totalLabel = "Total" }) {
  const rows = data.filter((d) => d.value > 0);
  const total = rows.reduce((sum, d) => sum + d.value, 0);
  const format = money ? formatMoney : formatWhole;
  const summary = `${title}: ${rows.map((d) => `${d.name} ${format(d.value)}`).join(", ")}.`;

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-xs text-muted">{subtitle}</p>

      {total === 0 ? (
        <p className="mt-6 text-sm text-muted">Nothing expected for this period.</p>
      ) : (
        <div className="mt-4 flex flex-1 flex-col items-center gap-5">
          <div role="img" aria-label={summary} className="relative size-44 shrink-0">
            <DonutChart data={rows} money={money} />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-lg font-semibold tabular-nums">{format(total)}</span>
              <span className="text-[11px] text-muted">{totalLabel}</span>
            </div>
          </div>
          <ul className="w-full min-w-0 space-y-2.5 text-sm">
            {rows.map((d, index) => (
              <li key={d.name} className="flex items-center gap-2.5">
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] }} />
                <span className="min-w-0 flex-1 truncate" title={d.name}>{d.name}</span>
                <span className="shrink-0 tabular-nums text-muted">{formatPercent(d.value / total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
