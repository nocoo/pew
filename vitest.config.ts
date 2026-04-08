import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "packages/web/src"),
      "@pew/core": resolve(__dirname, "packages/core/src/index.ts"),
    },
  },
  test: {
    globals: true,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/__tests__/e2e/**",
      "**/e2e/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["packages/*/src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.d.ts",
        "**/index.ts",
        "**/bin.ts",
        "**/cli.ts",
        "**/types.ts",
        // bun:sqlite adapter — untestable in vitest (Node runtime).
        // All logic is exercised through DI in sync.test.ts / session-sync.test.ts.
        "**/opencode-sqlite-db.ts",
        "**/hermes-sqlite-db.ts",
        // ---------------------------------------------------------------------------
        // Platform-specific path resolution — contains process.platform branches
        // that cannot all be covered in a single test run. The logic is trivial
        // (join paths based on OS) and verified by E2E tests on each platform.
        // ---------------------------------------------------------------------------
        "**/cli/src/utils/paths.ts",
        // ---------------------------------------------------------------------------
        // CLI command entry points — these orchestrate system calls (child_process,
        // file system operations, network requests) that are difficult to fully
        // branch-cover in unit tests. Core logic is extracted into testable modules;
        // command handlers belong in L2 integration / CLI E2E tests.
        // ---------------------------------------------------------------------------
        "**/cli/src/commands/init.ts",
        "**/cli/src/commands/update.ts",
        "**/cli/src/commands/notify.ts",
        // NextAuth catch-all route — pure re-export, no custom logic.
        "**/\\[...nextauth\\]/route.ts",
        // ---------------------------------------------------------------------------
        // TSX files — UI components, pages, and layouts.
        //
        // All business logic from tsx files has been extracted into testable
        // lib/*.ts modules (cost-helpers, date-helpers, usage-helpers, etc.).
        // The remaining tsx files are purely presentational React components
        // (JSX layout, Recharts wrappers, shadcn/ui primitives, page shells)
        // that belong in E2E / visual regression tests, not unit tests.
        // ---------------------------------------------------------------------------
        "**/*.tsx",
        // ---------------------------------------------------------------------------
        // React hooks — client-side data-fetching / state hooks ("use client").
        //
        // These hooks (use-budget, use-projects, use-leaderboard, etc.) wrap
        // fetch calls with React state management (useState/useEffect/useCallback).
        // They have zero extractable business logic and belong in L4 BDD E2E
        // tests via Playwright, not L1 unit tests.
        // ---------------------------------------------------------------------------
        "**/hooks/use-*.ts",
        // ---------------------------------------------------------------------------
        // NextAuth config — framework-level auth setup with Google OAuth,
        // JWT callbacks, and D1 adapter. The testable helpers (jwtCallback,
        // sessionCallback, shouldUseSecureCookies) are already tested in
        // auth.test.ts; the remaining untested code is NextAuth(() => config)
        // initialization which requires the full Next.js runtime.
        // ---------------------------------------------------------------------------
        "**/web/src/auth.ts",
        // ---------------------------------------------------------------------------
        // Cloudflare R2 client — S3-compatible object storage for team logos.
        // Requires real AWS credentials and R2 endpoint; untestable in unit
        // tests without mocking the entire S3 SDK. Covered by L3 API E2E.
        // ---------------------------------------------------------------------------
        "**/lib/r2.ts",
        // ---------------------------------------------------------------------------
        // Next.js proxy (middleware replacement) — request-time auth routing.
        // Requires Next.js server runtime and NextAuth session resolution.
        // Core logic (URL matching, redirect building) tested in proxy.test.ts;
        // remaining uncovered lines are the NextAuth integration path.
        // ---------------------------------------------------------------------------
        "**/web/src/proxy.ts",
        // ---------------------------------------------------------------------------
        // RPC types — pure TypeScript type definitions with no runtime code.
        // Shared between worker-read and web packages for type-safe RPC calls.
        // ---------------------------------------------------------------------------
        "**/lib/rpc-types.ts",
        // ---------------------------------------------------------------------------
        // DbWorker RPC adapter — thin HTTP client calling worker-read /api/rpc.
        // Requires real Worker runtime to test; covered by L2 API E2E tests.
        // All business logic is in the Worker handlers (tested in workers/).
        // ---------------------------------------------------------------------------
        "**/lib/db-worker.ts",
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
