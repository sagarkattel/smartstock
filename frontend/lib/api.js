import { apiPaths, pagePaths } from "@/config/paths";

/** An error from the backend (or the network), in the backend's { detail, code } shape. */
export class ApiError extends Error {
  constructor(message, { status = 0, code = "unknown" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

let leavingForLogin = false;

async function request(path, options) {
  let response;
  try {
    response = await fetch(`${apiPaths.backend}${path}`, options);
  } catch {
    throw new ApiError("Could not reach SmartStock. Check your connection and try again.", { code: "network_error" });
  }

  const json = await response.json().catch(() => null);

  if (response.status === 401) {
    // Session expired or missing: back to Login, then back to this screen (spec §9.4).
    if (!leavingForLogin) {
      leavingForLogin = true;
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`${pagePaths.login}?next=${encodeURIComponent(next)}`);
    }
    throw new ApiError(json?.detail ?? "Please sign in again.", { status: 401, code: json?.code ?? "not_authenticated" });
  }
  if (!response.ok) {
    throw new ApiError(json?.detail ?? "Something went wrong. Try again.", {
      status: response.status,
      code: json?.code ?? "unknown",
    });
  }
  return json;
}

function withQuery(path, params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

export function apiGet(path, params) {
  return request(withQuery(path, params));
}

export function apiPost(path, body) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function apiPut(path, body) {
  return request(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
