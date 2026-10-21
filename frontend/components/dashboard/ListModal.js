"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyRows, filterRows, ListHead, ListRow, SearchBox } from "@/components/dashboard/ListParts";
import { CloseIcon } from "@/components/ui/icons";

/** "View all" popup: every row in one scrollable list, with its own search. */
export function ListModal({ title, subtitle, rows, columns, gridClass, hrefOf, keyOf, searchText, searchPlaceholder, onClose }) {
  const dialogRef = useRef(null);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterRows(rows, searchText, query), [rows, searchText, query]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="list-modal-title"
      onClose={onClose}
      // Clicking the dimmed backdrop (the dialog element itself) closes it.
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="m-auto h-[min(85dvh,760px)] w-[min(980px,calc(100vw-1.5rem))] flex-col rounded-3xl border border-border bg-surface p-0 text-foreground shadow-2xl open:flex backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-5">
        <div className="min-w-0 flex-1">
          <h2 id="list-modal-title" className="text-lg font-semibold">
            {title}
          </h2>
          <p className="text-xs text-muted">
            {filtered.length} of {rows.length} · {subtitle}
          </p>
        </div>
        <SearchBox value={query} onChange={setQuery} placeholder={searchPlaceholder} className="order-last w-full sm:order-none sm:w-64" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-xl p-2 text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          <CloseIcon className="size-5" />
        </button>
      </div>

      <div role="table" aria-label={title} className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-4">
        <ListHead columns={columns} gridClass={gridClass} />
        <div role="rowgroup" className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <EmptyRows query={query} onClear={() => setQuery("")} />
          ) : (
            filtered.map((row) => (
              <ListRow key={keyOf(row)} row={row} columns={columns} gridClass={gridClass} href={hrefOf(row)} />
            ))
          )}
        </div>
      </div>
    </dialog>
  );
}
