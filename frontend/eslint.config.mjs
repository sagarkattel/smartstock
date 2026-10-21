
/**
 * ESLint Configuration
 * This file sets up ESLint for a Next.js project.
 * ESLint helps identify code errors and maintain code quality.
 */

// Import utilities to work with file and directory paths.
import { dirname } from "path";
import { fileURLToPath } from "url";

// Import FlatCompat to support older ESLint configurations.
import { FlatCompat } from "@eslint/eslintrc";

// Get the current file's full path.
const __filename = fileURLToPath(import.meta.url);

// Get the directory containing this file.
const __dirname = dirname(__filename);

// Create a compatibility helper for legacy ESLint configurations.
const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// Define the ESLint configuration rules.
const eslintConfig = [
  // Apply Next.js recommended rules and Core Web Vitals checks.
  ...compat.extends("next/core-web-vitals"),

  {
    // Exclude generated files and folders from ESLint checks.
    ignores: [
      "node_modules/**", // Installed project dependencies.
      ".next/**",        // Next.js generated build files.
      ".next-test/**",   // Next.js test build files.
      "out/**",          // Exported static website files.
      "build/**",        // Production build files.
    ],
  },
];

// Export the configuration for ESLint to use.
export default eslintConfig;
