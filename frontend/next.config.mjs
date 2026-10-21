import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const isDev = process.env.NODE_ENV !== "production";

// File uploads go from the browser straight to the backend (one-time upload link), so its address
// must be allowed in connect-src. It comes from the same setting the server uses.
function backendOrigin() {
  try {
    return new URL(process.env.SMARTSTOCK_API_URL ?? "http://localhost:8000/api/v1").origin;
  } catch {
    return "";
  }
}

// Security headers (spec §13). Next.js injects inline scripts, hence 'unsafe-inline'.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${backendOrigin()}${isDev ? " ws:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Lets a second dev server (e.g. for testing) use its own build folder: NEXT_DIST_DIR=.next-test
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Pin the project root (a stray lockfile in the home folder confuses detection).
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
