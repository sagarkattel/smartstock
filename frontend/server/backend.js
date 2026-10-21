import "server-only";
import { serverEnv } from "./env";

/** Calls the FastAPI backend. Returns { status, body } where body is parsed JSON (or null). */
export async function callBackend(path, { method = "GET", token, body, search = "" } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${serverEnv.apiUrl}${path}${search}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return {
      status: 503,
      body: { detail: "The SmartStock service is unavailable. Try again shortly.", code: "backend_unavailable" },
    };
  }

  const json = await response.json().catch(() => null);
  return { status: response.status, body: json };
}
