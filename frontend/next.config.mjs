
/**
 * Next.js Configuration for SmartStock
 *
 * This file configures the application build settings,
 * backend connections, and security headers.
 *
 * It helps improve application security and ensures
 * the frontend can communicate with the backend.
 */

// Import utilities to work with file and directory paths.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Check whether the application is running in development mode.
// true = development, false = production.
const isDev = process.env.NODE_ENV !== "production";

/**
 * Get the backend server address.
 *
 * This allows the frontend to communicate directly with the backend,
 * including uploading files using one-time upload links.
 */
function backendOrigin() {
  try {
    // Read the backend URL from environment variables.
    // Use localhost:8000 if no URL is provided.
    // Return only the origin (protocol, hostname, and port).
    return new URL(
      process.env.SMARTSTOCK_API_URL ?? "http://localhost:8000/api/v1"
    ).origin;

  } catch {
    // Return an empty string if the backend URL is invalid.
    return "";
  }
}

/**
 * Content Security Policy (CSP)
 *
 * Defines which resources the browser is allowed to load.
 * Helps protect the application from malicious content
 * and attacks such as Cross-Site Scripting (XSS).
 */
const contentSecurityPolicy = [

  // Only allow resources from the application's own origin by default.
  "default-src 'self'",

  // Allow scripts from the same origin and inline scripts.
  // Allow unsafe-eval only during development.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,

  // Allow styles from the same origin and inline styles.
  "style-src 'self' 'unsafe-inline'",

  // Allow images from the same origin, data URLs, and blob URLs.
  "img-src 'self' data: blob:",

  // Only allow fonts from the application's own origin.
  "font-src 'self'",

  // Allow connections to the frontend and backend.
  // WebSocket connections are additionally allowed during development.
  `connect-src 'self' ${backendOrigin()}${isDev ? " ws:" : ""}`,

  // Prevent other websites from embedding the application in frames.
  "frame-ancestors 'none'",

  // Only allow the application's own origin as the base URL.
  "base-uri 'self'",

  // Only allow forms to submit to the application's own origin.
  "form-action 'self'",

// Combine all security rules into one CSP header string.
].join("; ");

/**
 * Main Next.js configuration.
 * Controls build output, directories, and HTTP security headers.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {

  // Generate a standalone build for easier deployment.
  output: "standalone",

  // Set the folder where Next.js stores generated build files.
  // Default is ".next", but another folder can be configured.
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // Set the project root directory for build file tracing.
  // Prevents incorrect root detection caused by other lockfiles.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),

  // Hide the "X-Powered-By: Next.js" response header.
  poweredByHeader: false,

  // Define custom HTTP response headers.
  async headers() {
    return [
      {
        // Apply these security headers to all application routes.
        source: "/:path*",

        headers: [

          // Restrict which resources the browser can load.
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy
          },

          // Prevent the application from being displayed in an iframe.
          {
            key: "X-Frame-Options",
            value: "DENY"
          },

          // Control how much referrer information is shared.
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin"
          },

          // Prevent browsers from guessing file content types.
          {
            key: "X-Content-Type-Options",
            value: "nosniff"
          },
        ],
      },
    ];
  },
};

// Export the configuration for Next.js to use.
export default nextConfig;
