# 44 — Biome migration + TypeScript 7 upgrade

> **Status: implemented** (2026-07-14) — see commit trail `d41eb699 · 1e137ec0 · 44f7fdfb · fa70e988` on main
>
> 把 pew 从 `typescript-eslint` + ESLint 迁到 **Biome 2.5**，随后把 monorepo
> 的 TypeScript 从 `6.0.3` 升到 **稳定版 `typescript@7.0.2`**（同时装
> `@typescript/native-preview` 到 `packages/web` 供 Next 16 类型检测使用；
> typecheck 一律走 stable `tsc`）。参考实现在 `../raven` 已跑通生产
> （raven dashboard 也是 Next 16，pew web 与之等价）。

## 一、为什么现在做

- `typescript-eslint@8.63` 的 peer 硬上限是 `typescript >=4.8.4 <6.1.0`。TS 7 想装
  就装不上，`bun install` 会解不出。这是**升级的强物理约束**。
- 目前 G1 gate 是 `tsc --noEmit × 5 + eslint . --max-warnings=0`。每次 lint 冷启动
  ~30 s、热启动 ~10 s；biome 冷启动 ~1 s、热启动 <200 ms（raven 实测）。
- ts-eslint 有 26 000+ npm 包依赖它，未来跟 TS 版本会持续错位（TS 7 rc 已存在，
  ts-eslint 至少 3–6 个月才有 8.x 兼容版本；1 年后重复今天的困境）。
- Biome 基于 Rust（自有 JS/TS 前端），与 TypeScript 版本解耦：pew 升到 TS 7
  甚至 TS 8 都无需换 lint。两个自研 gate 脚本用 `oxc-parser`（也 Rust 实现）
  独立解 AST，同样不依赖 tsc 版本。

## 二、raven 走通的路径（供直接照搬）

按 raven 的 git log 时间线（`git log --oneline` on raven main）：

| # | commit | 变更 |
|---|---|---|
| 1 | `58c5d05` | 单个 commit 完成 eslint → biome 切换：新 `biome.json`、根/子包 `lint` script 改 `biome check`、`lint-staged` 换成 biome、卸载 eslint 依赖、删 `eslint.config.js`、把所有 inline `// eslint-disable-next-line` 翻译成 `// biome-ignore`（**同一 commit 内**，避免中间态既没 eslint 也没 biome-ignore） |
| 2 | `987f7a6` / `80ed74f` | README + CLAUDE.md 文案 |
| 3 | `8678e09` | 严格性对齐：把 biome recommended 之外的 tseslint-strict 规则一条条 elevate 到 `error` |
| 4 | `bac2b6a` | 补两个 tseslint 有但 biome 没有的规则：`no-dynamic-delete` + `ban-ts-comment` 描述长度 → `scripts/check-dynamic-delete.ts` + `scripts/check-ts-expect-error.ts`（用 `oxc-parser` 解 AST） |
| 5 | `28f9d2d` | **走弯路**：TS 6 与 TS 7 双 sidecar (`typescript` + `typescript7: npm:typescript@7.0.2`) — 后被 revert |
| 6 | `b7a9af6` | **最终方案**：单包 `@typescript/native-preview@7.0.0-dev.*`（供 Next 检测） + `typescript@^7.0.2` stable（供 `tsc` 走 typecheck 与 build）+ 删除 sidecar |
| 7 | `e6d3a66` | `dependency-cruiser` 需要 TS ≤6 Compiler API → aliased `typescript6-for-depcruise: npm:typescript@6.0.3`（**pew 无 depcruise，跳过**） |
| 8 | `fd7e27d` | 把 `scripts/` 目录也纳入 biome gate |

pew 跳过步骤 5（sidecar 弯路）与 7（depcruise 不适用），最终态与步骤 6 一致。

**关键：raven 用 stable `tsc` 做所有 typecheck 和 build**，`native-preview` 仅装
在有 Next 的包供 `next build` 的类型自动检测使用。`tsgo` binary 不进 gate 链路。

## 三、pew 的差异分析

### 3.1 依赖差异

| 项 | raven | pew | 备注 |
|---|---|---|---|
| Next.js | dashboard 用 Next 16 | web 用 Next 16.2.10 | 相同栈 |
| `@next/eslint-plugin-next` | 无（Next 16 移除内建 `next lint`） | 有 | 见 §3.3 逐条评估 |
| `eslint-plugin-react-hooks` | 无（dashboard hooks 覆盖面小） | 有 7.1.1 | recommended 启用 16 条规则，见 §3.4 |
| Workers | 无 | 4 个 wrangler worker | 无 lint 差异 |
| `dependency-cruiser` | 有 | 无 | pew 跳过 raven 步骤 7 |

### 3.2 pew 的 suppression 盘点（精确）

以 `rg -o 'eslint-disable(-next-line)? [@a-z/-]+' packages/*/src` 精确统计：

| 规则 | 出现处数 | 文件分布 |
|---|---:|---|
| `@typescript-eslint/no-dynamic-delete` | **6** | 4 文件：`cli/notifier/claude-hook.ts` ×1 + `cli/notifier/gemini-hook.ts` ×1 + `cli/notifier/openclaw-hook.ts` ×2 + `cli/__tests__/sync.test.ts` ×2 |
| `@next/next/no-img-element` | **13** | web 10 个 `.tsx` 文件：`showcase-image` / `pricing-table` / `teams/page` / `teams/[teamId]/page` / `layout/sidebar` (×2) / `leaderboard/logo-icons` / `dashboard/model-info-tooltip` / `admin/showcases/admin-showcases-content` / `admin/organizations/page` (×3) / `leaderboard/seasons/[slug]/page` |
| `@typescript-eslint/no-explicit-any` | **4** | 全在 `cli/parsers/*-sqlite-db.ts`（bun:sqlite / node:sqlite 双 runtime 类型骨架） |
| `react-hooks/purity` | **1** | `packages/web/src/app/(dashboard)/manage-devices/page.tsx` |
| `no-constant-condition` | **1** | `packages/web/src/app/api/admin/invites/route.ts` |
| **合计** | **25** | |

以上就是"lint gate 上 warn 但已被静默"的全部真源；每一条都要有**准确的
biome 替代或明确接受丢失**。

### 3.3 Next 特有规则的显式取舍

`@next/eslint-plugin-next` 推荐 + core-web-vitals 共 21 条规则。pew 只被
`no-img-element` 命中过（13 处 disable）+ `no-html-link-for-pages` 挂在
`eslint.config.ts`。其余 19 条要**逐条决定**是否放弃：

| Next 规则 | pew 是否触发 | 迁移策略 |
|---|---|---|
| `no-img-element` | 是（13 处 disable） | biome `performance.noImgElement`（等价） |
| `no-html-link-for-pages` | 否（配置有，实际 0 error — pew 全 app-router） | 放弃 |
| `no-async-client-component` | 否 | **接受丢失**（下轮 review 若发现问题再补自研 gate） |
| `no-before-interactive-script-outside-document` | 否 | 接受丢失 |
| `no-css-tags` / `no-head-import-in-document` / `no-head-element` / `no-document-import-in-page` / `no-duplicate-head` / `no-page-custom-font` / `no-script-component-in-head` / `no-styled-jsx-in-document` / `no-sync-scripts` / `no-title-in-document-head` / `no-typos` / `no-unwanted-polyfillio` / `google-font-display` / `google-font-preconnect` | 否 | 全部接受丢失（未曾在 pew 中告警） |
| `inline-script-id` | 否 | 接受丢失 |
| `next-script-for-ga` | 否 | 接受丢失 |

**接受丢失**的理由统一：这些是 pages-router 遗迹 / 边缘 SEO 优化 / 极少人踩的
用法。Next 16 本身也在移除 built-in `next lint`，说明官方也不再把这些当核心。

### 3.4 react-hooks recommended 逐条评估

pew 用 `eslint-plugin-react-hooks@7.1.1`。以 `node -e "console.log(Object.keys(
require('eslint-plugin-react-hooks').configs.recommended.rules))"` 的实测输出
为准，recommended 启用**16 条**规则（不含 `component-hook-factories` / `fbt`
/ `void-cleanup`，含 `config` / `incompatible-library` / `use-memo`）：

| eslint rule | pew 是否 disable / 用到 | biome 替代 | 迁移策略 |
|---|---|---|---|
| `rules-of-hooks` | 未 disable | `correctness.useHookAtTopLevel` | 直接换 |
| `exhaustive-deps` | 未 disable | `correctness.useExhaustiveDependencies` | 直接换 |
| `purity` | **1 处 disable** (`manage-devices/page.tsx:87`) | 无等价 | **接受丢失**；删 disable 注释，加代码内 `// TODO: react-hooks/purity — no biome equivalent, manual audit` |
| `config` | 未 disable（配置元规则） | 无 | 接受丢失（对 eslint-config 本身语义警告，pew 无自定义） |
| `error-boundaries` | 未 disable | 无 | 接受丢失 |
| `gating` | 未 disable | 无 | 接受丢失 |
| `globals` | 未 disable | 无 | 接受丢失 |
| `immutability` | 未 disable | 无 | 接受丢失 |
| `incompatible-library` | 未 disable | 无 | 接受丢失（不使用不兼容库） |
| `preserve-manual-memoization` | 未 disable | 无 | 接受丢失 |
| `refs` | 未 disable | 无 | 接受丢失 |
| `set-state-in-effect` | 未 disable | 无 | 接受丢失 |
| `set-state-in-render` | 未 disable | 无 | 接受丢失 |
| `static-components` | 未 disable | 无 | 接受丢失 |
| `unsupported-syntax` | 未 disable | 无 | 接受丢失（Compiler 前置警告） |
| `use-memo` | 未 disable | 无 | 接受丢失（推荐使用 useMemo 场景检测） |

**结论**：react-hooks 迁移会**丢失 14 条 rule**（包括 pew 已用到的 `purity`）。
这是**明确接受的降级**——理由：pew 主要开发面在 CLI + web api，Next client-side
组件是次要面（web app 是 dashboard + leaderboard，无复杂交互）。若未来 client
组件复杂度升级，回补自研 hook lint 或引入 react-lint 二进制。

### 3.5 pew 独有 gate

- `no-restricted-syntax` 禁 `.skip` / `.only`（`eslint.config.ts:62-72`）
- biome 有 `suspicious.noSkippedTests` / `suspicious.noFocusedTests` — **等价+
  更精**（识别 `describe.skip`、`it.only`、`test.only`），放到 biome test
  override 里 elevate 到 `error`
- **不需要**自研 `check-test-modifiers.ts`（早期 draft 有过，已删）

## 四、目标状态（迁移完成时的物理形态）

### 4.1 依赖

```jsonc
// package.json (root) — devDependencies
{
  "@biomejs/biome": "2.5.3",           // ← 新增
  "typescript": "^7.0.2",              // ← 6.0.3 → 7.0.2 stable
  "oxc-parser": "0.139.0",             // ← 新增（pin exact；raven 验证版本，
                                        //   0.x 的 caret 不会跨到 0.139，必须精确 pin）

  // 移除
  // "@eslint/js": "^10.0.1",
  // "@next/eslint-plugin-next": "16.2.10",
  // "eslint": "^10.7.0",
  // "eslint-plugin-react-hooks": "7.1.1",
  // "typescript-eslint": "^8.63.0",
}
```

```jsonc
// packages/web/package.json — devDependencies
{
  "@typescript/native-preview": "7.0.0-dev.20260707.2"  // ← 仅 web 装，pin exact
}
```

`packages/{web,worker,worker-read}/package.json` 里的 `typescript: ^6.0.3` **全部
去掉**（root 统一提供 7.0.2）。`packages/{core,cli}/package.json` **本来就没有**
typescript devDep，不需要改。

**为什么 native-preview 只在 web**：Next 16 检测到 `@typescript/native-preview`
存在后**跳过它自己的内部类型检查**（`next build` 里嵌入的 typecheck 逻辑），
从而绕开 TS 7 stable 没经典 Compiler API 会失败的问题。native-preview 只是
一个存在检测标记，Next **不会实际调用** tsgo。CLI / worker / core 不用 Next，
装了浪费磁盘。**Web 侧 typecheck 依然由 `tsc --noEmit`（stable 7.0.2）在
`build` 前显式串行完成**（§4.3）。

### 4.2 biome.json（monorepo 根）

以 raven `biome.json` 为基础，**但不完全照搬**——raven 全局关闭
`style.noNonNullAssertion`，与 pew 现状不符（pew ESLint 只在测试目录关
`@typescript-eslint/no-non-null-assertion`，生产代码依然强制）。pew 迁移
必须**恢复生产严格性**。

- 复用 §4.2 raven 的 rules（style / suspicious / complexity / correctness /
  security / performance / a11y 全套）
- **强制覆盖**：`style.noNonNullAssertion: "error"`（顶层全局；对齐 pew 现状
  ，raven 的 `off` 不能带过来）
- `includes` 追加 `"!**/.next-e2e/**"`, `"!**/.next-e2e-ui/**"`,
  `"!packages/web/next-env.d.ts"`（pew 特有 ignore）
- `overrides`：
  - `**/*.test.ts`, `**/*.test.tsx`, `**/__tests__/**` — `noExplicitAny: off` +
    **`noNonNullAssertion: off`**（顶层全局是 error；测试文件里 `!` 是常见 fixture
    write，不 spam）+ `useImportType: off`
  - **同一 override** elevate `suspicious.noSkippedTests: error` +
    `suspicious.noFocusedTests: error`（替代 pew 现在的 `no-restricted-syntax`）
- `formatter.enabled: false`（pew 无 prettier，不引 formatter 变更）

### 4.3 lint / typecheck / build 脚本

**根本原则**：所有 typecheck 和 build 走**同一个 `tsc@7.0.2`**。biome 只做 lint。
根 `lint` **必须包含 typecheck**（否则 CI 会漏检 CLI/Worker 类型 error——
`.github/workflows/ci.yml` 里 `typecheck-command: ""` 的注释"Included in lint script"
就是这个约定）。Next build **显式串接** `tsc --noEmit && next build`（因 Next
检测到 native-preview 就跳过自身 typecheck）。

```jsonc
// root package.json
{
  "scripts": {
    "typecheck": "bun run --filter '*' typecheck",
    "lint": "bun run typecheck && biome check --no-errors-on-unmatched --error-on-warnings --max-diagnostics=500 . && bun run gate:dynamic-delete && bun run gate:ts-expect-error",
    "lint:typecheck": "bash scripts/parallel-typecheck.sh",
    "lint:typecheck:cached": "bun run scripts/run-g1a.ts",
    "gate:dynamic-delete": "bun run scripts/check-dynamic-delete.ts",
    "gate:ts-expect-error": "bun run scripts/check-ts-expect-error.ts"
  }
}
```

**全部 5 个子包**都必须加 `typecheck` script（否则 `bun run --filter '*' typecheck`
会**静默跳过**没有该 script 的包 — 实测当前 web/worker/worker-read 已经有，
**core / cli 没有**，直接迁移会漏检 CLI 与 core 的类型 error）：

```jsonc
// packages/{core,cli,worker,worker-read}/package.json
{ "scripts": { "typecheck": "tsc --noEmit -p tsconfig.json" } }

// packages/web/package.json — build 显式 tsc && next build，防止 Next 自动跳过
{
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "build": "tsc --noEmit && next build"
  }
}
```

**根 `typecheck`** 使用 `bun run --filter '*' typecheck` 保留 5 项目独立 tsconfig
加载，与现有 `parallel-typecheck.sh` / `run-g1a.ts` 一致。**绝不用** `tsc
--noEmit` 直接在根跑——那会走根 `tsconfig.json` 而不加载子包 tsconfig，产生大量
JSX / 路径 alias / worker 类型误报。

**CI 也要一并调整**：`.github/workflows/ci.yml:21` 现在是 `typecheck-command:
""`（注释"Included in lint script"），迁移后 lint 已明确包含 typecheck，注释
保持事实即可；同时补上 `.github/workflows/ci.yml:21` 附近的显式 comment 说明
"typecheck 由根 lint 内 `bun run typecheck` 完成"。如果哥希望 CI 独立展示 typecheck
输出，可以把 `typecheck-command: "bun run typecheck"` 恢复回来（多跑一次 4 秒，
换来 CI 面板独立 timing）。**默认方案：保留在 lint 里**，CI 无需改动。

### 4.4 自研 gate scripts

搬 raven 两个（都基于 `oxc-parser`，与 tsc 版本解耦）：

- `scripts/check-dynamic-delete.ts` — 禁 `delete obj[computed]`，允许 `delete obj.static`
- `scripts/check-ts-expect-error.ts` — `@ts-expect-error` 必须带 ≥10 字符描述

**重要：不能原样搬运** raven 脚本，需要改四处：

1. **`ROOTS` 常量必须换成 pew 的路径**：
   ```ts
   const ROOTS = [
     join(import.meta.dir, "..", "packages", "core", "src"),
     join(import.meta.dir, "..", "packages", "cli", "src"),
     join(import.meta.dir, "..", "packages", "web", "src"),
     join(import.meta.dir, "..", "packages", "worker", "src"),
     join(import.meta.dir, "..", "packages", "worker-read", "src"),
   ];
   ```
2. **fail-closed 检查**：在扫描后如果处理文件数为 0，脚本必须 `exit 1` 并明确
   打印"扫描到 0 个文件，路径配置错误"。防止 ROOTS 拼错时脚本假绿。
   ```ts
   if (scannedCount === 0) {
     console.error(`FATAL: scanned 0 files under ${ROOTS.join(", ")} — misconfigured?`);
     process.exit(1);
   }
   ```
3. **精确到 (path,line) 的白名单**（不是 raven 的整文件 `ALLOWED`）：raven 的
   `ALLOWED: Record<string, string>` key 是文件路径 → 意味着该文件里所有
   `delete obj[computed]` 都放行，未来新增的违规也不会告警。pew 有 6 处 disable
   分布在 4 个文件（`openclaw-hook.ts` 和 `sync.test.ts` 各 2 处），必须**逐行
   精确**允许，避免"允许一行 = 放行整个文件"的漏保护：

   ```ts
   // scripts/check-dynamic-delete.ts
   // Format: `${repoRelPath}:${1-indexed-line}` → reason
   const ALLOWED_SITES: Record<string, string> = {
     "packages/cli/src/notifier/claude-hook.ts:XX":  "hook cleanup: dynamic key = source name",
     "packages/cli/src/notifier/gemini-hook.ts:XX":  "hook cleanup: dynamic key = source name",
     "packages/cli/src/notifier/openclaw-hook.ts:XX": "hook cleanup: dynamic key = source name",
     "packages/cli/src/notifier/openclaw-hook.ts:YY": "hook cleanup: dynamic key = env var",
     "packages/cli/src/__tests__/sync.test.ts:AA":   "test fixture: delete synthetic cursor entry",
     "packages/cli/src/__tests__/sync.test.ts:BB":   "test fixture: delete synthetic cursor entry",
   };

   // In the visitor (collect() helper — NOT inside a loop, so `continue`
   // would throw SyntaxError; use if-wrap around the push instead):
   const site = `${repoRel}:${node.loc.start.line}`;
   if (!(site in ALLOWED_SITES)) {
     out.push(violation);
   }
   ```

   行号在 Commit 1 落地时对齐（`rg -n '// eslint-disable-next-line
   @typescript-eslint/no-dynamic-delete' packages/cli/src` 拿准确行号，然后
   `+1` 因为 disable 注释指向下一行）。

4. **消除脚本内部的 `noNonNullAssertion` 违规**：raven 的
   `check-dynamic-delete.ts` 里用 `.split("\n")[0]!.trim()`（`raven/scripts/
   check-dynamic-delete.ts:106`）——pew 顶层 `noNonNullAssertion: error`（§4.2）
   会立刻打红。搬运时改成安全取值，例如：
   ```ts
   snippet: (src.slice(startPos, endPos).split("\n")[0] ?? "").trim(),
   ```
   同样审计 `check-ts-expect-error.ts` 里的所有 `!` 断言并全部改成 `?? ""` /
   `if (!x) continue` 兜底。目标：**gate 脚本自身通过 biome lint**，否则 Commit 2
   独立跑 `bun run lint` 会挂。

依赖：`oxc-parser` 必须显式加进 root `devDependencies`（**见 §4.1 已列出**），否则
脚本首次运行 `Cannot find package 'oxc-parser'`。

### 4.5 husky hooks

- `.husky/pre-commit`：G0 lockfile 保留；G1 里把 `bun run lint:typecheck:cached`
  内部的 `tsc` 保持不变（就是 stable tsc@7.0.2）；把 `bunx lint-staged` 换 biome；
  追加 `bun run gate:dynamic-delete` + `gate:ts-expect-error` 两条串行（脚本瞬完）
- `.husky/pre-push`：不变（L2/L3/G2 与 lint 无关）
- `lint-staged` 里 `*.{ts,tsx}` action 从 `eslint --max-warnings=0 ...` 换成
  `biome check --no-errors-on-unmatched --error-on-warnings --max-diagnostics=500
  --staged`

## 五、关键挑战与解决

### 挑战 1：TS 7 stable 也不再 export Compiler API

**验证**（本地 `npm install typescript@7.0.2 && ls node_modules/typescript/lib`
输出）：只有 `tsc.js` / `version.cjs` / `getExePath.js`，**没有** `typescript.js`。

意味着**stable 版本也一样**：任何 `import * as ts from "typescript"` 的静态分析
消费者（dependency-cruiser、ts-morph、部分 Next 内部代码路径）都会挂。

**pew 里的调用点**：无（无 depcruise、无 ts-morph、无自研 ts 消费）。
**Next build 的影响**：Next 16.2.10 检测到 `@typescript/native-preview` 存在
后**跳过自身内部的 typecheck**（并**不实际调用** tsgo，只是把 native-preview
的存在当作"用户自己会 typecheck"的信号）；意味着 `next build` 里**不再执行**
TS 类型检查。所以 pew web build script 必须显式串 `tsc --noEmit && next build`
（§4.3）。

### 挑战 2：Next 16 已 drop `next lint`

原本靠 `next lint` 的 rule（`no-html-link-for-pages`）必须落到别处。

**解决**：pew 全 app-router，`no-html-link-for-pages` 本来就 0 命中，直接放弃；
`no-img-element` 由 biome 内置 `performance.noImgElement` 接管。

### 挑战 3：react-hooks 覆盖度

详见 §3.4。**明确接受**丢失 14 条规则（包括 pew 已用到的 `purity`）。理由：
biome recommended + 严格 rules 已经覆盖 pew CLI 主战场；web dashboard 里的
React 复杂度低，交由 code review + L3 Playwright 兜底。

### 挑战 4：`no-dynamic-delete` 只 biome 缺

biome 唯一等价规则 `complexity.noDelete` 是**全禁 delete**，会把 pew 6 处合法
disable + 未来所有 `delete obj.static` 一起打错。

**解决**：搬 raven 的 `scripts/check-dynamic-delete.ts`（区分动态 key 和静态 key）
+ pew ROOTS + fail-closed（§4.4）。

### 挑战 5：`.skip` / `.only` 禁止

biome `suspicious.noSkippedTests` / `noFocusedTests` 覆盖，无需自研脚本。

### 挑战 6：25 处 eslint-disable 的翻译

| ESLint disable | 出现次数 | Biome 替代 | 处理方式 |
|---|---:|---|---|
| `@typescript-eslint/no-dynamic-delete` | 6 | 由 `check-dynamic-delete.ts` 处理 — 无需 inline biome-ignore | 删除原 disable，脚本继续 whitelist 通过 |
| `@next/next/no-img-element` | 13 | `lint/performance/noImgElement` | 翻译成 `// biome-ignore lint/performance/noImgElement: <reason>` |
| `@typescript-eslint/no-explicit-any` | 4 | `lint/suspicious/noExplicitAny` | 翻译成 `// biome-ignore lint/suspicious/noExplicitAny: <reason>` |
| `react-hooks/purity` | 1 | 无 | 保留代码但去掉 disable 注释（biome 不 lint 这条），加 `// TODO: react-hooks/purity — no biome equivalent, monitored via review` |
| `no-constant-condition` | 1 | biome 的 `noConstantCondition` 属 recommended，行为等价 | 翻译成 `// biome-ignore lint/correctness/noConstantCondition: <reason>` |

翻译方法：每处 `// eslint-disable-next-line X` 改成 `// biome-ignore lint/<rule>: <reason>`。
biome 强制要求 reason 部分，正好逼作者写清楚。

### 挑战 7：Commit 1 的独立编译问题

**旧计划错误**：Commit 1 若只删 eslint-disable 但保留 eslint，会因既有的
`any` / dynamic delete / img / purity 违规立即全部重新触发 error。

**修正**：**翻译 + 换 linter 必须在同一个 commit**——参考 raven `58c5d05` 的做法。
详见 §六新提交计划。

### 挑战 8：迁移工作量（用真实 biome dry-run 而非猜测）

**先跑一次 raven 的 biome.json 副本 dry-run**，看真实错误：raven 实测 pew 仓库
用 raven biome 配置能跑出 **406 errors + 21 warnings**（截至复查时）。分类
批处理：

- **auto-fixable**（`biome check --write`）：`useImportType`（type-only import
  加 `type` 关键字）、`useNodejsImportProtocol`（`fs` → `node:fs`）、
  `useAsConstAssertion`、`noUselessEmptyExport`、`noUselessConstructor`、
  `noUnusedImports` — 预期 ≥300 error 一次跑消解
- **半自动**：`noExplicitAny`（4 处已 disable + 未知量新触发）、`noNonNullAssertion`
  、`noConfusingVoidType` — 逐处手工换类型或加 `biome-ignore`；预期 50–80 处
- **需要真思考**：`useHookAtTopLevel` / `useExhaustiveDependencies` — 复用现有
  react-hooks 已解决地方（0 error 预期）；如果新增手工修

**行动流程**（Pre-flight 独立于 Commit 计划，不产生 commit）：

1. **复制 raven biome.json 到临时位置，然后按 §4.2 应用 pew 特有覆盖**（顶层
   `style.noNonNullAssertion: "error"`、pew 特有 `includes` 忽略项、test
   override 里的 `noSkippedTests` / `noFocusedTests`）—— 直接用 raven 原版会
   低估 error 数（raven 全局关的 `noNonNullAssertion` 到 pew 是 error，会
   多出可观数量的告警）：
   ```bash
   cp ../raven/biome.json /tmp/pew-preflight-biome.json
   # 手工编辑或用 jq 打补丁：
   #   1. 顶层 linter.rules.style.noNonNullAssertion = "error"
   #   2. files.includes 加 pew ignore 项
   #   3. overrides 里 test glob 里 noNonNullAssertion = "off"
   #   4. overrides 里 test glob 加 noSkippedTests/noFocusedTests = "error"
   ```
2. 用 `--config-path` 显式指向该副本，跑 dry-run：
   ```bash
   bunx --package @biomejs/biome@2.5.3 biome check \
     --config-path=/tmp/pew-preflight-biome.json \
     --no-errors-on-unmatched --max-diagnostics=1000 .
   ```
3. 把输出按 `--reporter=summary` 或 `--reporter=json` 汇总 rule → count，形成
   `docs/44-preflight-report.md`（不提交，供决策用）
4. 根据分布决定：如果 auto-fixable ≥ 80%，Commit 1 合并成一个原子步；若手工
   修改超 100 处，考虑拆 Commit 1a（`--write` auto-fix）与 Commit 1b（手工修
   剩余 + 翻译 25 处 disable）

## 六、原子化提交计划

每个 commit 独立 buildable + testable。

| # | commit | 内容 | 独立 lint+test+build? |
|---|---|---|---|
| **Pre-flight** | *（不 commit）* | §5 挑战 8 完整流程：临时 copy raven biome.json → `bunx --config-path` dry-run → 汇总 error 分类 → 决定 Commit 1 是否再拆 1a/1b | — |
| 1 | `chore(lint): switch from eslint to biome + translate all suppressions` | **原子切换**：装 `@biomejs/biome@2.5.3` + `oxc-parser@0.139.0`；卸 `eslint / @eslint/js / @next/eslint-plugin-next / eslint-plugin-react-hooks / typescript-eslint`；新增 `biome.json`（§4.2）；**为 5 个子包全部加 `typecheck` script**（core/cli 目前没有，遗漏会让 `--filter '*'` 静默跳过 → CLI/core 漏检）；根 `lint` 换成含 typecheck 的组合（§4.3）；`lint-staged` 换 biome；`biome check --write` 自动修 auto-fixable；剩余 25 处 inline `eslint-disable` 一次性翻译成 `biome-ignore` / 移除；删 `eslint.config.ts`。**同一 commit 起步 = eslint-disable 完成翻译，中间态可编译** | ✅ `bun run lint` 全绿（biome + tsc@6） |
| 2 | `feat(lint): add dynamic-delete + ts-expect-error custom gates` | 加 `scripts/check-dynamic-delete.ts`（含 `ALLOWED_SITES` 逐行 whitelist §4.4）+ `scripts/check-ts-expect-error.ts`；根 `lint` 追加两条 gate；`.husky/pre-commit` 加两条串行 | ✅ |
| 3 | **合并**：`build(web+ts): install native-preview, upgrade to TS 7.0.2 stable, stitch tsc into next build` | **单原子步骤**（避免 next build 中间态失败）：<br>1) `packages/web` 装 `@typescript/native-preview@7.0.0-dev.20260707.2`（**先装**，让 Next 检测到 native-preview marker → 跳过自身内部 typecheck，不会真调 tsgo）<br>2) `packages/web/package.json` `build` 改成 `tsc --noEmit && next build`<br>3) 根 `typescript: ^6.0.3 → ^7.0.2`；`packages/{web,worker,worker-read}/package.json` 移除 `typescript` devDep（`core / cli` 本来就没有）<br>4) `bun install` 更新 lockfile；跑 `bun run typecheck` 修 TS 7 变严格暴露的类型 error（预期少量）<br>5) `bun run --filter '@pew/web' build` 全绿验证 | ✅ 单 commit 内完成上下文切换 |
| 4 | `feat(husky): switch pre-commit G1 to biome + custom gates` | `.husky/pre-commit` 里 `bunx lint-staged` 已在 Commit 1 换成 biome；此 commit 只清理老 hook 里的 eslint 残留 comment + 更新 exit message | ✅ |
| 5 | `docs(44): mark biome migration + ts7 upgrade implemented; update CLAUDE.md/README` | doc 44 status → done；CLAUDE.md G1 描述改 biome；README lint 说明改 biome；suppression map 落地 | ✅ |

**顺序关键**：Commit 3 内部"native-preview + build script → 才升 TS 7"这三步在
**同一 commit 内**（`git diff HEAD~1` 会同时显示这些改动），保证 CI/pre-push
在 Commit 3 上拉起时不会经历"TS 7 但 Next 找不到经典 API"的可失败中间态。

每个 commit 单独跑：`bun run lint` + `bun run test` + `bun run --filter '@pew/web' build` 全绿。

## 七、测试覆盖率保障

- 迁移**前**跑 `bun run test:coverage` 记录基线（预期 branches 95.25% /
  statements 98.44%）
- 每个 commit 之后重跑，**期望 0 变化**——biome 只做静态分析、tsc 只做类型
  检查，都不改运行时代码。若出现**任何** ±0.01% 的差异，必须**在 commit
  message 里说明因由**（哪个测试文件被 `--write` auto-fix 改动、哪个 branch
  因删除 eslint-disable 被新覆盖），**不允许**用"±0.5% 抖动" 掩盖
- 若 branches < 95%（`vitest.config.ts` 阈值），阻断 merge

## 八、时间估算（含 pre-flight dry-run）

- **Pre-flight biome dry-run + 错误分类**：0.5 天
- **Commit 1（原子切换 + 翻译 25 处 + 手动修剩余 error）**：1.5 天（视 dry-run 结果调整）
- **Commit 2（自研 gate）**：0.5 天
- **Commit 3（合并：native-preview + TS 7 stable + build 补位）**：1 天
- **Commit 4-5（hook cleanup + docs）**：0.5 天
- **合计**：约 3.5–4 天，含 Pre-flight

## 九、回退计划

每个 commit 独立可回退：`git revert <sha>` + `bun install`。用 `revert` 而不用
`reset --hard`，因为：
- reset 会丢失 push 后拉了此 commit 的其他机器的 rebase state
- revert 生成新 commit 记录"为什么撤"，保留审计线索
- lockfile 也没有真正的"物理不可回退"——`bun install` 从 revert 后的
  package.json 会重新生成，Windows/macOS/Linux 结果确定

场景应对：

- **Commit 1 lint 挂**：`git revert HEAD` 拿回 eslint 状态；lockfile 会因去
  eslint 而 diff，`bun install` 恢复
- **Commit 3 build 挂**（TS 7 上下文切换失败）：`git revert HEAD` 一次性回到
  TS 6 + 无 native-preview 的干净状态。因为三步在同一 commit 内，revert
  也是原子的
- **Commit 3 上线后发现某处 TS 7 严格性触发新 error**：不要 revert 已发布的
  commit（会污染 main）；直接**追加**一个 fix commit（改类型 or 加
  `// @ts-expect-error: ts7-strict:<reason>`）

## 十、Post-migration 收益

- **G1 冷启动**：30 s → 5 s（biome 1 s + `tsc@7` 5 包并行 4 s）
- **G1 热启动**：10 s → 1 s
- **依赖数（实测）**：`bun pm ls --all` 总树条目从迁移前 **640** 降到迁移后 **550**（−90）。`rg -c eslint` = 0，`rg -c typescript-eslint` = 0（原为 25 / 11）
- **TS 7 就位**：`satisfies` v2、更快 inference、erasable syntax
- **未来 TS 8/9 升级**：与 biome 完全解耦，只改一行 typescript 版本

## 十一、References

- raven `../raven/` — 已经在生产运行的完整实现
- raven git log — 时间线可直接对照（重点 `58c5d05` `b7a9af6` `bac2b6a` `fd7e27d`）
- Biome 2.5 docs — [https://biomejs.dev/reference/](https://biomejs.dev/reference/)
- TS 7 preview — [https://github.com/microsoft/typescript-go](https://github.com/microsoft/typescript-go)
- Next 16 typescript-go support — Next.js changelog 16.2.10
- pew doc 30（quality system upgrade）— 定义 G1 gate 语义
- pew doc 31（D1 test isolation）— 说明 pre-push L2/L3 与 G1 无关
- pew `eslint.config.ts`（迁移后删除）— 基线 rule set
- pew `.husky/pre-commit` — 修改点

## 附录 A — pew 现有 25 处 suppression 逐条

| # | 文件 | 行 | 规则 | 迁移后动作 |
|---|---|---|---|---|
| 1 | `packages/cli/src/notifier/claude-hook.ts` | ~ | `@typescript-eslint/no-dynamic-delete` | 删 disable；由 `check-dynamic-delete.ts` whitelist 允许 |
| 2 | `packages/cli/src/notifier/gemini-hook.ts` | ~ | 同上 | 同上 |
| 3-4 | `packages/cli/src/notifier/openclaw-hook.ts` | ~ ×2 | 同上 | 同上 |
| 5-6 | `packages/cli/src/__tests__/sync.test.ts` | ~ ×2 | 同上 | 同上 |
| 7 | `packages/cli/src/parsers/hermes-sqlite-db.ts` | ~ | `@typescript-eslint/no-explicit-any` | `biome-ignore lint/suspicious/noExplicitAny: bun:sqlite/node:sqlite dual-runtime require` |
| 8 | `packages/cli/src/parsers/opencode-sqlite-db.ts` | ~ | 同上 | 同上 |
| 9 | `packages/cli/src/parsers/zcode-sqlite-db.ts` | ~ | 同上 | 同上 |
| 10 | `packages/cli/src/parsers/zcode-sqlite-session-db.ts` | ~ | 同上 | 同上 |
| 11 | `packages/web/src/components/showcase/showcase-image.tsx` | ~ | `@next/next/no-img-element` | `biome-ignore lint/performance/noImgElement: <reason>` |
| 12 | `packages/web/src/app/(dashboard)/model-prices/pricing-table.tsx` | ~ | 同上 | 同上 |
| 13 | `packages/web/src/app/(dashboard)/teams/page.tsx` | ~ | 同上 | 同上 |
| 14 | `packages/web/src/app/(dashboard)/teams/[teamId]/page.tsx` | ~ | 同上 | 同上 |
| 15-16 | `packages/web/src/components/layout/sidebar.tsx` | ~ ×2 | 同上 | 同上 |
| 17 | `packages/web/src/components/leaderboard/logo-icons.tsx` | ~ | 同上 | 同上 |
| 18 | `packages/web/src/components/dashboard/model-info-tooltip.tsx` | ~ | 同上 | 同上 |
| 19 | `packages/web/src/app/(dashboard)/admin/showcases/admin-showcases-content.tsx` | ~ | 同上 | 同上 |
| 20-22 | `packages/web/src/app/(dashboard)/admin/organizations/page.tsx` | ~ ×3 | 同上 | 同上 |
| 23 | `packages/web/src/app/leaderboard/seasons/[slug]/page.tsx` | ~ | 同上 | 同上 |
| 24 | `packages/web/src/app/(dashboard)/manage-devices/page.tsx` | 87 | `react-hooks/purity` | 删 disable；加 `// TODO: react-hooks/purity — no biome equivalent, manual audit only` |
| 25 | `packages/web/src/app/api/admin/invites/route.ts` | ~ | `no-constant-condition` | `biome-ignore lint/correctness/noConstantCondition: <reason>` |

*具体行号在 Commit 1 落地时对齐。*
