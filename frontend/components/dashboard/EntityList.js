"use client";

import { useMemo, useState } from "react";
import { EmptyRows, filterRows, ListHead, ListRow, SearchBox } from "@/components/dashboard/ListParts";
import { ListModal } from "@/components/dashboard/ListModal";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";

const PAGE_SIZES = [5, 10, 20, 50];

/**
 * Searchable, paginated table with a "Show N" page-size choice and a "View all" popup.
 * Used for products (warehouse, machine) and machines.
 */
export function EntityList({
  title,
  subtitle,
  noun,
  modalTitle,
  modalSubtitle,
  searchPlaceholder,
  rows,
  columns,
  gridClass,
  keyOf,
  hrefOf,
  searchText,
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => filterRows(rows, searchText, query), [rows, searchText, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const first = current * pageSize;
  const visible = filtered.slice(first, first + pageSize);

  const pageButton =
    "flex size-9 items-center justify-center rounded-xl border border-border bg-surface-2/70 hover:border-primary/60 " +
    "focus-visible:outline-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border";

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
        <SearchBox
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(0);
          }}
          placeholder={searchPlaceholder}
          className="w-full sm:w-72"
        />
      </div>

      <div role="table" aria-label={title} className="mt-4 overflow-x-auto">
        <ListHead columns={columns} gridClass={gridClass} />
        <div role="rowgroup">
          {filtered.length === 0 ? (
            <EmptyRows
              query={query}
              onClear={() => {
                setQuery("");
                setPage(0);
              }}
            />
          ) : (
            visible.map((row) => (
              <ListRow key={keyOf(row)} row={row} columns={columns} gridClass={gridClass} href={hrefOf(row)} />
            ))
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <label className="flex items-center gap-2 text-muted">
          Show
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
            className="rounded-xl border border-border bg-surface-2/70 px-3 py-2 text-foreground focus:outline-2 focus:outline-focus-ring"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {noun}
          <span className="hidden tabular-nums md:inline" aria-live="polite">
            · {filtered.length === 0 ? "0" : `${first + 1}–${first + visible.length}`} of {filtered.length}
          </span>
        </label>

        <div className="flex items-center gap-2">
          <button type="button" className={pageButton} onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Previous page">
            <ChevronLeftIcon className="size-4" />
          </button>
          <span className="min-w-14 text-center tabular-nums text-muted">
            {current + 1} / {pageCount}
          </span>
          <button type="button" className={pageButton} onClick={() => setPage(current + 1)} disabled={current >= pageCount - 1} aria-label="Next page">
            <ChevronRightIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="ml-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            View all
          </button>
        </div>
      </div>

      {showAll && (
        <ListModal
          title={modalTitle}
          subtitle={modalSubtitle}
          rows={rows}
          columns={columns}
          gridClass={gridClass}
          hrefOf={hrefOf}
          keyOf={keyOf}
          searchText={searchText}
          searchPlaceholder={searchPlaceholder}
          onClose={() => setShowAll(false)}
        />
      )}
    </section>
  );
}
