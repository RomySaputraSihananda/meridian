import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["*.js", "tools/*.js"],
      exclude: ["node_modules", "scripts", "discord-listener", "vitest.config.js", "eslint.config.js"],
      thresholds: { lines: 70, functions: 70, branches: 60 },
    },
    testTimeout: 5000,
    mockReset: true,
  },
});
