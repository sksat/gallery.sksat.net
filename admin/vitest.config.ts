import { defineConfig } from "vitest/config";
import { qwikVite } from "@builder.io/qwik/optimizer";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [qwikVite(), tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    // Admin currently has no unit tests (Phase 0 scaffolding only).
    // Remove this once admin/src grows pure-function logic so CI can flag
    // include-pattern breakage or accidentally deleted tests.
    passWithNoTests: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/entry.*.tsx",
        "src/routes/**/index.tsx",
      ],
    },
  },
});
