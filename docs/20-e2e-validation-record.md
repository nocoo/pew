# 20 — E2E Validation Record (v1.6.0 Token Inflation Fixes)

## Background

`docs/19-token-inflation-audit.md` 计划的 bug 修复全部完成后，需要在真实数据上做端到端验证，确认：

1. 本地扫描 → D1 数据**精确匹配**（token + session 两条管线）
2. 重复 sync **幂等**（不产生额外累积或丢失）
3. Worker 部署与 D1 schema 对齐

本文记录完整验证过程和结论。

---

## Pre-conditions

### Committed Fixes

| Commit | Description |
|--------|-------------|
| `06bfdf9` | Bug A (inode change → full rescan) + Bug B (no-op sync 不再重标 uploaded) |
| `06bfdf9` + `94a2bb2` | Version bump 1.5.1 → 1.6.0 |
| `2f2f343` | Bug A2: knownFilePaths 区分 "新文件" vs "cursor 丢失" |
| `6aad9d7` | Bug C: reset 命令移除无用 --dev 参数 |
| `72e0cd1` | Bug A2b: knownDbSources 追踪 SQLite cursor 丢失 |
| `a427b9a` | `pew update` 自更新命令 |
| `fef342d` | Bug A2b-edge: backfill 发现 SQLite cursor 已丢失时触发 full rescan |

### Environment

- **User ID**: `7f778922-52dc-4906-8405-ab331244370b`
- **Device ID**: `14a28b16-39eb-492b-b92f-8aa244b97f1f` (shared `~/.config/pew/device.json`，dev/prod 共用)
- **D1 Database**: `5c00ebbf-a0ed-49d9-a64f-5712c272e96f`
- **Worker**: redeployed version `95bfb407-f2f1-4dbf-83c9-6818d4053219` (includes device_id support)
- **API endpoint**: `pew.dev.hexly.ai` → Worker → D1

### State Reset

1. 清除本地所有 sync 状态文件（6 个文件，与 `reset.ts` 的 `STATE_FILES` 一致）：
   ```bash
   rm -f ~/.config/pew/{cursors,session-cursors}.json \
         ~/.config/pew/{queue,session-queue}.jsonl \
         ~/.config/pew/{queue,session-queue}.state.json
   ```
2. 备份原始文件为 `.bak2`
3. 清空 D1 中该用户的 usage_records 和 session_records（其他用户数据不动）

---

## Phase 1: First Full Sync + Upload

### Token Pipeline

```
144,807 events parsed → 2,992 queue records (aggregated by source/model/hour)
5 sources: claude-code, codex, gemini-cli, opencode, vscode-copilot
```

Upload: 2,992 records in 60 batches (50 records/batch).

### Session Pipeline

```
4,321 sessions found → 3,691 queue records (after within-batch dedup by session_key)
```

Source-level breakdown (7,757 unique sessions across all data including notifier waves) 见 Phase 3。

Upload: 3,691 records in 74 batches.

### Notifier Concurrency Issue

sync 过程中（约 10 分钟），后台 **notifier 进程**触发了并发 sync，也 append 到 `session-queue.jsonl`。产生了 3 波数据：

| Wave | Time | Records | Source |
|------|------|---------|--------|
| 1 | 02:30 | 15,512 | 2 concurrent notifiers |
| 2 | 02:34 | 3,691 | Main sync (ours) |
| 3 | 02:35 | 7,382 | 2 more notifiers |

Upload engine 在读取时只看到 Wave 1+2（19,203 lines / 6.7MB），Wave 3 在读取之后追加。这不是 correctness bug — 下次 sync 会上传剩余部分，monotonic upsert 保证最终一致。

---

## Phase 2: Token Comparison — Local vs D1

**方法**: 对 token queue 的 2,992 条记录按 source 聚合 6 个字段，与 D1 的 `GROUP BY source` 查询结果逐字段对比。

### Result: PERFECT MATCH

| Source | Records | input_tokens | output_tokens | cached_input | reasoning_output | total_tokens |
|--------|---------|-------------|---------------|-------------|-----------------|-------------|
| claude-code | 223 | 66,790,554 | 2,177,436 | 290,615,046 | 0 | 359,583,036 |
| codex | 116 | 174,979,726 | 1,161,046 | 150,520,832 | 433,137 | 327,094,741 |
| gemini-cli | 49 | 2,961,403 | 78,542 | 2,151,494 | 231,875 | 5,423,314 |
| opencode | 2,589 | 1,007,223,879 | 54,871,158 | 6,473,078,748 | 2,929,832 | 7,538,103,617 |
| vscode-copilot | 15 | 2,948,870 | 31,798 | 0 | 0 | 2,980,668 |

所有 5 个 source × 6 个字段 = **30 个数值完全匹配**。

---

## Phase 3: Session Comparison — After 2nd Sync

第 1 次上传后 D1 session 数据因 Wave 3 未上传而有缺口。执行第 2 次 sync + upload 后重新对比。

**方法**: 从 session-queue.jsonl 已上传部分（offset 0..10,523,726 bytes = 30,290 lines）dedup，按 source 聚合 5 个字段与 D1 对比。

### Result: PERFECT MATCH

| Source | Sessions | total_messages | user_messages | assistant_messages | duration_seconds |
|--------|----------|---------------|---------------|--------------------|-----------------|
| claude-code | 278 | 12,798 | 3,779 | 5,768 | 1,467,969 |
| codex | 99 | 20,602 | 435 | 1,352 | 485,305 |
| gemini-cli | 67 | 491 | 71 | 417 | 4,182 |
| opencode | 7,313 | 151,203 | 16,855 | 134,348 | 7,791,342 |

所有 4 个 source × 5 个字段 = **20 个数值完全匹配**。总计 **7,757 unique sessions**。

---

## Phase 4: Idempotency Verification

### Token Idempotency

执行第 3 次和第 4 次 sync，对比 D1 token data 前后变化。

**Sync 3**: "No new token usage found" + "No pending token records to upload" — 增量扫描没发现新数据。D1 token data **零变化**（`diff` exit code 0）。

**Sync 4**: 上传了 1 条 token record — 当前 OpenCode 会话产生的新 token。D1 变化：

| Field | Before | After | Delta |
|-------|--------|-------|-------|
| opencode cnt | 2,589 | 2,590 | +1 (new hour bucket) |
| opencode input_tokens | 1,007,223,879 | 1,007,233,378 | +9,499 |
| opencode output_tokens | 54,871,158 | 54,872,211 | +1,053 |
| opencode cached_input | 6,473,078,748 | 6,473,127,567 | +48,819 |

**其他 4 个 source 完全不变**。证明 overwrite upsert 语义正确 — 重复上传相同数据不会累积。

### Session Idempotency

Session 数据在 sync 间有小幅变化，均为**真实活跃会话的正常更新**：

- **opencode**: +1 session (当前会话), +43 messages, +2,726s duration
- **claude-code**: +79 messages, +437s duration (并行运行中的 Claude Code 会话)
- **gemini-cli**: +20 messages, +225s duration (snapshot 更新)
- **codex**: 零变化

Monotonic upsert (`WHERE excluded.snapshot_at >= session_records.snapshot_at`) 确保只有更新的 snapshot 覆盖旧值。

---

## Conclusions

### Token Pipeline: VERIFIED

1. **Accuracy**: 本地扫描 → queue → D1 全链路精确匹配，5 source × 6 fields = 30 values 无偏差
2. **Idempotency**: 重复 sync/upload 不产生累积；overwrite upsert 用相同值覆盖相同值
3. **Incremental scan**: cursor 追踪正确，无新数据时不产生 queue 记录

### Session Pipeline: VERIFIED

1. **Accuracy**: dedup 后 7,757 sessions 全部匹配 D1，4 source × 5 fields = 20 values 无偏差
2. **Eventual consistency**: notifier 并发 append 不影响最终一致性，monotonic upsert 保证 newer snapshot wins
3. **Live activity**: 活跃会话的 snapshot 更新正确反映在 D1 中

### Infrastructure

1. **Worker deployment**: version `95bfb407` 正确处理 device_id + 5-column UNIQUE constraint
2. **D1 schema alignment**: Worker 的 `ON CONFLICT` 子句与 migration 006 的 UNIQUE 约束匹配
3. **Version gate**: `MIN_CLIENT_VERSION = "1.6.0"` 正确拒绝旧版 CLI

### Known Issues (Non-blocking)

1. **Session queue unbounded growth** — `session-queue.jsonl` append-only，已达 34K+ 行。需要 compaction 策略。详见 `docs/21-session-queue-growth.md`。
2. **Notifier concurrency** — 后台 notifier 与手动 sync 并发 append 到同一 queue 文件，导致临时不一致。最终一致但增加了验证复杂度。
