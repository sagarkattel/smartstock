"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { notify } from "@/lib/notify";
import { usePromoteModel } from "@/lib/queries";

/** "Make active" / "Roll back" for a model version, with a confirmation that says what changes (spec §8.14). */
export function PromoteButton({ version, rollback = false, primary = false }) {
  const queryClient = useQueryClient();
  const promote = usePromoteModel();
  const [open, setOpen] = useState(false);
  const label = rollback ? "Roll back to this version" : "Use this model";

  const confirm = async () => {
    await promote.mutateAsync(version);
    // Every number on screen may change with a new model, so refresh all of it.
    await queryClient.invalidateQueries();
    notify(`Now using model ${version}. Forecasts have been refreshed.`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`rounded-xl px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
          primary
            ? "bg-primary text-primary-foreground hover:bg-primary-hover"
            : "border border-border bg-surface-2 hover:border-primary/60"
        }`}
      >
        {label}
      </button>
      {open && (
        <ConfirmDialog title={rollback ? "Roll back to this model?" : "Use this model for all forecasts?"} confirmLabel={rollback ? "Roll back" : "Use this model"} onConfirm={confirm} onClose={() => setOpen(false)}>
          <p>
            Every screen (Warehouse, Machines and New Installations) will switch to <span className="font-medium text-foreground">{version}</span>.
            Forecasts, suggested stock and rankings may change.
          </p>
          <p>The current model is kept, so you can switch back at any time.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
