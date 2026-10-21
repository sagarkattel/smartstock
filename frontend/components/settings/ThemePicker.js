"use client";

import { useSyncExternalStore } from "react";
import { CheckIcon } from "@/components/ui/icons";
import { THEMES, THEME_EVENT, getStoredTheme, saveTheme } from "@/lib/theme";

function subscribe(callback) {
  window.addEventListener(THEME_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(THEME_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/** A tiny picture of the theme: page, card and accent colours. */
function Preview({ colors }) {
  const pane = (c) => (
    <div className="flex h-full flex-1 flex-col gap-1.5 p-3" style={{ background: c.bg }}>
      <div className="h-2 w-10 rounded-full" style={{ background: c.accent }} />
      <div className="flex-1 rounded-lg p-2" style={{ background: c.surface }}>
        <div className="h-1.5 w-12 rounded-full" style={{ background: c.text, opacity: 0.8 }} />
        <div className="mt-1.5 h-1.5 w-8 rounded-full" style={{ background: c.text, opacity: 0.35 }} />
      </div>
    </div>
  );
  if (!colors) {
    // "Match my device": half dark, half light
    return (
      <div className="flex h-24 overflow-hidden rounded-xl border border-border">
        {pane(THEMES[0].colors)}
        {pane(THEMES[1].colors)}
      </div>
    );
  }
  return <div className="flex h-24 overflow-hidden rounded-xl border border-border">{pane(colors)}</div>;
}

export function ThemePicker() {
  const current = useSyncExternalStore(subscribe, getStoredTheme, () => "dark");

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold">Theme</h2>
      <p className="mt-1 text-sm text-muted">Choose how SmartStock looks. This is remembered on this device.</p>

      <div role="radiogroup" aria-label="Theme" className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {THEMES.map((theme) => {
          const selected = current === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => saveTheme(theme.id)}
              className={`rounded-2xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
              }`}
            >
              <Preview colors={theme.colors} />
              <span className="mt-3 flex items-center justify-between gap-2">
                <span>
                  <span className="block text-sm font-semibold">{theme.name}</span>
                  <span className="block text-xs text-muted">{theme.description}</span>
                </span>
                {selected && (
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <CheckIcon className="size-4" />
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
