import Link from "next/link";
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, MinusIcon } from "@/components/ui/icons";
import { formatMoney, formatPercent } from "@/lib/format";

const RANK_COLORS = ["#7c5cff", "#2f8cff", "#4f6bff", "#ffb23e", "#18b6d9"];

function TrendArrow({ trend }) {
  if (trend === null || trend === undefined || Math.abs(trend) < 0.005) {
    return <MinusIcon className="size-4 text-muted" />;
  }
  return trend > 0 ? <ArrowUpIcon className="size-4 text-[var(--positive)]" /> : <ArrowDownIcon className="size-4 text-[var(--negative)]" />;
}

/**
 * A "Top 5" card: rank, icon, name, expected sales and share, and the trend over the period.
 * Each row opens the item's detail page.
 */
export function RankedList({ title, subtitle, entries, className = "" }) {
  return (
    <section className={`rounded-2xl border border-border bg-surface p-5 ${className}`}>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-xs text-muted">{subtitle}</p>

      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Nothing to rank yet.</p>
      ) : (
        <ol className="mt-3 divide-y divide-border">
          {entries.map((entry, index) => (
            <li key={entry.key}>
              <Link
                href={entry.href}
                className="group flex items-center gap-3 rounded-lg py-2.5 hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-focus-ring"
              >
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ background: RANK_COLORS[index % RANK_COLORS.length] }}
                >
                  {index + 1}
                </span>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-2 text-primary-hover">
                  <entry.Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium" title={entry.name}>{entry.name}</span>
                  <span className="block truncate text-xs text-muted">{entry.sub}</span>
                </span>
                <span className="shrink-0 text-right text-xs">
                  <span className="block font-semibold tabular-nums">{formatMoney(entry.value)}</span>
                  <span className="mt-0.5 flex items-center justify-end gap-1 text-muted">
                    {formatPercent(entry.share)}
                    <TrendArrow trend={entry.trend} />
                  </span>
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-muted group-hover:text-foreground" />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
