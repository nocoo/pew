# 21 — Token Inflation Audit & Fix Plan

## Background

Dashboard 上 Total Tokens 异常膨胀，经审计发现两个独立问题导致数据严重失真。

---

## Issue 1: Device ID Duplication (dev/prod 分裂)

### Root Cause

`ConfigManager` 根据 `dev` flag 读取不同的 config 文件：

- `config.json` (prod) → device ID: `7f2bdbdb-...`
- `config.dev.json` (dev) → device ID: `aaaaaaaa-...`

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

**已修复 (数据层)**：已从 D1 删除 dev device `aaaaaaaa-...` 的 2,911 行 usage_records + 1 行 device_aliases。

**待修复 (代码层)**：需要将 `deviceId` 改为环境无关的共享存储。

---

## Issue 2: Queue Accumulation on Cursor Reset (4x Token Inflation)

### Root Cause

数据管线中存在架构级 bug：当 cursor reset 与 queue 中的 unread records 同时存在时，upload 的 SUM 聚合产出膨胀值。

**精确触发条件**：膨胀发生当且仅当以下三个条件**同时**满足：

1. **Cursor 被清除**（`rm cursors.json`），导致下次 sync 从头重扫所有日志文件
2. **Queue 中存在尚未上传的 records**（即 `queue.jsonl` 中 savedOffset 之后还有数据）
3. **Re-sync 后的 records 被 append 到 queue，然后 upload 时 SUM 聚合把重复快照累加**

如果 cursor reset 前 upload 已成功（savedOffset 已推进到文件末尾），queue 的 unread 区间为空，此时 re-sync 产生的 records 是 queue 中唯一的一份，SUM 不会膨胀。**真正的膨胀条件是：cursor reset 使得同一 bucket 的重复快照同时留在 unread queue 区间里。**

具体因果链：

1. `rm cursors.json` 清除游标后 re-sync
2. 所有历史 deltas 被重新解析（parser 从头读取日志文件）
3. 新的 records **append** 到 `queue.jsonl`（追加，不是覆盖）
4. Upload 时 `aggregateRecords()` 从 savedOffset 读取全部 unread queue records，按 `(source, model, hour_start, device_id)` 做 **SUM**
5. Worker `ON CONFLICT DO UPDATE SET total_tokens = excluded.total_tokens` 用 SUM 值 **覆盖** D1

**结果**：如果 N 次 cursor reset + sync 在同一次 upload 前发生（unread records 累积了 N 份重复快照），则 D1 值 = N × 真实值。

**代码位置**:
- Queue append: `packages/cli/src/storage/base-queue.ts:39-43` (`appendBatch`)
- Aggregation SUM: `packages/cli/src/commands/upload.ts:52-72` (`aggregateRecords`)
- Upload reads from savedOffset: `packages/cli/src/commands/upload-engine.ts:112-114`
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

claude-code / codex / gemini-cli / vscode-copilot 均精确 **4.00x**，说明进行了 4 次 cursor reset，且每次 reset 前 upload 尚未完成（unread records 累积）。
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

## Root Cause Analysis: Queue Records Are Incremental Deltas, Not Snapshots

**理解 bug 和修复方案的前提是搞清楚 queue 里到底存的是什么。**

### Parser 产出的是增量 delta

每个 parser/driver 使用 cursor（byte offset、lastIndex、lastTotals 等）实现增量解析。sync 执行时，parser 只处理 cursor 之后的新数据，产出的 `ParsedDelta` 仅代表**本次新增的 token 量**。

两种 parser 策略：

| 策略 | Sources | 原始格式 | 增量机制 |
|------|---------|----------|----------|
| **Per-event absolute** | Claude, OpenClaw, VSCode Copilot | JSONL，每行带独立 usage | byte offset resume，只读新字节 |
| **Cumulative diff** | Codex, Gemini, OpenCode | 累积 totals | `diffTotals(current, lastTotals)` 产出增量 |

无论哪种策略，**cursor reset（offset=0 / lastTotals=null）都会导致全部数据被重新产出为 delta**。re-scan 的总量等于首次 scan 的总量。

### sync.ts 的聚合是纯加法

`sync.ts:297-315` 的 bucket 聚合使用 `addTokens()`（`buckets.ts:53-58`）做 `target.field += delta.field`。这是纯加法，不做去重。

### Queue 中存的是"本次 sync 产出的增量 bucket 聚合值"

sync 完成后 `appendBatch(records)` 写入 queue 的每条 record，是**本次 sync 中新解析到的所有 delta 按 (source, model, hour_start) 聚合后的增量值**。

关键推论：
- **正常增量 sync**：queue record 只包含上次 sync 以来的新增 token（因为 parser 从 cursor 位置开始）
- **Cursor reset 后的 sync**：queue record 包含从文件开头到末尾的所有 token（parser 从 byte 0 开始，重新产出全部 delta）
- **同一个 bucket key 的两次增量 sync**：两条 record 的值相加才是该 bucket 的真实总量

**这就是为什么 MAX 不能用作 merge 规则。** 假设半小时 bucket X 在第一次 sync 中产出 100 tokens，第二次 sync 又产出 30 tokens（同一半小时内新增了活动），`MAX(100, 30) = 100`，丢掉了 30。正确值应该是 130。

### 设计意图是幂等的——但被客户端聚合层瓦解

Worker 的 `ON CONFLICT DO UPDATE SET total_tokens = excluded.total_tokens` 是覆盖语义。相同值上传两次，D1 结果不变。

**但幂等性在客户端聚合层被瓦解了，而非 D1 层。**

核心矛盾：Queue 用 append 语义（正确做法：每条 record 是增量），cursor reset 使 parser 产出全量数据作为 delta（与 queue 中已有的增量重复），`aggregateRecords()` 对 queue 做 SUM（假设无重复）。三者组合打破了幂等性。

---

## Fix Plan

**对外一句话**："升级新版 CLI 后，执行一次 `pew reset`，再同步一次，状态就恢复正常。"

核心保证：
1. `pew reset` 能彻底清掉会导致 token inflation 的本地坏状态
2. reset 后第一次 sync 产出正确的 queue 和正确的上传值
3. 之后的 sync 永远安全，不因 cursor reset、upload 失败、重复扫描而膨胀

### Step 1: Fix Token Queue Semantics (CLI)

**目标**：从根本上消除 queue 累积问题。sync 结束后 queue 始终是"当前未上传的正确快照"。

**当前模型（有 bug）**：

```
sync:     parse deltas → aggregate into buckets → appendBatch(newRecords)
          // cursor saved BEFORE queue write (sync.ts:339-345)
upload:   readFromOffset(savedOffset) → aggregateRecords(SUM) → POST → saveOffset
```

append 意味着同一个 key 可以在 queue 中出现多次（cursor reset 后更是 N 倍），aggregateRecords 做 SUM 把重复项累加 → 膨胀。

**新模型**：

```
sync:     parse deltas → aggregate into buckets (newRecords)
          → read ALL old records from queue (offset 0, not savedOffset)
          → SUM(oldRecords + newRecords) by key → overwrite queue → offset = 0
          → save cursors
upload:   readFromOffset(0) → POST (records already aggregated) → saveOffset
```

#### 关键设计决策：为什么读取全量 queue 再 SUM，而不是 MAX

Queue records 是**增量 delta**，不是累积快照。同一个 bucket key 可能在多次 sync 中各产出一条增量 record，它们的**正确合并方式是 SUM**。

MAX 不成立的场景：
- 第 1 次 sync：bucket X 产出 100 tokens（新增活动）
- 第 2 次 sync：bucket X 又产出 30 tokens（同一半小时内继续有新活动）
- queue 中有两条 record：100 和 30
- `SUM(100, 30) = 130` ✅ 正确
- `MAX(100, 30) = 100` ❌ 丢掉了 30

那 SUM 不是会导致 cursor reset 后膨胀吗？**不会**，因为新模型下 sync 读取的是 queue 的**全量内容**（从 offset 0，不是从 savedOffset），然后用 merged result **overwrite** 整个 queue 文件。

#### Cursor reset 场景推演

```
状态：queue 里有 bucket X = 100（之前两次 sync 的 SUM）
操作：rm cursors.json && pew sync
```

1. Parser 从头解析，产出本次的 newRecords，其中 bucket X = 130（全量重扫值）
2. 读取 queue 全量：oldRecords 中 bucket X = 100
3. `SUM(100, 130) = 230` ❌ 这也是错的！

**所以纯 SUM 在 cursor reset 场景下同样会膨胀。** 这是问题的核心难点：queue 里存的是增量，但 cursor reset 后 parser 产出的是全量，两者混在一起无论 SUM 还是 MAX 都不对。

#### 解决方案：Overwrite-Only（不读 old、不 merge）

**Sync 不需要读取 old queue records，也不需要 merge。** 正确做法是：

```
sync:     parse deltas → aggregate into buckets → overwrite queue with newRecords → offset = 0
          → save cursors
upload:   readFromOffset(0) → POST → saveOffset(newOffset)
```

**每次 sync 的 output（newRecords）直接 overwrite 整个 queue，offset 归零。** 不读 old，不 merge。

这为什么是正确的：

| 场景 | 发生了什么 | Queue 内容 | 上传值 |
|------|-----------|-----------|--------|
| **正常增量 sync** | Parser 从 cursor 位置开始，只产出新 delta | 仅包含本次新增的增量 | ✅ 正确（增量覆盖 D1） |
| **Cursor reset 后 sync** | Parser 从头解析，产出全量 delta | 全量值（覆盖了之前的增量） | ✅ 正确（全量覆盖 D1） |
| **Upload 失败后再次 sync** | 新 sync 再次 overwrite queue | 最新的增量值（覆盖了上次未上传的） | ✅ 正确 |

**等一下——正常增量 sync 只覆盖新增量，但之前未上传的旧增量不就丢了吗？**

是的。这是 overwrite-only 的代价：**如果上次 sync 产出了 records 但 upload 尚未完成，下次 sync 的 overwrite 会丢掉那些未上传的增量。**

场景：
1. Sync A：产出 bucket X = 50（新增量），写入 queue
2. Upload 失败（或还没跑）
3. Sync B：产出 bucket X = 30（更多新增量），overwrite queue
4. Queue 里只有 X = 30，Sync A 的 50 丢了
5. Upload：D1 收到 30，正确值应该是 80

**这在 cursor-before-queue 的写入顺序下不会发生。** 因为：
- Sync A 先 save cursor 到位置 P₁，然后 overwrite queue
- Sync B 从 P₁ 开始解析，只产出 P₁ 之后的新增量 30
- 但 P₁ 之前的增量已经在 Sync A 的 queue 中，被 Sync B 的 overwrite 覆盖丢失了

**所以 overwrite-only 需要改变写入顺序：cursor 必须在 queue overwrite 之后保存。**

#### 最终方案：Overwrite + Cursor-After-Queue

```
sync.ts 尾部（替换 sync.ts:339-350）：

1. queue.overwrite(newRecords)   // 原子写入：write to tmp → rename
2. queue.saveOffset(0)           // offset 归零（文件被重写了）
3. cursorStore.save(cursors)     // cursor 最后保存
```

**Crash safety 分析**：

| Crash 时机 | 状态 | 下次 sync |
|-----------|------|-----------|
| overwrite 前 | queue = 旧内容，cursor = 旧 | 重新解析 + overwrite → 正确 |
| overwrite 后、cursor save 前 | queue = 本次结果，cursor = 旧 | cursor 指向旧位置，parser 重扫本次范围 + 之前的范围，产出更大的全量值 → overwrite queue → **D1 收到的值 ≥ 真实值** |
| cursor save 后 | queue = 本次结果，cursor = 新 | 正常增量 → 正确 |

**第二种 crash 场景会导致部分数据重复计入吗？**

是的。如果 crash 发生在 queue overwrite 之后但 cursor save 之前，下次 sync 会用旧 cursor 重扫，产出的值包含了"本次已经 overwrite 到 queue 中的增量"加上之前累积的部分。这意味着 queue 中的值可能 > 真实值。

但这比 cursor-before-queue 的 inflate-on-reset 要好得多：
1. **只发生在 crash 时**，不是正常操作流程
2. **只在 queue overwrite 到 cursor save 之间极短的窗口内**
3. **最坏情况是一次 sync 周期的增量被多算一次**，不是 Nx 倍数膨胀
4. 用户可以通过 `pew reset` 回到干净状态

**但还有更好的方案吗？**

有。**先保存 cursor，再 overwrite queue — 与现有代码相同的顺序。** Crash safety：
- Cursor saved + queue 没 overwrite → 下次 sync 从新 cursor 开始，产出的是纯增量，但 queue 里还有旧的内容
- 问题：旧 queue 内容 + 新 overwrite 内容 = ？

**不对。overwrite 是全量覆盖，不是 append。** 如果 cursor saved 但 queue 没 overwrite，下次 sync：
1. Cursor 指向新位置 P₂
2. Parser 从 P₂ 开始，只产出 P₂ 之后的增量
3. `overwrite(newRecords)` 把 queue 替换为仅 P₂ 之后的增量
4. 但 P₁ 到 P₂ 之间的增量丢了（在上次 queue overwrite 中被覆盖，但 overwrite 没成功）

**所以 cursor-before-queue + overwrite = 丢数据（上次 sync 的增量）。**

这是当前代码 cursor-before-queue + append 的设计意图——append 不会丢旧数据，只是追加。但 overwrite 会。

#### 最终结论：Cursor-After-Queue + Overwrite

写入顺序必须改为 **queue overwrite → offset save → cursor save**。

crash safety 的取舍是：用"极端 crash 场景下极短窗口内的微量多算"，换取"正常操作下（包括 cursor reset）永远不膨胀"。这是正确的取舍，因为：
- Cursor reset 是实际发生的（已经导致 4x 膨胀）
- 两步写入之间的 crash 是理论边界情况
- `pew reset` 提供了兜底恢复手段

**详细实现**：

`sync.ts` 尾部（替换 `packages/cli/src/commands/sync.ts:339-350`）：

```typescript
// ---------- Write to queue (overwrite, not append) ----------
if (records.length > 0) {
  await queue.overwrite(records);    // atomic: write tmp → rename
} else {
  await queue.overwrite([]);         // clear queue if no records
}
await queue.saveOffset(0);           // offset = 0 (entire file is unread)

// ---------- Save cursor state AFTER queue ----------
// Queue must be written before cursor so that a crash between the two
// does not lose data. Worst case: queue overwritten + cursor not saved
// → next sync re-scans from old cursor position → produces a superset
// of the current records → overwrite queue → values ≥ true (minor
// over-count for one sync cycle, recoverable via pew reset).
cursors.updatedAt = new Date().toISOString();
await cursorStore.save(cursors);
```

`base-queue.ts` 新增方法：

```typescript
/** Atomically overwrite the queue with new records (write tmp → rename) */
async overwrite(records: T[]): Promise<void>
```

`upload.ts` 的 `aggregateRecords()` 变为 **defense-in-depth**：保留函数，语义改为 SUM（与之前一致），但因为 queue 中每个 key 最多出现一次（overwrite 保证），SUM 退化为 identity。保留它是为了防止未来有其他路径 append 到 queue 时仍然安全。

`upload-engine.ts` 的 offset 逻辑不变：upload 从 savedOffset 读取 records，上传成功后 saveOffset。sync 结束后 offset = 0，所以 upload 会读到完整 queue。

**关键不变量**：
> 每次 sync 完成后，queue 文件仅包含本次 sync 产出的 records，offset = 0。Upload 时读到的就是本次 sync 的完整输出，无需 merge、无重复。

**修改文件**：
- `packages/cli/src/commands/sync.ts` — 尾部 queue 写入逻辑改为 overwrite + cursor-after-queue
- `packages/cli/src/storage/base-queue.ts` — 新增 `overwrite()` 方法（atomic tmp → rename）
- `packages/cli/src/commands/upload.ts` — `aggregateRecords()` 保留作为 defense-in-depth

**验证**：
- L1 单元测试：cursor reset + 二次 sync → queue 中值不膨胀（等于全量重扫值）
- L1 单元测试：sync 后 upload 失败 → 再次 sync → queue 值正确（不累积）
- L1 单元测试：两次增量 sync（无 upload）→ 第二次 overwrite 不丢第一次数据（因为 parser 从旧 cursor 开始，产出的增量包含第一次的范围 — **注意：这需要验证**）

**⚠️ 待验证的边界情况**：

两次 sync 之间如果 upload 没有执行，第二次 sync 的 overwrite 会丢掉第一次 sync 的增量吗？

分析：
1. Sync 1：cursor 从 P₀ → P₁，产出 delta [P₀, P₁)，overwrite queue，save cursor = P₁
2. （没有 upload）
3. Sync 2：cursor 从 P₁ → P₂，产出 delta [P₁, P₂)，overwrite queue，save cursor = P₂
4. Upload：读取 queue，只有 [P₁, P₂) 的增量。[P₀, P₁) 丢了。

**这是一个问题。** Overwrite-only 模型在"sync 频率 > upload 频率"时会丢数据。

#### 修正方案：Read-SUM-Overwrite（读全量 + SUM + 覆盖）

结合前面的分析，正确方案是：

```
sync:     parse deltas → aggregate into buckets (newRecords)
          → read ALL records from queue (offset 0)
          → SUM(allOldRecords + newRecords) by key → overwrite queue → offset = 0
          → save cursors
```

**读取的是 queue 的全量内容（offset 0），不是 savedOffset 之后的 unread 部分。**

这样 queue 始终是"从第一次 sync 到现在所有增量的累积 SUM"。每次 sync 把自己的新增量加到累积值上，然后 overwrite。

**Cursor reset 场景**：
1. Queue 中 bucket X = 130（之前所有 sync 的 SUM）
2. `rm cursors.json && pew sync`
3. Parser 从头解析，产出 newRecords 中 bucket X = 130（全量重扫值，恰好等于累积值）
4. 读取 queue 全量：oldRecords 中 bucket X = 130
5. `SUM(130, 130) = 260` ❌ 还是膨胀了！

**不行。只要 old records + cursor-reset 后的 new records 做 SUM，就一定膨胀。**

这是因为 cursor reset 后 parser 产出的不是增量而是全量，但 queue 里已经有了之前的累积值。两者 SUM = 累积 + 全量 = 2x。

#### 根本矛盾与正确方案

矛盾总结：
- Queue records 是增量 → 正常 sync 需要 SUM 来累积
- Cursor reset 后 records 变成全量 → SUM 会膨胀，需要 REPLACE
- **但代码无法区分"这次 sync 的 records 是增量还是全量"**

**解决方案：让 sync 自己知道自己是增量还是全量。**

如果 sync 检测到 cursor 是空的（首次 or reset），它产出的 records 是**全量**值。此时应该 **overwrite queue**（不读 old、不 merge）。

如果 sync 检测到 cursor 存在（正常增量），它产出的 records 是**增量**值。此时应该 **read old + SUM + overwrite queue**。

```
sync:     parse deltas → aggregate into buckets (newRecords)
          → if cursors were empty at start (full scan):
              queue.overwrite(newRecords)      // 全量覆盖
          → else (incremental):
              read ALL from queue → SUM(old + new) → queue.overwrite(merged)
          → queue.saveOffset(0)
          → cursorStore.save(cursors)
```

**验证所有场景**：

| 场景 | Cursor 状态 | 分支 | Queue 操作 | 结果 |
|------|------------|------|-----------|------|
| 首次 sync（空 cursor） | empty | full-scan | overwrite(全量) | ✅ 正确 |
| 正常增量 sync | exists | incremental | SUM(old + new) → overwrite | ✅ 正确：old 累积 + new 增量 = 新累积 |
| Cursor reset 后 sync | empty (刚删了) | full-scan | overwrite(全量) | ✅ 正确：丢弃旧 queue，用全量替换 |
| Upload 失败后增量 sync | exists | incremental | SUM(old + new) → overwrite | ✅ 正确：未上传的 old 被保留 |
| Upload 失败后 cursor reset | empty | full-scan | overwrite(全量) | ✅ 正确 |
| 两次增量 sync（无 upload） | exists | incremental | SUM(old + new₁) → SUM(result + new₂) | ✅ 正确 |
| Crash: overwrite 后 cursor 前 | — | — | queue = 本次结果，cursor = 旧 | 下次判断为 incremental（cursor 存在但过时），SUM(queue + re-scan) → 重扫范围内的增量可能被多算一次 |

**Crash safety 分析（cursor-after-queue 顺序）**：

| Crash 时机 | Queue | Cursor | 下次 sync | 影响 |
|-----------|-------|--------|-----------|------|
| overwrite 前 | 旧 | 旧 | 完整重做本次 sync → 正确 | 无 |
| overwrite 后、cursor save 前 | 新 | 旧 | Cursor 存在 → incremental 分支 → SUM(新 queue + 重扫旧→新区间的 delta) | **重扫范围内的增量可能被多算一次（范围取决于旧 cursor 与新 cursor 之间的距离，不一定恰好等于一个 sync 周期）** |
| cursor save 后 | 新 | 新 | 正常增量 | 无 |

第二种 crash 场景的影响是有限的：重扫范围内的增量被多算一次（而不是 Nx 倍数膨胀），且只在 crash 这种极端场景下发生。多算的范围取决于旧 cursor 与实际解析终点之间的距离，通常是上一个 sync 周期左右，但不应做精确承诺。`pew reset` 可以恢复。

**如何判断 cursor 是空的？**

在 `executeSync` 开头加载 cursor 后，**立即**检查 `cursors.files` 是否为空对象（且 `cursors.openCodeSqlite` 为 undefined），将结果存入 `initialCursorEmpty` 变量。

`isFullScan = Object.keys(cursors.files).length === 0 && !cursors.openCodeSqlite`

**必须在 sync 开始时判定，不能在 sync 结束后判定。** 因为 sync 过程中各 driver 会写入新的 file cursors（`cursors.files[path] = ...`），sync 结束后 `cursors.files` 不再为空，用结束时的状态判断会永远走 incremental 分支，首次 full-scan 也会错误地去 SUM 旧 queue。

**详细实现**：

`sync.ts` 尾部（替换 `packages/cli/src/commands/sync.ts:339-350`）：

```typescript
// ---------- Detect full-scan vs incremental ----------
// If cursors were empty when we started, this is a full scan (first run
// or after pew reset). The records represent the complete picture and
// should replace the queue entirely. Otherwise it's an incremental scan
// and records are deltas that must be SUM'd with existing queue contents.
const isFullScan = initialCursorEmpty;  // captured at start of executeSync

// ---------- Write to queue ----------
if (isFullScan) {
  // Full scan: overwrite queue with complete snapshot
  await queue.overwrite(records);
} else {
  // Incremental: SUM with existing queue records
  const { records: oldRecords } = await queue.readFromOffset(0);
  const merged = sumRecords([...oldRecords, ...records]);
  await queue.overwrite(merged);
}
await queue.saveOffset(0);

// ---------- Save cursor state AFTER queue ----------
cursors.updatedAt = new Date().toISOString();
await cursorStore.save(cursors);
```

`sumRecords()` 函数（可以复用现有的 `aggregateRecords` 逻辑——它本身就是 SUM，只是现在明确了语义）：

```typescript
function sumRecords(records: QueueRecord[]): QueueRecord[] {
  // 按 (source, model, hour_start, device_id) 分组，SUM 所有 token fields
  // 与 upload.ts 的 aggregateRecords 相同逻辑
}
```

**修改文件**：
- `packages/cli/src/commands/sync.ts` — 尾部 queue 写入逻辑改为 full-scan/incremental 双分支
- `packages/cli/src/storage/base-queue.ts` — 新增 `overwrite()` 方法（atomic tmp → rename）
- `packages/cli/src/commands/upload.ts` — `aggregateRecords()` 保留作为 defense-in-depth

**验证**：
- L1 单元测试：cursor reset + 二次 sync → queue 中值不膨胀（等于全量重扫值）
- L1 单元测试：sync 后 upload 失败 → 再次增量 sync → queue 值正确（old + new SUM）
- L1 单元测试：两次增量 sync（无 upload）→ 值正确累积（SUM）
- L1 单元测试：首次 sync（空 cursor）→ overwrite queue，值正确

### Step 2: `pew reset` CLI Command

**目标**：一条命令清除所有会导致 token inflation 的本地状态，然后全量重建。

**安全约束**：
- **绝不触碰用户原始数据**（`~/.claude/`, `~/.gemini/`, `~/.local/share/opencode/`, `~/.openclaw/` 等）
- 只删除 pew 自身的状态文件（`~/.config/pew/` 下）

**清理范围**（6 个文件）：

| 文件 | 用途 |
|------|------|
| `cursors.json` | Token sync 游标 |
| `queue.jsonl` | Token upload 队列 |
| `queue.state.json` | Token upload offset |
| `session-cursors.json` | Session sync 游标 |
| `session-queue.jsonl` | Session upload 队列 |
| `session-queue.state.json` | Session upload offset |

**行为**：

```
pew reset [--dev]
  1. 删除上述 6 个文件（不存在则跳过，不报错）
  2. 打印已清除的文件列表
  3. 提示用户执行 pew sync 重建数据
```

`pew reset` 只负责清理，不自动触发 sync + upload。用户手动执行 `pew sync` 来重建（sync 默认 `--upload`），这样用户对整个流程有完整控制。

**修改文件**：
- `packages/cli/src/commands/reset.ts` — 新建
- `packages/cli/src/cli.ts` — 注册 `reset` 子命令

### Step 3: Version Gate (Server-Side Defense)

**目标**：拒绝未修复 bug 的老版本客户端上传，防止膨胀值写入 D1。

**为什么需要**：客户端 bug 修复后，老版本 CLI 仍可能运行。Worker 无法区分"正确的 1000 tokens"和"4 次 cursor reset SUM 出来的 4000 tokens"——请求格式完全一样。

**实现**：

1. **CLI 端**：upload 请求添加 `X-Pew-Client-Version` header。

   ```
   headers: {
     "Content-Type": "application/json",
     "Authorization": `Bearer ${token}`,
     "X-Pew-Client-Version": "1.6.0"
   }
   ```

   版本号从 `cli.ts` 的 `meta.version` 传入 upload engine。

2. **Next.js 端**：`ingest-handler.ts` 认证通过后、校验 body 之前，检查 `X-Pew-Client-Version`：
   - 缺失 → `400: { "error": "Client version too old. Run: npx @nocoo/pew@latest && pew reset" }`
   - 低于 `MIN_CLIENT_VERSION` → 同上
   - 通过 → 继续正常流程

3. **Worker 端**：无需修改。Worker 只接受来自 Next.js 的内部请求（WORKER_SECRET 认证），版本校验在 Next.js 层完成。

**修改文件**：
- `packages/cli/src/commands/upload-engine.ts` — `sendBatchWithRetry` 添加版本 header
- `packages/web/src/lib/ingest-handler.ts` — 添加版本校验
- `packages/core/src/constants.ts` — 导出 `MIN_CLIENT_VERSION`

### Step 4: Clear D1 Data

**目标**：清除 D1 中所有膨胀和脏数据，等用户重新同步后干净重建。

**方案**：清空 `usage_records`、`session_records` 和 `device_aliases` 三张表。包含 `device_aliases` 是因为 Issue 1 的 device 分裂已经在 alias 表中留下了脏数据（例如已删除的 dev device 的 alias），干净重建需要一并清除。

```sql
DELETE FROM usage_records;
DELETE FROM session_records;
DELETE FROM device_aliases;
```

**时机**：Step 1-3 发布新版本、服务端版本门禁生效之后执行。确保清空后旧版本 CLI 无法再写入膨胀数据。

**恢复流程**：每个用户升级新版 CLI → `pew reset` → `pew sync`。device alias 会在用户下次访问 dashboard 时重新设置。

### Step 5: Share Device ID Across dev/prod

**目标**：同一台机器 dev 和 prod 使用相同的 device ID。

**方案**：将 `deviceId` 存储在独立的 `device.json` 文件中，不区分 dev/prod。`config.json` 和 `config.dev.json` 只存 `token`。

**修改文件**：
- `packages/cli/src/config/manager.ts` — `ensureDeviceId()` 改为读写 `device.json`
- `packages/core/src/types.ts` — `PewConfig` 中移除 `deviceId` 字段（或保留向后兼容）

### Execution Order

1. Step 1 (fix token queue semantics) → commit
2. Step 2 (`pew reset` command) → commit
3. Step 3 (version gate) → commit
4. Step 5 (share device ID) → commit
5. Bump version to 1.6.0, `bun run build`, `npm publish`
6. Deploy web (version gate live)
7. Step 4 (clear D1 data — including `device_aliases`)
8. Announce: "升级后执行 `pew reset` 再 `pew sync`"
