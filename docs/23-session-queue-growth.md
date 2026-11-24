# 23 — Session Queue Unbounded Growth

## Problem

`session-queue.jsonl` 使用 `appendBatch()` 语义，每次 sync 把所有 session 的最新 snapshot **追加**到文件末尾。这导致文件无限增长。

### 当前数据

| Metric      | Token Queue                    | Session Queue            |
| ----------- | ------------------------------ | ------------------------ |
| 写入方式    | `overwrite()` (atomic replace) | `appendBatch()` (append) |
| 文件大小    | 753 KB                         | **21 MB**                |
| 行数        | 2,996                          | **63,548**               |
| Unique keys | 2,996                          | 7,758                    |
| 冗余倍率    | 1.0x                           | **8.2x**                 |

每次 sync 追加约 3,700 行（= unique session count），加上后台 notifier 进程的并发 sync，文件以约每次 sync **4K 行 / 1.3MB** 的速度增长。

---

## Root Cause Analysis

### 为什么 Token 不增长

Token queue 使用 `overwrite()` — 每次 sync 把整个 queue 原子替换为最新快照。上传后 offset 推进到文件末尾，下次 sync 又 overwrite。文件大小 = unique record count × avg record size，恒定不变。

```
packages/cli/src/storage/base-queue.ts:53
async overwrite(records: T[]): Promise<void> {
  const tmpPath = this.queuePath + ".tmp";
  await writeFile(tmpPath, data);
  await rename(tmpPath, this.queuePath);   // atomic replace
}
```

### 为什么 Session 必须 Append

Session pipeline 的设计约束：

1. **Upload engine 基于 byte offset** (`base-queue.ts:71` `readFromOffset`)：只读取 offset 之后的新数据。如果用 overwrite，之前已上传的 offset 会失效（overwrite 会改变文件中每条记录的 byte position）。
2. **Dedup 在 upload 前做** (`session-upload.ts:56` `deduplicateSessionRecords`)：从 offset 开始读取所有新 append 的记录，按 `session_key` 取最新 `snapshot_at`，然后上传 dedup 后的结果。
3. **D1 monotonic upsert** (`WHERE excluded.snapshot_at >= session_records.snapshot_at`)：保证只有更新的 snapshot 覆盖旧值。

这意味着即使同一个 session 的 snapshot 被 append 了 8 次，upload engine 每次只读未上传的 tail，dedup 后只发送 1 条最新记录。正确性没问题，但文件一直在涨。

### Notifier 加速增长

后台 notifier 进程（`packages/cli/src/commands/notify.ts`）在 file system 变化时触发 sync。多个 notifier 可能并发运行，每个都 append 一批 session records 到同一个文件。在 E2E 测试中观察到单次 10 分钟 sync 期间有 4 个 notifier 触发，产生了 3 波 append（Wave 1: 15,512 records, Wave 3: 7,382 records）。

---

## Impact

### 现在

- **磁盘**: 21MB，可接受
- **Upload 延迟**: 每次 upload 需要解析 offset 后的所有新行。如果累积了多轮未上传的 append（如离线使用一段时间），解析量线性增长
- **内存**: dedup map 在 upload 前一次性加载。当前 ~7,800 sessions × ~350 bytes/record ≈ 2.7MB，可接受

### 6 个月后（预估）

假设每天 10 次 sync（手动 + notifier），每次 append ~4,000 行 × 350 bytes：

- **行数**: 63K + (10 × 4K × 180 days) = **7.2M 行**
- **文件大小**: 21MB + (10 × 1.3MB × 180) = **~2.3 GB**
- **Upload 解析**: 如果 offset 落后（如出国一周无网），需要一次性解析数百万行

---

## Possible Solutions

### 方案 A: Post-Upload Compaction

上传成功后，truncate 已上传的数据。

```
upload 完成 → saveOffset(newOffset) → compact()
compact:
  1. 读取 offset 之后的剩余数据（如果有）
  2. overwrite queue 为只剩余数据
  3. saveOffset(0)
```

**优点**: 最简单，文件大小 ≈ 最近一次 sync 的 append 量
**缺点**: 非原子操作（crash between overwrite and saveOffset → data loss or re-upload）。需要设计 crash-safe 的 compaction 协议。

### 方案 B: Overwrite + Offset Reset

把 session queue 也改成 `overwrite()` 语义，每次 sync 前 reset offset 到 0。

```
session-sync:
  1. 扫描所有 session files
  2. queue.overwrite(allSessionRecords)   // atomic replace
  3. queue.saveOffset(0)                  // reset offset

session-upload:
  1. readFromOffset(0)                    // 读全部
  2. dedup
  3. upload
  4. saveOffset(newOffset)
```

**优点**: 与 token pipeline 对齐，文件大小恒定（= unique sessions × record size ≈ 2.7MB）
**缺点**:

- 每次 upload 发送**所有** session records（不仅仅是增量），D1 upsert 幂等所以正确性无碍，但浪费带宽
- 并发 notifier 问题：两个进程同时 overwrite 会互相覆盖
- 打破了 "只上传新数据" 的增量优化

### 方案 C: Dual-File Rotation

维护两个文件：active（写入中）和 upload（上传中）。

```
session-sync:
  appendBatch → session-queue.jsonl (active)

session-upload:
  1. rename session-queue.jsonl → session-queue.upload.jsonl (atomic)
  2. 解析 upload 文件全部内容 → dedup → upload
  3. 上传成功后删除 upload 文件
  4. 新的 sync 会创建新的 session-queue.jsonl
```

**优点**: 已上传数据自动清理，无需 compaction。Crash-safe（rename 是原子的，上传文件持续存在直到确认成功）
**缺点**: 稍复杂，需要处理 "upload 文件已存在但上次上传未完成" 的恢复逻辑

### 方案 D: 定期 Full Overwrite + 增量 Append

混合方案：平时 append 增量，定期（如每 N 次 sync 或文件超过 X MB）做一次 full overwrite + offset reset。

```
if (queueFileSize > COMPACT_THRESHOLD) {
  queue.overwrite(allCurrentRecords);
  queue.saveOffset(0);
} else {
  queue.appendBatch(newRecords);
}
```

**优点**: 正常情况下保持增量优化，超限时自动压缩
**缺点**: 增加了状态判断的复杂度，COMPACT_THRESHOLD 需要调参

---

## Recommendation

**方案 A (Post-Upload Compaction)** 最实用：

1. 实现简单 — 只需在 `upload-engine.ts` 的 `saveOffset` 之后加一个 compact 步骤
2. 保持增量语义 — 不改变 sync 的 append 行为
3. Crash safety 可通过 "先 compact 再 saveOffset(0)" 的顺序保证：如果 compact 后 crash，下次 loadOffset 返回旧的大 offset，readFromOffset 发现文件变短了就从头读（等价于一次完整 re-upload，D1 upsert 幂等）

如果后续 notifier 并发问题严重，可升级到方案 C (Dual-File Rotation)。

---

## Related

- `packages/cli/src/storage/base-queue.ts` — BaseQueue implementation (overwrite vs appendBatch)
- `packages/cli/src/commands/session-upload.ts` — deduplicateSessionRecords + upload
- `packages/cli/src/commands/upload-engine.ts` — offset-based upload engine
- doc/22 — E2E validation 中发现此问题
- doc/21 — Token inflation audit (原始 bug 修复计划)
