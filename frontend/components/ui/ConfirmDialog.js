"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "Are you sure?" dialog for actions that change things (spec §13): says what will change, then
 * runs `onConfirm`. Shows the error if it fails and stays open.
 */
export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onClose }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e.message ?? "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onClose();
      }}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-3xl border border-border bg-surface p-6 text-foreground shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <h2 id="confirm-title" className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 space-y-2 text-sm text-muted">{children}</div>
      {error && <p role="alert" className="mt-3 rounded-xl bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus-ring disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60"
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
