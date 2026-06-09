import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const writeRouterSrc = path.resolve(here, "packages/write-router/src");
const reviewUiSrc = path.resolve(here, "apps/review-ui/src");

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "packages/**/tests/**/*.test.ts",
      "packages/**/tests/**/*.test.tsx",
      "apps/**/tests/**/*.test.ts",
      "apps/**/tests/**/*.test.tsx",
      "src/**/tests/**/*.test.ts",
    ],
    exclude: ["node_modules/**", "dist/**", "tools/**"],
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: [
        "src/**/*.{ts,tsx}",
        "packages/**/src/**/*.{ts,tsx}",
        "apps/**/src/**/*.{ts,tsx}",
      ],
      exclude: ["**/*.d.ts"],
      thresholds: {
        lines: 85,
        branches: 80,
        functions: 85,
        statements: 85,
      },
    },
  },
  resolve: {
    // Force a single react/react-dom copy so RTL hooks share the same module
    // instance as components imported via the @autopus/review-ui aliases.
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: /^react$/,
        replacement: path.resolve(here, "node_modules/react"),
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: path.resolve(here, "node_modules/react/jsx-runtime.js"),
      },
      {
        find: /^react-dom$/,
        replacement: path.resolve(here, "node_modules/react-dom"),
      },
      {
        find: /^react-dom\/(.+)$/,
        replacement: path.resolve(here, "node_modules/react-dom/$1"),
      },
      {
        find: /^@autopus\/write-router$/,
        replacement: path.resolve(writeRouterSrc, "index.ts"),
      },
      {
        find: /^@autopus\/write-router\/(.+)$/,
        replacement: path.resolve(writeRouterSrc, "$1.ts"),
      },
      // review-ui ships both .ts (lib utilities) and .tsx (React components).
      // Match the components/* segment first so JSX modules resolve to .tsx.
      {
        find: /^@autopus\/review-ui\/(components\/.+)$/,
        replacement: path.resolve(reviewUiSrc, "$1.tsx"),
      },
      {
        find: /^@autopus\/review-ui\/(.+)$/,
        replacement: path.resolve(reviewUiSrc, "$1.ts"),
      },
    ],
  },
});
