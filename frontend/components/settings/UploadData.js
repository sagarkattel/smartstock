"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { UploadReportView } from "@/components/settings/UploadReportView";
import { FileIcon, UploadIcon } from "@/components/ui/icons";
import { ErrorBlock } from "@/components/ui/StateViews";
import { formatBytes } from "@/lib/format";
import { notify } from "@/lib/notify";
import { useJobs, useRetrain, useUploadTicket } from "@/lib/queries";
import { uploadFiles } from "@/lib/upload";

const MAX_FILES = 10;
const MAX_MB = 50;

/** Client-side checks before sending (the backend checks again): .xlsx only, size and count. */
function checkFiles(files) {
  if (files.length > MAX_FILES) return `Choose at most ${MAX_FILES} files.`;
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith(".xlsx")) return `“${f.name}” is not an .xlsx file.`;
    if (f.size > MAX_MB * 1024 * 1024) return `“${f.name}” is larger than ${MAX_MB} MB.`;
  }
  return null;
}

export function UploadData() {
  const queryClient = useQueryClient();
  const ticket = useUploadTicket();
  const retrain = useRetrain();
  const jobs = useJobs();
  const inputRef = useRef(null);

  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(null); // null = not uploading, 0..1 while sending
  const [report, setReport] = useState(null);
  const [problem, setProblem] = useState(null);

  const training = jobs.data?.jobs.some((j) => ["queued", "running"].includes(j.status)) ?? false;

  const choose = (list) => {
    const chosen = Array.from(list);
    setReport(null);
    setProblem(checkFiles(chosen) ? { message: checkFiles(chosen) } : null);
    setFiles(chosen);
  };

  const upload = async () => {
    setProblem(null);
    setReport(null);
    setProgress(0);
    try {
      const { upload_url: url } = await ticket.mutateAsync();
      setReport(await uploadFiles(url, files, setProgress));
    } catch (error) {
      setProblem(error);
    } finally {
      setProgress(null);
    }
  };

  const startRetrain = async (mode) => {
    setProblem(null);
    try {
      await retrain.mutateAsync({ upload_id: report.upload_id, mode });
      await queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
      notify(mode === "quick" ? "Quick update started." : "Full retrain started.");
      document.getElementById("retraining")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setProblem(error);
    }
  };

  const invalid = Boolean(checkFiles(files));
  const busy = progress !== null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold">Upload new sales data</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Add the latest sales so forecasts can be based on what has really sold. Upload{" "}
        <span className="text-foreground">CashlessSalesAnalysis-&lt;year&gt;.xlsx</span> (sheet “Item”) and{" "}
        <span className="text-foreground">CashlessMachines.xlsx</span>. A sales file replaces the file for the same year, so upload the
        full-year export. Nothing changes for anyone until you retrain and then switch to the new model.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          choose(e.dataTransfer.files);
        }}
        className={`mt-4 flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
          dragging ? "border-primary bg-primary/10" : "border-border bg-surface-2/40"
        }`}
      >
        <UploadIcon className="size-8 text-muted" />
        <p className="text-sm">Drag Excel files here, or</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm font-medium hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-focus-ring disabled:opacity-50"
        >
          Choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".xlsx"
          className="sr-only"
          aria-label="Choose Excel files to upload"
          onChange={(e) => {
            choose(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="text-xs text-muted">.xlsx only · up to {MAX_FILES} files · {MAX_MB} MB each</p>
      </div>

      {files.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
          {files.map((f) => (
            <li key={f.name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <FileIcon className="size-5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
              <span className="text-xs tabular-nums text-muted">{formatBytes(f.size)}</span>
            </li>
          ))}
        </ul>
      )}

      {problem && <ErrorBlock error={problem} title="Could not use these files" className="mt-4" />}

      {files.length > 0 && !report && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={upload}
            disabled={busy || invalid}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Upload and check"}
          </button>
          {busy && (
            <div className="min-w-48 flex-1">
              <div role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">{progress >= 1 ? "Checking the files…" : `${Math.round(progress * 100)}% sent`}</p>
            </div>
          )}
        </div>
      )}

      {report && (
        <div className="mt-5 space-y-5 border-t border-border pt-5">
          <h3 className="text-sm font-semibold">Check before training</h3>
          <UploadReportView report={report} />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => startRetrain("quick")}
              disabled={!report.can_train || training || retrain.isPending}
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              Quick update (about 3 min)
            </button>
            <button
              type="button"
              onClick={() => startRetrain("full")}
              disabled={!report.can_train || training || retrain.isPending}
              className="rounded-xl border border-border bg-surface-2 px-5 py-2.5 text-sm font-semibold hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              Full retrain (about 20 min)
            </button>
            <button
              type="button"
              onClick={() => {
                setReport(null);
                setFiles([]);
              }}
              className="rounded-xl px-3 py-2.5 text-sm text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              Start over
            </button>
            {training && <p className="text-xs text-muted">A retraining job is already running.</p>}
          </div>
          <p className="text-xs text-muted">
            Quick update reuses the settings already found by the last full retrain; a full retrain searches for them again.
            Either way, the result is a new model version that you can compare and then switch to below.
          </p>
        </div>
      )}
    </section>
  );
}
