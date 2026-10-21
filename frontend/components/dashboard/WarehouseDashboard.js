"use client";

import { useMemo } from "react";
import { BreakdownCard } from "@/components/dashboard/BreakdownCard";
import { DashboardGrid, KpiSkeletons } from "@/components/dashboard/DashboardGrid";
import { EntityList } from "@/components/dashboard/EntityList";
import { OverviewCard } from "@/components/dashboard/OverviewCard";
import { PeriodSelect, useHorizon } from "@/components/dashboard/HorizonTabs";
import { RankedList } from "@/components/dashboard/RankedList";
import {
  LIST_GRID,
  productColumns,
  productKey,
  productSearchText,
  toProductRows,
  warehouseProductHref,
} from "@/components/dashboard/columns";
import { DataAgeBanner } from "@/components/ui/DataAgeBanner";
import { CalcIcon, CoinsIcon, CubeIcon, ProductTypeIcon, TagIcon } from "@/components/ui/icons";
import { PageHero } from "@/components/ui/PageHero";
import { StatCard } from "@/components/ui/StatCard";
import { ErrorBlock, Loadable, StatePanel } from "@/components/ui/StateViews";
import { WithMeta } from "@/components/ui/WithMeta";
import { productPath } from "@/config/paths";
import { formatMoney, formatPercent, formatWhole } from "@/lib/format";
import { baseGranularity, horizonCaption, periodText, totalsFromSummary } from "@/lib/horizon";
import { useAccuracy, useApp1Products, useApp1Summary, useHistory, useMissedForecast } from "@/lib/queries";
import { topAndBottomEntries, trendOf } from "@/lib/rankings";

export function WarehouseDashboard() {
  return <WithMeta>{(meta) => <WarehouseContent meta={meta} />}</WithMeta>;
}

const describeProduct = (item) => ({
  key: item.item,
  name: item.item,
  sub: item.ptype,
  href: productPath(item.item),
  Icon: ({ className }) => <ProductTypeIcon ptype={item.ptype} className={className} />,
});

function WarehouseContent({ meta }) {
  const { granularity, horizon, select } = useHorizon(meta);
  const longest = granularity === "week" ? meta.max_horizon_weeks : meta.max_horizon_months;
  const fixedWeeks = Math.min(4, meta.max_horizon_weeks);

  // KPI cards follow the chosen period; the overview chart shows the whole forecast window; the
  // table and the top-5 lists always use the next 4 weeks.
  const summary = useApp1Summary(granularity, horizon);
  const overview = useApp1Summary(baseGranularity(granularity), longest);
  // The weekly forecast also fills the rest of the current month in the Months view.
  const weeklyOverview = useApp1Summary("week", meta.max_horizon_weeks);
  const fixed = useApp1Products("week", fixedWeeks);
  const history = useHistory("app1");
  const monthHistory = useHistory("app1", { granularity: "month" });
  const accuracy = useAccuracy("app1");
  const missed = useMissedForecast("app1");

  const totals = useMemo(() => (summary.data ? totalsFromSummary(summary.data) : null), [summary.data]);
  const rows = useMemo(() => (fixed.data ? toProductRows(fixed.data.items) : []), [fixed.data]);
  const ranked = useMemo(() => (fixed.data ? topAndBottomEntries(fixed.data.items, describeProduct) : null), [fixed.data]);

  const periods = summary.data?.periods;
  const caption = horizonCaption(granularity, horizon);
  const rangeText = periods ? periodText(granularity, periods) : undefined;
  const spark = (key) => overview.data?.periods.map((p) => p[key]);
  const trend = (key) => (periods ? trendOf(periods.map((p) => p[key])) : null);
  const trendTitle = "Change from the first to the last period";

  const breakdown = useMemo(() => {
    if (!periods) return null;
    return ["High", "Medium", "Low"].map((priority) => ({
      name: `${priority} priority`,
      value: periods.reduce((sum, p) => sum + p.by_priority[priority].revenue_safe, 0),
    }));
  }, [periods]);

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 pt-5">
      <PageHero
        title="Warehouse"
        subtitle={
          meta.named_sales_share != null
            ? `Forecast demand for every product and what to buy, based on the sales data up to the last upload. Totals count only sales with a product name (${formatPercent(meta.named_sales_share)} of recent sales), so they are lower than on Machines.`
            : "Forecast demand for every product and what to buy, based on the sales data up to the last upload."
        }
        actions={<PeriodSelect meta={meta} granularity={granularity} horizon={horizon} rangeText={rangeText} onSelect={select} />}
      >
        <DataAgeBanner meta={meta} />
      </PageHero>

      <DashboardGrid
        kpis={
          summary.isError ? (
            <div className="sm:col-span-2 xl:col-span-4">
              <ErrorBlock error={summary.error} onRetry={() => summary.refetch()} title="Could not load the forecast totals" />
            </div>
          ) : totals ? (
            <>
              <StatCard tone="green" icon={TagIcon} label="Expected sales" value={formatMoney(totals.sales)} spark={spark("revenue_expected")} trend={trend("revenue_expected")} trendTitle={trendTitle} caption={`${caption} · ${rangeText}`} />
              <StatCard tone="blue" icon={CubeIcon} label="Expected units" value={formatWhole(totals.units)} spark={spark("expected")} trend={trend("expected")} trendTitle={trendTitle} caption={caption} />
              <StatCard tone="purple" icon={CalcIcon} label="Suggested order (units)" value={formatWhole(totals.order)} spark={spark("safe")} trend={trend("safe")} trendTitle={trendTitle} caption="Safe stock to avoid running out" />
              <StatCard tone="amber" icon={CoinsIcon} label="Suggested order value" value={formatMoney(totals.orderValue)} spark={spark("revenue_safe")} trend={trend("revenue_safe")} trendTitle={trendTitle} caption="At current sale prices" />
            </>
          ) : (
            <KpiSkeletons />
          )
        }
        overview={
          <Loadable query={overview} label="Loading the overview" className="h-80">
            {(data) => (
              <OverviewCard
                periods={data.periods}
                granularity={baseGranularity(granularity)}
                highlightCount={horizon}
                highlightFrom={granularity === "nextmonth" ? 1 : 0}
                history={history.data?.weeks}
                monthHistory={monthHistory.data?.months}
                comparison={accuracy.data}
                missed={missed.data?.weeks}
                weeklyPeriods={weeklyOverview.data?.periods}
              />
            )}
          </Loadable>
        }
        breakdown={
          breakdown ? (
            <BreakdownCard title="Suggested order value" subtitle={`By priority · ${caption.toLowerCase()}`} data={breakdown} totalLabel="Order value" />
          ) : (
            <StatePanel query={summary} title="Suggested order value" className="h-80" />
          )
        }
        table={
          fixed.data ? (
            <EntityList
              title="Products"
              noun="products"
              subtitle={`Forecast for ${fixed.data.periods[0].period_label} · select a product for its details`}
              modalTitle="All products"
              modalSubtitle={`Forecast for ${fixed.data.periods[0].period_label}`}
              searchPlaceholder="Search products"
              rows={rows}
              columns={productColumns}
              gridClass={LIST_GRID}
              keyOf={productKey}
              hrefOf={warehouseProductHref}
              searchText={productSearchText}
            />
          ) : (
            <StatePanel query={fixed} title="Products" className="h-96" />
          )
        }
        side={
          ranked ? (
            <>
              <RankedList title="Top 5 best-selling products" subtitle={`By expected sales (next ${fixedWeeks} weeks)`} entries={ranked.best} />
              <RankedList title="Top 5 least-selling products" subtitle={`By expected sales (next ${fixedWeeks} weeks)`} entries={ranked.least} />
            </>
          ) : (
            <>
              <StatePanel query={fixed} title="Top 5 best-selling products" className="h-72" />
              <StatePanel query={fixed} title="Top 5 least-selling products" className="h-72" />
            </>
          )
        }
      />
      <p className="text-xs text-muted">{meta.revenue_note}. All figures are forecasts, not recorded sales.</p>
    </main>
  );
}
