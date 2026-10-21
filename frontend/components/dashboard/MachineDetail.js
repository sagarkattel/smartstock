"use client";

import { useMemo } from "react";
import { BreakdownCard } from "@/components/dashboard/BreakdownCard";
import { DashboardGrid, KpiSkeletons } from "@/components/dashboard/DashboardGrid";
import { EntityList } from "@/components/dashboard/EntityList";
import { PeriodSelect, useHorizon } from "@/components/dashboard/HorizonTabs";
import { OverviewCard } from "@/components/dashboard/OverviewCard";
import { RankedList } from "@/components/dashboard/RankedList";
import {
  LIST_GRID,
  machineProductHref,
  productColumns,
  productKey,
  productSearchText,
  toProductRows,
} from "@/components/dashboard/columns";
import { ForecastPanel } from "@/components/product/ForecastPanel";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import { DataAgeBanner } from "@/components/ui/DataAgeBanner";
import { BoxIcon, CalcIcon, CoinsIcon, CubeIcon, ProductTypeIcon, TagIcon } from "@/components/ui/icons";
import { DocumentTitle } from "@/components/ui/DocumentTitle";
import { PageHero } from "@/components/ui/PageHero";
import { PriorityBadge } from "@/components/ui/PriorityBadge";
import { StatCard } from "@/components/ui/StatCard";
import { ErrorBlock, Loadable, LoadingBlock, NotFoundView, StatePanel } from "@/components/ui/StateViews";
import { WithMeta } from "@/components/ui/WithMeta";
import { machineProductPath, pagePaths } from "@/config/paths";
import { formatMoney, formatWhole } from "@/lib/format";
import { baseGranularity, horizonCaption, periodText, sum, totalsFromPeriods } from "@/lib/horizon";
import { useApp2aForecast, useApp2bMachine, useHistory, useMissedForecast } from "@/lib/queries";
import { CanonicalRedirect, useResolvedMachine } from "@/lib/resolve";
import { toSummaryPeriod, topAndBottomEntries, trendOf } from "@/lib/rankings";

const TYPE_NAMES = { Drink: "Drinks", "Snack/food": "Snacks & food" };

/** `param` is the address piece: normally "castle-hill-tafe-100900" (a plain asset ID also works). */
export function MachineDetail({ param }) {
  return <WithMeta>{(meta) => <ResolvedMachine meta={meta} param={param} />}</WithMeta>;
}

function ResolvedMachine({ meta, param }) {
  const target = useResolvedMachine(param);
  if (target.status === "error") return <ErrorBlock error={target.error} onRetry={target.retry} className="mt-5" />;
  if (target.status === "loading") return <LoadingBlock label="Loading the machine" className="mt-5 h-96" />;
  if (target.status === "notfound") {
    return (
      <NotFoundView
        title="Machine not found"
        message="SmartStock has no machine at this address."
        backHref={pagePaths.machines}
        backLabel="Back to the machines"
      />
    );
  }
  return (
    <>
      <DocumentTitle title={target.location} />
      <CanonicalRedirect param={param} slug={target.slug} path={`${pagePaths.machines}/${target.slug}`} />
      <MachineContent meta={meta} assetId={target.assetId} />
    </>
  );
}

function MachineContent({ meta, assetId }) {
  const { granularity, horizon, select } = useHorizon(meta);
  const longest = granularity === "week" ? meta.max_horizon_weeks : meta.max_horizon_months;
  const fixedWeeks = Math.min(4, meta.max_horizon_weeks);

  // KPI cards and the donut follow the chosen period; the overview chart shows the whole forecast
  // window; the products table and top-5 lists always use the next 4 weeks.
  const forecast = useApp2aForecast(assetId, granularity, horizon);
  const overview = useApp2aForecast(assetId, baseGranularity(granularity), longest);
  const machine = forecast.data;
  const location = machine?.location;
  const hasBreakdown = machine?.has_product_breakdown === true;
  const selected = useApp2bMachine(assetId, granularity, horizon, hasBreakdown);
  const fixed = useApp2bMachine(assetId, "week", fixedWeeks, hasBreakdown);
  const weeklyForecast = useApp2aForecast(assetId, "week", meta.max_horizon_weeks);
  const monthlyForecast = useApp2aForecast(assetId, "month", meta.max_horizon_months);
  const missed = useMissedForecast("app2a", assetId);
  const history = useHistory("app2a", { assetId });
  const monthHistory = useHistory("app2a", { assetId, granularity: "month" });

  const totals = useMemo(() => (machine ? totalsFromPeriods(granularity, machine.periods) : null), [machine, granularity]);
  const rows = useMemo(() => (fixed.data ? toProductRows(fixed.data.products) : []), [fixed.data]);
  const ranked = useMemo(
    () =>
      fixed.data
        ? topAndBottomEntries(
            fixed.data.products.map((p) => ({ ...p, sparkline: p.periods.map((x) => x.p50) })),
            (p) => ({
              key: p.item,
              name: p.item,
              sub: p.ptype,
              href: machineProductPath(assetId, location, p.item),
              Icon: ({ className }) => <ProductTypeIcon ptype={p.ptype} className={className} />,
            }),
          )
        : null,
    [fixed.data, assetId, location],
  );
  const byType = useMemo(() => {
    if (!selected.data) return null;
    const groups = new Map();
    for (const p of selected.data.products) {
      const name = TYPE_NAMES[p.ptype] ?? "Other";
      groups.set(name, (groups.get(name) ?? 0) + sum(p.periods.map((x) => x.revenue_p50)));
    }
    return [...groups].map(([name, value]) => ({ name, value }));
  }, [selected.data]);

  if (forecast.error?.code === "unknown_machine") {
    return (
      <NotFoundView
        title="Machine not found"
        message={`SmartStock has no machine with asset ID ${assetId}.`}
        backHref={pagePaths.machines}
        backLabel="Back to the machines"
      />
    );
  }
  if (forecast.isError && !machine) {
    return <ErrorBlock error={forecast.error} onRetry={() => forecast.refetch()} className="mt-5" />;
  }
  if (!machine) return <LoadingBlock label="Loading the machine" className="mt-5 h-96" />;

  const periods = machine.periods;
  const caption = horizonCaption(granularity, horizon);
  const rangeText = periodText(granularity, periods);
  const series = overview.data?.periods;
  const spark = (pick) => series?.map(pick);
  const trend = (pick) => trendOf(periods.map(pick));
  const trendTitle = "Change from the first to the last period";

  // Units the named products add up to, beside the machine total (which also counts unnamed sales).
  const namedUnits = fixed.data ? sum(fixed.data.machine_total.map((p) => p.p50)) : null;
  const totalUnits = fixed.data ? sum(fixed.data.app2a_total.map((p) => p.p50)) : null;

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 pt-5">
      <PageHero
        back={{ href: pagePaths.machines, label: "Machines" }}
        title={machine.location}
        subtitle={`Asset ${machine.asset_id}`}
        actions={<PeriodSelect meta={meta} granularity={granularity} horizon={horizon} rangeText={rangeText} onSelect={select} />}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
          <span className="inline-flex items-center gap-2">
            Confidence <ConfidenceBadge confidence={machine.confidence} />
          </span>
          <span className="inline-flex items-center gap-2">
            Priority <PriorityBadge priority={machine.priority} cls={machine.class} />
          </span>
          <DataAgeBanner meta={meta} />
        </div>
      </PageHero>

      <DashboardGrid
        kpis={
          totals ? (
            <>
              <StatCard tone="green" icon={TagIcon} label="Expected sales" value={formatMoney(totals.sales)} spark={spark((p) => p.revenue_p50)} trend={trend((p) => p.revenue_p50)} trendTitle={trendTitle} caption={`${caption} · ${rangeText}`} />
              <StatCard tone="blue" icon={CubeIcon} label="Expected units" value={formatWhole(totals.units)} spark={spark((p) => p.p50)} trend={trend((p) => p.p50)} trendTitle={trendTitle} caption={caption} />
              <StatCard tone="purple" icon={CalcIcon} label="Suggested stock (units)" value={formatWhole(totals.order)} spark={spark((p) => p.safe_qty)} trend={trend((p) => p.safe_qty)} trendTitle={trendTitle} caption="Safe stock to avoid running out" />
              <StatCard tone="amber" icon={CoinsIcon} label="Suggested stock value" value={formatMoney(totals.orderValue)} spark={spark((p) => p.revenue_safe)} trend={trend((p) => p.revenue_safe)} trendTitle={trendTitle} caption="At current sale prices" />
            </>
          ) : (
            <KpiSkeletons />
          )
        }
        overview={
          <Loadable query={overview} label="Loading the overview" className="h-80">
            {(data) => (
              <OverviewCard
                periods={data.periods.map(toSummaryPeriod)}
                granularity={baseGranularity(granularity)}
                highlightCount={horizon}
                highlightFrom={granularity === "nextmonth" ? 1 : 0}
                history={history.data?.weeks}
                monthHistory={monthHistory.data?.months}
                missed={missed.data?.weeks}
                weeklyPeriods={weeklyForecast.data?.periods.map(toSummaryPeriod)}
              />
            )}
          </Loadable>
        }
        breakdown={
          !hasBreakdown ? (
            <section className="rounded-2xl border border-border bg-surface p-5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-muted">
                <BoxIcon className="size-5" />
              </span>
              <h2 className="mt-3 text-base font-semibold">Product names are not recorded for this machine</h2>
              <p className="mt-1 text-sm text-muted">
                Most of this machine’s sales have no product name, so SmartStock can only forecast the machine total.
              </p>
            </section>
          ) : byType ? (
            <BreakdownCard title="Expected sales" subtitle={`By product type · ${caption.toLowerCase()}`} data={byType} totalLabel="Products total" />
          ) : (
            <StatePanel query={selected} title="Expected sales" className="h-80" />
          )
        }
        table={
          !hasBreakdown ? null : fixed.data ? (
            <EntityList
              title="Products in this machine"
              noun="products"
              subtitle={`Forecast for ${fixed.data.machine_total[0].period_label} · products ${formatWhole(namedUnits)} units, machine total ${formatWhole(totalUnits)}`}
              modalTitle={`Products in ${machine.location}`}
              modalSubtitle={`Forecast for ${fixed.data.machine_total[0].period_label}`}
              searchPlaceholder="Search products"
              rows={rows}
              columns={productColumns}
              gridClass={LIST_GRID}
              keyOf={productKey}
              hrefOf={machineProductHref(machine.asset_id, machine.location)}
              searchText={productSearchText}
            />
          ) : (
            <StatePanel query={fixed} title="Products in this machine" className="h-96" />
          )
        }
        side={
          !hasBreakdown ? null : ranked ? (
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

      <ForecastPanel
        title="Machine forecast"
        weeklyQuery={weeklyForecast}
        monthlyQuery={monthlyForecast}
        read={(data) => ({ periods: data.periods, history: data.history })}
      />
      <p className="text-xs text-muted">{meta.revenue_note}. All figures are forecasts, not recorded sales.</p>
    </main>
  );
}
