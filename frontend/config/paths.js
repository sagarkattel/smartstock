import { machineSlug, slugify } from "@/lib/slug";

/**
 * Central path configuration (spec §0, §4).
 * Components MUST import paths from here and never hard-code them.
 *
 * TODO(spec): the team chooses the final page URLs. In the App Router a page's
 * URL also comes from its folder under app/, so keep the two in step.
 */
export const pagePaths = {
  home: "/",
  login: "/login",
  warehouse: "/warehouse",
  machines: "/machines",
  newInstallations: "/new-installations",
  settings: "/settings",
  settingsGeneral: "/settings/general",
  settingsAppearance: "/settings/appearance",
  settingsProfile: "/settings/profile",
};

/**
 * Detail pages use readable slugs: /warehouse/mount-everest-water, /machines/castle-hill-tafe-100900,
 * /machines/castle-hill-tafe-100900/bueno. The real names are found again by looking the slug up in the
 * lists (see lib/resolve.js), so the address never needs encoding.
 */
export function productPath(item) {
  return `${pagePaths.warehouse}/${slugify(item)}`;
}

export function machinePath(assetId, location) {
  return `${pagePaths.machines}/${machineSlug(assetId, location)}`;
}

export function machineProductPath(assetId, location, item) {
  return `${machinePath(assetId, location)}/${slugify(item)}`;
}

/** Next.js server-side routes that the browser calls (never the backend directly). */
export const apiPaths = {
  signIn: "/api/auth/sign-in",
  signOut: "/api/auth/sign-out",
  // The browser only talks to this proxy; it forwards to the FastAPI backend with the session token.
  backend: "/api/backend",
};

/** Pages reachable without a session. */
export const publicPagePaths = [pagePaths.login];

/**
 * Only allow same-site relative paths as a post-login destination,
 * so `?next=` cannot be used as an open redirect.
 */
export function safeNextPath(next) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return pagePaths.home;
  }
  if (publicPagePaths.includes(next.split("?")[0])) return pagePaths.home;
  return next;
}
