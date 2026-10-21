import { NextResponse } from "next/server";
import { pagePaths, publicPagePaths } from "@/config/paths";

// Middleware runs on the Edge runtime, so it reads the env var directly
// rather than importing the server-only env module.
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "smartstock_session";

/**
 * Session check on the server before any protected screen renders (spec §3).
 * TODO(spec): the token is validated by the backend on each data request; an
 * expired token is handled there (clear cookie, return to Login).
 */
export function middleware(request) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = publicPagePaths.includes(pathname);

  if (!hasSession && !isPublic) {
    const loginUrl = new URL(pagePaths.login, request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (hasSession && pathname === pagePaths.login) {
    return NextResponse.redirect(new URL(pagePaths.home, request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Everything except API routes, Next.js internals and static asset files. Only real asset
  // extensions are skipped: product names contain dots (e.g. "41.5G") and must stay protected.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpe?g|gif|webp|ico|css|js|map|txt|woff2?)$).*)",
  ],
};
