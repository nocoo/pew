# 30 — Quality System Upgrade (L1+L2+L3+G1+G2)

> Upgrade from legacy "four-layer test architecture" to "quality system: three test layers + two gates".

## Background

### Old System (Four-Layer Test Architecture)

| Layer | Name | Trigger |
|-------|------|---------|
| L1 | Unit Tests (≥90%) | pre-commit |
| L2 | Lint (tsc + ESLint) | pre-commit |
| L3 | API E2E (real HTTP) | pre-push |
| L4 | BDD E2E (Playwright) | manual/CI |

### New System (Quality System)

| Layer | Name | What it validates | Trigger |
|-------|------|-------------------|---------|
| **L1** | Unit/Component | Logic units, pure functions, hooks, ViewModels | pre-commit (<30s) |
| **L2** | Integration/API | Real HTTP calls, DB interactions, cross-module | pre-push (<3min) |
| **L3** | System/E2E | End-to-end user flows via Playwright | CI / manual |
| **G1** | Static Analysis | tsc strict + ESLint strict, 0 errors + 0 warnings | pre-commit |
| **G2** | Security/Perf | osv-scanner (dependency CVEs) + gitleaks (secret leak) | pre-push |

### Key Changes

1. **Lint demoted**: L2 Lint → G1 gate (it validates *conventions*, not *behavior*)
2. **L3/L4 merged**: Old API E2E + BDD E2E → new L2 Integration + L3 System
3. **G2 added**: Security scanning — was completely absent

---

## Gap Analysis

Audit date: 2026-03-22. Test count: 2,170 (127 files). Coverage: 93.81%.

| Requirement | Current State | Gap | Action |
|------------|--------------|-----|--------|
| L1 Unit ≥90%, pre-commit | ✅ 2,170 tests, 90% threshold enforced in `vitest.config.ts` | None | — |
| L2 Integration/API, pre-push | ✅ `scripts/run-e2e.ts` launches real Next.js server on :17030 | None | — |
| L3 System/E2E (Playwright) | ❌ Runner `scripts/run-e2e-ui.ts` exists, 0 actual specs, Playwright not installed | Full layer missing | Commits 4–5 |
| G1 `--max-warnings=0` | ⚠️ ESLint strict preset but no `--max-warnings=0` flag | Warnings silently pass | Commit 2 |
| G1 `.skip`/`.only` ban | ❌ Test files can commit `.skip`/`.only` without error | Accidental debug leaks | Commit 2 |
| G2 osv-scanner | ❌ Not configured | No CVE scanning | Commit 3 |
| G2 gitleaks | ❌ Not configured | No secret scanning | Commit 3 |
| Hook comments | References "four-layer test architecture" | Stale naming | Commit 6 |
| CLAUDE.md | References "Four-layer architecture" | Stale naming | Commit 7 |

---

## Hook Mapping (Target State)

```
pre-commit (<30s):
  ├── L1: bun run test:coverage  (vitest + coverage-v8, threshold 90%)
  └── G1: bun run lint           (tsc --noEmit ×5 + eslint --max-warnings=0)

pre-push (<3min):
  ├── L2: bun run test:e2e       (scripts/run-e2e.ts → real HTTP on :17030)
  └── G2: bun run test:security  (scripts/run-security.ts → osv-scanner + gitleaks)

CI / manual:
  └── L3: bun run test:e2e:ui    (scripts/run-e2e-ui.ts → Playwright on :27030)
```

---

## Implementation — 8 Atomic Commits

### Commit 1: `docs: add quality system upgrade plan (doc 30)`

Create this document. Update `docs/README.md` index.

**Files**:
- `docs/30-quality-system-upgrade.md` (new)
- `docs/README.md` (add row)

---

### Commit 2: `chore: upgrade G1 eslint to --max-warnings=0 and ban .skip/.only`

**`package.json`** — lint script change:
```diff
- "lint": "... && eslint .",
+ "lint": "... && eslint . --max-warnings=0",
```

**`eslint.config.ts`** — add to test files block:
```ts
"no-restricted-syntax": [
  "error",
  {
    selector: "MemberExpression[property.name='skip']",
    message: "Do not commit .skip tests — remove before committing",
  },
  {
    selector: "MemberExpression[property.name='only']",
    message: "Do not commit .only tests — remove before committing",
  },
],
```

**Verify**: `bun run lint` → 0 errors, 0 warnings.

**Files**:
- `package.json`
- `eslint.config.ts`

---

### Commit 3: `chore: add G2 security gate (osv-scanner + gitleaks)`

**Prerequisites** (one-time manual install):
```bash
brew install osv-scanner gitleaks
```

> **osv-scanner version note**: `bun.lock` (text format, v2+) is supported since osv-scanner v2.
> The older v1 docs only listed `package-lock.json`/`pnpm-lock.yaml`/`yarn.lock`.
> Verify: `osv-scanner --version` should be ≥2.0. The old binary `bun.lockb` is NOT supported.
> Ref: https://google.github.io/osv-scanner/supported-languages-and-lockfiles/

**`package.json`** — add script:
```json
"test:security": "bun run scripts/run-security.ts"
```

**`scripts/run-security.ts`** (new) — single source of truth for G2 logic:
```ts
#!/usr/bin/env bun
/**
 * G2 Security Gate
 * 1. osv-scanner: dependency CVE scan (bun.lock)
 * 2. gitleaks: secret leak scan (unpushed commits)
 */
import { spawnSync } from "node:child_process";

function hasCommand(name: string): boolean {
  const r = spawnSync("command", ["-v", name], { shell: true });
  return r.status === 0;
}

function resolveUpstreamRange(): string {
  const r = spawnSync(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    { encoding: "utf-8" },
  );
  const upstream = r.status === 0 ? r.stdout.trim() : "origin/main";
  return `${upstream}..HEAD`;
}

let failed = false;

// osv-scanner
if (hasCommand("osv-scanner")) {
  console.log("🔍 osv-scanner: scanning bun.lock...");
  const r = spawnSync("osv-scanner", ["--lockfile=bun.lock"], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error("❌ osv-scanner found vulnerabilities.");
    failed = true;
  }
} else {
  console.warn("⚠️  osv-scanner not installed, skipping CVE scan");
}

// gitleaks
if (hasCommand("gitleaks")) {
  const range = resolveUpstreamRange();
  console.log(`🔍 gitleaks: scanning commits ${range}...`);
  const r = spawnSync("gitleaks", ["git", `--log-opts=${range}`], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error("❌ gitleaks found secrets in commits.");
    failed = true;
  }
} else {
  console.warn("⚠️  gitleaks not installed, skipping secret scan");
}

process.exit(failed ? 1 : 0);
```

> **gitleaks version note**: `protect --staged` is deprecated since v8.19.0 and scans only
> staged (index) files — that's a pre-commit semantic, not pre-push. In pre-push, the relevant
> scope is "commits about to be pushed". The script resolves the upstream tracking branch via
> `@{u}` (falls back to `origin/main`) and scans the commit range with `gitleaks git`.

**`.husky/pre-push`** — append G2 block after L2:
```bash
# G2: Security — osv-scanner (dependency CVEs) + gitleaks (secret leak in commits)
bun run test:security 2>&1
G2_EXIT=$?
if [ $G2_EXIT -ne 0 ]; then
  echo "❌ pre-push FAILED: G2 security gate."
  exit 1
fi
```

Pre-push hook delegates to the same `scripts/run-security.ts` — no duplicated logic.

**Verify**: `bun run test:security` → clean.

**Files**:
- `package.json`
- `scripts/run-security.ts` (new)
- `.husky/pre-push`

---

### Commit 4: `test: install playwright and configure for L3 E2E`

```bash
bun add -d @playwright/test
npx playwright install chromium
```

**Fix `scripts/run-e2e-ui.ts` env loading**: The API runner (`run-e2e.ts:22-40`) calls
`loadEnvLocal()` to inject `packages/web/.env.local` (D1 credentials, auth secrets) into the
server process. The UI runner (`run-e2e-ui.ts:46-56`) only passes `process.env`, which means
the Next.js dev server lacks D1 credentials and any page that fetches real data will fail.
Fix: import `loadEnvLocal` from `./e2e-utils` (it's already in the shared module) and merge
into the server spawn env, matching the API runner pattern.

**`scripts/run-e2e-ui.ts`** — change server spawn:
```diff
+ import { ensurePortFree, cleanupBuildDir, loadEnvLocal } from "./e2e-utils";
- import { ensurePortFree, cleanupBuildDir } from "./e2e-utils";

  // in main():
+ const envLocal = loadEnvLocal();
+ const mergedEnv = { ...process.env, ...envLocal };
  serverProcess = spawn(["bun", "run", "next", "dev", "-p", E2E_UI_PORT], {
    cwd: "packages/web",
    env: {
-     ...process.env,
+     ...mergedEnv,
      NEXT_DIST_DIR: ".next-e2e-ui",
      E2E_SKIP_AUTH: "true",
    },
```

> **Note**: If `loadEnvLocal` is currently defined inline in `run-e2e.ts` rather than exported
> from `e2e-utils.ts`, move it to `e2e-utils.ts` first and re-export, so both runners share
> the same implementation.

**Why `packages/web/e2e/playwright.config.ts`**: The existing runner `scripts/run-e2e-ui.ts:74`
hardcodes `--config packages/web/e2e/playwright.config.ts`. The config file **must** live there
to avoid changing the runner or creating a path mismatch. The runner already handles server
lifecycle (start on :27030, cleanup on exit), so the config **omits** `webServer` — no duplicate
server management.

**`packages/web/e2e/playwright.config.ts`** (new):
```ts
import { defineConfig } from "@playwright/test";

const E2E_UI_PORT = process.env.E2E_UI_PORT || "27030";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${E2E_UI_PORT}`,
    headless: true,
  },
  // No webServer — scripts/run-e2e-ui.ts manages the dev server lifecycle.
});
```

**`packages/web/e2e/smoke.spec.ts`** (new):
```ts
import { test, expect } from "@playwright/test";

test("app loads and shows page title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/pew/i);
});
```

**Verify**: `bun run test:e2e:ui` → runner starts server (with D1 credentials), 1 spec passes, cleanup.

**Files**:
- `package.json` (dep added)
- `bun.lock`
- `scripts/run-e2e-ui.ts` (add loadEnvLocal)
- `scripts/e2e-utils.ts` (extract loadEnvLocal if needed)
- `packages/web/e2e/playwright.config.ts` (new)
- `packages/web/e2e/smoke.spec.ts` (new)
- Add to `.gitignore`: `playwright-report/`, `test-results/`

---

### Commit 5: `test: add L3 playwright core flow specs`

Core user journeys. All specs run under `E2E_SKIP_AUTH=true` (set by the runner),
so auth is bypassed — the proxy passes all requests through and API routes return the
deterministic `e2e-test-user-id`.

**`packages/web/e2e/auth.spec.ts`** — auth bypass validation:
- With skip-auth, visiting `/dashboard` does NOT redirect to `/login` (proxy passes through)
- With skip-auth, API calls return data for the test user (200, not 401)

**`packages/web/e2e/dashboard.spec.ts`**:
- Dashboard loads at `/dashboard`
- Token usage chart container is visible
- At least one data card is rendered

**`packages/web/e2e/navigation.spec.ts`**:
- Sidebar links are present (Dashboard, Leaderboard, Settings)
- Clicking a sidebar link navigates to the correct page

**Files**:
- `packages/web/e2e/auth.spec.ts` (new)
- `packages/web/e2e/dashboard.spec.ts` (new)
- `packages/web/e2e/navigation.spec.ts` (new)

---

### Commit 6: `chore: update husky hooks to new quality system naming`

**`.husky/pre-commit`** — comment updates:
```diff
- # pre-commit: L1 Unit Tests + Coverage + L2 Lint (four-layer test architecture)
+ # pre-commit: L1 Unit/Component + G1 Static Analysis (quality system)

- # L1: Unit Tests + Coverage (90% threshold enforced by vitest.config.ts)
+ # L1 Unit/Component: coverage ≥90% enforced by vitest.config.ts

- # L2: Lint (TypeScript strict type checking + ESLint)
+ # G1 Static Analysis: tsc strict + ESLint strict (0 errors + 0 warnings)

- echo "✅ pre-commit passed: L1 UT + Coverage ≥90% + L2 Lint"
+ echo "✅ pre-commit passed: L1 Unit ≥90% + G1 Static Analysis"
```

**`.husky/pre-push`** — comment updates:
```diff
- # pre-push: L3 API E2E Tests (four-layer test architecture)
- # L1+L2 already enforced by pre-commit.
+ # pre-push: L2 Integration/API + G2 Security (quality system)
+ # L1+G1 already enforced by pre-commit.

- echo "✅ pre-push passed: L3 API E2E"
+ echo "✅ pre-push passed: L2 Integration/API + G2 Security"
```

**Files**:
- `.husky/pre-commit`
- `.husky/pre-push`

---

### Commit 7: `docs: update CLAUDE.md to reference new quality system`

In `CLAUDE.md` → Key Conventions → Testing:

```diff
- **Testing**: Vitest is the sole test runner for L1 unit tests (`bun run test`).
- Never use `bun test` directly for unit tests ... Four-layer architecture (see docs/01-plan.md)
+ **Testing**: Quality system — L1 Unit + L2 Integration + L3 System/E2E + G1 Static Analysis + G2 Security.
+ Vitest for L1 (`bun run test`), real HTTP E2E for L2 (`bun run test:e2e`),
+ Playwright for L3 (`bun run test:e2e:ui`). See docs/30-quality-system-upgrade.md.
+ Never use `bun test` directly for unit tests ...
```

**Files**:
- `CLAUDE.md`

---

### Commit 8: `docs: finalize doc 30 with verification record`

Append a "Verification Record" section to this document with actual results:
- L1: test count, coverage %
- L2: API E2E pass/fail
- L3: Playwright spec count and pass/fail
- G1: lint 0 errors + 0 warnings
- G2: osv-scanner clean, gitleaks clean

**Files**:
- `docs/30-quality-system-upgrade.md`

---

## Verification Checklist

```bash
# L1 Unit/Component
bun run test:coverage            # ≥2,170 tests pass, coverage ≥90%

# G1 Static Analysis
bun run lint                     # 0 errors + 0 warnings

# L2 Integration/API
bun run test:e2e                 # API E2E pass

# G2 Security
bun run test:security            # osv-scanner + gitleaks clean

# L3 System/E2E
bun run test:e2e:ui              # Playwright specs pass

# Hook dry-runs
sh .husky/pre-commit             # L1+G1 pass
sh .husky/pre-push               # L2+G2 pass
```

---

## Verification Record

> Filled after all commits are applied. See commit 8.
