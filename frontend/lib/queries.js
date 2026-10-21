"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "@/lib/api";

// Spec §11: forecasts stay fresh for 5 minutes, system information for 1 minute.
const FORECAST_STALE_MS = 5 * 60_000;
const META_STALE_MS = 60_000;

/** "nextmonth" asks the backend for months that start after the current one. */
function forecastParams(granularity, horizon) {
  return granularity === "nextmonth" ? { granularity: "month", horizon, skip_current: true } : { granularity, horizon };
}

// Keep the old numbers on screen while a new horizon loads, instead of flashing empty.
const forecastOptions = { staleTime: FORECAST_STALE_MS, placeholderData: keepPreviousData };

export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: () => apiGet("/meta"), staleTime: META_STALE_MS });
}

/** The signed-in user (name shown in the top bar). */
export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => apiGet("/auth/me"), staleTime: 10 * 60_000 });
}

// ---- App 1 (warehouse)
export function useApp1Products(granularity, horizon) {
  return useQuery({
    queryKey: ["app1", "products", granularity, horizon],
    queryFn: () => apiGet("/app1/products", { ...forecastParams(granularity, horizon) }),
    enabled: horizon >= 1,
    ...forecastOptions,
  });
}

export function useApp1Summary(granularity, horizon) {
  return useQuery({
    queryKey: ["app1", "summary", granularity, horizon],
    queryFn: () => apiGet("/app1/summary", { ...forecastParams(granularity, horizon) }),
    enabled: horizon >= 1,
    ...forecastOptions,
  });
}

export function useApp1Forecast(item, granularity, horizon) {
  return useQuery({
    queryKey: ["app1", "forecast", item, granularity, horizon],
    queryFn: () => apiGet("/app1/forecast", { item, ...forecastParams(granularity, horizon) }),
    enabled: horizon >= 1,
    ...forecastOptions,
  });
}

// ---- App 2a (machine totals)
export function useApp2aMachines(granularity, horizon) {
  return useQuery({
    queryKey: ["app2a", "machines", granularity, horizon],
    queryFn: () => apiGet("/app2a/machines", { ...forecastParams(granularity, horizon) }),
    enabled: horizon >= 1,
    ...forecastOptions,
  });
}

export function useApp2aSummary(granularity, horizon) {
  return useQuery({
    queryKey: ["app2a", "summary", granularity, horizon],
    queryFn: () => apiGet("/app2a/summary", { ...forecastParams(granularity, horizon) }),
    enabled: horizon >= 1,
    ...forecastOptions,
  });
}

export function useApp2aForecast(assetId, granularity, horizon) {
  return useQuery({
    queryKey: ["app2a", "forecast", assetId, granularity, horizon],
    queryFn: () => apiGet("/app2a/forecast", { asset_id: assetId, ...forecastParams(granularity, horizon) }),
    enabled: horizon >= 1,
    ...forecastOptions,
  });
}

// ---- App 2b (product breakdown): only for machines that record product names
export function useApp2bMachine(assetId, granularity, horizon, enabled = true) {
  return useQuery({
    queryKey: ["app2b", "machine", assetId, granularity, horizon],
    queryFn: () => apiGet("/app2b/machine", { asset_id: assetId, ...forecastParams(granularity, horizon) }),
    enabled: enabled && horizon >= 1,
    ...forecastOptions,
  });
}

// ---- App 3 (new sites)
export function useApp3Categories() {
  return useQuery({
    queryKey: ["app3", "categories"],
    queryFn: () => apiGet("/app3/categories"),
    staleTime: FORECAST_STALE_MS,
  });
}

export function useCategorize() {
  return useMutation({ mutationFn: (text) => apiPost("/app3/categorize", { text }) });
}

export function useRecommend() {
  return useMutation({ mutationFn: (request) => apiPost("/app3/recommend", request) });
}

// ---- Real sales and earlier-forecast accuracy (for the charts)
/**
 * Real sales for the charts: the whole fleet ("app1" = products, "app2a" = machines), or one machine
 * (`assetId`). Weekly: the last `count` weeks. Monthly: the last `count` complete months.
 */
export function useHistory(app, { granularity = "week", count, assetId } = {}) {
  const amount = count ?? (granularity === "week" ? 80 : 36);
  return useQuery({
    queryKey: ["history", app, assetId ?? null, granularity, amount],
    queryFn: () =>
      apiGet("/history/fleet", {
        app,
        asset_id: assetId,
        granularity,
        ...(granularity === "week" ? { weeks: amount } : { months: amount }),
      }),
    staleTime: FORECAST_STALE_MS,
  });
}

/**
 * Expected sales for weeks that have passed but have no real sales in the data yet (the gap between the
 * end of the data and the current week). Shown on the charts until newer sales are uploaded.
 */
export function useMissedForecast(app, assetId) {
  return useQuery({
    queryKey: ["forecast", "missed", app, assetId ?? null],
    queryFn: () => apiGet("/forecast/missed", { app, asset_id: assetId }),
    staleTime: FORECAST_STALE_MS,
  });
}

/** Earlier forecasts compared with the sales that have arrived since (empty until newer data is in). */
export function useAccuracy(app) {
  return useQuery({
    queryKey: ["accuracy", app],
    queryFn: () => apiGet("/admin/monitoring/accuracy", { app }),
    staleTime: FORECAST_STALE_MS,
  });
}

// ---- Data upload, retraining and model versions (Settings > General)
export function useUploadTicket() {
  return useMutation({ mutationFn: () => apiPost("/admin/upload-ticket", {}) });
}

export function useRetrain() {
  return useMutation({ mutationFn: (request) => apiPost("/admin/retrain", request) });
}

const RUNNING = ["queued", "running"];

export function useJobs() {
  return useQuery({
    queryKey: ["admin", "jobs"],
    queryFn: () => apiGet("/admin/jobs"),
    // Spec §8.13: refresh every 5 seconds while a job is running.
    refetchInterval: (query) => (query.state.data?.jobs.some((j) => RUNNING.includes(j.status)) ? 5000 : false),
  });
}

export function useJob(jobId) {
  return useQuery({
    queryKey: ["admin", "job", jobId],
    queryFn: () => apiGet(`/admin/jobs/${jobId}`),
    enabled: Boolean(jobId),
    refetchInterval: (query) => (!query.state.data || RUNNING.includes(query.state.data.status) ? 5000 : false),
  });
}

export function useModelVersions() {
  return useQuery({ queryKey: ["admin", "models"], queryFn: () => apiGet("/admin/models") });
}

export function usePromoteModel() {
  return useMutation({ mutationFn: (version) => apiPost(`/admin/models/${encodeURIComponent(version)}/promote`, {}) });
}

// ---- Profile
export function useUpdateProfile() {
  return useMutation({ mutationFn: (profile) => apiPut("/auth/profile", profile) });
}

export function useChangePassword() {
  return useMutation({ mutationFn: (passwords) => apiPost("/auth/password", passwords) });
}
