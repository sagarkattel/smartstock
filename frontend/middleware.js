
/**
 * Middleware Configuration for SmartStock
 *
 * This middleware protects private pages by checking
 * whether the user has a session cookie.
 *
 * Users without a session are redirected to the login page.
 * Logged-in users are redirected away from the login page.
 */

// Import NextResponse to control requests and redirects.
import { NextResponse } from "next/server";

// Import page routes and publicly accessible routes.
import { pagePaths, publicPagePaths } from "@/config/paths";

// Get the session cookie name from environment variables.
// Use "smartstock_session" if no name is configured.
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "smartstock_session";

/**
 * Middleware runs before matching page requests are processed.
 * It checks whether the user has a session cookie
 * and decides whether to allow access or redirect.
 */
export function middleware(request) {

  // Get the current page path and URL search parameters.
  const { pathname, search } = request.nextUrl;

  // Check whether the session cookie exists and has a value.
  // true = session cookie exists, false = no session cookie.
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  // Check whether the requested page is public.
  // Public pages can be accessed without logging in.
  const isPublic = publicPagePaths.includes(pathname);

  // If the user has no session and tries to access a protected page,
  // redirect them to the login page.
  if (!hasSession && !isPublic) {

    // Create the login page URL.
    const loginUrl = new URL(pagePaths.login, request.url);

    // Save the original requested URL in the "next" parameter.
    // This can be used to return the user after logging in.
    loginUrl.searchParams.set("next", `${pathname}${search}`);

    // Redirect the user to the login page.
    return NextResponse.redirect(loginUrl);
  }

  // If the user has a session and visits the login page,
  // redirect them to the home page.
  if (hasSession && pathname === pagePaths.login) {
    return NextResponse.redirect(new URL(pagePaths.home, request.url));
  }

  // Allow the request to continue if no redirect is needed.
  return NextResponse.next();
}

// Configure which routes should run this middleware.
export const config = {

  // Apply middleware to application pages.
  // Exclude API routes, Next.js internal files, and static assets.
  // Paths containing dots are still protected unless they end
  // with one of the excluded file extensions.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpe?g|gif|webp|ico|css|js|map|txt|woff2?)$).*)",
  ],
};
