# 43 — ZCode CLI Token Support

> **Status: design** (2026-07-11, revised after review)
>
> 为 pew 增加第 13 个 source：Z.ai ZCode CLI (`zcode`)。
> 通过读取 `~/.zcode/cli/db/db.sqlite` 的 `model_usage` 表，
> 精确提取每次 model call 的 input / output / reasoning / cache_read / cache_creation tokens，
> 归一化成 pew 现有 disjoint 四字段落盘。

## 设计原则

### ✅ 严格保证

1. **完全隔离**：ZCode parser / driver 的任何异常（DB 打不开 / schema 缺列 / 脏数据）
   最坏结果是 ZCode source 统计不到数据，绝不影响其他 source。DB 层 error 在 driver 内
   catch → log → 返回空结果，不允许抛给 orchestrator。
2. **原始文件只读**：只对 `~/.zcode/cli/db/db.sqlite` 做 `OPEN_READONLY`；绝不修改、
   不删除、不移动，也不新建临时表。
3. **幂等上传**：`pew reset && pew sync` 任何时刻结果一致；同 `(user_id, device_id,
   source, model, hour_start)` upsert 到 D1，绝不 SUM。
4. **Token 归因用 pew 现有 4 字段**（`input / cached / output / reasoning`），
   与其他 source 一致；不动 core `TokenDelta`、Queue、D1、RPC、Web。见 §1.4 与 §3。
5. **Project 归因只走 SessionSnapshot**（现有链路）；不给 ParsedDelta / QueueRecord /
   D1 加 project 字段。见 §四。
6. **TDD**：所有新 parser / driver / 归一化逻辑先写测试，红→绿→重构。
7. **代码 / 注释 / commit message / 文档中不出现任何参考项目名字。**

### ✅ 接受的限制

1. **只读取 `~/.zcode/cli/db/db.sqlite` 的 `model_usage` 表**（token）+ `session` +
   `message` 表（session snapshot）；不读 `turn_usage`（会造成 model_usage 双计）、
   不读 `tool_usage`（跟 token 无关）、不读 `rollout/*.jsonl`（数据同源，格式更难增量）。
2. **只读 CLI 侧**：不读 `~/.zcode/v2/tasks-index.sqlite`（GUI 任务索引，无 token）、
   不读 `~/.zcode/v2/logs/*.log`（Electron 主进程日志，无 per-turn usage）、
   不请求 `https://zcode.z.ai/api/v1/zcode-plan/billing/balance`（余额端点属于 SaaS 记账，
   与 pew 只读本地日志的定位不符）。
3. **首次 sync / cursor 丢失 = 全表重扫**；D1 端 `ON CONFLICT` upsert 保证零 inflation。
4. **cache_creation 保留在 input bucket、cached 只装 cache_read**：本机 4 条样本
   `cache_creation=0`；zcode CLI 源码显示 cache_creation 是"写入 cache 的付费 token"，
   按 provider 定价与 read 不同（后者按 cached 打折）。把 cache_creation 合入 cached 会
   低估成本。决策详见 §1.4 与 §三。
5. **GLM 系列不在 pricing baseline**：仅新增 `DEFAULT_SOURCE_DEFAULTS.zcode` 保守 fallback；
   dynamic pricing 上线后覆盖。

---

## 一、ZCode CLI 数据模型分析

### 1.1 什么是 ZCode CLI

Z.ai（智谱 / BigModel）官方推出的 agentic 编码代理，形态上是 Electron GUI + 独立 CLI。CLI
以 GLM-5.2 为默认模型，通过 z.ai coding-plan 订阅计费。启动后：

- 通过 OAuth 登录 z.ai（`https://zcode.z.ai/api/v1/oauth/token`），token 存 `~/.zcode/v2/credentials.json`
- 每次 turn 在 `~/.zcode/cli/db/db.sqlite` 落：一行 `session`、多行 `message`、多行
  `model_usage`（每次 model call 一行）、一行 `turn_usage`（turn 汇总）、多行 `tool_usage`
- 每个 session 还会写 `~/.zcode/cli/rollout/model-io-sess_<sid>.jsonl`，是 request/response
  全量镜像，token 数据与 `model_usage` 完全一致
- 通用应用日志落 `~/.zcode/cli/log/zcode-YYYY-MM-DD.jsonl`（无 token）

本机版本：`zcode 0.15.2`（CLI 二进制）、GUI `zcode 3.3.4`。SQLite migrations 记录在
`schema_migration` 表的 `app_version` 字段，本机最新 migration 是 `app_version = 0.15.0`
（CLI 二进制升级后 db schema 未必立刻迁移，二者独立）。

### 1.2 数据目录

```
~/.zcode/
├── cli/                        ← CLI 本地状态（本文档唯一关心）
│   ├── config.json
│   ├── db/
│   │   └── db.sqlite           ← ★ 唯一 token 真源
│   ├── rollout/                ← request/response 镜像（不读）
│   ├── log/                    ← 应用日志（不读，无 token）
│   ├── exec/                   ← bash/shell snapshots（无关）
│   └── plugins/                ← 插件（无关）
└── v2/                         ← GUI 端（全部不读）
    ├── tasks-index.sqlite
    ├── credentials.json
    ├── config.json
    └── logs/
```

### 1.3 `db.sqlite` 相关表

#### 1.3.1 `model_usage`（★ token 真源）

每次 model call 一行。字段（截取）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | text pk | 客户端生成 uuid，做 `lastProcessedIds` 天然键 |
| `session_id` | text | join `session.id`（token pipeline 只用它做归因日志，不上传） |
| `turn_id` | text | 归属 turn |
| `provider_id` | text | e.g. `builtin:bigmodel-coding-plan`, `builtin:zai-start-plan`, 或用户自定义 uuid |
| `model_id` | text | e.g. `GLM-5.2` |
| `status` | text | `running` \| `completed` \| `error` \| `cancelled` |
| `started_at` | integer | epoch ms |
| `completed_at` | integer | epoch ms（`running` 时为 null） |
| `input_tokens` | integer | **inclusive**：包含 `cache_read_input_tokens` 和 `cache_creation_input_tokens` |
| `output_tokens` | integer | 补全输出（本机 reasoning=0，未验证是否 ⊇ reasoning） |
| `reasoning_tokens` | integer | Thinking tokens（本机 4 条样本全 0） |
| `cache_read_input_tokens` | integer | ⊆ `input_tokens` |
| `cache_creation_input_tokens` | integer | ⊆ `input_tokens`（详见 §1.4 决策） |
| `provider_total_tokens` | integer | provider 报的原始 total |
| `computed_total_tokens` | integer | 客户端算的 total（与 provider 一致） |

索引：`(started_at, provider_id, model_id)` / `(session_id, turn_id)`。

#### 1.3.2 `session`

顶层会话表；SessionSnapshot 靠它。token pipeline 不 join（见 §五 P0#4 决定：token 不带
projectRef）。

| 字段 | 说明 |
|---|---|
| `id` | 与 `model_usage.session_id` 对应 |
| `directory` | cwd 绝对路径 → SessionSnapshot.projectRef |
| `title` | LLM 生成 |
| `time_created` / `time_updated` | epoch ms |
| `task_type` | `interactive` / 其它 |

#### 1.3.3 `turn_usage`

每 turn 一行，字段与 `model_usage` 相同（但为 turn 级汇总）。**不读**——`model_usage`
已是最细粒度，同时聚合 `turn_usage` 会导致 token 双计。

#### 1.3.4 `message`

对话原始消息（`data` 字段是 JSON blob，含 `role/content/tokens`）。SessionSnapshot 需要
统计 `userMessages / assistantMessages / totalMessages`，用 `SELECT COUNT(*), SUM(role='user'),
SUM(role='assistant')` 从此表拿。**不读 `data.tokens`**（跟 `model_usage` 同源，选一处）。

### 1.4 Token 语义（核心事实）

zcode 落库的 token 语义是 **inclusive OpenAI 风格**，与 codex / copilot-cli 同类型：

```
input_tokens          = uncached_input + cache_read + cache_creation
output_tokens         = 补全输出（本机 reasoning=0，未证 output ⊇ reasoning）
reasoning_tokens      = thinking tokens
cache_read_input_tokens     ⊆ input_tokens
cache_creation_input_tokens ⊆ input_tokens
computed_total_tokens = 参考本机 CLI 源码：
                        input_tokens > 0
                          ? input_tokens + output_tokens
                          : (cache_creation + cache_read) + output_tokens
```

即 zcode 自身在 `input_tokens > 0` 时**已经**把 cache_read 和 cache_creation 算进
`input_tokens`，`total` 不再重复加它们；只有当 `input_tokens = 0`（极少数纯 cache 的
路径）才 fallback 用 `cache_creation + cache_read` 兜底。

**本机 1 个真实 session（4 次 model call）实测**：

| # | input | cache_read | cache_creation | output | reasoning | computed_total | provider_total |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 11933 | 7360 | 0 | 170 | 0 | 12103 | 12103 |
| 2 | 16335 | 11904 | 0 | 180 | 0 | 16515 | 16515 |
| 3 | 17425 | 16320 | 0 | 180 | 0 | 17605 | 17605 |
| 4 | 18541 | 17408 | 0 | 799 | 0 | 19340 | 19340 |
| **Σ** | **64,234** | **52,992** | **0** | **1,329** | **0** | **65,563** | **65,563** |

验证：`computed_total == provider_total == input + output`；`cache_read ≤ input`；
`turn_usage` 单行汇总 = 4 行 model_usage 之和。

**关键决策：cache_creation 归入 input bucket、cached 只装 cache_read**

- **计费语义**：cache_read 一般按 cached 单价（Anthropic 家族约为 input 的 10%），
  cache_creation 一般按 input 单价（Anthropic 是 1.25×）。把 cache_creation 合并进
  cached 会用 read 单价打折 write，直接**低估成本**。
- **归一化公式**：

  ```
  if (input_tokens > 0):
      inputDisjoint = max(0, input_tokens - cache_read_input_tokens)
      cached        = cache_read_input_tokens
  else:                                       # zcode fallback 分支
      inputDisjoint = cache_creation_input_tokens
      cached        = cache_read_input_tokens
  outputDisjoint    = max(0, output_tokens - reasoning_tokens)  # 见 §一挑战 6
  reasoning         = reasoning_tokens
  ```

  cache_creation 由此**始终留在 input bucket**——`input_tokens > 0` 时它已经天然含在
  `input_tokens` 里；`input_tokens = 0` 的 fallback 分支显式加进 input。
- **归一化后 `total = input + cached + output + reasoning`**：
  - `input_tokens > 0`：`(input - cr) + cr + output = input + output = computed_total` ✓
  - `input_tokens = 0`：`cc + cr + output = (cc + cr) + output = computed_total` ✓
- **本机 4 行样本归一化后**：`input=11,242  cached=52,992  output=1,329  reasoning=0
  total=65,563`（与 zcode `computed_total_tokens` 之和一致）。
- **不扩 core `TokenDelta`**：pew 现有 4 字段能无损承载 zcode 数据，扩 5 字段会引发
  Core / Queue / D1 schema / RPC / Web / Worker 的全链路 migration，不成比例。
- **判断 disjoint vs inclusive 的正确姿势**：不能用 `input_tokens < cache_read + cache_creation`
  判断（inclusive 下 input 完全可能仍 > cache）。应看 provider_total 关系：
  - `provider_total == input_tokens + output_tokens` → inclusive（当前 zcode）
  - `provider_total == input_tokens + output_tokens + cache_read + cache_creation` → disjoint
  - 二者都不匹配 → 采用已确认的 CLI 语义并 log warn，parser 归一化结果照常返回

### 1.5 参考项目对 zcode 的处理评估

调研本地 `../reference/` 下 3 个开源 token tracker：

| 项目 | 数据源 | 归一化 | 结论 |
|---|---|---|---|
| **A** (Rust) | `~/.zcode/projects/*.jsonl`（本机不存在）+ `db.sqlite` `model_usage` | ❌ `total = input + output + cache_read + cache_write + reasoning` | 本机数据虚增 80.8%（65,563 → 118,555） |
| **B** (JS) | `db.sqlite` `message` 表的 `data.tokens` JSON | ❌ `total = input + output + reasoning + cached + cacheWrite` | 同样虚增 80.8% |
| **C** | 完全不支持 zcode | — | — |

两家共同根因：**假设 `input_tokens` 是 disjoint**（不含 cache），但 zcode 的
`input_tokens` 实际是 inclusive（`total = input + output` 自证）。pew 借鉴 codex/
copilot-cli 已栽过的坑（见 `packages/cli/src/parsers/codex.ts` `normalizeCodexUsage`），
从第一天就落 disjoint 字段。

---

## 二、关键挑战与解决方案

### 挑战 1：`input_tokens` 是 inclusive

见 §1.4。在 parser 里显式归一，测试固化不变式
`input_tokens ⊇ cache_read`（zcode CLI 源码保证的最弱不变式）。cache_creation 是否
`⊆ input_tokens` 由 provider_total 关系反推，见挑战 6。

### 挑战 2：为何只读 `model_usage`

同一份 token 数据在四处出现（`model_usage` 最细 / `turn_usage` 汇总 / `message.data.tokens`
嵌入 / `rollout/*.jsonl` 镜像）。选择 `model_usage`：
- 粒度最细：`(session_id, turn_id, model_id)` 保留，未来 model 归因不用重扫
- schema 明确：无 `json_extract`
- 增量最简：`id` 是 uuid，`lastProcessedIds` 天然键
- 分辨 running / terminal：`status IN ('completed','error','cancelled')` 过滤 in-flight
- `rollout/*.jsonl` 是 debug 镜像，token 同源，读它相当于二重

### 挑战 3：orchestrator 目前只识别 OpenCode / Hermes 两种 DB source

**问题**（review P0#1）：

- `packages/cli/src/commands/sync.ts:619` token DB dispatch 硬编码 `isOpenCode / isHermes`，
  只对这两个 source 做 cursor 读写、display name、`dbsScanned`。
- `packages/cli/src/commands/session-sync.ts:299` session DB loop 完全写死 OpenCode，
  末尾还会 `cursors.openCodeSqlite = result.cursor as OpenCodeSqliteSessionCursor`，
  ZCode driver 一旦挂到这个循环会**覆盖 OpenCode 的 session cursor**。

**解决**：抽象 DB dispatch，让 orchestrator 按 `driver.source` + 一张"cursor 路由表"处理，
而不是继续 `if (isOpenCode) ... else if (isHermes) ... else ...`。具体到本次改动的最小面：

1. `sync.ts` 里的 token DB 分派段（第 619 行前后）改成：
   ```ts
   const dbCursorMap: Record<string, DbCursorAccess> = {
     opencode:  { get: c => c.openCodeSqlite,      set: (c, v) => c.openCodeSqlite = v, key: "openCodeSqlite" },
     hermes:    { get: (c, k) => c.hermesSqlite?.[k!], set: (c, v, k) => ((c.hermesSqlite ??= {})[k!] = v), key: "hermesSqlite" },
     zcode:     { get: c => c.zcodeSqlite,          set: (c, v) => c.zcodeSqlite = v, key: "zcodeSqlite" },
   };
   const displayNameMap = { opencode: "OpenCode SQLite", hermes: ..., zcode: "ZCode SQLite" };
   ```
   同时把 `dbsScanned` 从固定 `{ opencode, hermes }` 改成 `Partial<Record<Source, number>>`
   / 或列出所有 3 个 DB source 的显式字段。
2. `session-sync.ts` 里的 DB session 循环改成同样按 map 分派，取消对 `openCodeSqlite`
   的写死赋值。
3. `knownDbSources` 里的 key 相应加 `"zcodeSqlite"`；`packages/cli/src/commands/sync.ts`
   的 backfill 段（sync.ts:250 起）增加 `if (cursors.zcodeSqlite) cursors.knownDbSources.zcodeSqlite = true`。
4. cursor-loss / inode-replay：ZCode 走 opencode 相同的模式（inode 变化 → 清 cursor →
   全量重扫）。sqlite 打开时读一下 `st.ino`，与 `cursor.inode` 比较。
5. driver 级异常隔离：orchestrator 里 `for (const driver of activeDbDrivers)` 循环包
   `try/catch`，抛错的 driver 只影响自己那一 source，不阻塞其他 driver。**这是 review
   P0#1 明确要求的"session DB driver 级异常隔离"，同时也补齐 OpenCode/Hermes 一起**
   （目前二者一起挂）。

### 挑战 4：cursor 数据结构 = token 一份 / session 一份，都要带 inode + `lastProcessedIds`

**问题**（review P0#2）：pew 有两个独立 cursor 文件（`CursorState.zcodeSqlite` vs
`SessionCursorState.zcodeSqlite`），本机现有的 OpenCode / Hermes cursor 都已带
`inode / lastProcessedIds / updatedAt`，用 `>=` + `lastProcessedIds` 边界去重（而非 `>` 或
无限增长的 `seenIds`）。

**解决**：镜像 `OpenCodeSqliteCursor` / `OpenCodeSqliteSessionCursor` 结构，
拆两个新 interface：

```ts
// packages/core/src/types.ts — token cursor
export interface ZcodeSqliteCursor {
  /** Max completed_at seen from model_usage (epoch ms) */
  lastCompletedAt: number;
  /** IDs of model_usage rows at exactly lastCompletedAt (for >= dedup) */
  lastProcessedIds?: string[];
  /** DB file inode (detect replacement/recreation) */
  inode: number;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
}

// packages/core/src/types.ts — session cursor
export interface ZcodeSqliteSessionCursor {
  /** Max time_updated seen from session table (epoch ms) */
  lastTimeUpdated: number;
  /** IDs of sessions at exactly lastTimeUpdated (for >= dedup) */
  lastProcessedIds?: string[];
  /** DB file inode (detect replacement/recreation) */
  inode: number;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
}
```

SQL 用 `WHERE completed_at > ? OR (completed_at = ? AND id NOT IN (?))` 或
`WHERE completed_at >= ?` 然后按 `lastProcessedIds` 过滤（与 OpenCode 一致）。
**不使用无限增长的 `seenIds`**，只保留 watermark 边界毫秒上的 IDs。

### 挑战 5：Session 数据

同一 `db.sqlite`。SessionSnapshot 字段来源：

- `startedAt` = ISO(`session.time_created`)
- `lastMessageAt` = ISO(`session.time_updated`)
- `durationSeconds` = `(time_updated - time_created) / 1000`
- `totalMessages / userMessages / assistantMessages` = 从 `message` 表 count（用
  `json_extract(data, '$.role')`）
- `model` = 该 session 里 `model_usage` 中出现次数最多的 `model_id`（一次 SQL：
  `SELECT model_id FROM model_usage WHERE session_id=? GROUP BY model_id ORDER BY COUNT(*) DESC, model_id LIMIT 1`；
  tie-break 用字典序保证 deterministic）
- `projectRef` = `session.directory`（空字符串视为 null）
- `sessionKey` = `zcode:${session.id}`（无 hostname、无 test user id；parser 拿不到发布侧
  user，也不该拿）
- `kind` = `"human"`（zcode CLI 是交互式）
- `snapshotAt` = ISO(now)

增量：`WHERE time_updated >= COALESCE(lastTimeUpdated, 0)`，然后 `lastProcessedIds`
过滤（同 OpenCode session driver）。

### 挑战 6：reasoning 与 output 的语义未闭环

**问题**（review P1#3）：本机 4 条样本 `reasoning_tokens = 0`，无法直接验证 zcode
`output_tokens` 是否 ⊇ reasoning（inclusive）或 ⟂ reasoning（disjoint）。假定 inclusive
的构造测试不能替代真实语义验证。

**解决**：**运行时用 `provider_total_tokens` 反推**（不做静态假设）。给定一行 model_usage，
定义：

- `inclusiveOutput = inputSide + output_tokens`
- `disjointOutput = inclusiveOutput + reasoning_tokens`
- `inputSide = input_tokens > 0 ? input_tokens : (cache_creation + cache_read)`

三种情况：
1. `provider_total == inclusiveOutput` → **reasoning 已在 output 内**，用 `output - reasoning`
2. `provider_total == disjointOutput` → **reasoning 与 output disjoint**，output 保留
3. 都不匹配 → 采用已确认的 CLI 语义（inclusive），parser 归一化结果照常返回，
   同时 emit 一条 `warn`（once-per-run 抑制），供未来 debug

本机 4 行 reasoning=0 → 情况 1 = 情况 2，无歧义；未来非零样本进入时自动切换或告警。

**测试要求**：`zcode-sqlite.test.ts` 至少覆盖以下三个真实/构造样本：
- Case 9a：reasoning>0 且 `provider_total = input + output`（inclusive 分支）
- Case 9b：reasoning>0 且 `provider_total = input + output + reasoning`（disjoint 分支）
- Case 9c：reasoning>0 且 provider_total 均不匹配（warn 分支，不 throw）

### 挑战 7：DB opener 依赖注入链路（不是 discover-based）

**问题**（review P0#1）：文档早期版本按 file driver 思路，说要加 `DiscoverOpts.zcodeDbPath`
和 `discoverZcodeDb()`。但 pew 的 DB driver 走的是**不同链路**：

- 参考 `packages/cli/src/drivers/registry.ts:164`：DB driver 由 `openXxxDbPath +
  openXxxDb`（一个 path + 一个 opener 函数）联合激活；`DbTokenDriver` 没有 `discover()`。
- 参考 `packages/cli/src/cli.ts:224` 与 `:636`：这两处是**入口划分**，不是 token/session
  分工：
  - **`cli.ts:224`** = 手动 `pew sync` 命令入口，动态 import `openMessageDb + openSessionDb
    + openHermesDb` 三个 opener（既 usage 又 session），都传给 `executeSync`
  - **`cli.ts:636`** = `pew notify` 命令入口，同样把 usage + session opener 全部装载，
    传给 `executeNotify`，notify 内部各自转发给 executeSync / executeSessionSync
  - 即两个入口，每个入口都要**同时**加载 usage + session opener（zcode 有两个 opener）

**解决**：给 zcode 增加一整条 opener 注入链路，与 OpenCode / Hermes 对齐：

1. `packages/cli/src/parsers/zcode-sqlite-db.ts` 导出 `openZcodeUsageDb(dbPath)` —
   返回 `{ queryUsageRows(startAtMs, ids): Row[]; readInode(): number; close(): void }`
2. `packages/cli/src/parsers/zcode-sqlite-session-db.ts` 导出 `openZcodeSessionDb(dbPath)` —
   `{ querySessions(startAtMs, ids): SessionRow[]; queryMessages(sessionId): MessageCounts;
   queryPrimaryModel(sessionId): string | null; readInode(): number; close(): void }`
3. `packages/cli/src/commands/sync.ts` `SyncOptions`（sync.ts:32 起）加：
   - `zcodeDbPath?: string`
   - `openZcodeDb?: (dbPath: string) => ReturnType<typeof openZcodeUsageDb> | null`
4. `packages/cli/src/commands/session-sync.ts` `SessionSyncOptions` 加：
   - `zcodeDbPath?: string`
   - `openZcodeSessionDb?: (dbPath: string) => ReturnType<typeof openZcodeSessionDb> | null`
5. `packages/cli/src/drivers/registry.ts`：
   - `TokenDriverRegistryOpts` 加 `zcodeDbPath?` + `openZcodeDb?`；激活条件
     `if (opts.zcodeDbPath && opts.openZcodeDb) dbDrivers.push(createZcodeTokenDriver(...))`
   - `SessionDriverRegistryOpts` 同上
6. `packages/cli/src/cli.ts` **两个入口 × 每个入口两个 opener = 4 处动态 import**：
   - cli.ts:224 段（手动 sync 入口）**加两个** try/import：
     ```ts
     let openZcodeDb: typeof import("./parsers/zcode-sqlite-db.js").openZcodeUsageDb | undefined;
     let openZcodeSessionDb: typeof import("./parsers/zcode-sqlite-session-db.js").openZcodeSessionDb | undefined;
     try {
       const mod = await import("./parsers/zcode-sqlite-db.js");
       openZcodeDb = mod.openZcodeUsageDb;
     } catch { /* SQLite adapter not available on this runtime */ }
     try {
       const mod = await import("./parsers/zcode-sqlite-session-db.js");
       openZcodeSessionDb = mod.openZcodeSessionDb;
     } catch { /* SQLite adapter not available on this runtime */ }
     ```
     然后 `executeSync({ ..., zcodeDbPath: paths.zcodeDbPath, openZcodeDb, openZcodeSessionDb })`
   - cli.ts:636 段（notify 入口）**镜像**上面两段 try/import，然后传给 `executeNotify`
   - **注释别写"bun-only"**：pew 现有 `opencode-sqlite-db.ts` 支持 `bun:sqlite`（Bun）
     + `node:sqlite`（Node ≥ 22.5）双 runtime。zcode adapter 复用同一实现，注释写
     "SQLite adapter not available on this runtime"（老 Node.js < 22.5 才会走 catch）
   - **预检查**：opener 存在但 `openZcodeDb(dbPath)` 返回 null（打开失败）→ log warn
     "ZCode SQLite unavailable" 并跳过 driver，不阻塞其他 source
7. `packages/cli/src/commands/notify.ts` `NotifyOptions` 同时加 `zcodeDbPath +
   openZcodeDb + openZcodeSessionDb` 三个字段，转发给 executeSync / executeSessionSync
8. `packages/cli/src/utils/paths.ts` 加 `zcodeDbPath = join(zcodeHome, "cli/db/db.sqlite")`

**删除项**（明确不做）：
- ❌ `DiscoverOpts.zcodeDbPath` — DB driver 不走 discover
- ❌ `discovery/sources.ts` 里 `discoverZcodeDb()` — 存在性检测由 opener 内部处理
- ❌ "driver discover 返回 []" 测试用例

在 registry 里没有同时给 path + opener 的情况下，driver **不会被创建**——这也是本条
review 的核心：完成 refactor 后必须验证"生产 CLI 实际能创建 ZCode driver"，而不是仅仅
类型编译通过。

### 挑战 8：warning 通道（`DbTokenResult.warnings`）

**问题**（review 追加项）：§3.3 的 `normalizeZcodeUsage` 会 emit warn（`provider_total`
不匹配），但当前 `DbTokenResult<TCursor>`（`packages/cli/src/drivers/types.ts:312`）
没有 warning 传递字段——即便 parser 里收集了也没通道到 orchestrator。

**解决**：给 core `DbTokenResult` / `DbSessionResult` 各加一个可选字段：

```ts
export interface DbTokenResult<TCursor> {
  deltas: ParsedDelta[];
  cursor: TCursor;
  rowCount: number;
  warnings?: string[];   // ← new
}
export interface DbSessionResult<TCursor> {
  snapshots: SessionSnapshot[];
  cursor: TCursor;
  rowCount: number;
  warnings?: string[];   // ← new (for future use)
}
```

Orchestrator（sync.ts / session-sync.ts 里的 DB driver loop）遍历
`result.warnings ?? []`，每条转成 `onProgress({ source: driver.source, phase: "warn",
message: w })`。既有 OpenCode / Hermes driver 不返回 warnings → `?? []` 天然兼容，
向后兼容 zero-cost。

`SyncProgressEvent.phase` 需要加 `"warn"` 变体（如目前不存在）；`cli.ts` 里
`logSyncProgress` 收到 `phase: "warn"` 时用 `log.warn(...)` 打印。

**为什么放在 driver 结果里而不是全局 log**：一致的路径 = 便于测试断言（unit test 可直接
检查 `result.warnings.length`），也便于未来把 warnings 挂到 `status` 输出。

---

## 三、Token 统计方案

### 3.1 字段映射

| pew `TokenDelta` 字段 | 来源公式（inclusive → disjoint） |
|---|---|
| `inputTokens` | `input_tokens > 0` 时 = `max(0, input_tokens - cache_read_input_tokens)`；否则 = `cache_creation_input_tokens`（fallback，见 §1.4） |
| `cachedInputTokens` | `cache_read_input_tokens`（只装 read，不合入 creation） |
| `outputTokens` | `max(0, output_tokens - reasoning_tokens)` — 前提：reasoning ⊆ output（见 §一挑战 6 provider-total 检验） |
| `reasoningOutputTokens` | `reasoning_tokens` |

派生 `total_tokens = input + cached + output + reasoning`（bucket aggregator 已有该行为）。

**本机 4 行归一化后（sum）**：`input=11,242  cached=52,992  output=1,329  reasoning=0
total=65,563` —— 与 zcode `computed_total_tokens` 之和一致，无损。

### 3.2 SQL 查询

```sql
SELECT
  mu.id,
  mu.session_id,
  mu.turn_id,
  mu.model_id,
  mu.provider_id,
  mu.status,
  mu.started_at,
  mu.completed_at,
  mu.input_tokens,
  mu.output_tokens,
  mu.reasoning_tokens,
  mu.cache_read_input_tokens,
  mu.cache_creation_input_tokens,
  mu.provider_total_tokens,          -- 可能为 NULL（provider 未返回）
  mu.computed_total_tokens           -- 客户端算的 total，总有值
FROM model_usage mu
WHERE mu.status IN ('completed', 'error', 'cancelled')
  AND mu.completed_at IS NOT NULL
  AND mu.completed_at >= COALESCE(?, 0)      -- lastCompletedAt
ORDER BY mu.completed_at, mu.id;
```

- **包含 error / cancelled**（review P1#6）：error 和 cancelled 的 model call 也已计费
  （token 已从 provider 返回），只要 `completed_at IS NOT NULL` 就属于终态。
- 只排除 `status = 'running'` 的 in-flight turn，避免半个 usage 被落。
- `completed_at >= ?` 与 `lastProcessedIds` 组合去重（同 OpenCode，防同毫秒漏行）。
- `provider_total_tokens` 可为 NULL；`computed_total_tokens` 是 NOT NULL default 0，
  归一化里 `reportedTotal = raw.providerTotalTokens ?? raw.computedTotalTokens`。

### 3.3 归一化代码

```ts
export interface ZcodeUsageRow {
  id: string;
  sessionId: string;
  turnId: string | null;
  modelId: string;
  providerId: string;
  status: "completed" | "error" | "cancelled";
  startedAt: number;                         // epoch ms
  completedAt: number;                       // epoch ms (SQL 已过滤 NOT NULL)
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  providerTotalTokens: number | null;        // provider 未返回时为 NULL
  computedTotalTokens: number;               // NOT NULL default 0
}

export function normalizeZcodeUsage(raw: ZcodeUsageRow): {
  tokens: TokenDelta;
  warn?: string;
} {
  const cacheRead = Math.max(0, raw.cacheReadInputTokens);
  const cacheWrite = Math.max(0, raw.cacheCreationInputTokens);
  const inputRaw = Math.max(0, raw.inputTokens);
  const outputRaw = Math.max(0, raw.outputTokens);
  const reasoning = Math.max(0, raw.reasoningTokens);

  // cache_creation stays in input bucket (see §1.4).
  const inputSide =
    inputRaw > 0
      ? Math.max(0, inputRaw - cacheRead)
      : cacheWrite;

  // reasoning ⊆ output vs disjoint — check via provider_total (fallback to
  // computed_total when provider omitted it).
  const reportedTotal = raw.providerTotalTokens ?? raw.computedTotalTokens;
  const inclusiveOutput = inputRaw > 0
    ? inputRaw + outputRaw
    : (cacheWrite + cacheRead) + outputRaw;
  const disjointOutput = inclusiveOutput + reasoning;

  let output: number;
  let warn: string | undefined;
  if (reportedTotal === inclusiveOutput) {
    // reasoning already inside output_tokens
    output = Math.max(0, outputRaw - reasoning);
  } else if (reportedTotal === disjointOutput) {
    // reasoning disjoint — keep output as-is
    output = outputRaw;
  } else {
    // Neither matches — fall back to observed CLI semantics (reasoning ⊆ output)
    // and surface the mismatch for future debugging.
    output = Math.max(0, outputRaw - reasoning);
    warn = `zcode provider_total mismatch: got ${reportedTotal}, ` +
           `expected ${inclusiveOutput} (inclusive) or ${disjointOutput} (disjoint)`;
  }

  return {
    tokens: {
      inputTokens: inputSide,
      cachedInputTokens: cacheRead,
      outputTokens: output,
      reasoningOutputTokens: reasoning,
    },
    warn,
  };
}
```

调用方 log `warn` 时用 `once-per-run` 抑制，避免脏 provider_total 一次污染多行日志。
warning 通过 `DbTokenResult.warnings?: string[]` 向上传（见 §二挑战 8）。

### 3.4 ParsedDelta 输出

```ts
const warnings: string[] = [];
const seenWarn = new Set<string>();

for (const row of rows) {
  const normalized = normalizeZcodeUsage(row);
  if (normalized.warn && !seenWarn.has(normalized.warn)) {
    warnings.push(normalized.warn);
    seenWarn.add(normalized.warn);
  }
  deltas.push({
    source: "zcode",
    model: row.modelId,
    timestamp: new Date(row.completedAt).toISOString(),
    tokens: normalized.tokens,   // ← 只取 tokens，不整个赋值
  });
}

return { deltas, cursor: nextCursor, rowCount: rows.length, warnings };
```

**不带 projectRef**（review P0#4 明确澄清）：
- `packages/cli/src/parsers/claude.ts:7` 起的 `ParsedDelta` 接口没有 projectRef 字段
- `packages/core/src/types.ts:269` 起的 `QueueRecord` 也没有
- `packages/worker/src/index.ts:62` 起的 D1 唯一键是
  `(user_id, device_id, source, model, hour_start)`，不包含 project
- **Project 归因走 SessionSnapshot 通道**（`projectRef` 是 SessionSnapshot 字段，见 §五）

### 3.5 幂等性保证

- `id` 是 uuid，永不复用 → 组合 `lastCompletedAt` + `lastProcessedIds` 完美去重
- SQL 只查终态行 → running turn 永不 emit 半个 usage
- inode 变化触发 cursor 清空 → 全量重扫
- D1 upsert 保证 batch 结果一致

---

## 四、Session 统计方案

### 4.1 SessionSnapshot 提取

```ts
const snapshot: SessionSnapshot = {
  sessionKey: `zcode:${session.id}`,       // 稳定键；不掺 hostname / user id
  source: "zcode",
  kind: "human",                            // zcode CLI 是交互
  startedAt: new Date(session.time_created).toISOString(),
  lastMessageAt: new Date(session.time_updated).toISOString(),
  durationSeconds: Math.max(0, Math.floor((session.time_updated - session.time_created) / 1000)),
  userMessages,                             // COUNT WHERE role='user'
  assistantMessages,                        // COUNT WHERE role='assistant'
  totalMessages,                            // COUNT(*)
  projectRef: session.directory?.trim() || null,
  model: primaryModelId,                    // model_usage 里出现最多，tie-break 字典序
  snapshotAt: new Date().toISOString(),
};
```

字段类型严格对齐 `packages/core/src/types.ts:297`：`startedAt / lastMessageAt / snapshotAt`
是 **ISO string**（不是 number），`kind` 是 `"human" | "automated"`（不是 `"agent"`）。

### 4.2 增量策略

- `zcodeSqlite` (session cursor，独立文件 `SessionCursorState.zcodeSqlite`)
- `WHERE time_updated >= COALESCE(lastTimeUpdated, 0)`（首次 = 全量）
- `lastProcessedIds` 过滤同毫秒边界

session driver 结构 100% 参考 `packages/cli/src/drivers/session/opencode-sqlite-session-driver.ts`，
不引入新模式。

---

## 五、Source 类型系统性扩展

任何一处漏改都会让 TypeScript `never` 检查断言失败。以下清单**必须逐一勾选**。

### 5.1 Core types & constants（edit）

- `packages/core/src/types.ts`：
  - `Source` union 加 `"zcode"`
  - 新增 `ZcodeSqliteCursor`（§二挑战 4）
  - 新增 `ZcodeSqliteSessionCursor`（§二挑战 4）
  - `CursorState` 加 `zcodeSqlite?: ZcodeSqliteCursor`
  - `SessionCursorState` 加 `zcodeSqlite?: ZcodeSqliteSessionCursor`
  - `knownDbSources` 注释里更新示例 keys
- `packages/core/src/constants.ts`：`SOURCES` 加 `"zcode"`
- `packages/core/src/__tests__/constants.test.ts`：长度 12 → 13；含 `"zcode"`
- `packages/core/src/__tests__/types.test.ts`：字符串枚举断言列表加 `"zcode"`
- `packages/core/src/__tests__/validation.test.ts`：`isValidSource("zcode")` + 遍历列表加 `"zcode"`

### 5.2 CLI parsers（new）

- `packages/cli/src/parsers/zcode-sqlite.ts` — SQL + `normalizeZcodeUsage` + 结果类型
- `packages/cli/src/parsers/zcode-sqlite-db.ts` — bun:sqlite 封装（与 opencode-sqlite-db /
  hermes-sqlite-db 同风格），DI 友好
- `packages/cli/src/parsers/zcode-session.ts` — SessionSnapshot 提取

### 5.3 CLI drivers（new）

- `packages/cli/src/drivers/token/zcode-sqlite-token-driver.ts` — phase 2 DB driver
- `packages/cli/src/drivers/session/zcode-sqlite-session-driver.ts` — phase 2 DB driver

### 5.4 CLI wiring（edit）

**5.4.a Orchestrator dispatch 抽象**（review P0#1，第一轮）：

- `packages/cli/src/commands/sync.ts`
  - 抽象 DB cursor 路由表（`opencode / hermes / zcode`）；删除 `isOpenCode / isHermes`
    硬编码分支（当前在 sync.ts:619 起）
  - `dbsScanned` 字段从固定 `{ opencode, hermes }` 改成 `Partial<Record<Source, number>>`
    或列出全部 DB source
  - `sourceKey()`（sync.ts:137）switch 加 `case "zcode": return "zcode"`
  - `SyncResult.sources.zcode` / `filesScanned.zcode` 初始化 0
  - `knownDbSources` backfill 段（sync.ts:250）加 `if (cursors.zcodeSqlite)
    cursors.knownDbSources.zcodeSqlite = true`
  - driver loop 加 `try/catch`，保证 driver 级异常隔离
- `packages/cli/src/commands/session-sync.ts`
  - 同上抽象：删除对 `cursors.openCodeSqlite` 的直接赋值（session-sync.ts:299）；改按
    driver.source 路由
  - `sourceCounts` / `dbsScanned` 支持 zcode 列
  - driver loop `try/catch`
  - 注意：这里的 `sourceKey(driver.source)` 调用（session-sync.ts:184 / 300）用的是
    `session-sync-helpers.sourceKey`（下方），并不定义 sourceKey 本身
- `packages/cli/src/commands/session-sync-helpers.ts` — `sourceKey()` switch（第 56 行起）
  加 `case "zcode": return "zcode"`
- ~~`packages/cli/src/notifier/coordinator.ts` — `sourceKey()` 加 case~~ — **不动**。
  coordinator 用的是 `Record<string, number>`，没有 source switch，通过 `sourceKey`
  路由，自然通过 sync 的 `sourceKey` 生效。

**注**：pew 中真正需要加 `case "zcode"` 的 `sourceKey()` **只有两处**：`sync.ts:137`
和 `session-sync-helpers.ts:56`。session-sync.ts 里的 `sourceKey(driver.source)`
是调用点（第 184、300 行），不是定义点。

**5.4.b Driver 注册与 opener 注入**（review P0#1，第二轮）：

见 §二挑战 7 完整链路。核心结论：

- `packages/cli/src/drivers/registry.ts`
  - `TokenDriverRegistryOpts` 加 `zcodeDbPath?: string` + `openZcodeDb?: (dbPath: string) => ...`
  - `SessionDriverRegistryOpts` 同上
  - 激活条件：`if (opts.zcodeDbPath && opts.openZcodeDb) dbDrivers.push(createZcodeTokenDriver({...}))`
- `packages/cli/src/parsers/zcode-sqlite-db.ts` — 导出 `openZcodeUsageDb(dbPath)`
- `packages/cli/src/parsers/zcode-sqlite-session-db.ts` — 导出 `openZcodeSessionDb(dbPath)`
- `packages/cli/src/commands/sync.ts` `SyncOptions` 加 `zcodeDbPath / openZcodeDb`
- `packages/cli/src/commands/session-sync.ts` `SessionSyncOptions` 加 `zcodeDbPath /
  openZcodeSessionDb`
- `packages/cli/src/commands/notify.ts` `NotifyOptions` 同样透传两个字段
- ~~`packages/cli/src/drivers/types.ts` `DiscoverOpts.zcodeDbPath?`~~ — **不加**。DB driver
  不走 discover 链路（file driver 才用 DiscoverOpts）
- ~~`packages/cli/src/discovery/sources.ts` `discoverZcodeDb()`~~ — **不加**。存在性
  检测由 opener 内部处理

**5.4.c 路径**：

- `packages/cli/src/utils/paths.ts` — 加 `zcodeHome = join(home, ".zcode")` 和
  `zcodeDbPath = join(home, ".zcode/cli/db/db.sqlite")`
- `packages/cli/src/__tests__/paths.test.ts` — 覆盖新字段
- ~~`packages/cli/src/storage/prune-alias-cursors.ts`~~ — **不动**。prune 只处理文件
  cursor；DB cursor 由 orchestrator 自己管理
- ~~`packages/cli/src/commands/status.ts` 加 `zcodeHome` 分类~~ — **不动**。status
  只遍历 `cursors.files`（file cursors），加 `zcodeHome` 分类无法显示 DB cursor。DB
  source 的 status 展示是另一个课题（OpenCode / Hermes 也没显示），本 PR 不新开。

**5.4.d 入口 / 通知 / formatter / summary**：

- `packages/cli/src/cli.ts`
  - `isSource()` 允许 `"zcode"`
  - `SOURCE_LABELS.zcode = "ZCode"`
  - **两套动态 import**（review P1#4）：
    - cli.ts:224 段（token）加 `let openZcodeDb = undefined; try { const mod = await
      import("./parsers/zcode-sqlite-db.js"); openZcodeDb = mod.openZcodeUsageDb; } catch {}`；
      随后 `SyncOptions` 传 `zcodeDbPath: paths.zcodeDbPath, openZcodeDb`
    - cli.ts:636 段（session）加对应的 `openZcodeSessionDb` 动态 import
  - **progress formatter**（cli.ts:102，review P1#4）：DB source 消息展示逻辑目前只
    识别 `event.source === "opencode-sqlite"`。改成同时支持 `"opencode-sqlite" |
    "zcode-sqlite"`（或抽象成"source 以 `-sqlite` 结尾"），让 ZCode DB 活动也显示
  - **token 完成摘要**（cli.ts:247 附近）：`if (result.sources.zcode > 0)
    deltaParts.push(\`ZCode: ${result.sources.zcode}\`)`
  - **session 完成摘要**（cli.ts:337 附近，review P1#4 明确漏项）：加
    `if (sessionResult.sources.zcode > 0) sessParts.push(\`ZCode: ${sessionResult.sources.zcode}\`)`
  - notify 路径（cli.ts:679 附近）同样透传两个 opener

### 5.5 Web dashboard（edit）

- `packages/web/src/lib/pricing.ts` — `DEFAULT_SOURCE_DEFAULTS.zcode`（按 GLM-5.2 保守估价，
  例：`{ input: 2, output: 8, cached: 0.5 }`；dynamic pricing 上线后覆盖）
- `packages/web/src/lib/palette.ts` — 新增 chart-13 palette 条目（source-color 映射）
- `packages/web/src/lib/usage-transforms.ts:178` `SOURCE_LABELS` 加 `zcode: "ZCode"`
- `packages/web/src/app/globals.css` — 3 处：
  - 顶部 `--color-chart-13: hsl(var(--chart-13))`（`:root` 层）
  - light theme `--chart-13: <hue> <sat>% <light>%;`
  - dark theme `--chart-13: <hue> <sat>% <light>%;`
- `packages/web/src/app/leaderboard/agents/page.tsx:27` — `AGENTS` 数组加 `"zcode"`
- API `VALID_SOURCES` 6 处 allowlist：
  - `packages/web/src/app/api/usage/route.ts:24`
  - `packages/web/src/app/api/sessions/route.ts:21`
  - `packages/web/src/app/api/leaderboard/route.ts:31`
  - `packages/web/src/app/api/users/[slug]/route.ts:28`
  - `packages/web/src/app/api/projects/route.ts:15`
  - `packages/web/src/app/api/projects/[id]/route.ts`（若存在同 Set）
- `packages/web/src/__tests__/palette.test.ts` — 长度断言从 12 → 13；含 `chart-13`

**明确不需要改**（review 澄清）：
- ~~worker-read RPC 里的 source-specific 字段~~ — reasoning 已通用化，zcode 直接复用
- ~~`device-helpers.ts` / `cost-helpers.ts` 里的 source-tuple~~ — 只要通过 core `Source`
  遍历就能自动覆盖 zcode

### 5.6 Docs / onboarding（edit）

- `README.md` — "12 种" → "13 种"；banner + 特性表 + 命令表加 ZCode（按字母序：Grok
  之前的字母以 V 结尾，Z 排最后，即 "…VS Code Copilot、ZCode"）；"无 hook" 列表加 ZCode
- `packages/web/src/components/landing/landing-content.tsx` — hero source 清单加 ZCode
  （字母序末位）；"无 hook" 说明加 ZCode
- `CLAUDE.md` — "Supported AI Tools" 段加 ZCode（字母序末位）
- **`PRIVACY.md`**（review P1#5）— "Raw data is read-only" 段（PRIVACY.md:71）里的
  只读路径列表补上 `~/.zcode/`，与已列出的 `~/.claude/` / `~/.gemini/` /
  `~/.local/share/opencode/` / `~/.openclaw/` / `~/.grok/` 并列
- `docs/README.md` — 索引表加 `43 | 43-zcode-support.md | ZCode CLI token support | done`

### 5.7 Release

- 版本号 bump（Z+1 patch 或 Y+1 minor，视整体改动量）
- `CHANGELOG.md` "Added" 段：ZCode CLI as pew's 13th source
- npm publish + Workers deploy + CI 观察

---

## 六、原子化提交计划

**依赖顺序**：`sourceKey()` 用 `never` 穷举检查（sync.ts:137 / session-sync-helpers.ts:56），
任何 commit 只要给 `Source` 加 `"zcode"`，两处 switch 立刻编译失败。为此重排：

| # | Commit | 内容 | 独立编译? |
|---|---|---|---|
| 1 | **`feat: add "zcode" source foundation (types + exhaustive switches + opener injection stubs + warnings channel)`** | `core/types.ts` 加 `zcode` + 两个 cursor interface；`core/constants.ts` `SOURCES`；2 处真实 `sourceKey()` 加 `case "zcode"`；`SyncResult.sources.zcode` / `filesScanned.zcode` 初始化；`SyncOptions` / `SessionSyncOptions` / `NotifyOptions` / `TokenDriverRegistryOpts` / `SessionDriverRegistryOpts` 加 `zcodeDbPath?` + `openZcodeDb?` / `openZcodeSessionDb?`（stub，尚未激活）；`drivers/types.ts` `DbTokenResult` / `DbSessionResult` 加 `warnings?: string[]`；`SyncProgressEvent.phase` 加 `"warn"` 变体；`utils/paths.ts` 加 zcodeHome/zcodeDbPath；`cli.ts` `isSource()` + `SOURCE_LABELS`；core & CLI 相关 tests（constants/types/validation/paths）。**尚无 parser / driver / dispatch 改动** | ✅ |
| 2 | `refactor(cli): abstract DB cursor dispatch in sync + session-sync orchestrators + wire warnings channel` | 引入 `dbCursorRouteMap` / display-name map，删掉 `isOpenCode / isHermes` 硬编码；行为对齐现状（zcode 分支存在但不激活，因为 driver 未注册）；driver loop 加 `try/catch`；orchestrator 遍历 `result.warnings ?? []` 转成 `onProgress({ phase: "warn" })`；`cli.ts` `logSyncProgress` 收到 `phase: "warn"` 时 `log.warn(...)`；补 OpenCode/Hermes 的 orchestrator 隔离测试 | ✅ 无功能变化，仅 refactor |
| 3 | `feat(cli): add zcode sqlite parser + normalizer (no wiring)` | `parsers/zcode-sqlite.ts` + `zcode-sqlite-db.ts` + `parsers/__tests__/zcode-sqlite.test.ts`。TDD 先测后码。包含 §一挑战 6 provider-total 三分支 | ✅ |
| 4 | `feat(cli): add zcode sqlite session parser (no wiring)` | `parsers/zcode-session.ts` + `zcode-sqlite-session-db.ts` + test | ✅ |
| 5 | `feat(cli): add zcode token+session drivers and register them` | `drivers/token/zcode-sqlite-token-driver.ts`、`drivers/session/zcode-sqlite-session-driver.ts`、`drivers/registry.ts` 加激活分支（`zcodeDbPath && openZcodeDb`）；registry test 覆盖两种"激活/未激活" | ✅ |
| 6 | `feat(cli): wire zcode through sync + session-sync + notify` | `cli.ts` **4 处**动态 import（cli.ts:224 usage + session；cli.ts:636 usage + session）；progress formatter 支持 `zcode-sqlite`；token / session 两处完成摘要加 zcode 分量；SQLite unavailable 预检查 warn；`normalizeZcodeUsage` 的 warn 通过 driver `warnings` 上抛 → cli 侧 log.warn | ✅ |
| 7 | `feat(web): add zcode to dashboard palette + labels + pricing fallback + API allowlists` | `pricing.ts` fallback；`palette.ts` + globals.css chart-13 三处；`usage-transforms.ts` SOURCE_LABELS；`leaderboard/agents/page.tsx` AGENTS；6 处 API VALID_SOURCES；`palette.test.ts` 断言 | ✅ |
| 8 | `docs(43): mark zcode support as implemented; update CLAUDE.md/README/landing/PRIVACY/docs-index` | 5 个文档（含 PRIVACY.md）+ doc 43 status → done + 12 → 13 | ✅ |

每个 commit 单独运行：`bun run test` 全绿 + `bun run lint` 全绿 + pre-commit L1/G1 通过。

---

## 七、测试覆盖率

### 7.1 L1 Unit tests（parser 层）

**`zcode-sqlite.test.ts`**：

| Case | 输入 | 期望 |
|---|---|---|
| 1 | 1 行 model_usage（本机首行） | 1 delta，disjoint：input=4573 cached=7360 output=170 rea=0 |
| 2 | 4 行 model_usage（本机 4 行） + 首次 sync | 4 deltas，累计 input=11242 cached=52992 out=1329 rea=0 total=65563 |
| 3 | 1 行 `status='running'` | 0 deltas（SQL 过滤） |
| 4 | 1 行 `status='error'` + 1 行 `status='cancelled'`（token 非零） | 2 deltas（terminal 但非成功也计费） |
| 5 | 异常：`cache_read > input_tokens`（脏数据） | inputDisjoint=0（`Math.max(0, ...)` 防御） |
| 6 | 增量：cursor `lastCompletedAt=row3.completedAt, lastProcessedIds=[row3.id]`，再来 row3 + row4 | 只 emit row4 |
| 7 | 空表 | 0 deltas，无异常 |
| 8 | 同一 `completed_at` 毫秒有 2 行 | 都 emit；下次 sync 用 `lastProcessedIds=[row_a.id, row_b.id]` 全跳过 |
| 9a | reasoning>0，`provider_total = input + output`（inclusive 分支） | outputDisjoint=`out - rea`；reasoning 字段透传；无 warn |
| 9b | reasoning>0，`provider_total = input + output + reasoning`（disjoint 分支） | output 保留原值；reasoning 字段透传；无 warn |
| 9c | reasoning>0，provider_total 都不匹配 | 采用 CLI 语义（inclusive）；emit 一条 warn；不抛异常 |
| 10 | `cache_creation > 0 && input_tokens > 0`（构造） | inputDisjoint=`input - cache_read`（cache_creation 已在 input 内）；cached=cache_read；total 不变式成立 |
| 11 | `input_tokens = 0 && cache_creation + cache_read > 0`（zcode fallback 分支） | inputDisjoint=cache_creation；cached=cache_read；total = cache_creation + cache_read + output |
| 12 | `provider_total != computed_total`（zcode 内部不一致） | 归一化结果照常返回，emit 一条 warn（once-per-run） |
| 13 | DB 打开失败 / schema 缺 `model_usage` 表 | parser 返回 `{deltas: [], cursor: unchanged}`，不抛 |

**`zcode-session.test.ts`**：

| Case | 输入 | 期望 |
|---|---|---|
| 1 | 完整 session + 5 条 message | snapshot 各字段类型正确（ISO string），model = 最频繁 model_id |
| 2 | 无 message | totalMessages=0，snapshot 仍返回 |
| 3 | 2 个不同 model_id 出现次数相同 | tie-break 字典序，deterministic |
| 4 | session.directory 空字符串 | projectRef=null |
| 5 | 增量：cursor lastTimeUpdated=t，t 之后新 session | 只 emit 新 session |
| 6 | 同一 time_updated 毫秒 2 个 session | lastProcessedIds 边界去重 |

**Driver 测试**（`zcode-sqlite-token-driver.test.ts` / `-session-driver.test.ts`）：

| Case | 期望 |
|---|---|
| Registry opts 无 `zcodeDbPath` 或无 `openZcodeDb` | driver 不激活（`createTokenDrivers` 返回的集合里没有 zcode） |
| `zcodeDbPath` 存在但 opener 打开失败（返回 null） | CLI 层 pre-check 输出 warn，driver 不加入集合；其他 driver 正常 |
| `zcodeDbPath` 指向真实 db.sqlite + opener 成功 | cursor 语义与 OpenCode driver 一致 |
| cursor 无 `zcodeSqlite` 字段（旧 pew 升级） | 首次全量 |
| inode 变化 | 清 cursor + 全量重扫（走 opencode 同样路径） |
| DB 打开抛异常 | driver 内部 catch，返回 empty result；orchestrator 循环不断 |

### 7.2 L1 Unit tests（orchestrator 抽象后）

- sync.ts 里注入 mock DB drivers（opencode + hermes + zcode 各一），验证每个都能拿到
  自己的 cursor、`dbsScanned` 各 +1、异常隔离（其中一个抛错不影响其它）
- session-sync.ts 同上；特别断言：**opencode + zcode 的 session cursor 各写各的**，
  互不覆盖（**这条是 review P0#1 明确担心的 bug**）

### 7.3 L1 Unit tests（source registry 扩展）

- `SOURCES` 长度 13
- `isValidSource("zcode") === true`
- `SOURCE_LABELS.zcode === "ZCode"`
- `sourceKey("zcode") === "zcode"`（2 处 switch：sync.ts:137 + session-sync-helpers.ts:56）
- `constants.test.ts` / `types.test.ts` / `validation.test.ts` 三处枚举列表更新

### 7.4 L2 Integration tests（`api-e2e.test.ts` 加一条）

参照 grok 加 "accepts and reads back zcode source records — every whitelist entry point"：

1. POST `/api/ingest` bare-array with `source: "zcode"`
2. 6 个 `?source=zcode` 白名单路由都返回 200：
   - `/api/usage?source=zcode&...`
   - `/api/sessions?source=zcode`
   - `/api/leaderboard?source=zcode&...`
   - `/api/users/[slug]?source=zcode&...`
   - `/api/projects` POST with zcode alias（session-alias-only 通道）
   - `/api/projects/[id]` PATCH with add_aliases zcode
3. token 字段保留 disjoint 语义
4. POST `/api/projects` 用扁平 response（复用 26c82cda 教训）

### 7.5 L3 Browser E2E

- source-filter 下拉出现 "ZCode"
- 按 `source=zcode` 过滤图表用 chart-13 色
- Leaderboard agent tab 有 ZCode

### 7.6 Golden verification（本机真实数据）

本地跑 `pew sync`，期望 `queue.jsonl` 里 zcode 记录：

- 单条 30-min bucket：`hour_start = "2026-07-10T01:00:00.000Z"`
- input=11242, cached=52992, output=1329, reasoning=0, total=65563
- model=`GLM-5.2`

上传后 D1 里 SELECT 匹配。SessionSnapshot 一条：sessionKey=`zcode:sess_1d50eb1b-…`，
projectRef=`/Users/nocoo/workspace/personal/zhe`。

### 7.7 隔离性验证

- 构造损坏 `db.sqlite`（截断 / schema 错乱），`pew sync` 输出 "ZCode: 0"、其他 source
  正常；无 uncaught error
- 卸载 zcode（删除 `~/.zcode/`），`pew sync` 静默跳过
- 只保留 ZCode driver 抛错的 mock（orchestrator 隔离测试）：OpenCode / Hermes 结果照常
  写回 cursor

---

## 八、时间估算

- **Foundation + orchestrator refactor**：0.75 天（refactor 是最大变量）
- **Parser / normalizer + tests**：0.5 天
- **Drivers + wiring**：0.5 天
- **Web 侧改动**：0.5 天
- **测试补齐 + golden 验证 + 文档收尾**：0.5 天
- **合计**：约 2.75 天开发；1 次 release

---

## 九、FAQ

**Q1：zcode 有 rollout jsonl，为什么不用它？**
A：token 数据与 `model_usage` 完全一致；jsonl 需要 byte-offset + 半行安全，比 SQLite
增量复杂得多；SQLite 已经足够。

**Q2：ZCode GUI（`~/.zcode/v2/`）为什么完全不读？**
A：GUI 是 CLI backend 的前端 RPC 客户端，所有 token 数据都由 CLI 落到
`~/.zcode/cli/db/db.sqlite`。GUI 侧 sqlite 只是任务列表 index。

**Q3：为什么不用 `message` 表的 `data.tokens` JSON 路径？**
A：结构化 SQL 表比 JSON blob 更抗 schema 漂移；`message.data.tokens` 与 `model_usage`
数据同源，选一个更稳的路径。

**Q4：一个 zcode session 可以切换 model 吗？**
A：可以（`/model` 命令）。`model_usage` 每行独立记录 `model_id`，per-turn 归因天然正确；
SessionSnapshot 的 model 字段用"出现次数最多 + 字典序 tie-break" 作为代表。

**Q5：本地 zcode 是订阅制，成本计算怎么办？**
A：pew 存的 usage 单位是 token，不是 dollar；dashboard 侧用 `estimateCost()` × pricing
估算成本，与用户实际订阅账单不必一致（同 Claude Pro / gemini-cli / etc.）。

**Q6：为什么把 `status='error'` / `'cancelled'` 也算进 token？**
A：这两种终态 model call 已经从 provider 返回了 usage，属于已计费；只有 `'running'`
状态是 in-flight 未终态。

**Q7：future-proof — cache_creation 非零的一天到来时怎么办？**
A：本机数据都是 0，§1.4 已给出保守设计（留在 input bucket，不合入 cached）。若真出现非零：
1. 先看 zcode `computed_total_tokens` 公式是否改了
2. 若 zcode 仍把 cache_creation 算进 `input_tokens`（当前 CLI 源码分支）：pew 现有归一化天然正确
3. 若 zcode 改成 disjoint（`total = input + output + cr + cc`）：`normalizeZcodeUsage`
   的 provider_total 三分支自动切到 "disjoint" 分支（`reportedTotal == disjointOutput`），
   保留 output 不减 reasoning。加一条 defensive test 提前锁死这个不变式。
   **不要**用 `input_tokens < cr + cc` 判断——inclusive 模式下 input 完全可能仍 > cache
   之和（本机 4 行样本就是这种情况）。判断口径只能靠 `provider_total` 关系。

**Q8：为什么不改 core 加第 5 个 token 字段（cache_creation）？**
A：见 §1.4 决策。改 core 会引发 Core / Queue / D1 / RPC / Web / Worker 全链路 migration，
不成比例。等到有 3+ source 都需要 cache_creation 独立字段时再做统一 refactor。

---

## 十、References

- 本机 zcode CLI：`~/.zcode/cli/db/db.sqlite`（schema `app_version = 0.15.0`，CLI 二进制 0.15.2）
- 本机 rollout 样本：`~/.zcode/cli/rollout/model-io-sess_1d50eb1b-*.jsonl`
- 42-grok-support.md — 结构模板与 disjoint 归一先例
- `packages/cli/src/parsers/codex.ts` `normalizeCodexUsage` — inclusive → disjoint 归一
- `packages/cli/src/parsers/opencode-sqlite.ts` — SQLite driver 结构参考（cursor 语义）
- `packages/cli/src/drivers/session/opencode-sqlite-session-driver.ts` — session driver
  结构参考
- `packages/core/src/types.ts:175 / :356` — `OpenCodeSqliteCursor` 双 cursor 参考
- Review notes (2026-07-11) 由哥提出 4 个 P0 + 3 个 P1，本次修订覆盖全部
