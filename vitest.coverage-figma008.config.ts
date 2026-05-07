import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config.js";
export default mergeConfig(baseConfig, defineConfig({
  test: {
    coverage: {
      reporter: ["json-summary", "text-summary"],
      reportsDirectory: "/tmp/figma008-coverage",
      thresholds: undefined,
    },
  },
}));
