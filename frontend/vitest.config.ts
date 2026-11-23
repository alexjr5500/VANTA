import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Next.js keeps JSX intact for SWC, while Vitest needs a Node-compatible
  // transform to import React components in UI regression tests.
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    // Default to the `node` environment: the curated unit tests here (media URL
    // resolution, upload helpers) are pure logic. If a DOM is ever needed,
    // install jsdom and switch this to "jsdom" (or annotate the file with
    // `// @vitest-environment jsdom`).
    environment: "node",
    // The default thread pool hangs under Node ≥20 on Windows, so fork each
    // test file in a subprocess (also isolates files from each other).
    pool: "forks",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/__tests__/**",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});