# 43 — ZCode CLI Token Support

> **Status: design** (2026-07-11)
>
> 为 pew 增加第 13 个 source：Z.ai ZCode CLI (`zcode`)。
> 通过读取 `~/.zcode/cli/db/db.sqlite` 的 `model_usage` 表，
> 精确提取每次 inference 的 input / output / reasoning / cache_read / cache_write tokens。

## 设计原则

### ✅ 严格保证

1. **完全隔离**：ZCode parser 任何异常（读文件失败 / SQLite schema 变化 / JSON 解析失败）
   最坏结果只是 ZCode source 统计不到数据，绝不影响其他 source 的同步。
2. **原始文件只读**：只对 `~/.zcode/cli/db/db.sqlite` 做 `OPEN_READONLY`；绝不修改、
   不删除、不移动，也不写 pew 自己的临时表进去。
3. **幂等上传**：`pew reset && pew sync` 任何时刻结果一致；同 `hour_bucket` upsert 到 D1，
   绝不 SUM。
4. **精确 token 归因**：与其他 source 一致，保留 5 路 token
   (input / cached / output / reasoning / cache_creation)，落盘时归一化成 disjoint。
5. **TDD**：所有新 parser / driver / 归一化逻辑必须先写测试，红→绿→重构。
6. **代码 / 注释 / commit message / 文档中不出现任何参考项目名字。**

### ✅ 接受的限制

1. **只读取 `~/.zcode/cli/db/db.sqlite` 的 `model_usage` 表**；不读 `message`, `turn_usage`,
   `tool_usage`, 也不读 `rollout/*.jsonl`。原因见"关键挑战 2"。
2. **只读 CLI 数据源**：不读 `~/.zcode/v2/tasks-index.sqlite`（GUI 任务索引，不含 token）、
   不读 `~/.zcode/v2/logs/*.log`（Electron 主进程日志，无 per-turn usage）、
   不请求 `https://zcode.z.ai/api/v1/zcode-plan/billing/balance`（余额端点属于 SaaS 记账，
   与 pew 只读本地日志的定位不符）。
3. **首次 sync 全量 emit**：cursor 丢失/首次跑 = 全表按 `(started_at, id)` 排序扫描，
   与其他 sqlite source 行为一致。D1 端 `ON CONFLICT` upsert 保证零 inflation。
4. **GLM 系列不在 pew 的 pricing baseline**：新增 `DEFAULT_SOURCE_DEFAULTS.zcode` 的
   fallback 单价即可，dynamic pricing 覆盖后自动接管。

---

## 一、ZCode CLI 数据模型分析

### 1.1 什么是 ZCode CLI

Z.ai（智谱 / BigModel）官方推出的 agentic 编码代理，形态上是 Electron GUI + 独立 CLI。CLI
以 GLM-5.2 为默认模型，通过 z.ai coding-plan 订阅计费。启动后：

- 通过 OAuth 登录 z.ai（`https://zcode.z.ai/api/v1/oauth/token`），token 存 `~/.zcode/v2/credentials.json`
- 每次 turn 在 `~/.zcode/cli/db/db.sqlite` 落 一行 `session`（顶层会话）、多行 `message`
  （user + assistant + tool，仅 raw body）、多行 `model_usage`（每次 model call 一行）、
  一行 `turn_usage`（该 turn 汇总）、多行 `tool_usage`
- 每个 session 还会写一份 `~/.zcode/cli/rollout/model-io-sess_<sid>.jsonl`，
  内容是 `request/response` 全量镜像（含 provider metadata），token usage 与 `model_usage`
  完全一致，只是格式为 jsonl
- 通用应用日志落 `~/.zcode/cli/log/zcode-YYYY-MM-DD.jsonl`（无 token 数据）

本机版本：`zcode 0.15.0`（config `~/.zcode/cli/config.json`）、GUI `zcode 3.3.3`。

### 1.2 数据目录

```
~/.zcode/
├── cli/                        ← CLI 本地状态（本文档唯一关心）
│   ├── config.json             ← CLI 配置
│   ├── db/
│   │   └── db.sqlite           ← ★ 唯一 token 真源
│   ├── rollout/                ← 每个 session 的 request/response 镜像
│   │   └── model-io-sess_<sid>.jsonl
│   ├── log/                    ← 应用日志（无 token）
│   │   └── zcode-YYYY-MM-DD.jsonl
│   ├── exec/                   ← bash/shell snapshots（无关）
│   └── plugins/                ← 插件目录（无关）
└── v2/                         ← GUI 端（不读）
    ├── tasks-index.sqlite      ← 只是 GUI 任务列表
    ├── credentials.json        ← OAuth token
    ├── config.json
    └── logs/                   ← Electron 主进程日志
```

### 1.3 `db.sqlite` 相关表

只关心 4 张表；其它跟 token 无关。

#### 1.3.1 `model_usage`（★ token 真源）

每次 model call 一行。字段（截取）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | text pk | 客户端生成 uuid，做 `seenIds` 天然键 |
| `session_id` | text | join `session.id` |
| `turn_id` | text | 归属 turn |
| `provider_id` | text | e.g. `builtin:bigmodel-coding-plan`, `builtin:zai-start-plan`, 或用户自定义 uuid |
| `model_id` | text | e.g. `GLM-5.2` |
| `agent` | text | e.g. `zcode-agent` |
| `mode` | text | `build` / 其它 |
| `status` | text | `running` \| `completed` \| `error` \| `cancelled` |
| `started_at` | integer | epoch ms |
| `completed_at` | integer | epoch ms（`running` 时为 null） |
| `input_tokens` | integer | **inclusive**：包含 cache_read |
| `output_tokens` | integer | disjoint：不含 reasoning（本机数据 reasoning = 0，需要在别的 session 上做二次验证） |
| `reasoning_tokens` | integer | Thinking tokens |
| `cache_read_input_tokens` | integer | ⊆ `input_tokens` |
| `cache_creation_input_tokens` | integer | 视为独立 bucket（与 Anthropic 一致） |
| `provider_total_tokens` | integer | provider 报的原始 total |
| `computed_total_tokens` | integer | 客户端算的 total = `input + output`（本机 4 行 100% 满足） |
| `retry_count` | integer | 重试次数 |
| `raw_usage_json` | text | 原始 provider usage 字符串（不解析） |
| `provider_metadata_json` | text | 原始 provider metadata（不解析） |

索引：`(started_at, provider_id, model_id)` / `(session_id, turn_id)`。

#### 1.3.2 `session`

顶层会话表；用来 join 出 `directory` 作为 pew 的 project_ref。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | text pk | 与 `model_usage.session_id` 对应 |
| `directory` | text | cwd 绝对路径 → project_ref |
| `title` | text | LLM 生成的 session 标题 |
| `time_created` | integer | epoch ms |
| `time_updated` | integer | epoch ms |
| `task_type` | text | `interactive` / 其它 |
| `trace_id` | text | 观测用，pew 忽略 |

#### 1.3.3 `turn_usage`

每 turn 一行，字段与 `model_usage` 相同（但是 turn 级汇总）。pew **不读**；
`model_usage` 已是最细粒度，聚合到 30 min bucket 时 `turn_usage` 的存在只会造成
重复计数。

#### 1.3.4 `message`

对话原始消息（`data` 字段是 JSON blob，含 `role/content/tokens`）。pew **不读**：

- `message.data.tokens` 与 `model_usage` 数据完全一致，只是嵌在 JSON 里
- SQL 直接查 `model_usage` 表结构更硬、无需 `json_extract`
- 避免把 user + assistant + tool 三类混淆

### 1.4 Token 语义（核心事实）

zcode 落库的 token 语义是 **inclusive OpenAI 风格**，与 codex / copilot-cli 同类型：

```
input_tokens          = uncached_input + cache_read_input_tokens
output_tokens         = 补全输出 (不含 reasoning，本机数据待更多样本验证)
reasoning_tokens      = thinking tokens（未来 GLM-5 thinking 场景）
cache_read_input_tokens    ⊆ input_tokens
cache_creation_input_tokens ⟂ input_tokens（独立 bucket）
computed_total_tokens = input_tokens + output_tokens (+ 可能的 reasoning，待验证)
```

**本机 1 个真实 session（4 次 model call）实测**：

| # | input | cache_read | output | reasoning | computed_total | provider_total |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 11933 | 7360 | 170 | 0 | 12103 | 12103 |
| 2 | 16335 | 11904 | 180 | 0 | 16515 | 16515 |
| 3 | 17425 | 16320 | 180 | 0 | 17605 | 17605 |
| 4 | 18541 | 17408 | 799 | 0 | 19340 | 19340 |
| **Σ** | **64,234** | **52,992** | **1,329** | **0** | **65,563** | **65,563** |

验证：`computed_total == provider_total == input + output`；`cache_read ≤ input`；
`turn_usage` 单行汇总 = 4 行 model_usage 之和。

pew 落盘前必须归一化成 **disjoint**（与 codex/copilot-cli 一致），否则 D1 侧
`SUM(total_tokens)` 会重复计 cache_read：

```ts
inputDisjoint       = input_tokens - cache_read_input_tokens
outputDisjoint      = output_tokens - reasoning_tokens
cachedInput         = cache_read_input_tokens
reasoningOutput     = reasoning_tokens
// cache_creation_input_tokens 与 cached_input_tokens 语义不同：
// pew 现有 TokenDelta 只有 cachedInputTokens（read）一个字段。
// zcode 的 cache_creation 目前观测到都为 0，先并入 cachedInputTokens 保守处理；
// 待未来看到 cache_creation > 0 的实例再扩展 TokenDelta 字段。
```

上面 4 行 sample 归一化后：
`input=11,242  cached=52,992  output=1,329  reasoning=0  total=65,563`
—— 与 zcode `computed_total_tokens` 之和一致，无损。

### 1.5 参考项目对 zcode 的处理评估

调研本地 `../reference/` 下 3 个开源 token tracker，结论如下：

| 项目 | 数据源 | disjoint 归一化 | 结论 |
|---|---|---|---|
| **tokscale** (Rust) | `~/.zcode/projects/*.jsonl`（本机不存在此目录）+ `~/.zcode/cli/db/db.sqlite` `model_usage` | ❌ `total = input + output + cache_read + cache_write + reasoning` | **算错**：本机数据虚增 80.8%（65,563 → 118,555） |
| **TokenTracker** (JS) | `~/.zcode/cli/db/db.sqlite` `message` 表的 `data.tokens` JSON | ❌ `total = input + output + reasoning + cached + cacheWrite` | **算错**：同样虚增 80.8% |
| **tokenscope** | 完全不支持 zcode | — | — |

两家共同的根因：**假设 `input_tokens` 与 Anthropic 一样是 disjoint**（不含 cache），
但 zcode 的 `input_tokens` 实际是 inclusive（`total = input + output` 自证）。

pew 借鉴 codex/copilot-cli 已经栽过的坑（见 `packages/cli/src/parsers/codex.ts`
的 `normalizeCodexUsage`），从第一天就落 disjoint 字段。

---

## 二、关键挑战与解决方案

### 挑战 1：`input_tokens` 是 inclusive 还是 disjoint？

**问题**：zcode SQLite 字段名（`input_tokens`, `cache_read_input_tokens`）与 Anthropic 完全一样，
但语义是 OpenAI 风格 inclusive。看字段名极易错判。

**解决**：`packages/cli/src/parsers/zcode.ts` 里显式做归一化，注释指出这个语义陷阱；
测试固化"`input_tokens ⊇ cache_read_input_tokens`"这一不变式（Case 4 会构造
`input_tokens < cache_read_input_tokens` 触发防御分支归零）。

### 挑战 2：为何只读 `model_usage`，不用 `turn_usage` / `message` / `rollout`？

**问题**：同一份 token 数据在四处出现：`model_usage`（最细）、`turn_usage`（turn 汇总）、
`message.data.tokens`（JSON 嵌套）、`rollout/*.jsonl`（request/response 镜像）。任意二者
之间的差异都是零，选谁都能算出正确总数，但选错会带来复杂度。

**解决**：只读 `model_usage`：

1. 粒度最细：`(session_id, turn_id, model_id)` 三元组保留，未来做 model 归因不需要重扫。
2. schema 明确：列全部命名，无需 `json_extract`。
3. 增量最简单：`id` 是 uuid，直接 `WHERE id NOT IN (seenIds)` 或 `WHERE completed_at > lastCompletedAt`。
4. 分辨 running / completed：`status='completed'` 过滤 in-flight turn，避免把未完成的 usage
   算进 bucket；等下次 sync 完成后再 emit。
5. `rollout/*.jsonl` 是 debug 镜像，token 数据同源，读它相当于二重计算。

### 挑战 3：session 归因与 project_ref

**问题**：pew 需要把 usage 打到 project 上。zcode 没有 `~/.grok/sessions/<enc-cwd>/` 那种
按 cwd 分目录的结构，session 只在 sqlite 一张表里。

**解决**：`model_usage LEFT JOIN session ON session_id = session.id` 拿到 `session.directory`，
即 cwd 绝对路径，作为 project_ref（与 opencode-sqlite 一致）。session 缺失（外键 orphan）
时 project_ref 置 `null`，与其他 source fallback 行为一致。

### 挑战 4：增量策略（SQLite append-only vs mutable rows）

**问题**：`model_usage` 行在 `started_at` 时插入 `status='running'`，到 `completed_at` 时
更新为 `status='completed'` 并回填 token。这不是纯 append-only。

**解决**：cursor 记录两项：

- `zcodeSqlite.lastCompletedAt: number | null` — 上次 sync 处理到的最大 `completed_at`
- `zcodeSqlite.seenIds: Set<string>` — 已 emit 的 `model_usage.id`（防止同一行被重复处理）

sync 时 `WHERE status='completed' AND completed_at IS NOT NULL AND completed_at >= COALESCE(lastCompletedAt, 0)`
拿一批，再用 `seenIds` 二次过滤。同一 `id` 只会 emit 一次；重跑 `pew reset && pew sync`
清空 cursor 后走全量，D1 upsert 保证幂等。

`lastCompletedAt` 用 `>=` 而非 `>` 是为了防止同一毫秒内多行漏 emit；`seenIds` 兜底去重。

### 挑战 5：Session 数据

**问题**：pew 的 SessionSnapshot 需要 `startedAt / lastMessageAt / totalMessages /
userMessages / assistantMessages / durationSeconds / model / projectRef`。

**解决**：从同一个 `db.sqlite` 拿：

- `startedAt` = `session.time_created`
- `lastMessageAt` = `session.time_updated`
- `durationSeconds` = `(time_updated - time_created) / 1000`
- `totalMessages / userMessages / assistantMessages` = `SELECT COUNT(*), SUM(role='user'), SUM(role='assistant') FROM message WHERE session_id = ?` 用 `json_extract(data, '$.role')`
- `model` = 该 session 里 `model_usage` 出现次数最多的 `model_id`（fast path：
  `SELECT model_id FROM model_usage WHERE session_id=? GROUP BY model_id ORDER BY COUNT(*) DESC LIMIT 1`）
- `projectRef` = `session.directory`

由于 SessionSnapshot 允许"根据 mtime 跳过"，增量策略：pew 记录
`zcodeSessions.lastUpdatedAt`，`WHERE time_updated > lastUpdatedAt` 拿变更集。首次全量。

---

## 三、Token 统计方案

### 3.1 字段映射

| pew `TokenDelta` | zcode `model_usage` | 归一化 |
|---|---|---|
| `inputTokens` | `input_tokens - cache_read_input_tokens` | `Math.max(0, ...)` 兜底 |
| `cachedInputTokens` | `cache_read_input_tokens + cache_creation_input_tokens` | 目前 cache_creation 都是 0，先合并 |
| `outputTokens` | `output_tokens - reasoning_tokens` | `Math.max(0, ...)` |
| `reasoningOutputTokens` | `reasoning_tokens` | 直接映射 |

派生：`total_tokens = inputDisjoint + cached + output + reasoning`
（= zcode 的 `computed_total_tokens` + `cache_creation`）

### 3.2 解析逻辑

```ts
export interface ZcodeUsageRow {
  id: string;
  sessionId: string;
  turnId: string | null;
  providerId: string;
  modelId: string;
  status: 'completed' | 'error' | 'cancelled';  // running 已被 SQL 过滤掉
  startedAt: number;         // epoch ms
  completedAt: number;       // epoch ms（前置条件：not null）
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  computedTotalTokens: number;
}

export function normalizeZcodeUsage(raw: ZcodeUsageRow): TokenDelta {
  return {
    inputTokens: Math.max(0, raw.inputTokens - raw.cacheReadInputTokens),
    cachedInputTokens: raw.cacheReadInputTokens + raw.cacheCreationInputTokens,
    outputTokens: Math.max(0, raw.outputTokens - raw.reasoningTokens),
    reasoningOutputTokens: raw.reasoningTokens,
  };
}
```

Parser 从 `db.sqlite` 用 read-only 打开，SQL 分批查（LIMIT/OFFSET 或 keyset paging），
每批 emit 一批 ParsedDelta：

```ts
{
  source: 'zcode',
  model: row.modelId,
  timestamp: row.completedAt,
  usage: normalizeZcodeUsage(row),
  projectRef: sessionDirectoryMap.get(row.sessionId) ?? null,
}
```

### 3.3 幂等性保证

- `id` 是 uuid，永不复用 → `seenIds` Set 天然键
- SQL 只查 `status='completed'` → running turn 不会 emit 半个 usage
- D1 侧按 `(user_id, source, hour_start, model, project_ref, device_id)` upsert → 重跑同一批 rows 结果一致
- `pew reset && pew sync` = 清 cursor + 全量重扫 + D1 upsert，最终态与增量同步一致

---

## 四、Session 统计方案

### 4.1 SessionSnapshot 提取

SessionSnapshot 结构（来自 `@pew/core`）：

```ts
{
  source: 'zcode',
  sessionKey: `${TEST_USER_ID}-${session.id}`,  // TEST_USER_ID 是发布侧 user_id，本地 hash 一致
  kind: 'human' | 'agent',                       // zcode 只有 human
  startedAt: number,
  lastMessageAt: number,
  durationSeconds: number,
  userMessages: number,
  assistantMessages: number,
  totalMessages: number,
  projectRef: string | null,                     // session.directory
  model: string | null,                          // 最频繁 model_id
  snapshotAt: number,
}
```

### 4.2 增量策略

- `zcodeSessions.lastUpdatedAt: number` — 上次 sync 处理到的最大 `session.time_updated`
- 首次跑 = `WHERE 1=1`，扫全部；后续 `WHERE time_updated > lastUpdatedAt`
- 每个 session 做一次 SessionSnapshot 全量重算（低成本，2 条 SQL）；上游 dedupe 兜底
- 同 opencode-sqlite driver 一样，走 phase 2 DB-based driver 通道，不走 file cursor

---

## 五、Source 类型系统性扩展

严格镜像 §5（Grok doc）的清单。任何一处漏改都会让 TypeScript `never` 检查断言失败；
所有既存文件的"新增 case"均视作必要项而非可选。

### 5.1 Core types & constants（edit）

- `packages/core/src/types.ts`：`Source` union 加 `"zcode"`；加 `interface ZcodeSqliteCursor
  { lastCompletedAt: number | null; seenIds: string[]; sessionsLastUpdatedAt: number | null; }`；
  `CursorState` 加 `zcodeSqlite?: ZcodeSqliteCursor`
- `packages/core/src/constants.ts`：`SOURCES` 加 `"zcode"`

### 5.2 CLI parsers（new）

- `packages/cli/src/parsers/zcode-sqlite.ts` — 只读 `model_usage`，返回 `ParsedDelta[]`
- `packages/cli/src/parsers/zcode-sqlite-db.ts` — bun:sqlite 封装（与 hermes / opencode 同风格），
  仅测试可注入 mock DB
- `packages/cli/src/parsers/zcode-session.ts` — SessionSnapshot 提取

### 5.3 CLI drivers（new）

- `packages/cli/src/drivers/token/zcode-sqlite-token-driver.ts` — phase 2 DB-based driver
- `packages/cli/src/drivers/session/zcode-sqlite-session-driver.ts` — phase 2 DB-based driver

### 5.4 CLI wiring（edit）

- `packages/cli/src/discovery/sources.ts` — 加 `discoverZcodeDb()`（存在性检测 + 返回 path）
- `packages/cli/src/drivers/registry.ts` — 注册两个 zcode driver（`opts.zcodeDbPath` 存在时激活）
- `packages/cli/src/drivers/types.ts` — `DiscoverOpts` 加 `zcodeDbPath?: string`
- `packages/cli/src/commands/sync.ts` / `session-sync.ts` / `session-sync-helpers.ts` /
  `notifier/coordinator.ts` — `sourceKey()` 里 `case "zcode": return "zcode"`；
  `SyncResult.sources.zcode` / `filesScanned.zcode` 初始化 0
- `packages/cli/src/storage/prune-alias-cursors.ts` — `case "zcode"` 保留 `zcodeSqlite` cursor
- `packages/cli/src/commands/status.ts` — `SourceDirs.zcodeHome` + `classifySource` 里
  `if (filePath.startsWith(dirs.zcodeHome)) return "zcode"`
- `packages/cli/src/utils/paths.ts` — `zcodeHome / zcodeDbPath` 默认路径

### 5.5 CLI entry / notify / status（edit）

- `packages/cli/src/cli.ts` — `isSource()` 允许 `"zcode"`；`SOURCE_LABELS.zcode = "ZCode"`；
  `SourceDirs.zcodeHome = paths.zcodeHome`；sync 报表 `if (result.sources.zcode > 0)
  deltaParts.push('ZCode: ${result.sources.zcode}')`

### 5.6 Web dashboard（edit）

- `packages/web/src/lib/pricing.ts` — `DEFAULT_SOURCE_DEFAULTS.zcode` 加保守 fallback：
  按 GLM-5.2 官方目录价的一个安全上限，例如 `{ input: 2, output: 8, cached: 0.5, reasoning: 8 }`；
  dynamic pricing 上线后覆盖
- `packages/web/src/lib/palette.ts` — 新增 chart-13 palette 条目；`palette.test.ts` 里
  `toHaveLength(12) → toHaveLength(13)` 和 `chart-13` 断言
- `packages/web/src/lib/usage-transforms.ts` / `usage-helpers.ts` / `cost-helpers.ts` /
  `device-helpers.ts` — 所有按 source 展开的 reducer/tuple 加 `zcode` 分量（TS `never`
  会强制暴露每一处）
- Dashboard 图表、trend chart、breakdown chart、source-filter — 加 `zcode` label 与
  palette 分配

### 5.7 Docs / onboarding（3 文件，edit）

- `README.md` — "12 种" → "13 种"；banner 与列表加 ZCode（按字母序，Pi 之前）；
  "无 hook"名单加 ZCode
- `packages/web/src/components/landing/landing-content.tsx` — 同上
- `CLAUDE.md` — "Supported AI Tools" 段加 ZCode
- `PRIVACY.md`（若存在类似枚举）同步

### 5.8 Testing 断言（edit）

- `packages/core/src/__tests__/constants.test.ts` — `SOURCES` 长度 12 → 13；含 `zcode`
- `packages/cli/src/__tests__/paths.test.ts` — 加 `zcodeHome / zcodeDbPath` 断言
- `packages/cli/src/__tests__/status.test.ts` — `SourceDirs.zcodeHome` 存在；
  含 zcode cursor 的 fixture 走 `classifySource` 得 `"zcode"`
- `packages/cli/src/drivers/__tests__/registry.test.ts` — 在有 zcodeDbPath 时激活两个 driver
- `packages/cli/src/commands/__tests__/sync.test.ts` — `sources.zcode` 累计正确
- `packages/web/src/__tests__/palette.test.ts` — 长度 13

### 5.9 New tests（new）

- `packages/cli/src/parsers/__tests__/zcode-sqlite.test.ts` — see §7.1
- `packages/cli/src/parsers/__tests__/zcode-session.test.ts` — see §7.1
- `packages/cli/src/drivers/token/__tests__/zcode-sqlite-token-driver.test.ts`
- `packages/cli/src/drivers/session/__tests__/zcode-sqlite-session-driver.test.ts`

---

## 六、原子化提交计划

严格按 CLAUDE.md "multi-file changes must be split into atomic commits" 原则，
每个 commit 必须独立 buildable + testable。

**依赖顺序**：pew 有多处 `sourceKey()` 用 TS `never` 做穷举检查
（`sync.ts` / `session-sync-helpers.ts` / `notifier/coordinator.ts`）。任何独立 commit 只要往
`Source` union 加 `"zcode"`，这几处 switch 立刻编译失败。同理 driver 依赖
`DiscoverOpts.zcodeDbPath` 必须在同一或更早 commit 存在。为此重排如下：

| # | Commit | 内容 | 独立编译? |
|---|---|---|---|
| 1 | **`feat: add "zcode" source foundation (types + all exhaustive switches + DiscoverOpts stub)`** | `core/types.ts` `Source` 加 zcode + 加 `ZcodeSqliteCursor`；`core/constants.ts` `SOURCES` 加 zcode；**同时**加 `sync.ts` / `session-sync.ts` / `session-sync-helpers.ts` / `notifier/coordinator.ts` 里 `sourceKey()` 的 `case "zcode"`、`SyncResult.sources.zcode`、`filesScanned.zcode` 初始化；`drivers/types.ts` `DiscoverOpts` 加 `zcodeDbPath?`；`utils/paths.ts` 加 zcodeHome / zcodeDbPath；`cli.ts` `isSource()` + `SOURCE_LABELS` + `SourceDirs.zcodeHome`；`prune-alias-cursors.ts` 保留分支；所有列在 §5.8 里的 core/CLI test 断言更新。**尚无 driver 注册、尚无 parser** — foundation commit，typecheck + lint 全绿 | ✅ |
| 2 | `feat(cli): add zcode sqlite parser and normalizer (no wiring)` | `parsers/zcode-sqlite.ts` + `parsers/zcode-sqlite-db.ts` + `parsers/__tests__/zcode-sqlite.test.ts`。**TDD 先测后码**。此时 parser 尚未被任何 driver 调用，纯函数库 | ✅ |
| 3 | `feat(cli): add zcode sqlite session parser (no wiring)` | `parsers/zcode-session.ts` + test。同上 | ✅ |
| 4 | `feat(cli): add zcode token+session drivers and register them` | `drivers/token/zcode-sqlite-token-driver.ts`、`drivers/session/zcode-sqlite-session-driver.ts`、`discovery/sources.ts` 新增 `discoverZcodeDb()`、`drivers/registry.ts` 注册两个 driver + registry test。driver 依赖 (2)/(3) 的 parser 和 (1) 的 DiscoverOpts，都已就位 | ✅ |
| 5 | `feat(cli): wire zcode end-to-end through sync + status + notify` | `commands/sync.ts` / `session-sync.ts` / `notify.ts` / `status.ts` 里传入 `zcodeDbPath`，sync/session-sync/status test 追加 zcode 覆盖。此时 CLI 端 zcode source 完整可用 | ✅ |
| 6 | `feat(web): add zcode to dashboard palette, labels, pricing fallback` | Web dashboard 文件（见 §5.6）+ `palette.test.ts` 里 `toHaveLength(12) → toHaveLength(13)` 和 `chart-13` 断言 + 相关 dashboard test | ✅ |
| 7 | `docs(43): mark zcode support as implemented; update CLAUDE.md/README/landing` | 4 个文档 + doc 43 status → done + tool 数字 12 → 13 | ✅ |

每个 commit 单独运行：
- `bun run test`：全绿
- `bun run lint`：typecheck + eslint 全绿
- pre-commit L1/G1 hook 通过

---

## 七、测试覆盖率

### 7.1 L1 Unit tests（parser 层）

**Parser 正确性（`zcode-sqlite.test.ts`）**：

| Case | 输入 | 期望 |
|---|---|---|
| 1 | 1 行 `model_usage`（本机首行数据） | 1 delta，disjoint 归一化正确：input=4573, cached=7360, output=170, reasoning=0 |
| 2 | 4 行 `model_usage`（本机 4 行）+ 首次 sync | 4 deltas，累计 input=11242 cached=52992 out=1329 rea=0 total=65563 |
| 3 | `status='running'` 一行 | 0 deltas（SQL 已过滤） |
| 4 | 异常：`cache_read_input_tokens > input_tokens`（脏数据） | `inputDisjoint = 0`（防御分支不返回负数） |
| 5 | 增量：cursor lastCompletedAt = row3.completedAt，再来 row4 | 只 emit row4；row3 因 seenIds 命中被跳过 |
| 6 | 空表 | 0 deltas，无异常 |
| 7 | `raw_usage_json` 是 malformed JSON | 忽略该字段，其余字段照常 emit |
| 8 | `session` 表缺该行（外键 orphan） | delta 正常 emit，`projectRef = null` |
| 9 | 同一 `completed_at` 毫秒下 2 行 | 都 emit（`>=` + seenIds 组合正确工作） |
| 10 | `reasoning_tokens > 0`（构造） | `outputDisjoint = output - reasoning`，`reasoningOutput = reasoning` |

**Session 正确性（`zcode-session.test.ts`）**：

| Case | 输入 | 期望 |
|---|---|---|
| 1 | 完整 session（本机数据）+ 5 条 message | snapshot 各字段正确，model = 出现最多的 model_id |
| 2 | 无 message 记录 | userMessages/assistantMessages/totalMessages 均为 0，snapshot 仍返回 |
| 3 | 一个 session 里有 2 个不同 model_id，出现次数不同 | model = 出现次数最多的（tie-break 用 name 字典序） |
| 4 | session.directory 为空字符串 | projectRef 视为 null |
| 5 | 增量：sessionsLastUpdatedAt = t，t 之后有新 session | 只 emit 新 session |

**Driver（`zcode-sqlite-token-driver.test.ts` / `-session-driver.test.ts`）**：

| Case | 期望 |
|---|---|
| DiscoverOpts 无 zcodeDbPath | driver 不激活（`discover()` 返回 `[]`） |
| zcodeDbPath 指向不存在文件 | driver 激活但空数据（graceful fallback） |
| zcodeDbPath 指向真实 db.sqlite | cursor 增量语义与 hermes-token-driver 一致 |
| cursor 缺失 `zcodeSqlite` 字段（旧 pew 升级） | 视为首次 sync，全量重扫 |
| cursor `seenIds` 与新 rows 冲突 | 冲突项不重复 emit |

### 7.2 L1 Unit tests（source registry 扩展）

- `SOURCES` 长度 12 → 13
- `isSource("zcode")` 返回 true
- `SOURCE_LABELS.zcode` === "ZCode"
- `sourceKey("zcode")` 返回 "zcode"（`never` 检查通过）

### 7.3 L2 Integration tests

参照 grok（`api-e2e.test.ts` 里 "accepts and reads back grok source records — every whitelist entry point"）加一份 zcode 版：

1. POST `/api/ingest` bare-array with `source: "zcode"`，token 与 D1 匹配
2. 每个 `?source=zcode` 白名单路由都返回 200：
   - `/api/usage?source=zcode&from=&to=`
   - `/api/sessions?source=zcode`
   - `/api/leaderboard?source=zcode&from=&to=`
   - `/api/users/[slug]?source=zcode&from=&to=`
3. token 保留 disjoint 字段
4. POST `/api/projects` 用 zcode alias 建 project，PATCH 加另一个 zcode alias

### 7.4 L3 Browser E2E

- Dashboard source-filter 下拉里出现 "ZCode"
- 按 source=zcode 过滤时图表 palette 用 `chart-13` 色
- 空态下 empty-state 提示行不需要改（已是通用文案）

### 7.5 Golden verification（本机真实数据）

本地跑 `pew sync`，期望在 `~/.config/pew/queue.jsonl` 里能看到：

- source=zcode 记录，`(user_id, source, hour_start, model)` 聚合正确
- 4 行 model_usage 落到同 1 个 30 min bucket：
  - hour_start = 2026-07-10T01:00:00.000Z
  - input_tokens = 11,242（即 64,234 - 52,992）
  - cached_input_tokens = 52,992
  - output_tokens = 1,329
  - reasoning_output_tokens = 0
  - total_tokens = 65,563

上传后 D1 里 SELECT 结果一致（脚本：见"验证与调试"章节）。

### 7.6 隔离性验证

- 手动构造损坏的 `db.sqlite`（截断 / schema 错乱），跑 `pew sync`：
  - CLI 输出应显示 "ZCode: 0"，其他 source 数量正常
  - 无 uncaught error 抛到 stderr
  - queue.jsonl 无 zcode 条目
- 卸载 zcode（删除 `~/.zcode/`）后跑 `pew sync`：全流程静默跳过

---

## 八、时间估算

- **Foundation + parser 骨架**：0.5 天
- **Driver + wiring + sync 通路**：0.5 天
- **Web dashboard 侧改动**：0.5 天（跟 grok 一样只是数量 +1）
- **测试补齐 + golden 验证 + 文档收尾**：0.5 天
- **合计**：约 2 天开发；1 次 release 打包

---

## 九、FAQ

**Q1：zcode 有 rollout jsonl，为什么不用它？**
A：`rollout/model-io-sess_*.jsonl` 是 request/response 全量镜像，per-turn token 数据与
`model_usage` 完全一致，且 jsonl 需要 byte offset cursor + 半行安全，比 SQLite 增量复杂得多。
唯一场景是"用户禁用了 SQLite 但保留 rollout" —— 目前没观察到这种配置，即便出现也可后加。

**Q2：ZCode GUI（`~/.zcode/v2/`）为什么完全不读？**
A：GUI 只是把任务列表 index 存在 `tasks-index.sqlite`（`tasks` / `task_groups` 表），
token 数据全部由 CLI backend 落到 `~/.zcode/cli/db/db.sqlite`。GUI 前端也是 RPC 到 CLI，
所以不管用户是 GUI 用户还是 CLI 用户，pew 都从同一个 sqlite 拿数据。

**Q3：v2 的 credentials.json 里有 API key，为啥不调 z.ai billing endpoint 拿准确余额？**
A：pew 定位是"只读本地日志"，不做联网 API 记账。参考项目 TokenTracker 那样调
`https://zcode.z.ai/api/v1/zcode-plan/billing/balance` 属于 SaaS 侧特性，不在 pew scope。
用户如需订阅额度可以看 zcode GUI；pew 只呈现自己解析出的 usage。

**Q4：inclusive → disjoint 归一化后，pew 的 total 与 zcode `computed_total_tokens` 会一致吗？**
A：一致。zcode `computed_total = input + output`（inclusive），pew 归一后
`total = (input - cache_read) + cache_read + (output - reasoning) + reasoning = input + output`。
数学上完全等价。cache_creation 目前观测都是 0，未来若非零需要评估是否新增
`TokenDelta.cacheCreationInputTokens` 字段（当前先合并进 `cachedInputTokens`）。

**Q5：一个 zcode session 可以切换 model 吗？**
A：可以（用户在 CLI 中 `/model` 命令切换）。`model_usage` 每行独立记录 `model_id`，
per-turn 归因天然正确；SessionSnapshot 的 model 字段用"出现次数最多"作为代表（fast path，
一次 SQL）。这与 grok 的 model 归因思路一致。

**Q6：本地 zcode 是订阅制的，成本计算怎么办？**
A：pew 存的 usage 单位是 token，不是 dollar；成本估算在 web dashboard 侧用
`estimateCost()` × pricing。zcode 用户实际是订阅制付费（如 z.ai coding-plan monthly $20），
pew 的 dollar 估算只是"如果按 token 单价计"，与用户实际账单不必一致。这与所有
subscription-based source（Claude Pro / gemini-cli / etc.）情况相同。

---

## 十、References

- 本机 zcode CLI：`~/.zcode/cli/db/db.sqlite`（本机 schema 版本：0.15.0）
- 本机 rollout 样本：`~/.zcode/cli/rollout/model-io-sess_1d50eb1b-*.jsonl`
- 42-grok-support.md — 结构模板与命名对齐
- `packages/cli/src/parsers/codex.ts` — inclusive → disjoint 归一化先例
- `packages/cli/src/parsers/opencode-sqlite.ts` — SQLite driver 结构参考
- `packages/cli/src/parsers/hermes-sqlite.ts` — bun:sqlite 封装参考
