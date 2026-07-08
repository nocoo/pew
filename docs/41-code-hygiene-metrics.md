# 41 · 代码卫生指标与清理路线

> 只读调研成文。目标：在**不改变业务逻辑**的前提下，让仓库的"东西"（代码、注释、脚本、文档、依赖、二进制资产）尽量少，且过时/无用之物能被**可观测、可门禁化**地及时移除。
>
> 本文档同时作为后续原子化清理提交的**基线快照**（baseline）。

## 总体进度

| 指标 | 基线 | 当前 | 状态 |
|---|---|---|---|
| **G1** 死代码 | 11 files / 19 exports / 40 types | **0 / 0 / 0** | ✅ done (`bf8418fe`…`479dd6c7`) |
| **G2** 依赖冗余 | 3 unused + 1 devDep + 1 unlisted binary | **0 / 0 / 0**（含 knip.json 白名单） | ✅ done (`ec8b2ac2`, `7fc42a43`, `5c1a1058`, `a42b7647`) |
| **G3** 文档孤儿 | 6 / 51 | **0 / 52** | ✅ done (`1e82f5ba`) |
| **G4** 脚本存活 | 6 dead | **0** | ✅ done (`00ac116a`) |
| **G5** 顶层残留 | 3 autoresearch + logo.png | **0** autoresearch（logo.png 保留） | ✅ done (`d3c96414`) |
| G6 巨型文件 | 5 (>1000 LOC) | 5 | ⏳ pending |
| G7 migration 冲突 | 3 组 | 3 | ⏳ pending |
| G8 债务标记 | 0.14 / kLOC | 0.14 | 📊 trend-only |
| G9 测试反模式 | 24 eslint-disable, 1 ts-ignore, 5 .skip | 24 / 1 / 5 | 📊 trend-only |
| G10 RPC 类型消费率 | 30+ unused | 30+ | ⏳ pending |

---

## 一、仓库现状速写（快照时间：见 git blame）

| 维度 | 值 |
|---|---|
| TS/TSX 源文件 | 669 个 / **158,991 行** |
| `packages/web` | 423 文件 / 93k 行（占 ~58%） |
| `packages/cli` | 177 文件 / 43k 行 |
| `packages/worker-read` | 59 文件 / 18k 行 |
| `packages/core` | 7 文件 / 2.3k 行 |
| `packages/worker` | 3 文件 / 1.2k 行 |
| `docs/*.md` | 51 个 / 22,913 行 |
| `scripts/` | 22 个可执行脚本（另含 `__tests__/`、`migrations/`） |
| 顶层杂项 | `autoresearch.jsonl` 117 KB、`autoresearch.ideas.md` 13 KB、`CHANGELOG.md` 135 KB、`logo.png` 3.6 MB |

Knip 一次扫出：**11 unused files、19 unused exports、40 unused exported types、3 unused deps、1 unused devDep** —— 说明客观信号已具备，但**尚未被门禁化**。

---

## 二、可衡量的核心指标

指标遵循 `Gn` 编号，便于后续在 CI/dashboard 与代码里引用。

### G1 · 死代码率 (Dead Code Ratio) — ✅ **DONE** (8 commits `bf8418fe`…`479dd6c7`, 2026-07-08)

> 共 8 个原子化提交，分四段：
>
> 1. **files** (`bf8418fe`, `eadf8ab9`, `8446dad9`) — 删 8 个真空文件。
> 2. **re-exports (bucket A)** (`8e84e228`) — 去 5 个无消费者 barrel re-export，以及相关未使用 `import`。
> 3. **internal-only exports (buckets B + C)** (`72b9151c`, `d3a725f9`) — 把 20 个只有模块内部使用的 `export` 降级为文件局部。
> 4. **types (bucket D + D2)** (`b61d02e7`, `479dd6c7`) — 降级 / 删除 40 个无消费者的 exported types，同时重写 CLI + worker-read 中的四个 barrel 只保留实际被消费的类型。
>
> 验证：`bun run lint = green`，`bun run test = 4186/4186`，每次提交 pre-commit 均通过。删除 / 降级的代码均保留 revive-hint 注释。
>
> 剩余的 knip 告警：**无**。`packages/web/e2e/playwright.config.ts` + `e2e/**/*.spec.ts` 已在 `knip.json` (`a42b7647`) 中声明为入口；`bunx knip --reporter compact` exit 0、零输出。

- **定义**：`(knip 判定的 unused files + unused exports 涉及行数) / 总 TS LOC`
- **基线**：
  - Unused files：11 个
    - `packages/web/e2e/playwright.config.ts`
    - `packages/web/src/components/badges/index.ts`
    - `packages/web/src/components/dashboard/achievement-panel.tsx`
    - `packages/web/src/components/dashboard/cost-per-token-chart.tsx`
    - `packages/web/src/components/dashboard/recent-bar-chart.tsx`
    - `packages/web/src/components/ui/avatar-stack.tsx`
    - `packages/web/src/components/ui/badge.tsx`
    - `packages/web/src/components/ui/card.tsx`
    - `scripts/bench-ut.ts`
    - `scripts/clear-d1-usage.ts`
    - `scripts/measure-coverage.ts`
  - Unused exports：19 个（如 `openBrowser`、`NOTIFY_HANDLER_MARKER`、`PROJECT_REF_HASH_LENGTH`、`GOAL_STORAGE_KEY`、`buttonVariants`、`compareSemver` …）
  - Unused exported types：**40 个**（主要集中在 `packages/worker-read/src/rpc/*.ts` —— RPC 返回类型定义后没有被消费方 import，见 G10）
- **工具**：`bunx knip --reporter compact`
- **优化目标**：把 knip 加进 `bun run lint`（与现有 `--max-warnings=0` 精神对齐），新增即 fail

### G2 · 依赖冗余度 (Unused Dependency Count) — ✅ **DONE** (4 commits `ec8b2ac2`, `7fc42a43`, `5c1a1058`, `a42b7647`, 2026-07-08)

- **基线**：
  - Unused dependencies：`fast-xml-parser`、`next`（top-level）、`packages/web/@auth/core`
  - Unused devDependencies：`packages/web/@types/sharp`
  - Unlisted：`postcss-load-config`（`packages/web/postcss.config.mjs` 使用但未列）、`lsof` binary（`scripts/e2e-utils.ts`）
- **注意**：`overrides` 里同样固定了 `fast-xml-parser` 版本，删除时需同步清理
- **优化目标**：Unused deps = 0；Unlisted 视情况补声明

### G3 · 文档孤儿率 (Doc Orphan Ratio) — ✅ **DONE** (`1e82f5ba`, 2026-07-08)

- **定义**：`docs/` 下未被任何 `.md/.ts/.tsx` 反向引用的文件数 / 总 doc 数
- **基线**（basename grep，偏保守）：**6 个孤儿**
  - `docs/19-leaderboard-agents-models.md`
  - `docs/36-github-actions-ci.md`
  - `docs/37-worker-read-security-hardening.md`
  - `docs/38-cloudflare-kv-cache.md`
  - `docs/39-badge-system.md`
  - `docs/40-l3-bdd-refactor.md`
- **额外观察**：`docs/` 存在多起编号冲突（多个 `06-*`、`07-*`、`08-*`、`16-*`、`36-*`；`40-dynamic-model-pricing.md` 与同名目录并存，还有 `40-l3-bdd-refactor.md`），说明命名规范缺失
- **优化目标**：`docs/README.md` 扩展为强制目录索引；孤儿 = 0；编号唯一

### G4 · 脚本存活率 (Script Aliveness) — ✅ **DONE** (`00ac116a`, 2026-07-08)

- **定义**：`scripts/` 下未被 `package.json` / `.github/workflows` / `.husky` / 其他 `.md`、`.ts` 引用的脚本数
- **基线**：**6 个 0-引用脚本**
  - `scripts/benchmark-docs-commit.sh`
  - `scripts/benchmark-hooks-warm.sh`
  - `scripts/benchmark-hooks.sh`
  - `scripts/benchmark-precommit.sh`
  - `scripts/benchmark-security.sh`
  - `scripts/measure-coverage.ts`
- **优化目标**：0；或将 benchmark 系合并到 `scripts/bench/` 单一入口

### G5 · 顶层残留物 (Top-Level Artifact Freshness) — ✅ **DONE (autoresearch 部分)** (`d3c96414`, 2026-07-08)

> 已清理三个 autoresearch 产物；`logo.png` 按用户指示保留（后续可考虑搬到 `assets/` 并加 pre-commit 大文件拦截）。

- **本次可疑物**：
  - `autoresearch.jsonl`（117 KB，事件流日志入库）
  - `autoresearch.ideas.md`（13 KB） + `autoresearch.md`
  - `logo.png` **3.6 MB** 位于仓库根 —— 常见二进制膨胀源
  - `coverage/` 6.3 MB —— 需确认 `.gitignore` 覆盖
- **指标**：`git ls-files | xargs -I{} du -b {} | awk '$1>500000'` 的行数
- **优化目标**：>500 KB 的非源码文件必须走白名单

### G6 · 巨型文件数 (Large File Count)

- **定义**：单文件超过分层阈值（建议 web=800、cli=1000、test=1500）
- **基线超阈**：
  - `packages/web/src/lib/db-worker.ts` **1253**
  - `packages/web/src/lib/usage-helpers.ts` **1237**
  - `packages/web/src/app/(dashboard)/admin/badges/page.tsx` **1096**
  - `packages/web/src/app/(dashboard)/admin/seasons/page.tsx` **1071**
  - `packages/cli/src/cli.ts` **958**
  - 测试类：`sync.test.ts` **3374**、`projects-api.test.ts` **1813**、`session-sync.test.ts` **1709**
- **价值**：巨型文件是"过时代码藏身处"，也是 review 盲区

### G7 · Migrations 命名冲突数

- **基线**：`scripts/migrations/` 出现 **3 组编号冲突**：`006-*` ×3、`007-*` ×2、`008-*` ×2、`016-*` ×3
- **优化目标**：0
- **一行 CI 校验**：`ls scripts/migrations | cut -c1-3 | sort | uniq -d`

### G8 · 债务标记密度 (Debt Marker Density)

- **定义**：`TODO|FIXME|XXX|HACK|@deprecated` 出现次数 / kLOC
- **基线**：22 条 / 158.9 kLOC ≈ **0.14 / kLOC**（已经很低）
- **优化目标**：设"不新增"阈值；`@deprecated` 与 knip 结果交叉后得到真正需要处理的清单

### G9 · 测试反模式计数

- **`.skip` / `.only`**：CLAUDE.md 已说要 ban。当前 grep 命中 5 处，需审计是否被 ESLint `no-only-tests` / `no-skipped-tests` 兜底
- **非测试 src 里 `console.log`**：5 处（应改 consola 或删除）
- **`eslint-disable`**：24 处（先做 baseline，只允许下降不允许上升）
- **`@ts-ignore` / `@ts-expect-error`**：1 处（很好，锁死为 ≤1）

### G10 · RPC 类型消费率（worker-read 专属病灶）

- 40 个 unused exported types 里有 **30+ 集中在 `packages/worker-read/src/rpc/*.ts`**
- **指标定义**：`worker-read/src/rpc/**` 中 export 的 type，被 `packages/web` import 的比率
- **潜在收益**：若这些类型永远只在 worker-read 内部使用，应改成 non-exported 局部 type；`packages/web/src/lib/rpc-types.ts` 才是唯一对外契约

---

## 三、优先级建议（按 ROI 排序）

| 优先级 | 指标 | 一次性动作 | 常态门禁 |
|---|---|---|---|
| P0 | G1 死代码 | 删 knip 报告里的 11 files + 19 exports | 把 knip 纳入 `bun run lint` |
| P0 | G7 migration 编号冲突 | 重编号或合并 | 加一行 CI 校验 |
| P1 | G2 依赖冗余 | 删 `fast-xml-parser`/`@auth/core`/`@types/sharp`/`next`（top-level） | knip 顺带 |
| P1 | G4 脚本存活 | 删 5 个未引用 benchmark 脚本 + `measure-coverage.ts` | pre-commit 检查 |
| P1 | G3 文档孤儿 | `docs/README.md` 做索引 → 6 个孤儿挂号或删除 | CI 校验索引完整 |
| P2 | G10 RPC 类型 | 把 worker-read 内 RPC 行类型改为局部 | 长期约束 |
| P2 | G6 巨型文件 | 拆 `db-worker.ts` / `usage-helpers.ts` | 阈值告警 |
| P3 | G5 顶层残留 | 决定 `autoresearch.*` 去留、`logo.png` 是否搬 `assets/` | pre-commit 大文件拦截 |
| P3 | G8 债务标记 | 保持 <0.2/kLOC | trend-only |
| P3 | G9 测试反模式 | baseline 24 → 只降不升 | 已有 lint 兜底 |

---

## 四、落地方案：`scripts/hygiene-report.ts`（尚未创建）

不改变任何逻辑，只输出一份周期性 markdown（可发到 CI artifact 或 dashboard）：

```
hygiene-report.md
├─ G1 dead code      knip unused files=11 exports=19 types=40   ▲ vs last week
├─ G2 unused deps    4
├─ G3 doc orphans    6 / 51 (11.8%)
├─ G4 dead scripts   6 / 22 (27.3%)
├─ G6 large files    5 (>1000 LOC)
├─ G7 mig conflicts  3
├─ G8 debt density   0.14 /kLOC
└─ G9 lint escapes   24 eslint-disable, 1 ts-ignore
```

配合一条 pre-push 或 nightly 的 fail 规则："G1/G2/G7 严格为 0；其余只允许下降"，即可把 CLAUDE.md 的三大原则（Raw Data READ-ONLY / Source Isolation / Idempotent Uploads）从"数据侧"扩展到"代码/文档/脚本侧"的**卫生学不变量**。

---

## 五、清理执行日志（追加更新）

每一次原子提交清理动作，请在此追加一行：`YYYY-MM-DD · Gn · 简述 · commit hash`。

| 日期 | 指标 | 动作 | Commit |
|---|---|---|---|
| 2026-07-08 | G3 | `docs/README.md` 补全 6 个孤儿条目 + 修正 `37` 坏链（6/51 → 0/52） | `1e82f5ba` |
| 2026-07-08 | G4 | 删除 6 个无引用脚本（benchmark-*.sh × 5 + measure-coverage.ts）（6 → 0） | `00ac116a` |
| 2026-07-08 | G5 | 删除 3 个顶层 autoresearch 产物（.md / .ideas.md / .jsonl），共 -454 行；logo.png 保留 | `d3c96414` |
| 2026-07-08 | G1 | 删 3 个未用 dashboard 组件（-868 行） | `bf8418fe` |
| 2026-07-08 | G1 | 删 3 个未用 shadcn/ui primitives + badges barrel（-197 行） | `eadf8ab9` |
| 2026-07-08 | G1 | 删 2 个未引用脚本（bench-ut.ts / clear-d1-usage.ts，-213 行） | `8446dad9` |
| 2026-07-08 | G1 | 删 5 个 dead re-export（bucket A: login/app-shell/scope-dropdown/showcase/period-selector） | `8e84e228` |
| 2026-07-08 | G1 | 12 个 internal-only export 降级为文件局部（bucket B） | `72b9151c` |
| 2026-07-08 | G1 | 8 个 internal-only export 降级（bucket C: fixtures + achievement format helpers） | `d3a725f9` |
| 2026-07-08 | G1 | 34 个 exported type 降级 / 删除（bucket D） | `b61d02e7` |
| 2026-07-08 | G1 | 修 cli + worker-read RPC 的 barrels，去 15 个 dead type re-export，knip = 0 unused exports/types | `479dd6c7` |
| 2026-07-08 | G2 | 删 `packages/web` 下 `@auth/core`（next-auth 自带）+ `@types/sharp`（npm deprecated stub） | `ec8b2ac2` |
| 2026-07-08 | G2 | 删根 `package.json` 里多余的 `dependencies` 块（`fast-xml-parser` / `next`）；`overrides` 保留作安全 pin | `7fc42a43` |
| 2026-07-08 | G2 | 删 `packages/web/postcss.config.mjs` 里未声明的 `postcss-load-config` JSDoc 类型提示 | `5c1a1058` |
| 2026-07-08 | G2 (补) | 新增 `knip.json`：白名单 `lsof` 系统命令 + 将 `playwright.config.ts` / `e2e/**/*.spec.ts` 声明为入口；`bunx knip` exit 0 | `a42b7647` |
| 2026-07-08 | G3 (补) | 修 `docs/35-hermes-support.md` 自指 `./docs/35-...` 坏链 | `9f7c6441` |
| 2026-07-08 | hygiene | 去除 `docs/README.md` 与 `packages/cli/src/drivers/types.ts` 中 EOF 多余空行，`git diff --check` 归零 | `13b061e1` |
