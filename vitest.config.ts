import { defineConfig } from "vitest/config";

// Repository unit/contract tests only. Corpus hidden suites (corpus/**/hidden/**) are never run by this config:
// corpus code only ever executes inside the qualified sandbox (PLAN K18/K19). Tests must pass offline with no keys.
// Written, never run in Dirty Mode (DEFERRED-VALIDATION DV-04).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["corpus/**", "fixtures/**", "results/**", "runs/**", "node_modules/**", "dist/**"],
    environment: "node",
    passWithNoTests: false,
  },
});
