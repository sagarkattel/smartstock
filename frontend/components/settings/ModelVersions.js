"use client";

import { PromoteButton } from "@/components/settings/PromoteButton";
import { ErrorBlock, LoadingBlock } from "@/components/ui/StateViews";
import { formatDate, formatDateTime, formatPercentPrecise } from "@/lib/format";
import { useModelVersions } from "@/lib/queries";

function StatusBadge({ status }) {
  const tone = status === "active" ? "status-ok" : status === "candidate" ? "badge-medium" : "badge-low";
  const label = { active: "In use", candidate: "New", archived: "Older" }[status] ?? status;
  return <span className={`${tone} rounded-full px-2.5 py-0.5 text-xs font-medium`}>{label}</span>;
}

const VERDICT_TEXT = { better: "Better than the one in use", worse: "Worse than the one in use", same: "Same as the one in use" };

export function ModelVersions() {
  const models = useModelVersions();

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold">Model versions</h2>
      <p className="mt-1 text-sm text-muted">Every trained model is kept. Switch to a new one, or go back to an older one, at any time.</p>

      <div className="mt-4">
        {models.isError ? (
          <ErrorBlock error={models.error} onRetry={() => models.refetch()} title="Could not load the model versions" />
        ) : !models.data ? (
          <LoadingBlock label="Loading the model versions" className="h-32" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <caption className="sr-only">Trained model versions</caption>
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <th scope="col" className="py-2 pr-3 text-left font-medium">Version</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Trained</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Data until</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium" title="Forecast error: lower is better">Warehouse error</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Machine error</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Compared</th>
                  <th scope="col" className="py-2 pl-3 text-right font-medium"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {models.data.versions.map((v) => (
                  <tr key={v.version} className="border-b border-border last:border-b-0">
                    <th scope="row" className="py-3 pr-3 text-left font-medium">
                      <span className="block whitespace-nowrap">{v.version}</span>
                      <span className="mt-1 inline-flex items-center gap-2 text-xs font-normal text-muted">
                        <StatusBadge status={v.status} /> {v.mode === "quick" ? "Quick update" : v.mode === "imported" ? "Imported" : "Full retrain"}
                      </span>
                    </th>
                    <td className="px-3 py-3 text-muted">{formatDateTime(v.trained_at)}</td>
                    <td className="px-3 py-3 text-muted">{formatDate(v.data_end)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatPercentPrecise(v.metrics?.app1?.wape)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatPercentPrecise(v.metrics?.app2a?.wape)}</td>
                    <td className="px-3 py-3 text-xs text-muted">{v.status === "active" ? "—" : (VERDICT_TEXT[v.comparison?.verdict] ?? "Not compared")}</td>
                    <td className="py-3 pl-3 text-right">
                      {v.status === "active" ? (
                        <span className="text-xs text-muted">In use</span>
                      ) : (
                        <PromoteButton version={v.version} rollback={v.status === "archived"} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
