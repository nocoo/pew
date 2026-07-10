# 42 — Grok CLI Token Support

> 为 pew 增加第 12 个 source：xAI Grok CLI（`grok`）。
> 通过读取 `~/.grok/logs/unified.jsonl` 里的 `shell.turn.inference_done` 事件，
> 精确提取每次 inference 的 prompt / cached / completion / reasoning tokens。

## 设计原则

### ✅ 严格保证

1. **完全隔离**:Grok parser 任何异常(读文件失败 / JSON 解析失败 / schema 变化)
   最坏结果只是 Grok source 统计不到数据,绝不影响其他 source 的同步。
2. **原始文件只读**：只从 `~/.grok/logs/unified.jsonl` 读，不修改、不删除、不移动。
3. **幂等上传**：`pew reset && pew sync` 任何时刻结果一致；同 `hour_bucket` upsert 到 D1，绝不 SUM。
4. **精确 token 归因**：与 Anthropic / OpenCode 一致，保留 4 路 token（input / cached / output / reasoning），
   不做 4→2 折损。
5. **TDD**：所有新 parser / driver / 归一化逻辑必须先写测试，红→绿→重构。
6. **代码 / 注释 / commit message / 文档中不出现任何参考项目名字。**

### ✅ 接受的限制

1. **Grok CLI 不持久化 pricing 元数据**:本文档假设 pew 的 `pricing.ts` 会为 `xai` provider
   独立维护单价表。**前置 fix(commit 0)**:`estimateCost()` 有两个既存问题需要一起改:
   (a) 它对 input 做了 `nonCached = input - cached` 减法(见"1.3 归一化关键约束"),
       在 grok 这种 cache 命中率高的场景下会把真实 input 砍成 0。改成直接
       `inputCost = inputTokens * pricing.input`。
   (b) 只接收 `(input, output, cached)` 三参数,reasoning tokens 完全没入账。加入
       `reasoningTokens` + `pricing.reasoning`(单价 fallback = output 单价)。同步扩展所有
       调用点(见 §5.6 pricing.ts + §5.7 reasoning propagation)。
2. **只读取 `logs/unified.jsonl`**,不读 `sessions/<sid>/updates.jsonl`。原因见"关键挑战 1"。
3. **首次 sync 全量 emit**:cursor 丢失/首次跑 = 全文件解析,与其他 byte-offset source 行为一致。
   D1 端 `ON CONFLICT` upsert 保证零 inflation。

---

## 一、Grok CLI 数据模型分析

### 1.1 什么是 Grok CLI

xAI 官方 CLI 编码代理，`grok` 可执行文件通常安装在 `~/.local/bin/grok`。启动后：

- 通过 OIDC 登录 xAI（auth.x.ai），token 存 `~/.grok/auth.json`
- 每个 `cwd` 一个 session dir，用 URL-encoded path 命名
- 全局 log 落在 `~/.grok/logs/unified.jsonl`（append-only）

本机版本：`grok-pager 0.2.93`，session id UUID v7（`019f4975-...`）。

### 1.2 数据目录

```
~/.grok/
├── auth.json                    # OIDC tokens (仅 auth 用途，不读)
├── config.toml
├── active_sessions.json
├── logs/
│   └── unified.jsonl            # ★ 主数据源：所有 shell + pager 结构化日志
└── sessions/
    └── <url-encoded-cwd>/       # 例如 %2FUsers%2Fnocoo%2Fworkspace%2Fpersonal%2Fpew
        └── <session-id>/         # UUID v7
            ├── events.jsonl           # phase_changed / tool_started（无 token）
            ├── chat_history.jsonl     # user / assistant 内容（无 token）
            ├── updates.jsonl          # JSON-RPC session/update chunk（token 字段误导，见 1.5）
            ├── signals.json           # 会话摘要（contextTokensUsed，非消耗）
            ├── summary.json           # session 元数据
            ├── prompt_context.json
            ├── resources_state.json
            ├── rewind_points.jsonl
            └── announcement_state.json
```

### 1.3 `unified.jsonl` 行结构

```json
{
  "ts": "2026-07-10T00:37:52.898Z",
  "src": "shell",
  "pid": 36685,
  "lvl": "info",
  "sid": "019f4975-8cf2-7fc2-9d8a-a4297c3a01a7",
  "msg": "shell.turn.inference_done",
  "ctx": {
    "loop_index": 1,
    "model_elapsed_ms": 2641,
    "elapsed_since_turn_start_ms": 2642,
    "ttft_ms": 840,
    "itl_p50_ms": 0,
    "attempts": 1,
    "prompt_tokens": 21601,
    "cached_prompt_tokens": 11136,
    "completion_tokens": 193,
    "reasoning_tokens": 48,
    "tokens_per_sec": 107.2
  }
}
```

**核心字段解释**：

| 字段 | 语义 | 归一化到 |
|---|---|---|
| `prompt_tokens` | 本次 inference 的输入 token 总数(**含 cached 部分**) | 用于导出 non-cached input |
| `cached_prompt_tokens` | 命中 prompt cache 的部分(xAI 有 prompt caching) | → `cachedInputTokens` |
| `completion_tokens` | 输出 token 数 | → `outputTokens` |
| `reasoning_tokens` | 思维链输出 token 数 | → `reasoningOutputTokens` |
| `sid` | session id | 归因 |
| `ts` | 事件时间(ISO 8601) | hour bucket 归属 |

**归一化公式**:

```
inputTokens          = max(0, prompt_tokens - cached_prompt_tokens)   // non-cached
cachedInputTokens    = cached_prompt_tokens
outputTokens         = completion_tokens
reasoningOutputTokens = reasoning_tokens
```

**关键约束 — `inputTokens` 和 `cachedInputTokens` 必须不重叠**。pew 全 source 遵守这个
disjoint 约定:
- Claude parser 存 `input + cache_creation`(不含 cache_read),`cachedInputTokens = cache_read`
- Gemini parser 存 `tokens.input`(源已是 non-cached),`cachedInputTokens = tokens.cached`
- Codex 存 OpenAI `input_tokens`(源已是 non-cached),`cachedInputTokens = cached_input_tokens`
- OpenCode 存 `input + cache.write`,`cachedInputTokens = cache.read`
- Pi 存 `input + cacheWrite`,`cachedInputTokens = cacheRead`
- Grok parser 遵循同一约定:`inputTokens = max(0, prompt - cached)`,`cachedInputTokens = cached`

**由此推论:`estimateCost()` 当前的 `nonCached = input - cached` 减法是错的**
(`packages/web/src/lib/pricing.ts:299`)。既然 pew 存的 input 已经不含 cached,再减一次
在 cache 命中率高的场景(Grok 本机 63,872 cached vs 25,315 non-cached)会把 input 减到负
再被 `Math.max(0, ...)` 归零 —— 真实的 25,315 输入 tokens 被完全砍掉。**必须去掉这个减法,
直接 `inputCost = inputTokens / M * pricing.input`**。这个修复对**所有 source** 都有正效果
(pew 里从来没有一个 parser 存过 "input 含 cached" 的数据,减法从没起过作用,只在边缘场景
把数据错砍)。

### 1.4 Model 归因

`unified.jsonl` 里**没有 `model` 字段**。Grok 支持**同一 session 内切换模型**,所以不能
简单用 session 级 `primaryModelId`。真正的模型信息在 **session 侧的 `events.jsonl`**
里,每个 `turn_started` 事件都带 `model_id`(本机实测 `{"ts":"...", "type":"turn_started",
"turn_number":0, "model_id":"grok-4.5", ...}`)。

**性能背景**:本机 18 秒的短 session 里 `events.jsonl` 就有 **1,448 行**(1,396 条
`phase_changed`),而 `unified.jsonl` 全部只有 **110 行**。全量扫 events 对增量 sync
成本过高。用两级 fast/slow path:

**归因规则(按优先级)**:
1. **Fast path**:读 `signals.json.modelsUsed`。**当且仅当 `Array.isArray(modelsUsed) &&
   modelsUsed.length === 1`** → 直接用它唯一的 model_id 归因该 sid 所有 `inference_done`,
   **跳过 events.jsonl 扫描**。绝大部分 session 属于此情况。
2. **Slow path**:任何**非 length===1** 的情形(signals.json 缺失 / modelsUsed 为
   `undefined` / 空数组 `[]` / 长度 > 1)→ 尝试扫 `events.jsonl` 抽出 `turn_started`
   建时间轴 `[(ts, model_id), ...]`。对每条 `inference_done`,以 `ts` 找该 sid 时间轴上
   **最后一个 ts ≤ inference_done.ts** 的 turn,取其 `model_id`。
3. Fallback:events.jsonl 缺失/turn_started 全无 → 用 `signals.json.primaryModelId`。
4. 都拿不到 → `"grok-unknown"`(不阻塞 emit,让数据先入库)。

因此 discovery 阶段**总是**读 signals.json(小),**按需**读 events.jsonl(大)。
建 `sid → { model?: string; timeline?: Array<{ts, modelId}>; primary: string | null }`
一级映射即可。

### 1.5 核心事实（三家参考项目全都错在这里）

调研三家开源 token tracker 发现**它们全部误读**：

- 它们只读 `sessions/<sid>/updates.jsonl` 里 `params._meta.totalTokens` 字段
- 这个字段是**当前 context window 里的 token 数**（= `signals.json.contextTokensUsed`）
- 它**不是**"本 turn 消耗的 tokens"，也不是累积

**本机 1 个真实 session 实测**：

| 数据源 | 计算方式 | in+out |
|---|---|---:|
| **正确**（`unified.jsonl` 3 次 `inference_done` 累加） | prompt=89187 cached=63872 out=1682 rea=111 | **90,980** |
| ❌ `updates.jsonl.max(totalTokens)` | 36,046（仅 context 大小） | 36,046 |
| ❌ 参考项目算法（80/20 硬拆 totalTokens） | input≈28,837 out≈7,209 | 36,046 |

**结论**：只有 `~/.grok/logs/unified.jsonl` 是 token 消耗真源。

---

## 二、关键挑战与解决方案

### 挑战 1：区分"context 占用"和"token 消耗"

**问题**：三家参考项目把 `updates.jsonl.totalTokens` 当消耗算，实际它是 context size。

**解决**：完全**不读** `sessions/<sid>/updates.jsonl` 的 token 字段。只读 `logs/unified.jsonl` 里
的 `msg == "shell.turn.inference_done"` 事件。

### 挑战 2:Model 归因需要按时间轴匹配 turn,同时不能拖慢 sync

**问题**:`unified.jsonl` 只有 sid 没有 model。Grok 支持同一 session 内切换模型,
简单用 `signals.json.primaryModelId` 会把切换前的 turns 全部错归到切换后的 model。
但 events.jsonl 每 session 可能上千行(本机 1,448 行 vs unified 110 行),每次 sync
全扫成本过高。

**解决**:分两级读。见 §1.4 的 fast/slow path:
1. **总是**尝试读 `signals.json`(几十字节)。**只有** `Array.isArray(modelsUsed) &&
   modelsUsed.length === 1` 才走 fast path,该 sid 所有 inference_done 直接用它,
   **不读 events.jsonl**。
2. 其他所有情形(缺 signals.json / modelsUsed 未定义 / 空数组 / 长度 > 1)→ 扫 events.jsonl
   抽 `turn_started` 建时间轴,按 `ts ≤ inference_done.ts` 查最后一次 turn 的 `model_id`。
3. events 也没数据 → 用 `signals.json.primaryModelId`(如有)→ 都缺则 `"grok-unknown"`。

### 挑战 3：unified.jsonl append-only，增量策略

**问题**：日志文件持续增长，不能每次全读。

**解决**：byte-offset cursor，和 pi/openclaw/copilot-cli 完全一致的 pattern。
- Cursor 类型：`ByteOffsetCursor`（现有类型，无需扩展）
- Skip gate：`fileUnchanged(cursor, fingerprint)` = inode + mtime + size
- Inode 变化 → 走 orchestrator 已有的 replay 路径（`needsReplay` 不需要，因为无 legacy schema）

### 挑战 4：重试 / 多次 inference 同一 turn

**问题**：一个 user prompt 可能触发多次 `inference_done`（`loop_index` 1 / 2 / 3 = 多次 tool loop），
以及 `attempts > 1`（重试）。

**解决**：**每个 inference_done 都独立计入**。因为：
- 每次都是真实的 API 调用（真实计费）
- `loop_index` 和 `attempts` 只是元数据，不影响归因
- xAI 后端按每次 request 计费

去重 key：`sid + ts + loop_index + attempts`（多字段组合，避免同一次事件在 log rotate
后被重复读入）。

### 挑战 5：Session 数据

**问题**：Grok 有 session 概念但 `chat_history.jsonl` 消息里没时间戳。

**解决**：session driver 读 `~/.grok/sessions/<enc-cwd>/<sid>/summary.json`：
- `session_key = <sid>`（UUID v7 全局唯一）
- `startedAt = summary.created_at`
- `lastMessageAt = summary.last_active_at`
- `totalMessages = summary.num_chat_messages`
  ⚠️ **不能用 `summary.num_messages`** — 它等于 `updates.jsonl` 行数(本机实测 61,
  包含 agent_thought_chunk / tool_call / phase_changed 等系统事件),真正的对话消息数是
  `num_chat_messages`(本机 22)。
- `assistantMessages = signals.json.assistantMessageCount`
- `userMessages = signals.json.userMessageCount`
- `model = summary.current_model_id`
- `projectRef = summary.git_root_dir`（如有）或 `summary.cwd`

---

## 三、Token 统计方案

### 3.1 字段映射

```typescript
// packages/cli/src/parsers/grok.ts
export function normalizeGrokUsage(ctx: Record<string, unknown>): TokenDelta {
  const prompt = toNonNegInt(ctx.prompt_tokens);
  const cached = toNonNegInt(ctx.cached_prompt_tokens);
  return {
    // Disjoint from cached — same convention as Claude parser stores
    // (input_tokens + cache_creation_input_tokens, not counting cache_read).
    // Storing prompt raw would double-count in aggregate queries that sum
    // input + cached (see usage-helpers.ts / cost-helpers.ts).
    inputTokens: Math.max(0, prompt - cached),
    cachedInputTokens: cached,
    outputTokens: toNonNegInt(ctx.completion_tokens),
    reasoningOutputTokens: toNonNegInt(ctx.reasoning_tokens),
  };
}
```

### 3.2 解析逻辑

```typescript
// packages/cli/src/parsers/grok.ts
export async function parseGrokLogFile(opts: {
  filePath: string;                                       // ~/.grok/logs/unified.jsonl
  startOffset: number;                                    // byte offset cursor
  sidTurnTimeline: Map<string, Array<{ ts: string; modelId: string }>>;
  sidPrimaryModel: Map<string, string>;
}): Promise<GrokFileResult> {
  // 1. Read from startOffset via createReadStream (utf-8, byte-tracking)
  // 2. Buffer bytes read; split on \n but NEVER emit or advance past a
  //    trailing partial line. Track byte length of the trailing partial
  //    (if last byte != \n) separately.
  // 3. For each COMPLETE line only:
  //    - JSON.parse (skip on error — but still count its bytes as consumed
  //      so we don't loop forever on a corrupt but terminated line)
  //    - Filter: msg === "shell.turn.inference_done"
  //    - Filter: ctx has prompt_tokens or completion_tokens
  //    - Resolve model:
  //        timeline = sidTurnTimeline.get(sid) — pick last entry with ts ≤ event.ts
  //        else sidPrimaryModel.get(sid)
  //        else "grok-unknown"
  //    - Normalize via normalizeGrokUsage
  //    - Skip if isAllZero(delta)
  //    - Push { source: "grok", model, timestamp: ts, tokens: delta }
  // 4. endOffset = startOffset + bytes of processed complete lines only.
  //    Trailing partial-line bytes stay unread; next sync re-reads from
  //    endOffset and picks up the completed line.
  // 5. Return { deltas, endOffset }.
}
```

**关键**:endOffset **必须停在最后一个完整 `\n` 后**。若文件尾部有半行(grok CLI 正在写入),
半行的字节数**不能**计入 endOffset;否则下次 sync 从中间 offset 读,那条 log line 的前半段
永久丢失。相同 pattern 已在 pi/openclaw/copilot-cli 使用,copilot-cli 更严格(检测未闭合 JSON
块 rewind 到 marker 前 — 见 retrospective 里 "off by one telemetry marker line" 教训)。

### 3.3 幂等性保证

- **hour_bucket**：`toUtcHalfHourStart(ts)` 生成 30-min UTC bucket（与所有 source 一致）
- **D1 upsert**：`ON CONFLICT (user_id, device_id, source, model, hour_start) DO UPDATE SET ...`
  已是现有约束，无需 migration
- **重复上传**：同一次 sync 里同 bucket 会在 `aggregateRecords()` 时 SUM，
  跨 sync 重复读取（如 cursor 丢失）会全量重扫→overwrite queue（走 orchestrator
  `initialCursorEmpty` 分支），零 inflation

---

## 四、Session 统计方案

### 4.1 SessionSnapshot 提取

```typescript
// packages/cli/src/parsers/grok-session.ts
export async function parseGrokSession(sessionDir: string): Promise<SessionSnapshot | null> {
  // Read summary.json + signals.json in parallel
  const [summary, signals] = await Promise.all([
    readJson(join(sessionDir, "summary.json")),
    readJson(join(sessionDir, "signals.json")),
  ]);
  if (!summary?.info?.id) return null;

  return {
    sessionKey: summary.info.id,
    source: "grok",
    kind: "human",
    startedAt: summary.created_at,
    lastMessageAt: summary.last_active_at ?? summary.updated_at,
    durationSeconds: signals?.sessionDurationSeconds ?? 0,
    userMessages: signals?.userMessageCount ?? 0,
    assistantMessages: signals?.assistantMessageCount ?? 0,
    totalMessages: summary.num_chat_messages ?? 0,   // NOT num_messages
    projectRef: summary.git_root_dir ?? summary.info.cwd ?? null,
    model: summary.current_model_id ?? null,
    snapshotAt: new Date().toISOString(),
  };
}
```

### 4.2 增量策略

Session driver 采用 mtime-based `SessionFileCursor`（同 kosmos / vscode-copilot pattern）：
- discover：glob `~/.grok/sessions/*/*/summary.json`
- shouldSkip：summary.json mtime 未变则跳过
- parse：读 summary.json + signals.json

---

## 五、Source 类型系统性扩展

参考 doc 13（Phase 3 unified source drivers），添加 `"grok"` 需要动的**24 个文件**：

### 5.1 Core types & constants（2 文件）

- `packages/core/src/types.ts` — `Source` union 加 `"grok"`（第 12 个）
- `packages/core/src/constants.ts` — `SOURCES` 数组加 `"grok"`

### 5.2 CLI parsers（2 新文件）

- `packages/cli/src/parsers/grok.ts` — `parseGrokLogFile` + `normalizeGrokUsage`
- `packages/cli/src/parsers/grok-session.ts` — `parseGrokSession`

### 5.3 CLI drivers（2 新文件）

- `packages/cli/src/drivers/token/grok-token-driver.ts` — `FileTokenDriver<ByteOffsetCursor>`
- `packages/cli/src/drivers/session/grok-session-driver.ts` — `FileSessionDriver<SessionFileCursor>`

### 5.4 CLI wiring（7 文件，edit）

- `packages/cli/src/drivers/registry.ts` — 注册两个 driver + `grokHome?: string` opt
- `packages/cli/src/drivers/types.ts` — `DiscoverOpts` 加 `grokLogsPath` + `grokSessionsDir`
- `packages/cli/src/discovery/sources.ts` — `discoverGrokLogFile()` + `discoverGrokSessionDirs()`
- `packages/cli/src/utils/paths.ts` — 添加：
  ```
  grokHome:            ~/.grok
  grokLogsPath:        ~/.grok/logs/unified.jsonl
  grokSessionsDir:     ~/.grok/sessions
  ```
- `packages/cli/src/commands/sync.ts` — `SyncOptions` / `SyncResult.sources.grok` / `sourceKey()` switch
- `packages/cli/src/commands/session-sync.ts` — 对应扩展
- `packages/cli/src/commands/session-sync-helpers.ts` — `SessionSyncSourceKey` 联合类型 + 穷举 switch

### 5.5 CLI entry / notify / status（3 文件，edit）

- `packages/cli/src/cli.ts` — `isSource()` 数组、`SOURCE_LABELS`、sync/session summary 打印
- `packages/cli/src/commands/notify.ts` — 传递 grok dirs
- `packages/cli/src/commands/status.ts` — `SourceDirs.grokHome` + `classifySource()` 分支

### 5.6 Web dashboard（9 文件，edit）

- `packages/web/src/lib/palette.ts` — 加 `grok` → `chart-12`；同步扩展 `chart` 对象 / `CHART_TOKENS`
- `packages/web/src/app/globals.css` — 加 `--chart-12` 变量（light + dark）
- `packages/web/src/lib/usage-transforms.ts` — `SOURCE_LABELS` 加 `{ grok: "Grok" }`
- `packages/web/src/lib/pricing.ts` — 两项改动:
  (a) **扩展 `estimateCost()` 接受 `reasoningTokens` + `pricing.reasoning` 单价**,
      同步更新 `ModelPricing` 类型、`pricing.test.ts` 的 5 处调用、以及**全部 14 处**
      生产调用点(reasoning 单价 fallback = output 单价):

      | 位置 | file:line | 说明 |
      |---|---|---|
      | Achievement 成本 | `api/achievements/route.ts:66` | user route |
      | Achievement 成本 | `api/users/[slug]/achievements/route.ts:51` | slug route |
      | By-device 成本 | `api/usage/by-device/route.ts:124` | device 聚合 |
      | Daily usage | `(dashboard)/daily-usage/page.tsx:61` | 页面 |
      | Hourly usage | `(dashboard)/hourly-usage/page.tsx:140` | 页面 |
      | Model 成本 (per-model) | `lib/cost-helpers.ts:23` | `sumMostExpensiveModels` 类 |
      | Model 成本 (per-source-model) | `lib/cost-helpers.ts:59` | 按 source × model |
      | Cost per 1K | `lib/cost-helpers.ts:206` | 排序辅助 |
      | Records 聚合 (map 分支) | `lib/usage-helpers.ts:166` | 主 aggregate |
      | Records 聚合 (per-model 分支) | `lib/usage-helpers.ts:235` | model 展开 |
      | Records 聚合 (per-source 分支) | `lib/usage-helpers.ts:306` | source 展开 |
      | Records 聚合 (per-hour 分支) | `lib/usage-helpers.ts:429` | hour 展开 |
      | Records 聚合 (per-day 分支) | `lib/usage-helpers.ts:539` | day 展开 |
      | Records 聚合 (per-device 分支) | `lib/usage-helpers.ts:659` | device 展开 |

      每处调用签名从 `estimateCost(input, output, cached, pricing)` →
      `estimateCost(input, output, cached, reasoning, pricing)`。**新增参数必填**
      (不设 optional,否则遗漏调用点会被 TS 静默通过 → 该页面/路由无 reasoning 计价)。
      commit 0 里 grok 尚未接入,reasoning 传 `0` 保持行为等价。
  (b) `DEFAULT_SOURCE_DEFAULTS` 加 grok 条目(默认 xAI 模型的 input/output/cached/reasoning 单价)。
- `packages/web/src/app/api/{leaderboard,usage,sessions,projects,users/[slug]}/route.ts` +
  `packages/web/src/app/api/projects/[id]/route.ts` — 6 处 `VALID_SOURCES` 数组
- `packages/web/src/app/leaderboard/agents/page.tsx` — `AGENTS` 常量

### 5.6b Reasoning tokens 端到端传递(commit 0 之后必须做)

commit 0 让 `estimateCost()` 接受 `reasoningTokens`,但**上游根本没有 reasoning 数据可传**
—— 现有多层聚合都只有 `input/output/cached`。修完 commit 0 后,如果 Grok 或 Claude 或
Codex 未来产生 reasoning 数据,页面成本估算仍**不会包含 reasoning 部分**,除非同步扩展下面
的层(计数不确定,commit 6 CI 全绿 + pin-test 通过是唯一可信信号):

| 层 | 文件 | 改动 |
|---|---|---|
| Core type:by-device cost | `packages/core/src/types.ts:DeviceCostDetail` | 加 `reasoning_output_tokens: number` |
| **Core type:by-device timeline** | `packages/core/src/types.ts:DeviceTimelinePoint` | 加 `reasoning_output_tokens: number` |
| Worker-read SQL:by-device 细节 | `packages/worker-read/src/rpc/usage.ts:handleGetDeviceCostDetails` | SELECT 里 `SUM(ur.reasoning_output_tokens) AS reasoning_output_tokens` |
| Worker-read row type:by-device 细节 | `packages/worker-read/src/rpc/usage.ts:CostDetailRow` | 加 `reasoning_output_tokens: number` |
| **Worker-read SQL:by-device timeline** | `packages/worker-read/src/rpc/usage.ts:handleGetDeviceTimeline` | SELECT 里 `SUM(ur.reasoning_output_tokens) AS reasoning_output_tokens`(若做 timeline reasoning 展示) |
| **Worker-read row type:by-device timeline** | `packages/worker-read/src/rpc/usage.ts:TimelineRow` | 加 `reasoning_output_tokens: number` |
| **By-device route:estimateCost 调用** | `packages/web/src/app/api/usage/by-device/route.ts:124` | `estimateCost(row.input_tokens, row.output_tokens, row.cached_input_tokens, row.reasoning_output_tokens, pricing)` — 传新参 |
| **By-device route:deviceDetails map** | `packages/web/src/app/api/usage/by-device/route.ts:162` | 输出加 `reasoning_output_tokens: row.reasoning_output_tokens`;`total_tokens` 从 `input+output+cached` 改为 `input+output+cached+reasoning`(避免 UI 层 reasoning 消失)|
| **Device breakdown 类型** | `packages/web/src/lib/device-helpers.ts:193, 202` | `DeviceAgentBreakdownRow` 和 `DeviceModelBreakdownRow` 各加 `reasoning_output_tokens: number` |
| **Device breakdown reducers** | `packages/web/src/lib/device-helpers.ts:toDeviceAgentBreakdown` 和 `toDeviceModelBreakdown` | 初始化和累加都加 `reasoning_output_tokens += d.reasoning_output_tokens` |
| **Device 堆叠图 keys/labels** | `packages/web/src/components/dashboard/device-agent-chart.tsx:56-63, 176-188` + `device-model-chart.tsx` 同结构 | `orderedKeys` 数组从 `["input_tokens","output_tokens","cached_input_tokens"]` 扩为 `[..., "reasoning_output_tokens"]`;label 加 `reasoning_output_tokens: "Reasoning"`;新增一段 `<Bar dataKey="reasoning_output_tokens" ...>`。否则堆叠图各部分之和 < `total_tokens`,视觉上出现"缺口"。 |
| **By-device route:timeline map** | `packages/web/src/app/api/usage/by-device/route.ts:152` | 输出加 `reasoning_output_tokens: row.reasoning_output_tokens`(前提是 TimelineRow SQL 已加上)|
| Worker-read SQL:achievements daily-cost | `packages/worker-read/src/rpc/achievements.ts:129` | SELECT 加 `SUM(reasoning_output_tokens)` |
| Worker-read SQL:achievements per-model-source | `packages/worker-read/src/rpc/achievements.ts:222` | SELECT 加 `SUM(reasoning_output_tokens)` |
| Worker-read type | `packages/worker-read/src/rpc/achievements-types.ts:DailyCostRow` 和 `CostByModelSourceRow` | 两个 interface 各加 `reasoning_output_tokens: number` |
| Web RPC 镜像类型 | `packages/web/src/lib/rpc-types.ts:AchievementDailyCostRow` 和 `AchievementCostByModelSourceRow`(~L628 / L660) | 镜像加同名字段 |
| 两个 achievement route computeCost | `packages/web/src/app/api/achievements/route.ts:57` (`computeCost`) 与调用点 :196 :209;`packages/web/src/app/api/users/[slug]/achievements/route.ts:42` 与 :113 :130 | `computeCost` 签名加 `reasoningTokens`,调用点从聚合行读 `row.reasoning_output_tokens` 传入 |
| Web `ModelAggregate` | `packages/web/src/lib/usage-transforms.ts:58` | 加 `reasoning: number` |
| Web `toModelAggregates` | `packages/web/src/lib/usage-transforms.ts:145` | 累加 `reasoning += r.reasoning_output_tokens`;初始化 `reasoning: r.reasoning_output_tokens` |
| Web helpers 内聚合结构 | `packages/web/src/lib/usage-helpers.ts` 所有内部 `{ inputTokens, outputTokens, cachedTokens }` interface + reducer(grep `cachedTokens` 定位) | 各加 `reasoningTokens`,reducer `+=` 累加,`estimateCost` 调用传真值 |
| Web `cost-helpers` | `packages/web/src/lib/cost-helpers.ts` 的 `m.input/m.output/m.cached` 调用点(L23 / L59 / L206) | 传 `m.reasoning`(需 ModelAggregate 先加字段) |

**注**:之前草案里"Achievement cost row: `web/src/lib/achievement-helpers.ts`" 是错的
— `achievement-helpers.ts` 只有 "reasoning-junkie" achievement 定义,不做 cost 计算。
cost 逻辑在**两个 achievement route 的 `computeCost()`**,数据源在 **worker-read
`achievements.ts` 两条 daily-cost SQL** 和它的镜像类型。

### 5.6b 层级测试(仅 pricing.test 不够)

pricing.test.ts 只覆盖 estimator 本身,漏了任一上游聚合都不会让 pricing 单元测试失败
(它输入什么就算什么)。commit 6 必须**每层单独 pin 测试**:

| 层 | 测试文件 | 关键断言 |
|---|---|---|
| **estimator** | `packages/web/src/__tests__/pricing.test.ts` | `estimateCost(100, 200, 500, 50, pricing)` 的 `totalCost` 包含 `50/M * pricing.reasoning` |
| **worker-read achievements SQL** | `packages/worker-read/src/rpc/achievements.test.ts` | seed 一行 `reasoning_output_tokens=50`,断言 `DailyCostRow`/`CostByModelSourceRow` 返回 `reasoning_output_tokens: 50` |
| **worker-read by-device SQL(cost + timeline 两处)** | `packages/worker-read/src/rpc/usage.test.ts` | seed 一行 grok,`handleGetDeviceCostDetails` 返回的 CostDetailRow 含 `reasoning_output_tokens`;`handleGetDeviceTimeline` 返回的 TimelineRow 也含之 |
| **web device breakdown reducers** | `packages/web/src/__tests__/device-helpers.test.ts` | 一组带 reasoning 的 DeviceCostDetail 输入,`toDeviceAgentBreakdown` 和 `toDeviceModelBreakdown` 结果里各 row 的 `reasoning_output_tokens` 正确累加;`total_tokens` 等于 input+output+cached+reasoning |
| **web usage-transforms** | `packages/web/src/__tests__/usage-transforms.test.ts`(新增或补) | `toModelAggregates([{...,reasoning_output_tokens:50}])` 结果 `models[0].reasoning === 50` |
| **web usage-helpers reducer** | `packages/web/src/__tests__/usage-helpers.test.ts` | 每个 reducer(代表 3 处:per-model、per-hour、per-day)聚合后 `reasoningTokens` 累加正确 |
| **web achievements route** | `packages/web/src/__tests__/achievements-route.test.ts` (or e2e) | mock RPC 返回带 reasoning 的行,`computeCost` 结果 delta 与不带 reasoning 差异 = `50/M * priceReasoning` |
| **e2e/api-e2e — token 保留**(user route) | `packages/web/src/__tests__/e2e/api-e2e.test.ts` | ingest 一条 `reasoning_output_tokens=50` grok 行,GET `/api/users/${TEST_USER_SLUG}?source=grok` 返回的 token summary 里 `reasoning_output_tokens === 50`。**注意**:`/api/users/[slug]` route 只算 token summary,**不算 estimated_cost**,不能用来验成本传播 |
| **e2e/api-e2e — cost 传播**(by-device) | 同上文件 | ingest 同一条 grok 行(含 `device_id`),GET `/api/usage/by-device?from=...&to=...`,断言 `devices[0].estimated_cost` 与"reasoning=0 时应有的 cost" 差异 ≥ `50/M * pricing.reasoning`(pricing 从 `DEFAULT_SOURCE_DEFAULTS` 查 grok 单价)。这是唯一能端到端验证 reasoning **进入成本估算**的 e2e 路径 |

任一层未改会让**对应的层测试失败**,不会遗漏。

**排期**:这一整套(propagation + pin-test)是 commit 6 的一部分,和 palette /
labels 一起做。estimator 接受 reasoning(commit 0)+ propagation(commit 6)+ 层测试
组合起来才让 grok 成本正确。

### 5.7 Docs / onboarding(3 文件,edit)

- `CLAUDE.md` — "Supported AI Tools" 一行
- `README.md` — ASCII banner + "11 种 → 12 种" 数量 + tool 列表
- `PRIVACY.md` — 添加 `~/.grok/` 到 raw-data-paths

### 5.8 Testing 断言(edit)

以下现有 test 里硬编码 11 source 断言的地方,必须同步扩展:

**Core / CLI**:
- `packages/core/src/__tests__/constants.test.ts` — SOURCES 数组断言
- `packages/core/src/__tests__/types.test.ts`
- `packages/core/src/__tests__/validation.test.ts`
- `packages/cli/src/__tests__/registry.test.ts`
- `packages/cli/src/__tests__/discovery.test.ts`
- `packages/cli/src/__tests__/paths.test.ts`
- `packages/cli/src/__tests__/sync.test.ts`
- `packages/cli/src/__tests__/session-sync.test.ts`
- `packages/cli/src/__tests__/session-sync-helpers.test.ts`
- `packages/cli/src/__tests__/status.test.ts`
- `packages/cli/src/__tests__/cli.test.ts`

**Web(2 处,不能忘)**:
- `packages/web/src/__tests__/palette.test.ts:18` — `toHaveLength(11)` → 12,加 chart-12 断言
- `packages/web/src/__tests__/e2e/api-e2e.test.ts` — commit 6 加一个 `it("accepts and reads
  back grok source records — every whitelist entry point")` case
  (现有 tests **不会自动覆盖 grok**,只 hard-code claude-code/gemini-cli/opencode);
  同时 seedTestUser 必须补 `slug` + `is_public=1` 才能打通 `/api/users/<slug>` 路径。

### 5.9 New tests（6 新文件）

- `packages/cli/src/__tests__/grok-parser.test.ts`
- `packages/cli/src/__tests__/grok-session.test.ts`
- `packages/cli/src/__tests__/drivers/token/grok-token-driver.test.ts`
- `packages/cli/src/__tests__/drivers/session/grok-session-driver.test.ts`
- （必要时）`packages/cli/src/__tests__/fixtures/grok/unified.jsonl`
- （必要时）`packages/cli/src/__tests__/fixtures/grok/session-*/`

---

## 六、原子化提交计划

严格按 CLAUDE.md "multi-file changes must be split into atomic commits" 原则拆分,
每个 commit 必须独立 buildable + testable。

**依赖顺序背景**:pew 有两处 `sourceKey()` 用 TS `never` 做穷举检查
(`sync.ts:125-142`、`session-sync-helpers.ts:55-73`)。任何独立 commit 只要往 `Source`
union 加 `"grok"`,这两处 switch 立刻编译失败。同理,driver 依赖 `DiscoverOpts.grokLogsPath`
必须在同一或更早 commit 存在。为此重排如下:

| # | Commit | 内容 | 独立编译? |
|---|---|---|---|
| 0 | `fix(web): estimateCost inputCost uses inputTokens directly (no cache subtraction) + accept reasoningTokens` | 两处 pricing.ts 内部改动 + `pricing.test.ts` 更新预期(新增 cached>input 的 case 明确断言 input 不被砍)+ **全部 14 处**生产调用点扩展签名 `estimateCost(input, output, cached, reasoning, pricing)`(2 achievements route + 1 by-device route + 2 dashboard 页面 + 3 处 `cost-helpers.ts` + 6 处 `usage-helpers.ts`;reasoning 传 `0` 保原成本行为,直到 P1b 让上游真值可用)。**reasoning 参数必填**,防止遗漏 callsite。 | ✅ 独立 refactor,无 grok 引用 |
| 1 | **`feat: add "grok" source foundation (types + all exhaustive switches + DiscoverOpts stub)`** | `core/types.ts` `Source` 加 grok + 加 `GrokCursor` 若需要;`core/constants.ts` `SOURCES` 加 grok;**同时**加 `sync.ts`/`session-sync.ts`/`session-sync-helpers.ts` 里 `sourceKey()` 的 `case "grok"`、`SyncResult.sources.grok`、`filesScanned.grok` 初始化;`drivers/types.ts` `DiscoverOpts` 加 `grokLogsPath?` + `grokSessionsDir?`;`utils/paths.ts` 加 grok 三个默认路径;`cli.ts` `isSource()` + `SOURCE_LABELS` + `SourceDirs`;所有列在 §5.8 里的 core/CLI test 断言更新。**尚无 driver 注册,尚无 parser** — foundation commit,typecheck + lint 全绿 | ✅ |
| 2 | `feat(cli): add grok log parser and normalizer (no wiring)` | `parsers/grok.ts` + `grok-parser.test.ts`。**TDD 先测后码**。此时 parser 尚未被任何 driver 调用,纯函数库。 | ✅ |
| 3 | `feat(cli): add grok session parser (no wiring)` | `parsers/grok-session.ts` + `grok-session.test.ts`。同上。 | ✅ |
| 4 | `feat(cli): add grok token+session drivers and register them` | `drivers/token/grok-token-driver.ts`、`drivers/session/grok-session-driver.ts`、`discovery/sources.ts` 新增 `discoverGrokLogFile()` + `discoverGrokSessionDirs()`、`drivers/registry.ts` 注册两个 driver + registry test 更新。driver 依赖 (2)/(3) 的 parser 和 (1) 的 DiscoverOpts,都已就位。 | ✅ |
| 5 | `feat(cli): wire grok end-to-end through sync + status + notify` | `commands/sync.ts` / `session-sync.ts` / `notify.ts` / `status.ts` 里传入 `grokLogsPath` / `grokSessionsDir`,sync/session-sync/status test 追加 grok 覆盖。此时 CLI 端 grok source 完整可用。 | ✅ |
| 6 | `feat(web): add grok to dashboard palette, labels, API validation, and propagate reasoning end-to-end` | Web dashboard 文件(见 §5.6)+ `palette.test.ts` 里 `toHaveLength(11) → toHaveLength(12)` 和 `chart-12` 断言 + 相关 dashboard test。**同时完成 §5.6b 全部 reasoning propagation 层**(core 类型 + worker-read SQL/type + web RPC 镜像 + `api/usage/by-device/route.ts` 三处 + 两个 achievement route 的 `computeCost()` + `ModelAggregate` + `toModelAggregates` + `usage-helpers.ts` 所有 reducer + `cost-helpers.ts` 三处 estimateCost 调用 + `device-helpers.ts` 两个 breakdown row/reducer + 两个 device chart keys/labels)。**同时加 §5.6b 全部 pin-test**,任一层漏改立刻失败。 | ✅ |
| 7 | `docs(42): mark grok support as implemented; update CLAUDE.md/README/PRIVACY` | 4 个文档 + doc 42 status → done + tool 数字 11 → 12。 | ✅ |

每个 commit 单独运行:
- `bun run test`:全绿
- `bun run lint`:typecheck + eslint 全绿
- pre-commit L1/G1 hook 通过

---

## 七、测试覆盖率

### 7.1 L1 Unit tests（parser 层）

**Parser 正确性（`grok-parser.test.ts`）**：

| Case | 输入 | 期望 |
|---|---|---|
| 1 | `msg=shell.turn.inference_done` 单行 | 1 delta，字段映射正确 |
| 2 | 3 行 `inference_done`（本机真实数据） | 3 deltas，总 in=25315 cached=63872 out=1682 rea=111 |
| 3 | 非 `inference_done` 事件（phase_changed 等） | 0 deltas，正常跳过 |
| 4 | 缺 `prompt_tokens` 字段 | 0 deltas（`isAllZero` 过滤） |
| 5 | 缺 `cached_prompt_tokens`（旧 grok 版本） | `cached = 0`，`input = prompt_tokens` 全额 |
| 6 | `cached > prompt`（异常） | `input = max(0, prompt - cached) = 0`，不返回负数 |
| 7 | 恶意 JSON（malformed line） | 跳过，不阻塞 |
| 8 | `attempts > 1`（重试） | 每次都 emit（每次都真实计费） |
| 9 | 缺 `ts` | skip |
| 10 | `ctx.prompt_tokens = "not a number"` | 用 `toNonNegInt` 归零 |

**Session 正确性（`grok-session.test.ts`）**：

| Case | 输入 | 期望 |
|---|---|---|
| 1 | 完整 summary.json + signals.json | SessionSnapshot 各字段正确 |
| 2 | signals.json 缺失 | snapshot 有 startedAt/model,messages 用 summary.num_chat_messages fallback |
| 3 | summary.json 缺 `current_model_id` | `model = null` |
| 4 | summary.json 损坏 | 返回 null,不抛异常 |

**Byte-offset cursor(`grok-token-driver.test.ts`)**:

| Case | 期望 |
|---|---|
| 首次 sync | 全文件 emit |
| 二次 sync 文件不变 | 0 deltas |
| 二次 sync 文件追加(完整行) | 只 emit 新增部分 |
| **半行安全**:文件尾部是半条 line(无末尾 `\n`) | 半行**不**计入 endOffset,不 emit;二次 sync 追加剩余部分 + `\n`,该完整 line 被正确 emit **一次** |
| **半行 → 追加 → 追加(pi/openclaw 已有的 round-trip 模式)** | Parser 从 raw offset 开始每次都能正确对齐到 line 边界 |
| Inode 变化(log rotate) | 触发 replay,orchestrator 清 cursors 全量重扫 |
| 尾部损坏(完整 line 但 JSON 错) | 该 line 跳过,offset **可以**推进(未 stall);后续完整 line 正常处理 |

**Model 归因(`grok-parser.test.ts` 扩展)**:

| Case | 期望 |
|---|---|
| **Fast path**:`modelsUsed = ["grok-4.5"]`(长度 = 1) | 用 `grok-4.5`,**不读 events.jsonl**(用 spy 断言未调用) |
| **Slow path — 多模型**:`modelsUsed = ["grok-4.5","grok-code"]`,一次 inference_done 在 turn A 之后 | 扫 events.jsonl,用 turn A 的 model_id |
| **Slow path — 空数组**:`modelsUsed = []` | 必须扫 events.jsonl(spy 断言**已**调用),再 fallback 到 primaryModelId |
| **Slow path — 字段缺失**:`signals.json` 完全没有 `modelsUsed` key | 同上,扫 events → fallback |
| **Slow path — signals.json 缺失**:文件不存在 | 直接扫 events;若 events 也无数据 → `"grok-unknown"` |
| session 内两次 turn_started 切换模型(A → B),中间夹一条 inference_done | 该 inference_done 归 A |
| turn_started 缺失,但 signals.json 有 primaryModelId | 用 primaryModelId fallback |
| turn_started 和 primaryModelId 都缺 | fallback `"grok-unknown"`,不阻塞 emit |
| inference_done.ts 早于任何 turn_started(理论异常) | fallback 到 primaryModelId,再不行 `"grok-unknown"` |

### 7.2 L1 Unit tests(source registry 扩展)

跨 11 个原有 test 文件同步扩展 "12 sources" 断言(见 §5.8)。

**额外必须同步的硬编码断言**(容易被忽略,加进 commit 6 web checklist):

- `packages/web/src/__tests__/palette.test.ts:18` — `toHaveLength(11)` → `toHaveLength(12)`,
  加 `chart-12` 断言、加 grok 对应 `agentColor()` 测试。
- `packages/web/src/__tests__/e2e/api-e2e.test.ts` — 现有 ingest 测试**只写死** `claude-code` /
  `gemini-cli` / `opencode` 三种 source,**不会自动覆盖 grok**。**commit 6**(不是 commit 5)
  里追加 `it("accepts and reads back grok source records — every whitelist entry point")` case
  (完整代码见 §7.3),并在 seedTestUser 里补 `slug` + `is_public=1`。commit 5 时 web 侧
  `VALID_SOURCES` 还没更新,L2 会 400,所以必须放到 commit 6。

### 7.3 L2 Integration tests

**必须新增一个 grok source ingest case** — 现有 `packages/web/src/__tests__/e2e/api-e2e.test.ts`
只覆盖 claude-code/gemini-cli/opencode。虽然 D1 schema 无需 migration,但 API 层
`VALID_SOURCES` 白名单是每个 route 手动维护的,漏一个 route 就会 400。

必须**用 `?source=grok` 显式查询**才能触发路由的白名单校验;不带 filter 的 GET
只做 `SELECT * WHERE user=?`,即使某 route 忘了把 grok 加入 `VALID_SOURCES` 也依然 200,
测试完全查不到问题。**每个 route 的白名单入口方式必须精确匹配**才能真触发校验。

**Route → 白名单校验入口清单**(commit 6 test 必须每个都覆盖 — 注意 commit 5 时 web 侧
`VALID_SOURCES` 还没加 grok,L2 case 必须放 commit 6):

| Route | 校验入口 | L2 打法 |
|---|---|---|
| `/api/ingest` | POST body 是 **`IngestRecord[]` bare array**(不是 `{records:[...]}`)里的 `records[*].source` | `POST /api/ingest [{source:"grok",...}]` |
| `/api/usage` | query `?source=` | `GET /api/usage?source=grok` |
| `/api/sessions` | query `?source=` | `GET /api/sessions?source=grok` |
| `/api/leaderboard` | query `?source=` | `GET /api/leaderboard?source=grok` |
| `/api/users/<slug>` | query `?source=` | `GET /api/users/<slug>?source=grok`(前置:test user 必须有 slug + is_public=1) |
| **`/api/projects`** | **POST body 里的 `aliases[*].source`**(**不读** `?source=`) | `POST /api/projects {name:"...", aliases:[{source:"grok",project_ref:"..."}]}` |
| **`/api/projects/[id]`** | **PATCH body 里的 `add_aliases[*].source` / `remove_aliases[*].source`**(**不是** camelCase `aliasesToAdd`) | `PATCH /api/projects/<id> {add_aliases:[{source:"grok",project_ref:"..."}]}` |

**前置准备**(必须在 case 头部执行,否则某些 route 打不通):

1. `TEST_USER_SLUG` 常量当前不存在;新增。**注意**:`scripts/run-e2e.ts` 只透传 `E2E_TEST_USER_ID`
   和 `E2E_TEST_USER_EMAIL` 到测试进程,**不透传 `RUN_ID`**。测试端从 `TEST_USER_ID` 派生
   稳定后缀,避免并发 CI 撞车:
   ```typescript
   // TEST_USER_ID = "e2e-test-user-<8hex>", already established at test-file top
   const RUN_SUFFIX = TEST_USER_ID.replace("e2e-test-user-", "");  // → "<8hex>"
   const TEST_USER_SLUG = `e2e-user-${RUN_SUFFIX}`;
   // reuse same suffix for project name / refs so cleanup can globby-match
   ```
2. `seedTestUser()` 里的 INSERT 补两列:`slug=?, is_public=1`;并把 UPSERT 分支同步
   (`ON CONFLICT (id) DO UPDATE SET email=excluded.email, slug=excluded.slug, is_public=1`)
3. cleanup 里加 `DELETE FROM users WHERE id = ?` 保留(已有),但确认清空后 slug 不残留
4. **`/api/projects` POST 和 PATCH 都会调用 `dbRead.sessionRecordExists(userId, alias.source,
   alias.project_ref)`**(route.ts:288, [id]/route.ts:192)。任一 alias 找不到对应
   `session_records` 行,整个请求返回 **400 "Some aliases do not match any session data"**。
   L2 case **必须先** ingest 两条 grok session records(对应下面 POST/PATCH 用到的
   `project_ref` 值),否则两个 project 请求都会 400。
5. cleanup 顺序需保留:先删 project_aliases、projects,再删 session_records、
   usage_records,最后 users(FK 顺序)。

新增 case(放 commit 6,不是 commit 5):
```typescript
it("accepts and reads back grok source records — every whitelist entry point", async () => {
  // 1. POST /api/ingest — bare-array body
  const ingest = await fetch(`${BASE_URL}/api/ingest`, {
    method: "POST",
    headers: INGEST_HEADERS,
    body: JSON.stringify([  // <-- bare array, NOT wrapped in {records:...}
      makeRecord({
        source: "grok",
        model: "grok-4.5",
        input_tokens: 25315,
        cached_input_tokens: 63872,
        output_tokens: 1682,
        reasoning_output_tokens: 111,
      }),
    ]),
  });
  expect(ingest.status).toBe(200);

  // 2. Seed two grok session_records so /api/projects sessionRecordExists()
  //    passes for both project_ref values used below. Uses direct D1 write
  //    (not /api/sessions ingest — sessions ingest has its own request shape;
  //    the seed helper follows the pattern already used for seedTestUser).
  const projectRefCreate = `e2e-repo-${RUN_SUFFIX}`;
  const projectRefPatch = `e2e-repo-${RUN_SUFFIX}-2`;
  for (const project_ref of [projectRefCreate, projectRefPatch]) {
    await getD1().execute(
      `INSERT INTO session_records (user_id, session_key, source, kind,
         started_at, last_message_at, duration_seconds, user_messages,
         assistant_messages, total_messages, project_ref, model, snapshot_at)
       VALUES (?, ?, 'grok', 'human', datetime('now'), datetime('now'), 0, 0, 0, 0, ?, 'grok-4.5', datetime('now'))
       ON CONFLICT (user_id, session_key) DO NOTHING`,
      [TEST_USER_ID, `${TEST_USER_ID}-${project_ref}`, project_ref],
    );
  }

  // 3. Every ?source= route (needs public slug from prereq 1-2)
  for (const path of [
    "/api/usage?source=grok",
    "/api/sessions?source=grok",
    "/api/leaderboard?source=grok",
    `/api/users/${TEST_USER_SLUG}?source=grok`,
  ]) {
    const r = await fetch(`${BASE_URL}${path}`);
    expect(r.status, path).toBe(200);
  }

  // 4. /api/projects — POST alias with source:"grok"
  //    Session record from step 2 satisfies sessionRecordExists check.
  const create = await fetch(`${BASE_URL}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `grok-e2e-${RUN_SUFFIX}`,
      aliases: [{ source: "grok", project_ref: projectRefCreate }],
    }),
  });
  expect(create.status).toBe(201);
  const { project } = await create.json();

  // 5. /api/projects/[id] — PATCH with add_aliases (snake_case!)
  //    projectRefPatch was seeded in step 2.
  const patch = await fetch(`${BASE_URL}/api/projects/${project.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      add_aliases: [{ source: "grok", project_ref: projectRefPatch }],
    }),
  });
  expect(patch.status).toBe(200);
});
```

若某个 route 的 `VALID_SOURCES` 数组漏了 `"grok"`,对应的 assert 会 400/`"Invalid source parameter"`,
commit 6 立刻停下。

### 7.4 L3 Browser E2E

现有 dashboard specs 里 source filter dropdown / agent leaderboard 是数据驱动的,自动包含 grok。无需新增 spec。

### 7.5 Golden verification(本机真实数据)

写一次性验证脚本(不入库):

```typescript
// /tmp/grok_golden.ts (临时,验证后删除)
// 期望 output: input=25315 cached=63872 output=1682 reasoning=111
```

对比:
- Pre-implementation: 0(pew 完全不支持 grok)
- Post-implementation: **25315 + 63872 + 1682 + 111 = 90980 tokens**(本机 1 session)

### 7.6 隔离性验证

**关键 case**: 故意破坏 `~/.grok/logs/unified.jsonl`(chmod 000 / 截断 / 塞乱码),
运行 `pew sync`,验证:
- 其他 source 全部正常同步
- grok source 报 warning 但不抛异常
- 不 crash

## 八、时间估算

| 阶段 | 内容 | 预计 |
|---|---|---|
| Commit 0 | pricing.ts 去掉 nonCached 减法 + 加 reasoning + 14 callsite 迁移 + 更新 5 处 test 预期 | 40 min |
| Commit 1 | Foundation:core types + 所有 exhaustive switch + DiscoverOpts + paths + status wiring + 所有列在 §5.8 的 test 断言 | 45 min |
| Commit 2 | grok.ts parser + tests | 35 min |
| Commit 3 | grok-session.ts parser + tests | 20 min |
| Commit 4 | 两个 driver + discovery + registry + tests | 40 min |
| Commit 5 | sync/notify/status end-to-end wiring + tests | 25 min |
| Commit 6 | Web dashboard 文件 + §5.6b 全部 reasoning propagation 层(core + worker-read + web,含 by-device route 三处 + device breakdown)+ 全部 pin-test + palette/e2e | 110 min |
| Commit 7 | Docs + PRIVACY + CLAUDE.md + doc 42 close | 15 min |
| 全量 test + lint + golden 验证 | | 20 min |
| **合计** | | **~4 h** |

## 九、FAQ

**Q1: 为什么不读 `sessions/<sid>/updates.jsonl`?**
A: 该文件的 `_meta.totalTokens` 是**当前 context window 大小**,不是本 turn 消耗的 tokens。
用它算会严重低估。见"1.5 核心事实"。

**Q2: 为什么保留 4 路 tokens 不折损?**
A: xAI grok 支持 prompt caching,`cached_prompt_tokens` 单价通常比普通 input 便宜(参考 Anthropic 0.1x)。合并会导致成本估算偏差。参见 OpenCode section 我们做的对比,pew 的 opencode parser 因为 4→2 折损低估约 25% 成本,不能重蹈覆辙。

**Q3: reasoning tokens 单独一路?**
A: 是。Grok-4 系列有 chain-of-thought(reasoning),按独立单价计费(通常按 output 类)。保持独立字段以便 pricing.ts 精确匹配。

**Q4: 如果 xAI 后续修改 log schema 怎么办?**
A:
1. Parser 层 `msg == "shell.turn.inference_done"` 过滤 + `if (!ctx.prompt_tokens && !ctx.completion_tokens) skip` 兜底,新 event 类型自动被忽略
2. 字段缺失 → 归零(`toNonNegInt`),不抛
3. 违反预期结构 → JSON.parse fail → 跳过该行,不影响后续
4. 独立 source 隔离,坏了不影响其他

**Q5: 多 session / 多 cwd 会有冲突吗?**
A: 不会。`unified.jsonl` 是全局唯一日志,不同 sid 的 event 混合在一个文件里。parser 按 sid 分组,每个 event 独立归因。

**Q6: 现有 xAI provider(比如 kosmos / opencode 里用 xai model)会不会双计?**
A: 不会。不同 source(source=kosmos / source=opencode / source=grok)在 D1 里是独立维度,dashboard 可以按 source 切片。同 provider 不同 source 是 pew 的设计。

**Q7: 认证 / API key 需要吗?**
A: 不需要。grok CLI 已完成 OIDC 登录,pew 只读它落盘的 log 文件,不打任何 xAI API。

**Q8: cursor 支持是否受影响?**
A: 无关。cursor 因为本地无 token 数据被放弃了,grok 是**本地有精确 token 数据**的 source,是 cursor 之外的独立工作。

## 十、References

- 本机 grok CLI: v0.2.93(2026-07-10 安装)
- Grok CLI 官方文档: 略(用户 opt-in 安装,不做官方链接引用)
- Doc 03 数据管道基础: `03-data-pipeline.md`
- Doc 05 Token 归一化: `05-token-accounting.md`
- Doc 13 Unified source driver 架构: `13-phase3-unified-source-drivers.md`
- Doc 35 Hermes(session-level SQLite 参考): `35-hermes-support.md`
- Doc 36 Kosmos(JSON session 参考): `36-kosmos-support-design.md`
