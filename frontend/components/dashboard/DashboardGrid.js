import { LoadingBlock } from "@/components/ui/StateViews";

/** Four KPI cards, then (chart + breakdown) above a table on the left and ranked lists on the right. */
export function DashboardGrid({ kpis, overview, breakdown, table, side }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{kpis}</div>
      <div className={`grid gap-5 ${side ? "xl:grid-cols-[minmax(0,1fr)_22rem]" : ""}`}>
        <div className="min-w-0 space-y-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
            {overview}
            {breakdown}
          </div>
          {table}
        </div>
        {side && <div className="min-w-0 space-y-5">{side}</div>}
      </div>
    </>
  );
}

export function KpiSkeletons() {
  return [0, 1, 2, 3].map((i) => <LoadingBlock key={i} label="Loading totals" className="h-32" />);
}
