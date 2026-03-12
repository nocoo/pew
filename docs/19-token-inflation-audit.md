# 19 — Token Inflation Audit & Fix Plan

## Background

Dashboard 上 Total Tokens 异常膨胀，经审计发现两个独立问题导致数据严重失真。

---

## Issue 1: Device ID Duplication (dev/prod 分裂)

### Root Cause

`ConfigManager` 根据 `dev` flag 读取不同的 config 文件：

- `config.json` (prod) → device ID: `7f2bdbdb-...`
- `config.dev.json` (dev) → device ID: `14a28b16-...`

同一台机器上 `pew sync` 和 `pew sync --dev` 使用不同的 device_id，导致相同的原始数据被作为两个独立 device 上传到 D1。

**代码位置**: `packages/cli/src/config/manager.ts:16-18`

```typescript
constructor(configDir: string, dev = false) {
  const filename = dev ? DEV_CONFIG : PROD_CONFIG;
  this.configPath = join(configDir, filename);
}
```

### Impact

- UNIQUE constraint `(user_id, device_id, source, model, hour_start)` 中 `device_id` 不同，相同数据被视为两条独立记录
- Dashboard `SUM(total_tokens)` 跨 device 聚合，同一份数据被计算两次
- 本机验证：dev device 2,911 行 **100% 与 prod device 重叠**，dev 的 token 值从未超过 prod

### Status

**已修复 (数据层)**：已从 D1 删除 dev device `14a28b16-...` 的 2,911 行 usage_records + 1 行 device_aliases。

**待修复 (代码层)**：需要将 `deviceId` 改为环境无关的共享存储。

---

## Issue 2: Queue Accumulation on Cursor Reset (4x Token Inflation)

### Root Cause

数据管线中存在架构级 bug，cursor reset 导致 D1 数据按倍数膨胀：

1. `rm cursors.json` 清除游标后 re-sync
2. 所有历史 deltas 被重新解析
3. 新的 records **append** 到 `queue.jsonl`（追加，不是覆盖）
4. Upload 时 `aggregateRecords()` 读取全部未上传的 queue records 按 `(source, model, hour_start, device_id)` 做 **SUM**
5. Worker `ON CONFLICT DO UPDATE SET total_tokens = excluded.total_tokens` 用 SUM 值 **覆盖** D1

**结果**：N 次 cursor reset + sync + upload → D1 值 = N × 真实值

**代码位置**:
- Queue append: `packages/cli/src/storage/base-queue.ts:39-43` (`appendBatch`)
- Aggregation SUM: `packages/cli/src/commands/upload.ts:52-72` (`aggregateRecords`)
- Worker overwrite: `packages/worker/src/index.ts:48-58` (`TOKEN_UPSERT_SQL`)
- Cursor persist before queue: `packages/cli/src/commands/sync.ts:339-345`

### Evidence

本机原始数据 vs D1 (prod device `7f2bdbdb-...`) 对比：

| Source | Local Raw | D1 Prod | Ratio |
|--------|-----------|---------|-------|
| opencode | 7,450,016,338 | 17,607,707,877 | **2.36x** |
| claude-code | 354,044,326 | 1,416,682,362 | **4.00x** |
| codex | 301,976,679 | 1,187,600,717 | **3.93x** |
| gemini-cli | 5,423,314 | 21,693,256 | **4.00x** |
| vscode-copilot | 2,980,668 | 11,922,672 | **4.00x** |
| **Total** | **8,114,441,325** | **20,245,606,884** | **2.49x** |

claude-code / codex / gemini-cli / vscode-copilot 均精确 **4.00x**，说明进行了 4 次 cursor reset。
opencode 为 2.36x 因为 opencode 数据随时间变化（新增 session 改变了累积值）。

### Additional Context: `default` Device

`default` device（device_id 功能上线前的遗留数据）情况：

- 4,883 行，17.6B tokens
- 与 prod device 重叠 2,837 行（100% 的 prod 时间范围内）
- 2,046 行为独有数据：
  - 60 行 2025 年旧数据（pre device-id era）
  - 1,986 行 2026 年数据中 prod device 没有的 source/model 组合（如 `openclaw` 1,315 行、`github_copilot/*` 模型等）
- 11 行 default > prod（集中在 2026-02-16 opencode/claude-opus-4.6）
- `openclaw` 数据（309M tokens）仅存在于 `default` 和 Mac Studio device 中，本机无 openclaw 原始文件

**结论**：`default` device 混合了多台机器的数据（device_id 功能上线前所有机器共用 `"default"`），不能简单删除或合并。

---

## Root Cause Analysis: Why Idempotency Was Broken

设计意图是幂等的：Worker 的 `ON CONFLICT DO UPDATE SET total_tokens = excluded.total_tokens` 是覆盖语义。相同值上传两次，D1 结果不变。

**但幂等性在客户端聚合层被瓦解了，而非 D1 层。**

问题的因果链：

1. **Queue 是 append-only 的** — `base-queue.ts:43` 用 `appendFile`，每次 sync 的 records 追加到 `queue.jsonl` 末尾，从不清空。
2. **Upload 读取 queue 后做 SUM 聚合** — `upload.ts:52-72` 的 `aggregateRecords()` 把 queue 中所有未上传的 records 按 `(source, model, hour_start, device_id)` 做 SUM。
3. **Cursor reset 触发全量重扫** — `rm cursors.json` 后 re-sync，所有日志从头解析，产生的 records 与上次一模一样，但被 **append** 到 queue 里。Queue 现在有两份相同数据。
4. **聚合后值翻倍** — `aggregateRecords()` 把两份相同 records 做 SUM → 值 = 2x 真实值。Worker 收到的 "覆盖值" 本身就是膨胀的。

**核心矛盾**：Queue 用 append 语义（适合增量数据），cursor reset 产生全量数据（不是增量），`aggregateRecords()` 对 queue 做 SUM（假设无重复）。三者组合打破了幂等性。

---

## Fix Plan

### Step 1: Fix Queue Accumulation Bug

**目标**：无论 cursor 状态如何，queue + upload 管线永远产出正确值，不累积重复。

#### 方案 A：Fresh Parse Detection（推荐）

**核心思路**：sync 入口检测到 cursors 为空（fresh parse）时，先清空 queue + queue.state，再执行全量扫描。

**逻辑**：cursor 没了 → 即将全量重扫 → 旧 queue 数据全部作废 → 清掉。新 queue 内容是完整的全量快照，upload 后的 SUM = 正确值。

**实现**：

```
executeSync() 入口:
  1. cursorStore.load() → cursors
  2. if cursors.files 为空 AND cursors.updatedAt 不为 null:
       // 曾经有 cursor 但现在没有了 = cursor reset
       queue.clear()          // 删除 queue.jsonl
       queue.clearState()     // 删除 queue.state.json (offset 归零)
  3. ... 正常 sync 流程 (append to queue)
```

`cursors.updatedAt !== null` 这个检查区分了 "首次安装（从未 sync 过）" 和 "cursor reset"。首次安装时 queue 也为空，无需清理。但实际上首次安装清理空 queue 也无副作用，所以可以简化为：

```
if Object.keys(cursors.files).length === 0:
    queue.clear()
    queue.clearState()
```

**修改文件**：
- `packages/cli/src/commands/sync.ts` — `executeSync()` 入口添加检测逻辑
- `packages/cli/src/storage/base-queue.ts` — 添加 `clear()` 和 `clearState()` 方法

**优点**：改动最小，不影响正常增量 sync 路径。
**缺点**：仅处理 cursor reset 场景。如果 queue 通过其他途径被污染（如手动编辑），无法检测。

#### 方案 B：Queue Overwrite 模式

**核心思路**：彻底改变 queue 写入语义——sync 不再 append，而是 **overwrite** 整个 queue 文件。每次 sync 输出的就是当前时刻的完整快照。

**关键难点**：增量 sync 只解析新增部分，不会重新产生旧 records。如果 sync 跑了但 upload 没跑，下次 sync 的 overwrite 会丢失上次未上传的 records。

**解决**：sync 时先读取 queue 中未上传的旧 records，与本次新 records 合并聚合后，overwrite 整个 queue。

```
executeSync() 尾部:
  1. oldOffset = queue.loadOffset()
  2. { records: oldRecords } = queue.readFromOffset(oldOffset)
  3. allRecords = [...oldRecords, ...newRecords]
  4. aggregated = aggregateByKey(allRecords)  // 按 (source, model, hour_start, device_id) 合并
  5. queue.overwrite(aggregated)              // 清空并重写整个文件
  6. queue.saveOffset(0)                      // offset 归零（因为文件被重写了）
```

**修改文件**：
- `packages/cli/src/commands/sync.ts` — 尾部写入逻辑改为 read-merge-overwrite
- `packages/cli/src/storage/base-queue.ts` — 添加 `overwrite()` 方法
- `packages/cli/src/commands/upload.ts` — `aggregateRecords()` 仍然需要保留（defense-in-depth）

**优点**：从根本上消除 queue 累积问题，无论 cursor 状态如何，queue 内容始终是正确的聚合快照。
**缺点**：改动较大，sync 需要读取 queue（之前只写不读），引入 read-merge-overwrite 的原子性问题（crash-safety 需要 rename 模式）。

#### 决策

两个方案都能解决问题。方案 A 适合快速修复，方案 B 适合长期架构演进。可先实施方案 A，后续视需要升级到方案 B。

**关键不变量**（两个方案都必须满足）：
> 对于任意 key `(source, model, hour_start, device_id)`，queue 中该 key 的所有 records 经过 `aggregateRecords()` SUM 后的值，必须等于原始日志文件中该 key 的真实 token 总量。

**验证**：L1 单元测试模拟 cursor reset + 二次 sync，确认 queue 不累积。

### Step 2: Worker Version Gate (Server-Side Defense)

**目标**：拒绝未修复 bug 的老版本客户端上传数据，防止膨胀值覆盖已修复的正确值。

**为什么需要**：客户端 bug 修复后，老版本 CLI 仍可能运行。Worker 无法区分"正确的 1000 tokens"和"4 次 cursor reset SUM 出来的 4000 tokens"——请求格式完全一样。唯一可靠的防御是版本门禁。

**实现**：

1. **CLI 端**：在 upload 请求中注入客户端版本号。

   `upload-engine.ts` `sendBatchWithRetry` 目前发送的 body 是 `JSON.stringify(batch)`（一个 `T[]` 数组）。无需改变 body 格式，通过 HTTP header 传递版本：

   ```
   headers: {
     "Content-Type": "application/json",
     "Authorization": `Bearer ${token}`,
     "X-Pew-Client-Version": "1.6.0"     // ← 新增
   }
   ```

   版本号从 `cli.ts` 的 `meta.version` 传入。

2. **Next.js 端**：`ingest-handler.ts` 读取 `X-Pew-Client-Version` header，低于最低版本（如 `1.6.0`）或缺失时返回 `400`:

   ```json
   { "error": "Client version too old. Please upgrade: npx @nocoo/pew@latest" }
   ```

   不带版本号的请求 = 老版本 = 一律拒绝。

3. **Worker 端**：无需修改。Worker 只接受来自 Next.js 的内部请求（WORKER_SECRET 认证），版本校验在 Next.js 层完成。

**修改文件**：
- `packages/cli/src/commands/upload-engine.ts` — `sendBatchWithRetry` 添加 `X-Pew-Client-Version` header
- `packages/web/src/lib/ingest-handler.ts` — 添加版本校验逻辑
- `packages/core/src/types.ts` — 可选：导出 `MIN_CLIENT_VERSION` 常量

### Step 3: `pew reset` CLI Command

**目标**：提供一条命令完成"清除本地状态 → 全量重扫 → 上传正确值"的全流程，替代手动执行 `rm cursors.json queue.jsonl queue.state.json && pew sync`。

**安全约束**：
- **绝不触碰用户原始数据**（`~/.claude/`, `~/.gemini/`, `~/.local/share/opencode/`, `~/.openclaw/` 等）。
- 只删除 pew 自身的状态文件（`~/.config/pew/` 下的 cursors、queue 文件）。

**行为**：

```
pew reset [--dev]
  1. 删除 cursors.json（token cursor）
  2. 删除 session-cursors.json（session cursor）
  3. 删除 queue.jsonl + queue.state.json（token queue）
  4. 删除 session-queue.jsonl + session-queue.state.json（session queue）
  5. 打印已清除的文件列表
  6. 自动执行 pew sync [--upload]（全量重扫 + 上传）
```

**修改文件**：
- `packages/cli/src/commands/reset.ts` — 新建，实现 `executeReset()`
- `packages/cli/src/cli.ts` — 注册 `reset` 子命令

### Step 4: Fix D1 Data with Correct Values

**目标**：用本机原始数据的正确值覆盖 D1 中 prod device 的膨胀数据。

**方案**：在 Step 1-3 完成并发布新版本后，在本机执行 `pew reset` 即可。

**前置条件**：Step 1 必须先完成（否则 reset 后 queue 仍可能累积）。

**数据修复的局限性**：对于其他用户，D1 只存最终聚合值，无上传历史，无法仅从服务端数据判断膨胀倍数。唯一修复路径是用户在本机执行 `pew reset`（前提：原始日志文件仍存在）。

### Step 5: Merge `default` Device

**目标**：清理 `default` device 的重复数据，保留独有数据。

**方案**：
1. 删除 `default` 中与 prod device 重叠的 2,837 行（prod 值 >= default 的 2,826 行直接删；11 行 default > prod 的先更新 prod 再删）
2. 将 `default` 中独有的 2,046 行迁移到 prod device `7f2bdbdb-...`（UPDATE device_id）
3. 删除 `default` 的 device_aliases 记录

**风险**：`default` 中的 `openclaw` 数据（1,412 行）可能来自其他机器，迁移到本机 device 可能归属错误。需要进一步调查确认。

### Step 6: Share Device ID Across dev/prod

**目标**：同一台机器 dev 和 prod 使用相同的 device ID。

**方案**：将 `deviceId` 存储在独立的 `device.json` 文件中，不区分 dev/prod。`config.json` 和 `config.dev.json` 只存 `token`。

**修改文件**：
- `packages/cli/src/config/manager.ts` — 新增 `ensureDeviceId()` 读写 `device.json`
- `packages/core/src/types.ts` — `PewConfig` 中移除 `deviceId` 字段（或保留向后兼容）

### Execution Order

1. Step 1 (fix queue accumulation bug) → commit
2. Step 2 (worker version gate) → commit
3. Step 3 (`pew reset` command) → commit
4. Step 6 (share device ID) → commit
5. Bump version to 1.6.0, `bun run build`, `npm publish`
6. Step 4 (fix D1 data) → `pew reset` on local machine
7. Step 5 (merge default device) → manual SQL operation
