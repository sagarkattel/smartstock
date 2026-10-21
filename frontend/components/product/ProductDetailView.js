import { ForecastPanel } from "@/components/product/ForecastPanel";
import { DataAgeBanner } from "@/components/ui/DataAgeBanner";
import { BoxIcon, CalcIcon, CubeIcon, TagIcon } from "@/components/ui/icons";
import { PageHero } from "@/components/ui/PageHero";
import { PriorityBadge } from "@/components/ui/PriorityBadge";
import { StatCard } from "@/components/ui/StatCard";
import { formatMoney, formatUnits, formatWhole } from "@/lib/format";

/** One product's forecast: used for warehouse products and for a product inside a machine. */
export function ProductDetailView({ series, weeklyQuery, monthlyQuery, read, meta, backHref, backLabel, context }) {
  const week = series.weekly[0];

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 pt-5">
      <PageHero
        back={{ href: backHref, label: backLabel }}
        title={series.item}
        subtitle={context ?? "Forecast for this product"}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
          <span>{series.ptype}</span>
          <span className="inline-flex items-center gap-2">
            Priority <PriorityBadge priority={series.priority} cls={series.class} />
          </span>
          <span>Recent price {formatMoney(series.price_recent)}</span>
          <DataAgeBanner meta={meta} />
        </div>
      </PageHero>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard tone="blue" icon={CubeIcon} label="Expected units" value={formatUnits(week.p50)} caption={week.period_label} />
        <StatCard tone="purple" icon={CalcIcon} label="Likely range" value={`${formatUnits(week.p10)} – ${formatUnits(week.p90)}`} caption="8 times out of 10" />
        <StatCard tone="amber" icon={BoxIcon} label="Safe stock" value={formatWhole(week.safe_qty)} caption={`Enough in ${Math.round(week.service_level * 100)}% of weeks`} />
        <StatCard tone="green" icon={TagIcon} label="Expected sales" value={formatMoney(week.revenue_p50)} caption="This week" />
      </div>

      <ForecastPanel title="Forecast" weeklyQuery={weeklyQuery} monthlyQuery={monthlyQuery} read={read} />

      <p className="text-xs text-muted">{meta.revenue_note}. All figures are forecasts, not recorded sales.</p>
    </main>
  );
}
