# Pew L3 → BDD 重构方案

> **Numbers in this doc are reproducible.** All test counts come from commands
> embedded inline; re-run them on `main` to verify. If a count drifts during
> the migration, update the doc in the same commit that changes the count.

## 1. 存量分析

### 1.1 测试规模

Reproducible baseline command (run from repo root):

```bash
grep -cE '^\s*test\(' packages/web/e2e/*.spec.ts | awk -F: '{s+=$2} END {print s}'
# => 64
```

| 指标 | 数值 |
|------|------|
| Spec 文件数 | 16 |
| 测试用例总数 | **64** |
| Smoke 域 | 1 spec, 1 test |
| Auth 域 | 1 spec, 3 tests |
| Dashboard 域 (dashboard + dashboard-data + navigation) | 3 spec, 12 tests |
| Public 域 | 1 spec, 2 tests |
| Leaderboard 域 (leaderboard + leaderboard-data) | 2 spec, 12 tests |
| 数据页面域 (data-pages + devices + settings-projects) | 3 spec, 10 tests |
| 协作域 (teams + organizations) | 2 spec, 12 tests |
| Admin 域 (admin + admin-badges-crud + admin-seasons-crud) | 3 spec, 12 tests |
| **合计** | **16 spec, 64 tests** |

域加总核对：1 + 3 + 12 + 2 + 12 + 10 + 12 + 12 = 64 ✅

### 1.2 Spec 文件清单

Per-file counts (reproducible via
`grep -cE '^\s*test\(' packages/web/e2e/*.spec.ts`, sorted by domain):

| Spec 文件 | 测试数 | 域 | 覆盖范围 |
|-----------|--------|-----|---------| 
| `smoke` | 1 | Smoke | 应用加载、页面标题 |
| `auth` | 3 | Auth | 认证绕过验证（E2E_SKIP_AUTH）、登录页 |
| `navigation` | 3 | Dashboard | 侧边栏链接、页面导航 |
| `dashboard` | 5 | Dashboard | 仪表盘加载、内容/空状态、侧边栏、导航 |
| `dashboard-data` | 4 | Dashboard | 数据卡片（route-mocked）、费用统计、趋势段 |
| `public` | 2 | Public | 隐私页面、公开用户页面 |
| `leaderboard` | 8 | Leaderboard | 排行榜导航标签、子页面（成就/agent/模型/展示/赛季/赛季详情） |
| `leaderboard-data` | 4 | Leaderboard | 排行榜数据展示（route-mocked）、排名条目、时段切换 |
| `data-pages` | 6 | Data Pages | agents/models/projects/sessions/daily-usage/hourly-usage 页面加载 |
| `devices` | 2 | Data Pages | 设备分析页面、设备管理页面 |
| `settings-projects` | 2 | Data Pages | 设置展示、管理项目页面 |
| `teams` | 3 | Collaboration | 团队列表、创建/加入选项、团队详情容错 |
| `organizations` | 9 | Collaboration | 组织管理（admin 页面、设置、排行榜、导航） |
| `admin` | 8 | Admin | 后台子页面加载（badges/compare/invites/model-prices/seasons/showcases/storage） |
| `admin-badges-crud` | 2 | Admin | 徽章 CRUD（route-mocked、serial mode） |
| `admin-seasons-crud` | 2 | Admin | 赛季 CRUD（route-mocked、serial mode） |
| **合计** | **64** | | |

### 1.3 技术栈现状

| 维度 | 现状 |
|------|------|
| 框架 | Playwright (Chromium only) |
| 配置 | `packages/web/e2e/playwright.config.ts` |
| 测试目录 | `packages/web/e2e/` (testDir: ".") |
| 端口 | 27020 (dev=7020, L2=17020, L3=27020) |
| 启动器 | `scripts/run-e2e-ui.ts`（管理 Next.js dev server + D1 测试隔离 + Playwright） |
| 并行度 | CI: 2 workers, 本地: 1 worker |
| 超时 | 60s per test, 30s navigation |
| CI 方式 | 自建 job（非 base-ci `enable-l3`），需 10 个 Cloudflare 秘钥 |
| 共享 fixtures | 无（所有 fixture 内联在各 spec 中） |
| BDD 元素 | 零（无 Given/When/Then、无 .feature 文件、无 step definitions） |

### 1.4 测试风格分析

**命名模式**：全部使用命令式短句（`"page loads and shows heading"`, `"sidebar links are visible"`），无行为描述。

**Locator 策略**：

| 定位方式 | 使用次数 | 占比 |
|----------|---------|------|
| `page.getByRole()` | 57 | 42% |
| `page.getByText()` | 54 | 40% |
| `page.locator()` (CSS) | 25 | 18% |
| `page.getByPlaceholder()` | 3 | <1% |
| `page.getByTestId()` | 0 | 0% |

**断言模式**：

| 断言 | 使用次数 |
|------|---------|
| `toBeVisible()` | 61 |
| `toContainText()` | 35 |
| `toHaveURL()` | 8 |
| `toBe(true)` | 8（防御性 fallback） |
| `not.toBeVisible()` | 2 |
| `toHaveTitle()` | 1 |
| `toBeEnabled()` | 1 |

**操作复杂度**：

| 操作 | 使用次数 | 说明 |
|------|---------|------|
| `page.goto()` | 64 | 每个 test 一次 |
| `.click()` | 18 | 导航和表单交互 |
| `.fill()` | 6 | 仅 CRUD specs（badges + seasons） |
| `page.route()` | 12 | API 响应 mock（4 个 spec） |
| `waitForTimeout()` | 5 | 显式等待 1-3s |

**结论**：
1. **Locator 质量较高**：82% 已使用 `getByRole`/`getByText`，优于 firefly（仅 19% getByText + 0% getByRole）。18% 的 CSS locator 需审查
2. 绝大多数测试是**只读页面验证**，仅 CRUD specs 有写入操作
3. 4 个 spec 使用 `page.route()` mock API，需原样保留 mock 逻辑

### 1.5 已有痛点

1. **防御性数据门模式滥用**：14 处 `.isVisible().catch(() => false)` + `expect(hasX || hasY).toBe(true)` 模式，测试永远通过，掩盖真实失败。应改为 `test.skip()` 或 route-mock 消除数据不确定性
2. **无共享 fixtures**：每个 spec 独立导入 `@playwright/test`，无公共辅助函数
3. **route-mocked fixture 内联**：`dashboard-data`、`leaderboard-data`、`admin-badges-crud`、`admin-seasons-crud` 的 mock 数据常量散落在各文件中
4. **显式 `waitForTimeout` 使用**：5 处硬编码等待（1-3s），应改为 Playwright 原生等待策略
5. **describe 命名不统一**：有的用域名（`"dashboard"`），有的用技术描述（`"auth bypass (E2E_SKIP_AUTH=true)"`）
6. **CI 非标准**：自建 job，因需要 D1 测试隔离（`d1-test-guard.ts` 四层防御 + 10 个秘钥）

## 2. BDD 目标架构

### 2.1 方案选型

采用 **方案 B：L3 原地升级为 BDD**，与其他 personal 项目保持一致。

技术选型：**Playwright 原生 BDD**（Given/When/Then 命名约定 + 结构化步骤注释）。**不引入** 以下任何依赖：

- `playwright-bdd`
- `@cucumber/cucumber`
- `.feature` 文件 / Gherkin 语法
- 独立的 step definitions 目录

理由：
- pew 的 64 个测试都是 Playwright 原生写法，引入 .feature 文件改写成本过高
- 其他已完成项目（dove/lyre/backy/gecko/neo/noheir/wooly/otter/pew-game）使用相同的 Playwright 原生 BDD 命名
- 保持依赖最小化

BDD 在本项目中的定义仅是：**test 名称用 Given/When/Then 句式 + 测试体内有 `// Given:` / `// When:` / `// Then:` 注释分段 + `describe` 用 `Feature:` 前缀**。

### 2.2 目录结构迁移

```
packages/web/e2e/
├── *.spec.ts             # 当前（重构期与 bdd/ 并存，最终删除）
├── bdd/                  # 目标
│   ├── fixtures.ts       # 共享 fixtures（导航 helpers + 数据门 + mock 常量）
│   ├── smoke.spec.ts
│   ├── auth.spec.ts
│   ├── dashboard.spec.ts
│   ├── public.spec.ts
│   ├── leaderboard.spec.ts
│   ├── data-pages.spec.ts
│   ├── collaboration.spec.ts
│   └── admin.spec.ts
├── playwright.config.ts  # 重构期同时覆盖根目录和 bdd/（见 §6.2）
└── ...                   # 其他辅助文件不变
```

### 2.3 BDD 命名规范

**test 名称**：`"Given <前置条件>, When <操作>, Then <期望结果>"`

```typescript
// ❌ 当前风格
test("page loads and shows heading", async ({ page }) => { ... });

// ✅ BDD 风格
test("Given the user is authenticated, When I visit the dashboard, Then I see the Dashboard heading", async ({ page }) => {
  // Given: user is authenticated (E2E_SKIP_AUTH=true)
  // When: visit dashboard
  await page.goto("/dashboard");
  // Then: heading is visible
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
```

**describe 名称**：`"Feature: <功能域>"`

```typescript
// ❌ 当前风格
test.describe("dashboard", () => { ... });

// ✅ BDD 风格
test.describe("Feature: Dashboard", () => { ... });
```

### 2.4 共享 Fixtures（边界约束）

`packages/web/e2e/bdd/fixtures.ts` 的范围严格限定为以下四类**稳定**辅助：

1. **稳定导航**：跨多个 spec 共用的页面入口（如 `gotoAdmin`、`gotoSettings`）
2. **空数据处理**：把防御性 `isVisible().catch(() => false)` 替换为结构化 `test.skip()`
3. **Route-mock 工厂**：抽取 `dashboard-data`、`leaderboard-data` 等 spec 中共用的 mock 数据常量和 `page.route()` setup
4. **Auth 绕过封装**：复用 `E2E_SKIP_AUTH` + `E2E_ADMIN_BYPASS` 环境约定

**不放进 fixtures**：
- 任何 spec 内部一次性使用的 helper
- 任何与具体业务断言耦合的逻辑
- 不稳定的 CSS fallback selector

`emptyDataGate` 必须返回结构化结果，调用方用 Playwright 原生 `test.skip()`
消费（不能用 `return` 或 `.catch(() => false)` 提前退出）：

```typescript
// packages/web/e2e/bdd/fixtures.ts
import { test as base, expect, type Page } from "@playwright/test";

/** Inspect count; caller must consume via `test.skip(result.skip, result.reason)`. */
export function emptyDataGate(count: number, what: string): { skip: boolean; reason: string } {
  return count === 0
    ? { skip: true, reason: `Test DB has no ${what}; seed required.` }
    : { skip: false, reason: "" };
}

/** Navigate to admin and ensure page loads. */
export async function gotoAdmin(page: Page, path = ""): Promise<void> {
  await page.goto(`/admin${path ? `/${path}` : ""}`);
  await expect(page.locator("main")).toBeVisible();
}

export { base as test, expect };
```

**调用示例**：

```typescript
test("Given usage data exists, When I visit the dashboard, Then I see stat cards", async ({ page }) => {
  await page.goto("/dashboard");
  const count = await page.getByText("Total Tokens").count();
  const gate = emptyDataGate(count, "usage data");
  test.skip(gate.skip, gate.reason);
  // ...
});
```

### 2.5 Locator 策略（迁移强制）

pew 的 locator 质量已较好（82% 为 getByRole/getByText），迁移时按以下优先级审查现有 CSS locator：

1. `page.getByRole("...", { name: "..." })` — 首选，可访问性 + 语义最佳（现有 57 处，保留）
2. `page.getByLabel(...)` — 表单字段首选
3. `page.getByTestId(...)` — 需要 `data-testid` 锚点的情况
4. `page.getByText(...)` — 用户可见文本断言时可以接受（现有 54 处，保留）
5. `page.locator("css")` — **仅作为兜底**，且必须在代码里加注释说明为何无法用前 4 种

**审查重点**：现有 25 处 `.locator()` 调用。其中 `locator("main")`、`locator("aside nav")` 等结构选择器通常是合理兜底（无对应 ARIA role）；`locator("h1")`、`locator("tr")` 应尝试替换为 `getByRole("heading")`、`getByRole("row")`。

### 2.6 数据门模式统一（核心改造点）

pew 现有两种数据处理策略，均需标准化：

**策略 A：防御性 catch（14 处，必须消除）**

```typescript
// ❌ 当前：永远通过，掩盖真实失败
const hasData = await page.getByText("Total Tokens").isVisible().catch(() => false);
const hasEmpty = await page.getByText("Ready to Track").isVisible().catch(() => false);
expect(hasData || hasEmpty).toBe(true);
```

```typescript
// ✅ BDD：明确跳过或断言
test("Given no usage data, When I visit dashboard, Then I see getting started guide", async ({ page }) => {
  // Given: no usage data (test DB empty)
  // When: visit dashboard
  await page.goto("/dashboard");
  // Then: empty state is visible
  const hasData = await page.getByText("Total Tokens").isVisible().catch(() => false);
  test.skip(hasData, "Test DB has usage data; this test is for empty state only");
  await expect(page.getByText("Ready to Track")).toBeVisible();
});
```

**策略 B：Route-mock（4 个 spec，保留并增强）**

`page.route()` mock 是正确的做法——消除了数据不确定性。迁移时保留 mock 逻辑，将 fixture 常量提取到 `fixtures.ts`。

### 2.7 显式等待消除

5 处 `waitForTimeout()` 必须替换为 Playwright 原生等待：

| 现有模式 | 替换为 |
|---------|--------|
| `await page.waitForTimeout(3000)` → then assert | `await expect(element).toBeVisible({ timeout: 5000 })` |
| `await page.waitForTimeout(1000)` → then check | `await page.waitForLoadState("networkidle")` 或直接 `await expect(...)` |

## 3. Spec 合并计划

当前 16 个 spec 合并到 8 个 BDD spec。

> **来源数核对原则**：本表"原测试数"列必须与 §1.2 完全一致。

| 目标 BDD Spec | 合并来源 (旧 spec → 取用测试数) | 原测试数 | 预估 BDD 测试数 |
|---------------|-----------------------------|---------|----------------|
| `smoke.spec.ts` | smoke(1) | 1 | 1 |
| `auth.spec.ts` | auth(3) | 3 | 3 |
| `dashboard.spec.ts` | dashboard(5) + dashboard-data(4) + navigation(3) | 12 | 10 |
| `public.spec.ts` | public(2) | 2 | 2 |
| `leaderboard.spec.ts` | leaderboard(8) + leaderboard-data(4) | 12 | 10 |
| `data-pages.spec.ts` | data-pages(6) + devices(2) + settings-projects(2) | 10 | 8 |
| `collaboration.spec.ts` | teams(3) + organizations(9) | 12 | 10 |
| `admin.spec.ts` | admin(8) + admin-badges-crud(2) + admin-seasons-crud(2) | 12 | 11 |
| **合计** | **16 → 8** | **64** | **~55** |

**合计来源核对**：1+3+12+2+12+10+12+12 = 64 ✅

**合并理由**：

- **dashboard + dashboard-data + navigation → dashboard.spec.ts**：navigation 的侧边栏测试与 dashboard 的侧边栏断言重复；dashboard-data 的 route-mock 测试是 dashboard 的数据层补充
- **leaderboard + leaderboard-data → leaderboard.spec.ts**：同上，data 是 mock 数据层补充
- **data-pages + devices + settings-projects → data-pages.spec.ts**：全部是"页面加载成功"断言，同质化高
- **teams + organizations → collaboration.spec.ts**：同属协作功能域
- **admin + admin-*-crud → admin.spec.ts**：同属管理后台域，CRUD specs 保持 `test.describe.configure({ mode: "serial" })`

预估测试数减少原因：
- 合并 navigation 和 dashboard 中重复的侧边栏断言（sidebar links visible + sidebar navigation is visible）
- 合并 data-pages 中 6 个结构相同的"页面加载"测试为参数化模式
- 去除 dashboard 中 `expect(true).toBe(true)` 的无效断言

## 4. 迁移优先级与原子提交

### 4.1 原子提交规则

- **每个 commit 最多迁移一个目标 BDD spec**。批次包含多个 spec 时拆成多个 commit。
- 删除旧 spec 与新 spec 落地必须在同一个 commit 内完成，或在紧接的下一个 commit 内完成。
- 单个 commit 必须包含本目标 spec 的完整 traceability 映射表（在 commit body 中）。

### 4.2 Phase 0：基建准备

| 批次 | 内容 | 工作量 |
|------|------|--------|
| 0.1 | 创建 `packages/web/e2e/bdd/fixtures.ts` + Stage 1 config commit | 极小 |

### 4.3 Phase 1：无状态页面（风险最低）

| 批次 | Spec | 测试数 (旧→新) | 工作量 | 理由 |
|------|------|--------|--------|------|
| 1.1 | `smoke.spec.ts` | 1 → 1 | 极小 | 单个测试 BDD 改名 |
| 1.2 | `auth.spec.ts` | 3 → 3 | 小 | 纯断言，无数据依赖 |
| 1.3 | `public.spec.ts` | 2 → 2 | 小 | 公开页面，无认证 |
| 1.4 | `data-pages.spec.ts` | 10 → 8 | 中 | 合并 3 个 spec，参数化页面加载测试 |

### 4.4 Phase 2：数据展示页面（有 route-mock）

| 批次 | Spec | 测试数 (旧→新) | 工作量 | 理由 |
|------|------|--------|--------|------|
| 2.1 | `dashboard.spec.ts` | 12 → 10 | 中 | 合并 3 个 spec，消除防御性 catch，保留 route-mock |
| 2.2 | `leaderboard.spec.ts` | 12 → 10 | 中 | 合并 2 个 spec，8 个子页面 + route-mock |

### 4.5 Phase 3：交互页面（有 click/fill/serial）

| 批次 | Spec | 测试数 (旧→新) | 工作量 | 理由 |
|------|------|--------|--------|------|
| 3.1 | `collaboration.spec.ts` | 12 → 10 | 中 | 合并 teams + organizations，organizations 有嵌套 describe |
| 3.2 | `admin.spec.ts` | 12 → 11 | 大 | 合并 3 个 spec，CRUD 有 serial mode + fill + route-mock |

## 5. 迁移检查清单（每个批次 / 每个目标 spec）

每个目标 spec 落地前按以下步骤执行：

1. **创建 BDD spec 文件**：在 `packages/web/e2e/bdd/` 下新建
2. **重写测试名称**：全部改为 Given/When/Then 格式
3. **添加步骤注释**：`// Given:` / `// When:` / `// Then:`
4. **Locator 审查**：现有 `getByRole`/`getByText` 保留；`.locator("css")` 按 §2.5 审查，CSS fallback 必须加注释说明
5. **提取共享代码**：重复的导航/mock 逻辑提到 `fixtures.ts`，遵守 §2.4 边界
6. **数据门标准化**：把 `.isVisible().catch(() => false)` + `expect(x || y).toBe(true)` 改为 `test.skip()` + `emptyDataGate`（§2.6）
7. **消除 waitForTimeout**：替换为 Playwright 原生等待（§2.7）
8. **合并微测试**：同一 scenario 的多个微断言合并
9. **Serial mode 保留**：CRUD specs 的 `test.describe.configure({ mode: "serial" })` 原样迁移
10. **Traceability 映射**：在 commit body 中写"旧 test 名 → 新 scenario 名"全量表，无遗漏则可删旧 spec
11. **删除旧 spec**：确认 §6.2 临时 testMatch 仍能跑通后删除对应旧文件
12. **验证三件套**：
    - `bun run lint`
    - `bun run typecheck`（或 `bun run lint:typecheck`）
    - `bunx playwright test --config packages/web/e2e/playwright.config.ts --list`（确认新 spec 被收集）
    - `bun run test:e2e:ui`（全量通过）

## 6. CI 迁移

### 6.1 当前 CI 架构

pew CI 使用**自建 L3 job**（`browser-e2e`），因为需要：
- D1 测试隔离（`d1-test-guard.ts` 四层防御：existence check、DB ID 非等、Worker URL 非等、`_test_marker` 表验证）
- 10 个 Cloudflare 秘钥（CF_ACCOUNT_ID、CF_D1_DATABASE_ID_TEST、WORKER_*_URL_TEST 等）
- 启动 Next.js dev server（`E2E_SKIP_AUTH=true`, `E2E_ADMIN_BYPASS=true`）
- `.env.local` 和 `.env.test` 文件写入

这些需求使得 base-ci 的 `enable-l3` + `l3-command` 模式**不适用**。pew 的 L3 CI 保持自建 job。

### 6.2 BDD 迁移期间的 `playwright.config.ts` 演化（三阶段）

**Stage 0（重构前，当前）**：

```ts
// packages/web/e2e/playwright.config.ts
testDir: ".",
```

**Stage 1（迁移期，旧/新并存）**：在创建任何 `packages/web/e2e/bdd/` spec 之前，先落一个**配置变更 commit**，让 Playwright 同时收集根目录和 `bdd/` 两个目录：

```ts
// packages/web/e2e/playwright.config.ts
testDir: ".",
testMatch: ["*.spec.ts", "bdd/**/*.spec.ts"],
```

在此阶段，每删除一个旧 spec，新 spec 即生效；CI 命令 `bun run test:e2e:ui` 不变，但实际跑的是两个目录的并集。

**Stage 2（迁移完成）**：所有旧 spec 已删除后，落一个**收尾 commit**，把 testDir 收敛到 `./bdd`：

```ts
// packages/web/e2e/playwright.config.ts
testDir: "./bdd",
```

`bun run test:e2e:ui` 命令、`scripts/run-e2e-ui.ts` 启动器、CI job 定义在三个 stage 内均不需要变更。

### 6.3 CI 命令统一

Stage 2 完成后，在 `package.json` 添加别名：

```json
"test:e2e:bdd": "bun run test:e2e:ui"
```

保持与其他项目的命名一致性。原命令保留，避免破坏 CI / 文档引用。

## 7. 工作量估算

| Phase | Spec 数 | 测试数 | 预估工时 | SDE Issue 数 |
|-------|---------|--------|---------|-------------|
| 准备工作 | 0 | 0 | 0.5h | 1（创建 fixtures.ts + Stage 1 config commit） |
| Phase 1 | 4 | 14 | 1h | 4（每个目标 spec 一个 commit） |
| Phase 2 | 2 | 20 | 1.5h | 2 |
| Phase 3 | 2 | 21 | 1.5h | 2 |
| 收尾 | 0 | 0 | 0.5h | 1（Stage 2 config + 删旧文件 + 添加 alias） |
| **合计** | **8** | **~55** | **~5h** | **10** |

## 8. 约束与风险

### 8.1 不变量（baseline 数字均可复跑验证）

| 不变量 | Baseline | 验证命令 |
|--------|----------|---------|
| `scripts/run-e2e-ui.ts` 启动器不改 | — | `git diff main -- scripts/run-e2e-ui.ts` 必须为空 |
| `packages/web/e2e/playwright.config.ts` 位置不变 | — | 文件路径不变，只改 `testDir`/`testMatch` |
| L1 测试数 | 233 test files | `find packages -name '*.test.ts' -o -name '*.test.tsx' \| wc -l` |
| L3 browser baseline | 16 spec files / 64 tests | `grep -cE '^\s*test\(' packages/web/e2e/*.spec.ts \| awk -F: '{s+=$2} END {print s}'` |
| CI 自建 job 结构 | — | `.github/workflows/ci.yml` 中 `browser-e2e` job 步骤数不变 |
| D1 测试隔离逻辑 | — | `scripts/d1-test-guard.ts` 不改 |
| Route-mock specs 的 API 端点覆盖 | — | mock 的端点（`/api/usage*`, `/api/achievements*`, `/api/pricing`, `/api/leaderboard**`）必须在新 spec 中完整保留 |

### 8.2 风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 防御性 catch 改为 test.skip 后暴露真实失败 | 测试数减少（被正确跳过） | 可接受——说明 test DB 缺少 seed 数据，BDD 改写的价值之一就是暴露这些 |
| Route-mock fixture 提取时遗漏字段 | Mock 不完整导致测试失败 | 每个 fixture 常量必须完整复制，不允许"精简"字段 |
| Serial mode CRUD specs 合并后顺序依赖被打破 | 数据状态不一致 | 保持 `test.describe.configure({ mode: "serial" })` 在新 spec 中 |
| organizations 嵌套 describe 合并到 collaboration 后结构复杂 | 可读性下降 | 保持子 describe 嵌套，只在最外层加 Feature: 前缀 |
| Stage 1 期间旧/新并存导致重复执行 | CI 时长上涨 | 跨阶段命名不冲突；每删一个旧 spec 同 commit 落地新 spec |
| waitForTimeout 消除后 flaky | 等待不足 | 使用 `{ timeout: N }` 参数替代硬编码，CI `retries: 1` 已配置 |

## 9. 验收标准

- [ ] §1.1 / §1.2 / §3 的数字与 §8.1 验证命令的输出完全一致
- [ ] 所有原 64 个测试的行为覆盖被保留（按 §3 合并表追溯，允许合并，不允许遗漏）
- [ ] 每个目标 spec commit body 含 "旧 test 名 → 新 scenario 名" 全量映射表
- [ ] 所有 test 名称符合 Given/When/Then 格式
- [ ] 所有 test 包含 `// Given:` / `// When:` / `// Then:` 步骤注释
- [ ] 所有 `describe` 使用 `Feature: <...>` 前缀
- [ ] 所有 selector 符合 §2.5 优先级，CSS fallback 必须有解释注释
- [ ] 共享 fixtures 提取到 `packages/web/e2e/bdd/fixtures.ts`，遵守 §2.4 边界
- [ ] 所有防御性 `.isVisible().catch(() => false)` 模式已消除，统一用 `emptyDataGate` + `test.skip()` 或 route-mock
- [ ] 所有 `waitForTimeout()` 已替换为 Playwright 原生等待
- [ ] CRUD specs 保持 `test.describe.configure({ mode: "serial" })`
- [ ] Route-mock 的 API 端点覆盖完整保留
- [ ] `bun run lint` / `bun run typecheck` 通过
- [ ] `bunx playwright test --config packages/web/e2e/playwright.config.ts --list` 输出包含全部新 spec、不包含已删旧 spec
- [ ] `bun run test:e2e:ui` 全量通过（64 → ~55 tests，CI green）
- [ ] `package.json` 有 `test:e2e:bdd` 别名
- [ ] 旧 `packages/web/e2e/*.spec.ts` 文件完全删除（仅保留 playwright.config.ts 和辅助脚本）
- [ ] `playwright.config.ts` 最终 `testDir: "./bdd"`（Stage 2）
