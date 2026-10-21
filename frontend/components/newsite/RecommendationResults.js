"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { InfoIcon, DrinkIcon, MachineIcon } from "@/components/ui/icons";
import { StatCard } from "@/components/ui/StatCard";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatMoney, formatUnits, formatWhole } from "@/lib/format";

const RecommendationChart = dynamic(() => import("@/components/charts/RecommendationChart"), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse rounded-xl bg-border/50" role="status" aria-label="Loading chart" />,
});
const MixChart = dynamic(() => import("@/components/charts/MixChart"), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse rounded-xl bg-border/50" role="status" aria-label="Loading chart" />,
});

const CHART_LIMIT = 20; // spec §7.11: more than 20 bars shows the top 20; the table lists everything
const SITE_HELP = "High = 5 or more similar sites stocked it, Medium = 2 to 4, Low = 0 or 1.";

const CSV_COLUMNS = [
  { header: "List", value: (r) => r.list },
  { header: "Rank", value: (r) => r.rank },
  { header: "Item", value: (r) => r.item },
  { header: "Type", value: (r) => r.ptype },
  { header: "Price", value: (r) => r.price },
  { header: "Chance of regular sale", value: (r) => r.likelihood_regular_seller },
  { header: "Expected units per machine week", value: (r) => r.expected_units_per_machine_week },
  { header: "Expected sales per machine week", value: (r) => r.expected_revenue_per_machine_week },
  { header: "Lift vs fleet", value: (r) => r.lift_vs_fleet },
  { header: "Similar sites with product", value: (r) => r.similar_sites_with_product },
  { header: "Confidence", value: (r) => r.confidence },
];

function chartRows(rows, kind) {
  return rows.slice(0, CHART_LIMIT).map((r) => ({
    name: r.item,
    value: kind === "chance" ? Math.round(r.likelihood_regular_seller * 100) : r.lift_vs_fleet,
    label: kind === "chance" ? `${Math.round(r.likelihood_regular_seller * 100)}%` : `${r.lift_vs_fleet.toFixed(2)}×`,
    lines:
      kind === "chance"
        ? [`${Math.round(r.likelihood_regular_seller * 100)}% chance of selling at least 1 a week`, `${formatUnits(r.expected_units_per_machine_week)} units a week`]
        : [`Sells ${Math.round((r.lift_vs_fleet - 1) * 100)}% more than the fleet average`, `${r.similar_sites_with_product} similar sites stock it`],
  }));
}

function RecommendationTable({ rows, label }) {
  return (
    <div className="max-h-[30rem] overflow-auto rounded-xl border border-border">
      <table className="w-full min-w-[46rem] text-sm">
        <caption className="sr-only">{label}</caption>
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
            <th scope="col" className="py-2 pr-2 pl-3 text-right font-medium">#</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Product</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Type</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Regular seller</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Units / week</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Sales / week</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Lift</th>
            <th scope="col" className="py-2 pr-3 pl-3 text-left font-medium">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item} className="border-b border-border last:border-b-0">
              <td className="py-2 pr-2 pl-3 text-right tabular-nums text-muted">{r.rank}</td>
              <th scope="row" className="px-3 py-2 text-left font-medium">{r.item}</th>
              <td className="px-3 py-2 text-muted">{r.ptype}</td>
              <td className="px-3 py-2 text-right tabular-nums">{Math.round(r.likelihood_regular_seller * 100)}%</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatUnits(r.expected_units_per_machine_week)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.expected_revenue_per_machine_week)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.lift_vs_fleet.toFixed(2)}×</td>
              <td className="py-2 pr-3 pl-3">
                <ConfidenceBadge confidence={r.confidence} help={SITE_HELP} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListPanel({ rows, kind, label, emptyMessage }) {
  if (rows.length === 0) {
    return <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">{emptyMessage}</p>;
  }
  const bars = chartRows(rows, kind);
  const summary = `${label}: ${rows
    .slice(0, 3)
    .map((r) => r.item)
    .join(", ")}${rows.length > 3 ? " and more" : ""}.`;

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-xs text-muted">
          {kind === "chance"
            ? "Chance of selling at least 1 a week at a machine like this"
            : "How much more it sells here than the fleet average (1× = same)"}
          {rows.length > CHART_LIMIT && ` · chart shows the top ${CHART_LIMIT}, the table lists all ${rows.length}`}
        </p>
        <div role="img" aria-label={summary} style={{ height: bars.length * 30 + 44 }} className="w-full">
          <RecommendationChart rows={bars} kind={kind} />
        </div>
      </div>
      <RecommendationTable rows={rows} label={label} />
    </div>
  );
}

export function RecommendationResults({ result }) {
  const { meta, best_sellers: best, distinctive } = result;
  const [tab, setTab] = useState("best");
  const lowConfidence = meta.overall_confidence === "Low";

  const exportCsv = () => {
    const rows = [
      ...best.map((r) => ({ ...r, list: "Expected best-sellers" })),
      ...distinctive.map((r) => ({ ...r, list: "Distinctive for this site type" })),
    ];
    downloadCsv("new-site-recommendations.csv", toCsv(CSV_COLUMNS, rows));
  };

  const tabs = [
    { id: "best", label: "Expected best-sellers", count: best.length },
    { id: "distinctive", label: "Distinctive for this site type", count: distinctive.length },
  ];

  return (
    <div className="space-y-4">
      {lowConfidence && (
        <div role="alert" className="status-warn rounded-2xl p-4">
          <p className="font-semibold">Low confidence: {meta.similar_training_sites === 0 ? "no similar sites yet" : "very few similar sites"}</p>
          <p className="mt-0.5 text-sm">{meta.warning ?? "Few or no similar sites: these are general fleet suggestions."}</p>
        </div>
      )}

      <p className="text-sm text-muted">
        Results for <span className="font-medium text-foreground">{meta.categories.join(" + ")}</span>
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon={MachineIcon} label="Similar sites" value={formatWhole(meta.similar_training_sites)} caption="Sites SmartStock learned from" tone="purple" />
        <StatCard icon={InfoIcon} label="Overall confidence" value={meta.overall_confidence} caption="Based on how many similar sites" tone={lowConfidence ? "amber" : "green"} />
        <StatCard
          icon={DrinkIcon}
          label="Drinks share"
          value={`${Math.round(meta.drink_share * 100)}%`}
          caption={`Fleet average ${Math.round(meta.fleet_drink_share * 100)}%`}
          tone="blue"
        />
      </div>

      <section className="grid gap-4 rounded-2xl border border-border bg-surface p-5 sm:grid-cols-2 sm:items-center">
        <div>
          <h2 className="text-base font-semibold">Machine suggestion</h2>
          <p className="mt-1 text-sm">{meta.machine_hint}</p>
          <p className="mt-2 text-xs text-muted">Method: {meta.method}</p>
        </div>
        <div role="img" aria-label={`Drinks are ${Math.round(meta.drink_share * 100)}% of sales at this site type, against ${Math.round(meta.fleet_drink_share * 100)}% across the fleet.`} className="h-24 w-full">
          <MixChart siteShare={meta.drink_share} fleetShare={meta.fleet_drink_share} />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Recommendation lists" className="flex overflow-hidden rounded-lg border border-border">
            {tabs.map((t) => (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                role="tab"
                type="button"
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring ${
                  tab === t.id ? "bg-primary text-primary-foreground" : "text-muted hover:bg-background hover:text-foreground"
                }`}
              >
                {t.label} <span className="opacity-80">({t.count})</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={exportCsv}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-background focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            Export CSV
          </button>
        </div>

        <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-4">
          {tab === "best" ? (
            <ListPanel rows={best} kind="chance" label="Expected best-sellers" emptyMessage="No products to show." />
          ) : (
            <ListPanel
              rows={distinctive}
              kind="lift"
              label="Distinctive for this site type"
              emptyMessage="No distinctive products yet: there are not enough similar sites to say what stands out."
            />
          )}
        </div>
      </section>

      <p className="text-xs text-muted">
        Suggestions only. Once the machine has a few weeks of sales, use the machine forecasts (App 2a/2b). Cashless
        sales only, at current prices.
      </p>
    </div>
  );
}
