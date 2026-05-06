import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const writeRouterSrc = path.resolve(here, "packages/write-router/src");
const reviewUiSrc = path.resolve(here, "apps/review-ui/src");

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "tools/**"],
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/**/*.ts", "packages/**/src/**/*.ts", "apps/**/src/**/*.ts"],
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
    alias: [
      {
        find: /^@autopus\/write-router$/,
        replacement: path.resolve(writeRouterSrc, "index.ts"),
      },
      {
        find: /^@autopus\/write-router\/(.+)$/,
        replacement: path.resolve(writeRouterSrc, "$1.ts"),
      },
      {
        find: /^@autopus\/review-ui\/(.+)$/,
        replacement: path.resolve(reviewUiSrc, "$1.ts"),
      },
    ],
  },
});
