"use client";

import { ErrorBlock, LoadingBlock } from "@/components/ui/StateViews";
import { useMeta } from "@/lib/queries";

/**
 * Loads the system information (/meta) once and gives it to the screen. While it loads, or if it
 * fails, or the sales data is too old to forecast from, it shows that instead of an empty screen.
 */
export function WithMeta({ children }) {
  const meta = useMeta();

  if (meta.isPending) return <LoadingBlock label="Loading" className="mt-5 h-96" />;
  if (meta.isError) {
    return <ErrorBlock error={meta.error} onRetry={() => meta.refetch()} title="Could not reach SmartStock" className="mt-5" />;
  }
  if (meta.data.max_horizon_weeks < 1) {
    return (
      <ErrorBlock
        error={{ code: "data_too_old" }}
        title={`Sales data is ${meta.data.data_age_weeks} weeks old`}
        className="mt-5"
      />
    );
  }
  return children(meta.data);
}
