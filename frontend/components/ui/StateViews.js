"use client";

import Link from "next/link";
import { pagePaths } from "@/config/paths";

/** Loading, error, empty and not-found views for data screens (spec §12). */
export function LoadingBlock({ label = "Loading…", className = "" }) {
  return (
    <div role="status" aria-label={label} className={`animate-pulse rounded-2xl bg-border/50 ${className}`}>
      <span className="sr-only">{label}</span>
    </div>
  );
}

function friendlyMessage(error) {
  if (error?.code === "data_too_old") {
    return "The sales data is too old to forecast from. Upload newer sales data and retrain the models.";
  }
  if (error?.code === "models_not_loaded") {
    return "The forecasting models are still loading. Wait a few seconds and try again.";
  }
  return error?.message ?? "Something went wrong. Try again.";
}

export function ErrorBlock({ error, onRetry, title = "Could not load this", className = "" }) {
  return (
    <div role="alert" className={`rounded-2xl border border-danger/40 bg-danger-surface p-5 ${className}`}>
      <p className="font-semibold text-danger">{title}</p>
      <p className="mt-1 text-sm text-danger">{friendlyMessage(error)}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg bg-danger px-4 py-1.5 text-sm font-semibold text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/** Shows a query's data once it has it, otherwise its loading or error state. */
export function Loadable({ query, label = "Loading", className = "h-72", children }) {
  if (query.data) return children(query.data);
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => query.refetch()} />;
  return <LoadingBlock label={label} className={className} />;
}

/** A titled card that shows a query's loading or error state in place of its content. */
export function StatePanel({ query, title, className = "" }) {
  return (
    <section className={`flex min-h-0 flex-col rounded-2xl border border-border bg-surface p-5 ${className}`}>
      <h2 className="text-base font-semibold">{title}</h2>
      {query.isError ? (
        <ErrorBlock error={query.error} onRetry={() => query.refetch()} className="mt-3" />
      ) : (
        <LoadingBlock label={`Loading ${title}`} className="mt-3 min-h-0 flex-1" />
      )}
    </section>
  );
}

export function NotFoundView({ title, message, backHref, backLabel }) {
  return (
    <main className="mx-auto flex max-w-lg flex-col items-center gap-3 px-4 py-20 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted">{message}</p>
      <Link
        href={backHref ?? pagePaths.home}
        className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        {backLabel ?? "Back to Home"}
      </Link>
    </main>
  );
}
