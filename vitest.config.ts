import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "tests/browser/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      include: [
        "apps/cli/src/**/*.ts",
        "apps/server/src/**/*.ts",
        // The Web renderer is accepted through build + rendered Browser QA.
        // Keep the V8 unit ratchet on the deterministic contracts that the
        // Node test environment actually executes instead of reporting every
        // React component as uncovered source.
        "apps/web/src/i18n.ts",
        "apps/web/src/layout/compileLiveLayout.ts",
        "apps/web/src/state/liveRuntime.ts",
        "packages/*/src/**/*.ts",
      ],
      exclude: ["**/*.test.ts", "**/*.test.tsx"],
      thresholds: {
        lines: 75,
        statements: 75,
        functions: 75,
        branches: 70,
        "packages/protocol/src/index.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
        "packages/core/src/core.ts": { lines: 95, statements: 95, functions: 100, branches: 77 },
        "packages/core/src/store.ts": { lines: 92, statements: 92, functions: 100, branches: 81 },
        "packages/core/src/time.ts": { lines: 100, statements: 100, functions: 100, branches: 83 },
        "packages/context-compiler/src/index.ts": { lines: 100, statements: 100, functions: 100, branches: 82 },
        "packages/projections/src/**/*.ts": { lines: 95, statements: 95, functions: 97, branches: 86 },
        "apps/server/src/server.ts": { lines: 82, statements: 82, functions: 87, branches: 72 },
        "packages/client/src/index.ts": { lines: 87, statements: 87, functions: 52, branches: 81 },
        "packages/adapters/src/index.ts": { lines: 79, statements: 79, functions: 75, branches: 75 },
      },
    },
  },
});
