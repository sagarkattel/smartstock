import "server-only";

// Server-only settings. Never prefix these with NEXT_PUBLIC_.
export const serverEnv = {
  // Where the FastAPI backend runs, including its prefix (see the backend README: SMARTSTOCK_API_URL).
  apiUrl: (process.env.SMARTSTOCK_API_URL ?? "http://localhost:8000/api/v1").replace(/\/+$/, ""),
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "smartstock_session",
  // Used only if the backend does not say when the token expires.
  sessionMaxAgeSeconds: Number(process.env.SESSION_MAX_AGE_SECONDS ?? 60 * 60 * 12),
};
