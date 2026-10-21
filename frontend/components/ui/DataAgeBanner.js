import { formatDate } from "@/lib/format";

/** Spec §7.4: normal under 4 weeks, warning 4–8, critical over 8. `meta` is the backend's /meta. */
export function DataAgeBanner({ meta, className = "" }) {
  const weeks = meta.data_age_weeks;
  const tone = weeks < 4 ? "ok" : weeks <= 8 ? "warn" : "crit";
  // TODO(spec): the critical state links to Upload data once the Administration screens exist.
  return (
    <p
      role="status"
      className={`status-${tone} inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${className}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      Sales data up to {formatDate(meta.data_end)} ({weeks} {weeks === 1 ? "week" : "weeks"} old)
    </p>
  );
}
