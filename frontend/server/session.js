import "server-only";
import { serverEnv } from "./env";

/** The backend's token lives only in an httpOnly cookie set here (spec §3, §13). */
export function setSessionCookie(response, token, maxAgeSeconds) {
  response.cookies.set({
    name: serverEnv.sessionCookieName,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds > 0 ? maxAgeSeconds : serverEnv.sessionMaxAgeSeconds,
  });
}

export function clearSessionCookie(response) {
  response.cookies.set({
    name: serverEnv.sessionCookieName,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** The backend token from the session cookie, if there is one. */
export function getSessionToken(request) {
  return request.cookies.get(serverEnv.sessionCookieName)?.value ?? null;
}

/** CSRF protection for state-changing routes: the request must come from this origin. */
export function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
