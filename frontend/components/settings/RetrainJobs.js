"use client";

import { useQueryClient } from "@tanstack/react-query";
import { PromoteButton } from "@/components/settings/PromoteButton";
import { CheckIcon, AlertIcon, RefreshIcon } from "@/components/ui/icons";
import { ErrorBlock, LoadingBlock } from "@/components/ui/StateViews";
import { formatDateTime, formatPercentPrecise } from "@/lib/format";
import { notify } from "@/lib/notify";
import { useJob, useJobs, useModelVersions, useRetrain } from "@/lib/queries";

const APP_NAMES = { app1: "Warehouse (App 1)", app2a: "Machine totals (App 2a)", app2b: "Products in machines (App 2b)" };
const VERDICT = { better: "Better", worse: "Worse", same: "Same" };

function StatusPill({ status }) {
  const tone = status === "succeeded" ? "status-ok" : status === "failed" ? "status-crit" : "badge-medium";
  const label = { queued: "Waiting", running: "Training", succeeded: "Finished", failed: "Failed" }[status] ?? status;
  return <span className={`${tone} rounded-full px-2.5 py-0.5 text-xs font-medium`}>{label}</span>;
}

function duration(seconds) {
  if (!seconds) return "";
  return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

function Comparison({ comparison }) {
  const apps = ["app1", "app2a", "app2b"];
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[30rem] text-sm">
        <caption className="sr-only">Forecast error of the new model compared with the model in use</caption>
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
            <th scope="col" className="px-4 py-2 text-left font-medium">Forecast</th>
            <th scope="col" className="px-4 py-2 text-right font-medium" title="Lower is better">Error now (WAPE)</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Error new model</th>
            <th scope="col" className="px-4 py-2 text-left font-medium">New vs now</th>
          </tr>
        </thead>
        <tbody>
          {apps.map((app) => {
            const row = comparison[app];
            return (
              <tr key={app} className="border-b border-border last:border-b-0">
                <th scope="row" className="px-4 py-2 text-left font-medium">{APP_NAMES[app]}</th>
                <td className="px-4 py-2 text-right tabular-nums text-muted">{formatPercentPrecise(row.wape_active)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatPercentPrecise(row.wape_new)}</td>
                <td className="px-4 py-2">{VERDICT[row.verdict] ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-border px-4 py-2 text-xs text-muted">{comparison.note}</p>
    </div>
  );
}

function JobPanel({ job, active }) {
  const queryClient = useQueryClient();
  const retrain = useRetrain();
  const running = ["queued", "running"].includes(job.status);

  const retry = async () => {
    try {
      await retrain.mutateAsync({ upload_id: job.upload_id, mode: job.mode });
      await queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
      notify("Retraining started again.");
    } catch (error) {
      notify(error.message, "error");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <StatusPill status={job.status} />
        <span className="font-medium">{job.mode === "quick" ? "Quick update" : "Full retrain"}</span>
        <span className="text-muted">Started {formatDateTime(job.started_at)}</span>
        {job.duration_seconds ? <span className="text-muted">Took {duration(job.duration_seconds)}</span> : null}
      </div>

      {running && (
        <div>
          <div className="mb-1.5 flex justify-between text-sm">
            <span>{job.step}</span>
            <span className="tabular-nums text-muted">{job.percent}%</span>
          </div>
          <div role="progressbar" aria-label="Retraining progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.percent} className="h-2.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${job.percent}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">You can leave this page. Training keeps running and this updates every 5 seconds.</p>
        </div>
      )}

      {job.status === "failed" && (
        <div role="alert" className="space-y-3 rounded-xl border border-danger/40 bg-danger-surface p-4 text-sm text-danger">
          <p className="flex items-start gap-2 font-medium"><AlertIcon className="mt-0.5 size-4 shrink-0" />{job.error ?? "Training failed."}</p>
          {job.upload_id && (
            <button
              type="button"
              onClick={retry}
              disabled={retrain.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-danger px-4 py-2 text-sm font-semibold text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60"
            >
              <RefreshIcon className="size-4" /> Retry with the same upload
            </button>
          )}
        </div>
      )}

      {job.status === "succeeded" && (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm font-medium text-[var(--positive)]">
            <CheckIcon className="size-4" /> New model version <span className="text-foreground">{job.result_version}</span> is ready.
          </p>
          {job.comparison && <Comparison comparison={job.comparison} />}
          {active === job.result_version ? (
            <p className="text-sm text-muted">This model is the one in use.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <PromoteButton version={job.result_version} primary />
              <p className="text-xs text-muted">Until you do this, everyone keeps seeing forecasts from the current model.</p>
            </div>
          )}
        </div>
      )}

      {job.log_tail?.length > 0 && (
        <details className="rounded-xl bg-surface-2/60 px-4 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Latest log lines</summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-muted">{job.log_tail.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}

export function RetrainJobs() {
  const jobs = useJobs();
  const models = useModelVersions();
  const latestId = jobs.data?.jobs[0]?.job_id;
  const latest = useJob(latestId);
  const earlier = jobs.data?.jobs.slice(1, 6) ?? [];

  return (
    <section id="retraining" className="scroll-mt-20 rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold">Retraining</h2>
      <p className="mt-1 text-sm text-muted">Teaches the forecasts about the sales you uploaded. The result is a new model version; it is only used once you switch to it.</p>

      <div className="mt-4">
        {jobs.isError ? (
          <ErrorBlock error={jobs.error} onRetry={() => jobs.refetch()} title="Could not load the retraining jobs" />
        ) : !jobs.data ? (
          <LoadingBlock label="Loading retraining jobs" className="h-24" />
        ) : !latestId ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">No retraining yet. Upload new data above, then choose Quick update or Full retrain.</p>
        ) : latest.isError ? (
          <ErrorBlock error={latest.error} onRetry={() => latest.refetch()} />
        ) : !latest.data ? (
          <LoadingBlock label="Loading the latest job" className="h-24" />
        ) : (
          <JobPanel job={latest.data} active={models.data?.active_version} />
        )}
      </div>

      {earlier.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Earlier jobs</h3>
          <ul className="mt-2 divide-y divide-border text-sm">
            {earlier.map((j) => (
              <li key={j.job_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                <StatusPill status={j.status} />
                <span>{j.mode === "quick" ? "Quick update" : "Full retrain"}</span>
                <span className="text-muted">{formatDateTime(j.started_at)}</span>
                {j.result_version && <span className="text-muted">→ {j.result_version}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
