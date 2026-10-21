"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

// Retry only network and server errors; a 4xx (unknown machine, horizon too long, ...) will not change.
function shouldRetry(failureCount, error) {
  const status = error?.status ?? 0;
  return (status === 0 || status >= 500) && failureCount < 2;
}

export function QueryProvider({ children }) {
  // Created once per browser session (spec §11).
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: shouldRetry, refetchOnWindowFocus: false } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
