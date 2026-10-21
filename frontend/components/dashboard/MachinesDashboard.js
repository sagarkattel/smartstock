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
  machineColumns,
  machineHref,
  machineKey,
  machineSearchText,
  toMachineRows,
} from "@/components/dashboard/columns";
import { DataAgeBanner } from "@/components/ui/DataAgeBanner";
import { CalcIcon, CoinsIcon, CubeIcon, MachineIcon, TagIcon } from "@/components/ui/icons";
import { PageHero } from "@/components/ui/PageHero";
import { StatCard } from "@/components/ui/StatCard";
import { ErrorBlock, Loadable, StatePanel } from "@/components/ui/StateViews";
import { WithMeta } from "@/components/ui/WithMeta";
import { machinePath } from "@/config/paths";
import { formatMoney, formatWhole } from "@/lib/format";
import { baseGranularity, horizonCaption, periodText, sum, totalsFromSummary } from "@/lib/horizon";
import { useAccuracy, useApp2aMachines, useApp2aSummary, useHistory, useMissedForecast } from "@/lib/queries";
import { topAndBottomEntries, trendOf } from "@/lib/rankings";

export function MachinesDashboard() {
  return <WithMeta>{(meta) => <MachinesContent meta={meta} />}</WithMeta>;
}

// Many machines share a location name, so the asset ID keeps them apart.
const describeMachine = (m) => ({
  key: m.asset_id,
  name: m.location,
  sub: `Asset ${m.asset_id}`,
  href: machinePath(m.asset_id, m.location),
  Icon: MachineIcon,
});

function MachinesContent({ meta }) {
  const { granularity, horizon, select } = useHorizon(meta);
  const longest = granularity === "week" ? meta.max_horizon_weeks : meta.max_horizon_months;
  const fixedWeeks = Math.min(4, meta.max_horizon_weeks);

  // KPI cards and the donut follow the chosen period; the overview chart shows the whole forecast
  // window; the table and the top-5 lists always use the next 4 weeks.
  const summary = useApp2aSummary(granularity, horizon);
  const overview = useApp2aSummary(baseGranularity(granularity), longest);
  // The weekly forecast also fills the rest of the current month in the Months view.
  const weeklyOverview = useApp2aSummary("week", meta.max_horizon_weeks);
  const selected = useApp2aMachines(granularity, horizon);
  const fixed = useApp2aMachines("week", fixedWeeks);
  const history = useHistory("app2a");
  const monthHistory = useHistory("app2a", { granularity: "month" });
  const accuracy = useAccuracy("app2a");
  const missed = useMissedForecast("app2a");

  const totals = useMemo(() => (summary.data ? totalsFromSummary(summary.data) : null), [summary.data]);
  const rows = useMemo(() => (fixed.data ? toMachineRows(fixed.data.machines) : []), [fixed.data]);
  const ranked = useMemo(() => (fixed.data ? topAndBottomEntries(fixed.data.machines, describeMachine) : null), [fixed.data]);

  // Expected sales split by how well the machine records product names.
  const byConfidence = useMemo(() => {
    if (!selected.data) return null;
    return ["High", "Medium", "Low"].map((level) => ({
      name: `${level} confidence`,
      value: sum(selected.data.machines.filter((m) => m.confidence === level).map((m) => sum(m.sparkline) * m.price_recent)),
    }));
  }, [selected.data]);

  const periods = summary.data?.periods;
  const machineCount = summary.data?.machines;
  const withoutNames = fixed.data?.machines.filter((m) => !m.has_product_breakdown).length;
  const caption = horizonCaption(granularity, horizon);
  const rangeText = periods ? periodText(granularity, periods) : undefined;
  const spark = (key) => overview.data?.periods.map((p) => p[key]);
  const trend = (key) => (periods ? trendOf(periods.map((p) => p[key])) : null);
  const trendTitle = "Change from the first to the last period";

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 pt-5">
      <PageHero
        title="Machines"
        subtitle="Forecast what every vending machine will sell, and how much stock to load."
        actions={<PeriodSelect meta={meta} granularity={granularity} horizon={horizon} rangeText={rangeText} onSelect={select} />}
      >
        <div className="flex flex-wrap items-center gap-2">
          <DataAgeBanner meta={meta} />
          {fixed.data && (
            <span className="inline-flex items-center rounded-full border border-border bg-surface-2/70 px-3 py-1 text-xs text-muted">
              {machineCount} machines · {withoutNames} without product names
            </span>
          )}
        </div>
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
              <StatCard tone="blue" icon={CubeIcon} label="Expected units" value={formatWhole(totals.units)} spark={spark("expected")} trend={trend("expected")} trendTitle={trendTitle} caption={`${caption} · all machines`} />
              <StatCard tone="purple" icon={CalcIcon} label="Avg expected sales per machine" value={formatMoney(totals.sales / machineCount)} spark={spark("revenue_expected")?.map((v) => v / machineCount)} trend={trend("revenue_expected")} trendTitle={trendTitle} caption={`${caption} · ${machineCount} machines`} />
              <StatCard tone="amber" icon={CoinsIcon} label="Suggested stock value" value={formatMoney(totals.orderValue)} spark={spark("revenue_safe")} trend={trend("revenue_safe")} trendTitle={trendTitle} caption={`${formatWhole(totals.order)} units at sale price`} />
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
          byConfidence ? (
            <BreakdownCard title="Expected sales" subtitle={`By machine confidence · ${caption.toLowerCase()}`} data={byConfidence} totalLabel="Expected sales" />
          ) : (
            <StatePanel query={selected} title="Expected sales" className="h-80" />
          )
        }
        table={
          fixed.data ? (
            <EntityList
              title="Machines"
              noun="machines"
              subtitle={`Forecast for ${fixed.data.periods[0].period_label} · select a machine for its details`}
              modalTitle="All machines"
              modalSubtitle={`Forecast for ${fixed.data.periods[0].period_label}`}
              searchPlaceholder="Search machines or asset ID"
              rows={rows}
              columns={machineColumns}
              gridClass={LIST_GRID}
              keyOf={machineKey}
              hrefOf={machineHref}
              searchText={machineSearchText}
            />
          ) : (
            <StatePanel query={fixed} title="Machines" className="h-96" />
          )
        }
        side={
          ranked ? (
            <>
              <RankedList title="Top 5 performing machines" subtitle={`By expected sales (next ${fixedWeeks} weeks)`} entries={ranked.best} />
              <RankedList title="Top 5 least performing machines" subtitle={`By expected sales (next ${fixedWeeks} weeks)`} entries={ranked.least} />
            </>
          ) : (
            <>
              <StatePanel query={fixed} title="Top 5 performing machines" className="h-72" />
              <StatePanel query={fixed} title="Top 5 least performing machines" className="h-72" />
            </>
          )
        }
      />
      <p className="text-xs text-muted">{meta.revenue_note}. All figures are forecasts, not recorded sales.</p>
    </main>
  );
}
