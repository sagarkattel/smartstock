import { AlertIcon, CheckIcon, FileIcon } from "@/components/ui/icons";
import { formatDate, formatPercent, formatWhole } from "@/lib/format";

function Stat({ label, value, hint }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2/70 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function MachineList({ label, ids }) {
  if (ids.length === 0) return null;
  return (
    <details className="rounded-xl bg-surface-2/70 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">
        {formatWhole(ids.length)} {label}
      </summary>
      <p className="mt-2 break-words text-xs text-muted">{ids.join(", ")}</p>
    </details>
  );
}

/** The validation report for an uploaded set of files (spec §8.12): shown before any retraining. */
export function UploadReportView({ report }) {
  const sales = report.files.filter((f) => f.date_min);
  const dateMin = sales.map((f) => f.date_min).sort()[0];
  const dateMax = sales.map((f) => f.date_max).sort().at(-1);
  const dropped = report.dropped;

  return (
    <div className="space-y-4">
      <div role="status" className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ${report.can_train ? "status-ok" : "status-crit"}`}>
        {report.can_train ? <CheckIcon className="size-4" /> : <AlertIcon className="size-4" />}
        {report.can_train ? "The files look good. You can retrain now." : "These files cannot be used yet. Fix the problems below and upload again."}
      </div>

      {report.errors.length > 0 && (
        <ul className="space-y-1.5 rounded-xl border border-danger/40 bg-danger-surface p-4 text-sm text-danger">
          {report.errors.map((e) => (
            <li key={e} className="flex gap-2"><AlertIcon className="mt-0.5 size-4 shrink-0" />{e}</li>
          ))}
        </ul>
      )}
      {report.warnings.length > 0 && (
        <ul className="status-warn space-y-1.5 rounded-xl p-4 text-sm">
          {report.warnings.map((w) => (
            <li key={w} className="flex gap-2"><AlertIcon className="mt-0.5 size-4 shrink-0" />{w}</li>
          ))}
        </ul>
      )}

      {report.files.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {report.files.map((f) => (
            <li key={f.name} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <FileIcon className="size-5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate font-medium" title={f.name}>{f.name}</span>
              <span className="text-xs text-muted">{f.kind}</span>
              <span className="text-xs tabular-nums text-muted">{formatWhole(f.rows)} rows</span>
              {f.date_min && <span className="text-xs text-muted">{formatDate(f.date_min)} – {formatDate(f.date_max)}</span>}
              {f.replaces_existing && <span className="status-warn rounded-full px-2 py-0.5 text-xs">replaces the current {f.kind.replace("sales ", "")} file</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {dateMin && <Stat label="New data covers" value={`${formatDate(dateMin)} – ${formatDate(dateMax)}`} />}
        <Stat
          label="Compared with current data"
          value={report.overlap_weeks > 0 ? `${report.overlap_weeks} week(s) overlap` : report.gap_weeks > 0 ? `${report.gap_weeks} week(s) gap` : "Continues straight on"}
          hint={report.overlap_weeks > 0 ? "Overlapping weeks are replaced by the new files" : undefined}
        />
        <Stat label="Sales without a product name" value={report.unnamed_share === null ? "—" : formatPercent(report.unnamed_share)} />
        <Stat
          label="Rows left out"
          value={formatWhole(dropped.duplicates + dropped.partial_weeks + dropped.warehouse_test_vends)}
          hint={`${formatWhole(dropped.duplicates)} duplicates, ${formatWhole(dropped.partial_weeks)} incomplete week, ${formatWhole(dropped.warehouse_test_vends)} warehouse tests`}
        />
      </div>

      <div className="space-y-2">
        <MachineList label="new machine(s)" ids={report.machines.new} />
        <MachineList label="machine(s) with no recent sales" ids={report.machines.removed} />
        <MachineList label="machine(s) that changed location" ids={report.machines.relocated} />
      </div>
    </div>
  );
}
