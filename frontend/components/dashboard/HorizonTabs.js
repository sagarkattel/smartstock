"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarIcon, ChevronDownIcon } from "@/components/ui/icons";
import { allowedHorizons, defaultHorizon, horizonCaption, horizonLimitNote } from "@/lib/horizon";

/** Granularity (weeks / months) and how far ahead, in one state. */
export function useHorizon(meta) {
  const [choice, setChoice] = useState(() => ({ granularity: "week", horizon: defaultHorizon("week", meta) }));
  return {
    granularity: choice.granularity,
    horizon: choice.horizon,
    select: (granularity, horizon) => setChoice({ granularity, horizon }),
  };
}

/** The dropdown at the top right of each screen: "Next 4 weeks · 5 Oct 2026 – 1 Nov 2026". */
export function PeriodSelect({ meta, granularity, horizon, rangeText, onSelect }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groups = [
    { title: "Weeks", granularities: ["week"] },
    { title: "Months", granularities: ["month", "nextmonth"] },
  ].map((g) => ({
    title: g.title,
    options: g.granularities.flatMap((granularity) => allowedHorizons(granularity, meta).map((count) => ({ granularity, count }))),
    note: g.granularities.map((granularity) => horizonLimitNote(granularity, meta)).find(Boolean) ?? null,
  }));

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-60 items-center gap-3 rounded-2xl border border-border bg-surface-2/80 px-4 py-3 text-left backdrop-blur hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-focus-ring"
      >
        <CalendarIcon className="size-6 shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{horizonCaption(granularity, horizon)}</span>
          <span className="block truncate text-xs text-muted">{rangeText ?? "Loading…"}</span>
        </span>
        <ChevronDownIcon className={`size-5 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Forecast period"
          className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-surface p-2 shadow-2xl shadow-black/50"
        >
          {groups.map((group) => (
            <div key={group.title} className="py-1">
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">{group.title}</p>
              {group.options.map(({ granularity: optionGranularity, count }) => {
                const selected = optionGranularity === granularity && count === horizon;
                return (
                  <button
                    key={`${optionGranularity}-${count}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onSelect(optionGranularity, count);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-focus-ring ${
                      selected ? "bg-primary text-primary-foreground" : "hover:bg-surface-2"
                    }`}
                  >
                    {horizonCaption(optionGranularity, count)}
                  </button>
                );
              })}
              {group.note && <p className="px-3 pt-1 text-xs text-muted">{group.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
