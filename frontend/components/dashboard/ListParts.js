import Link from "next/link";
import { SearchIcon } from "@/components/ui/icons";

export const ROW_HEIGHT = 60;

function cellClass(column) {
  return [
    column.hideOnMobile ? "hidden sm:block" : "",
    column.align === "right" ? "text-right tabular-nums" : "",
    column.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function ListHead({ columns, gridClass }) {
  return (
    <div
      role="row"
      className={`${gridClass} h-10 rounded-xl bg-surface-2/70 text-[11px] font-semibold uppercase tracking-wide text-muted`}
    >
      {columns.map((column) => (
        <span
          key={column.key}
          role="columnheader"
          title={column.fullHeader}
          className={cellClass({ ...column, className: "" })}
        >
          {column.header}
        </span>
      ))}
    </div>
  );
}

export function ListRow({ row, columns, gridClass, href }) {
  return (
    <Link
      href={href}
      role="row"
      style={{ height: ROW_HEIGHT }}
      className={`${gridClass} border-b border-border/70 text-sm transition-colors last:border-b-0 hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring`}
    >
      {columns.map((column) => (
        <span key={column.key} role="cell" className={cellClass(column)}>
          {column.render(row)}
        </span>
      ))}
    </Link>
  );
}

export function SearchBox({ value, onChange, placeholder, className = "" }) {
  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">{placeholder}</span>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-xl border border-border bg-surface-2/70 py-2.5 pr-3 pl-10 text-sm placeholder:text-muted focus:outline-2 focus:outline-focus-ring"
      />
    </label>
  );
}

export function EmptyRows({ query, onClear }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-sm">
      <p className="text-muted">No results match “{query.trim()}”.</p>
      <button
        type="button"
        onClick={onClear}
        className="rounded-lg px-3 py-1.5 font-medium text-primary-hover hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring"
      >
        Clear search
      </button>
    </div>
  );
}

export function filterRows(rows, searchText, query) {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((row) => searchText(row).toLowerCase().includes(q)) : rows;
}
