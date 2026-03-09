# 11. Notifier 实现计划

## 实施进度

- [x] Step 1: 核心类型
- [x] Step 2: Coordinator（跨进程 file-lock + signal 文件）
- [x] Step 3: notify-handler（notify.cjs 生成器）
- [x] Step 3.5: 统一 Notifier 路径解析器
- [x] Step 4: Claude Code Hook 安装器
- [x] Step 5: Gemini CLI Hook 安装器
- [x] Step 6: OpenCode Plugin 安装器
- [ ] Step 7: OpenClaw Hook 安装器
- [x] Step 8: Codex Notifier（TOML notify 字段）
- [ ] Step 9: Notifier Registry
- [ ] Step 10: `pew notify` CLI 命令
- [ ] Step 11: `pew init` CLI 命令

### 当前状态

- 当前进行中：Step 7
- 参考来源：`~/workspace/personal/vibeusage` 的安装器与插件生成逻辑可复用；Coordinator/notify 并发模型按本计划重写
- 提交策略：按步骤原子化提交，每完成一块同步更新本节

## 概述

本计划覆盖架构计划（`docs/10`）中 **Layer 1（Trigger Layer）** 和 **Layer 2（Coordinator Layer）** 的完整实现，加上 5 个 AI 工具的 hook/plugin 安装器和两个新 CLI 命令。

**实现范围**：Trigger + Coordinator + 5 个 Notifier + CLI 命令
**不在范围内**：Discovery/Plan Layer、Source Registry、Queue/State 改造、Run Log — 后续阶段实现

### 核心原则

1. **纯 DI**：所有模块通过 options 对象注入依赖（fs 操作、spawn、路径），测试不依赖真实文件系统
2. **安全优先**：所有配置写入前创建 `.bak` 备份；卸载前验证 marker，不会误删用户配置
3. **幂等**：重复安装不改变已正确的配置；重复 notify 被跨进程 file-lock + O_APPEND signal 合并
4. **零阻塞**：notify.cjs 和所有 hook 回调始终 exit 0，不阻塞 AI 工具

### 已知局限

本计划在现有 at-most-once sync 语义之上接入自动触发。`docs/10` 已明确指出当前"先保存 cursor，再写 queue"的语义在进程崩溃时会丢失增量数据。这个问题在 hook 驱动下仍然存在，但影响被两个因素缓解：

1. **增量窗口更窄**：hook 驱动的触发频率远高于手动 `pew sync`，每次增量数据量更小，单次崩溃丢失的数据更少
2. **vibeusage 生产验证**：相同的 at-most-once + hook 驱动架构在 vibeusage 中已稳定运行

Queue/State 语义改造（staged commit + cursor-after-queue）将在后续阶段独立实施，与 notifier 层正交。本计划不会使数据丢失风险变得比当前手动 `pew sync` 更差。

## 文件清单

```
packages/core/src/types.ts                          # 新增 notifier 类型
packages/cli/src/notifier/coordinator.ts            # Coordinator（file-lock + signal + dirty follow-up）
packages/cli/src/notifier/notify-handler.ts         # notify.cjs 生成器
packages/cli/src/notifier/paths.ts                  # 统一 notifier 路径解析器
packages/cli/src/notifier/claude-hook.ts            # Claude Code hook 安装器
packages/cli/src/notifier/gemini-hook.ts            # Gemini CLI hook 安装器
packages/cli/src/notifier/opencode-plugin.ts        # OpenCode plugin 安装器
packages/cli/src/notifier/openclaw-hook.ts          # OpenClaw session plugin 安装器
packages/cli/src/notifier/codex-notifier.ts         # Codex TOML notify 安装器
packages/cli/src/notifier/registry.ts               # Notifier 注册表
packages/cli/src/commands/notify.ts                 # pew notify 命令
packages/cli/src/commands/init.ts                   # pew init 命令
packages/cli/src/__tests__/coordinator.test.ts      # Coordinator 测试
packages/cli/src/__tests__/notify-handler.test.ts   # notify-handler 测试
packages/cli/src/__tests__/notifier-paths.test.ts   # 路径解析器测试
packages/cli/src/__tests__/claude-hook.test.ts      # Claude hook 测试
packages/cli/src/__tests__/gemini-hook.test.ts      # Gemini hook 测试
packages/cli/src/__tests__/opencode-plugin.test.ts  # OpenCode plugin 测试
packages/cli/src/__tests__/openclaw-hook.test.ts    # OpenClaw hook 测试
packages/cli/src/__tests__/codex-notifier.test.ts   # Codex notifier 测试
packages/cli/src/__tests__/registry.test.ts         # Registry 测试
packages/cli/src/__tests__/notify-command.test.ts   # pew notify 命令测试
packages/cli/src/__tests__/init-command.test.ts     # pew init 命令测试
```

---

## Step 1: 核心类型

**文件**：`packages/core/src/types.ts`（追加）

```ts
// ---------------------------------------------------------------------------
// Notifier / Trigger types
// ---------------------------------------------------------------------------

/** Trigger that initiates a sync cycle */
export type SyncTrigger =
  | { kind: "manual"; command: string }
  | { kind: "notify"; source: Source; fileHint?: string | null }
  | { kind: "startup" }
  | { kind: "scheduled" };

/** Result of a single Coordinator run */
export interface CoordinatorRunResult {
  /** Unique ID for this run (ISO timestamp + random suffix) */
  runId: string;
  /** Triggers that were coalesced into this run */
  triggers: SyncTrigger[];
  /** Whether a follow-up run was triggered by dirty signal */
  hadFollowUp: boolean;
  /** Whether this process had to wait for another sync to finish before acquiring the lock */
  waitedForLock: boolean;
  /** Whether sync was skipped because a previous follow-up already consumed the signal (waiter dedup) */
  skippedSync: boolean;
  /** Error message if the run failed (includes lock timeout) */
  error?: string;
}

/** Status of a notifier hook/plugin for a specific source */
export type NotifierStatus = "installed" | "not-installed" | "outdated" | "error";

/** Result of a notifier install/uninstall operation */
export interface NotifierOperationResult {
  source: Source;
  action: "install" | "uninstall" | "skip";
  /** Whether the config was actually changed */
  changed: boolean;
  /** Human-readable detail */
  detail: string;
  /** Path to backup file if one was created */
  backupPath?: string;
  /** Warning messages (non-fatal) */
  warnings?: string[];
}
```

**提交信息**：`feat: add notifier and coordinator types to @pew/core`

**不新增的类型说明**：

- `NotifierDriver` 接口定义在 `packages/cli/src/notifier/` 内部，不放 `@pew/core`（因为它依赖 Node.js fs 操作的 options 注入，不适合纯类型包）
- `CoordinatorOptions` 也是内部类型

---

## Step 2: Coordinator（跨进程 file-lock + signal 文件）

**文件**：`packages/cli/src/notifier/coordinator.ts`

### 职责

Coordinator 是**跨进程**的互斥调度器，通过文件锁 + 信号文件实现 mutex 和 dirty follow-up。不负责任何业务逻辑。

### 设计原理

`pew notify` 是短命进程 — 每次 hook 触发 spawn 一个新的。进程内 Coordinator 在这个场景下毫无意义：不存在"运行中收到第二个 trigger"。因此并发控制必须跨进程：

1. **文件锁 (`sync.lock`)**：保证同一时刻只有一个 sync 在执行
2. **信号文件 (`notify.signal`)**：每次 notify 通过 `O_APPEND` 追加一个 `\n`（1 byte），无 read-modify-write
3. **dirty follow-up**：持锁者在 sync 前截断 signal（在锁保护下安全重置）；sync 完成后检查 signal size > 0 则补跑
4. **blocking handoff + waiter dedup**：拿锁失败的进程不 exit，而是 append signal 后阻塞等锁（blocking flock），拿到锁后检查 signal size — 如果为 0（前一个 follow-up 已消化），直接释放锁退出（避免 N 个 waiter 串行跑 N 次冗余 sync）；如果 > 0，自己跑 sync

> **为什么用 O_APPEND 而非计数器或 mtime**：
> - mtime 精度在某些文件系统（HFS+、FAT32）只到秒，同秒内的 notify 会被漏掉
> - read-modify-write 计数器在多进程并发时不是原子的 — 两个进程同时读到 "5" 都写 "6"，丢一次递增
> - POSIX 保证 `O_APPEND` + `write()` 对 ≤ PIPE_BUF（4096 bytes）的数据是原子的。每次追加 1 byte `\n`，绝对不会丢写入
>
> **为什么失败方阻塞等锁而非 exit**：
> 如果失败方 append signal 后 exit 0，在 "持锁者最后一次 check dirty → truncate → unlock" 窗口中插入的 append 会被截断吞掉，且没有任何存活进程会在锁释放后接手。让失败方阻塞等锁保证总有一个进程为最后的 notify 负责。notify.cjs 是 detached spawn `pew notify`，不阻塞 AI 工具。
>
> **为什么 waiter 拿到锁后要检查 signal size（waiter dedup）**：
> 如果 N 个 waiter 都在阻塞等锁，它们会依次获取锁。第一个 waiter 拿到锁后跑 sync + follow-up，follow-up 已经消化了所有 pending 的 signal。后续 waiter 拿到锁时 signal 为空，说明没有新的数据需要 sync，直接退出即可。没有 dedup 的话，N 个 waiter 会串行跑 N 次冗余 sync。
>
> **为什么超时必须 fd.close()**：
> `withTimeout` 只 reject Promise，不取消底层的 `fd.lock()` 系统调用。如果不 close fd，挂起的 lock() 可能在超时后获取到锁 — 但此时进程已认为自己失败退出，没有人会释放这把锁（ghost waiter），导致后续所有 `pew notify` 都 timeout。`fd.close()` 关闭文件描述符，内核自动释放关联的 flock。

### 核心接口

```ts
interface CoordinatorOptions {
  /** State directory for lock and signal files */
  stateDir: string;
  /** The actual sync function to execute */
  executeSyncFn: (triggers: SyncTrigger[]) => Promise<void>;
  /** Clock function for testability. Default: Date.now */
  now?: () => number;
  /** Injected fs operations for testability */
  fs?: {
    open: typeof import("node:fs/promises").open;
    stat: typeof import("node:fs/promises").stat;
    appendFile: typeof import("node:fs/promises").appendFile;
    writeFile: typeof import("node:fs/promises").writeFile;
    mkdir: typeof import("node:fs/promises").mkdir;
  };
  /** Maximum follow-up rounds to prevent infinite loops. Default: 3 */
  maxFollowUps?: number;
  /** Timeout for blocking lock acquisition (ms). Default: 60_000.
   *  If another sync is running, this process waits up to this long for the lock.
   *  On timeout, returns a result with error (does not run sync). */
  lockTimeoutMs?: number;
}

/**
 * Execute a coordinated sync run with cross-process mutex + dirty follow-up.
 *
 * - If the lock is free: acquire, run sync, check dirty, follow-up as needed.
 * - If the lock is held: append signal, blocking-wait for lock (up to lockTimeoutMs),
 *   then run sync ourselves.
 * - Always returns a CoordinatorRunResult (never null).
 */
async function coordinatedSync(
  trigger: SyncTrigger,
  opts: CoordinatorOptions,
): Promise<CoordinatorRunResult>;
```

### 跨进程流程

```
notify.cjs (hook callback):
  1. O_APPEND 追加 "\n" 到 notify.signal（原子写，无 read-modify-write）
  2. detached spawn: pew notify --source=xxx
  3. exit 0（立即返回，不阻塞 AI 工具）

pew notify --source=xxx:
  1. 尝试 flock(sync.lock, LOCK_EX | LOCK_NB)
     ├── 成功（immediate locker）→ 跳到步骤 2
     └── 失败 (EAGAIN) → append "\n" 到 signal 确保 dirty
                        → flock(sync.lock, LOCK_EX)（阻塞等锁，最多 lockTimeoutMs）
                        → 拿到锁 → 跳到步骤 1b
                        → 超时 → fd.close() 取消挂起锁 → 返回 result with error，不跑 sync
  1b. Waiter deduplication（仅阻塞等锁后执行）:
      stat(notify.signal).size == 0？
      ├── 是 → 前一个持锁者的 follow-up 已消化此 notify → 释放锁，exit 0（skippedSync: true）
      └── 否 → 跳到步骤 2
  2. 截断 signal 文件为空（在持锁保护下，安全重置）
  3. 执行 sync
  4. stat(notify.signal).size > 0？（sync 期间有新 notify append 过？）
     ├── 是 → dirty follow-up：回到步骤 2（最多 maxFollowUps 轮）
     └── 否 → 释放锁，exit 0
```

### 状态机

```
pew notify 进程 A                    pew notify 进程 B
     │                                    │
     ▼                                    │
  flock(LOCK_NB) → 成功                   │
  (immediate locker)                      │
     │                                    │
     ▼                                    │
  truncate(signal) → 0 bytes              │
     │                                    ▼
     ▼                               flock(LOCK_NB) → EAGAIN
  执行 sync...                            │
     │                                    ▼
     │                              append "\n" → size 变为 1
     │                                    │
     │                                    ▼
     │                              flock(LOCK_EX) → 阻塞等待...
     ▼
  sync 完成
     │
     ▼
  stat(signal).size → 1 > 0？
     │
    是（进程 B append 过）
     │
     ▼
  dirty follow-up：truncate → sync → check...
     │
     ▼
  stat(signal).size → 0？
     │
    是（follow-up 已消化进程 B 的 notify）
     │
     ▼
  释放锁
     │                                    │
     │                                    ▼
     │                              flock 返回（拿到锁）
     │                                    │
     │                                    ▼
     │                              ★ waiter dedup: stat(signal).size → 0
     │                                    │
     │                                   是 → 前一个 follow-up 已消化
     │                                    │
     │                                    ▼
     │                              释放锁，exit 0（skippedSync: true）
     ▼
  exit 0
```

### 关键行为

| 场景 | 行为 |
|------|------|
| 首次 notify，无 sync 在跑 | 获取锁（immediate），截断 signal，执行 sync |
| sync 运行中，新 notify 到达 | 新进程获取锁失败 → append signal → 阻塞等锁 → 拿到锁后 waiter dedup check |
| waiter 拿到锁，signal size > 0 | 截断 signal，执行 sync |
| waiter 拿到锁，signal size == 0 | 前一个 follow-up 已消化 → 释放锁，exit 0（skippedSync: true） |
| sync 完成，signal size > 0 | dirty follow-up，截断 signal，再跑一轮 |
| sync 完成，signal size == 0 | 释放锁，正常退出 |
| sync 运行中，N 个 notify 到达 | 所有都 append + 阻塞等锁；持锁者 follow-up 消化 dirty；等锁者依次拿锁后 dedup check — signal 为空则直接退出，避免 N 次冗余 sync |
| follow-up 运行中又有 notify | 再检查一轮（最多 maxFollowUps 次） |
| sync 执行抛异常 | 捕获异常，记录 error，仍然检查 dirty follow-up |
| 文件锁获取异常（非 EAGAIN） | 记录 warning，直接执行 sync（降级为无锁） |
| 阻塞等锁超时（lockTimeoutMs） | fd.close() 取消挂起锁 → 返回 result with error，不跑 sync |

### 文件锁实现

```ts
// 使用 Node.js fs.open + FileHandle.lock() (Node 22+ / Bun)
// 不可用时降级为无锁执行（见备注）

const lockFile = join(stateDir, "sync.lock");
const fd = await fs.open(lockFile, "w");
let waitedForLock = false;
try {
  // 非阻塞尝试获取排他锁
  await fd.lock("exclusive", { nonBlocking: true });
} catch (err) {
  if (err.code === "EAGAIN" || err.code === "EWOULDBLOCK") {
    // 另一个进程持有锁 — append signal 确保 dirty
    await appendSignal(stateDir, fs);
    waitedForLock = true;
    // 阻塞等锁（最多 lockTimeoutMs）
    try {
      await withTimeout(fd.lock("exclusive"), lockTimeoutMs);
    } catch (timeoutErr) {
      // 超时 — 必须 fd.close() 取消挂起的 lock() Promise
      // 否则 lock() 可能后续获取成功 → ghost waiter 持有锁但无人释放
      await fd.close();
      return { ... error: "lock timeout", skippedSync: true };
    }
    // 拿到锁 — waiter dedup: 检查 signal 是否已被前一个 follow-up 消化
    const size = await readSignalSize(stateDir, fs);
    if (size === 0) {
      // 前一个持锁者的 follow-up 已经跑过了，无需再跑
      await fd.close();
      return { ... skippedSync: true, waitedForLock: true };
    }
    // signal 不为空，继续正常流程（truncate → sync → check dirty）
  } else {
    // 其他错误 — 降级为无锁执行
  }
}
```

### Signal 文件操作

```ts
const SIGNAL_PATH = join(stateDir, "notify.signal");

/**
 * Read the current signal file size.
 * Returns 0 if the file doesn't exist.
 */
async function readSignalSize(stateDir: string, fs: FsOps): Promise<number>;

/**
 * Append a single "\n" to the signal file (O_APPEND, atomic for ≤ PIPE_BUF).
 * Creates the file if it doesn't exist.
 */
async function appendSignal(stateDir: string, fs: FsOps): Promise<void>;

/**
 * Truncate the signal file to 0 bytes.
 * Called by the lock holder at the START of each sync run (under lock protection).
 * This resets the dirty baseline — any append during sync means size > 0.
 */
async function truncateSignal(stateDir: string, fs: FsOps): Promise<void>;
```

**备注**：Node.js `FileHandle.lock()` 在 v22+ 可用，Bun 也支持。pew 的主要运行时是 Bun，因此 `FileHandle.lock()` 是唯一锁实现。**不提供 mkdir-based 降级锁**——如果 `lock()` 不可用（极旧 Node 版本），`catch` 分支走"降级为无锁执行"路径（即直接执行 sync，不保证互斥，但不 crash）。这条路径已在测试矩阵 #8 覆盖。

### 测试矩阵（`coordinator.test.ts`）

| # | 测试用例 | 断言 |
|---|---------|------|
| 1 | 单次 trigger，锁空闲 | executeSyncFn 被调用 1 次，signal 被截断 |
| 2 | 锁被占用 → 阻塞等锁 → 拿到锁后跑 sync | executeSyncFn 被调用，返回 CoordinatorRunResult |
| 3 | sync 期间 signal 有 append（size > 0）| dirty follow-up，executeSyncFn 被调用 2 次 |
| 4 | sync 期间 signal 无 append（size == 0）| executeSyncFn 只调用 1 次 |
| 5 | 多轮 follow-up（每轮期间都有新 append）| executeSyncFn 调用 ≤ maxFollowUps+1 次 |
| 6 | 超过 maxFollowUps 上限 | 停止 follow-up，正常退出 |
| 7 | sync 失败后仍检查 dirty | executeSyncFn 抛异常，follow-up 仍执行 |
| 8 | 文件锁 API 异常（非 EAGAIN）| 降级无锁执行，result 有 warning |
| 9 | signal 文件不存在 | 不 follow-up（size == 0） |
| 10 | runId 格式正确 | ISO 时间戳 + 随机后缀 |
| 11 | 阻塞等锁超时 → fd.close() 取消挂起锁 | 返回 result with error + skippedSync: true，executeSyncFn 不被调用，fd 已关闭 |
| 12 | 截断发生在 sync 之前（持锁保护下） | truncate 在 executeSyncFn 之前被调用 |
| 13 | waiter dedup: 阻塞等锁后 signal size == 0 | executeSyncFn 不被调用，skippedSync: true，waitedForLock: true |
| 14 | waiter dedup: 阻塞等锁后 signal size > 0 | executeSyncFn 正常调用，skippedSync: false |

**提交信息**：`feat: add coordinator with file-lock mutex and signal-based dirty follow-up`

---

## Step 3: notify-handler（notify.cjs 生成器）

**文件**：`packages/cli/src/notifier/notify-handler.ts`

### 职责

1. **生成 `notify.cjs` 源码**：纯字符串生成，输出一个零依赖的 CommonJS 脚本
2. **写入 `notify.cjs` 到磁盘**：`~/.config/pew/bin/notify.cjs`

### notify.cjs 行为

所有 5 个 AI 工具的 hook/plugin 最终都调用这个脚本。它的职责是：

1. 解析 `--source=<source>` 参数
2. **追加信号** `~/.config/pew/notify.signal`（`O_APPEND` 写 `\n`，原子操作，用于 Coordinator dirty 检测）
3. detached spawn `<PEW_BIN> notify --source=<source>`
4. **对 Codex**：链式调用原始 notify（读取 `~/.config/pew/codex_notify_original.json`）
5. 始终 exit 0

**注意**：notify.cjs **不做 throttle**，也不做互斥。它只负责两件事：append signal + detached spawn `pew notify`，然后立即 exit 0（不阻塞 AI 工具）。所有并发控制发生在 `pew notify` 进程内——如果有 sync 在跑，`pew notify` 会 append signal 后**阻塞等锁**（blocking flock），拿到锁后执行 waiter dedup check，必要时自己跑 sync。notify.cjs 是 detached spawn，不受此阻塞影响。

### pew 运行时发现策略

notify.cjs 需要可靠地找到 `pew` 可执行文件。**在 `pew init` 时固化为绝对路径**：

```js
// notify.cjs（编译时注入）
const PEW_BIN = "/Users/nocoo/.bun/bin/pew";  // pew init 时解析的绝对路径
```

解析优先级（在 `pew init` 执行时）：
1. `process.argv[1]` 所在目录的 `pew` 二进制（如果 init 是通过 `pew init` 调用的）
2. `which pew` 的结果
3. 如果都找不到 → 报错退出 init，提示用户确保 pew 在 PATH

**fallback 链**（运行时，如果绝对路径不存在）：
1. 使用烤入的绝对路径 `PEW_BIN`
2. fallback 到 `npx @nocoo/pew notify`（最后手段，有冷启动开销）

验证：`pew init` 完成后，输出中打印实际使用的 pew 路径，方便用户确认。

### notify.cjs 源码模板要点

```js
#!/usr/bin/env node
// PEW_NOTIFY_HANDLER — Auto-generated, do not edit
"use strict";

const { appendFileSync, readFileSync, mkdirSync, existsSync } = require("fs");
const { join } = require("path");
const { spawn } = require("child_process");

const STATE_DIR = "<stateDir>";         // 编译时注入
const PEW_BIN = "<pewBinAbsolutePath>"; // 编译时注入

// 1. 解析 --source=xxx
const source = (process.argv.find(a => a.startsWith("--source=")) || "").split("=")[1];

// 2. O_APPEND 追加信号（原子写，无 read-modify-write 竞态）
try {
  mkdirSync(STATE_DIR, { recursive: true });
  appendFileSync(join(STATE_DIR, "notify.signal"), "\n");
} catch (_) {}

// 3. 找到 pew 并 detached spawn
const bin = existsSync(PEW_BIN) ? PEW_BIN : "npx";
const args = bin === PEW_BIN
  ? ["notify", "--source=" + source]
  : ["@nocoo/pew", "notify", "--source=" + source];
try {
  const child = spawn(bin, args, {
    detached: true, stdio: "ignore", env: { ...process.env }
  });
  child.unref();
} catch (_) {}

// 4. Codex 原始 notify 链式调用
if (source === "codex") {
  try {
    const orig = JSON.parse(readFileSync(join(STATE_DIR, "codex_notify_original.json"), "utf8"));
    if (orig.notify && Array.isArray(orig.notify) && orig.notify.length > 0) {
      // 排除自引用
      const isSelf = orig.notify.some(a => typeof a === "string" && a.includes("notify.cjs"));
      if (!isSelf) {
        const child = spawn(orig.notify[0], orig.notify.slice(1), {
          detached: true, stdio: "ignore"
        });
        child.unref();
      }
    }
  } catch (_) {}
}
```

### 接口

```ts
interface BuildNotifyHandlerOptions {
  /** State directory path to bake into the script */
  stateDir: string;
  /** Absolute path to pew binary, resolved at init time */
  pewBin: string;
}

/** Generate the notify.cjs source code string */
function buildNotifyHandler(opts: BuildNotifyHandlerOptions): string;

interface WriteNotifyHandlerOptions {
  /** Directory to write notify.cjs into (default: <stateDir>/bin/) */
  binDir: string;
  /** The source code to write */
  source: string;
  /** Injected fs operations for testability */
  fs?: { writeFile, mkdir, readFile };
}

/** Write notify.cjs to disk, returns { changed, path, backupPath? } */
async function writeNotifyHandler(opts: WriteNotifyHandlerOptions): Promise<{
  changed: boolean;
  path: string;
  backupPath?: string;
}>;

/** Resolve the absolute path to the pew binary */
async function resolvePewBin(): Promise<string>;
```

### 测试矩阵（`notify-handler.test.ts`）

| # | 测试用例 |
|---|---------|
| 1 | 生成的源码包含 PEW_NOTIFY_HANDLER marker |
| 2 | 生成的源码包含正确的 stateDir |
| 3 | 生成的源码包含正确的 pewBin 绝对路径 |
| 4 | 生成的源码是合法的 JS（`new Function()` 不抛异常） |
| 5 | 首次写入创建 bin 目录和文件 |
| 6 | 相同内容重复写入返回 changed=false |
| 7 | 内容变化时创建 backup |
| 8 | 生成的源码对 codex source 包含原始 notify 链式调用 |
| 9 | 生成的源码对非 codex source 不链式调用 |
| 10 | 生成的源码在 PEW_BIN 不存在时 fallback 到 npx |

**提交信息**：`feat: add notify.cjs handler generator`

---

## Step 3.5: 统一 Notifier 路径解析器

**文件**：`packages/cli/src/notifier/paths.ts`

### 职责

一次性解析所有 notifier 安装器需要的路径，统一处理环境变量。避免各安装器各自解析 env var 导致不一致。

### 接口

```ts
interface NotifierPaths {
  /** ~/.config/pew/ */
  stateDir: string;
  /** ~/.config/pew/bin/ */
  binDir: string;
  /** ~/.config/pew/bin/notify.cjs */
  notifyPath: string;
  /** ~/.config/pew/sync.lock */
  lockPath: string;
  /** ~/.config/pew/notify.signal */
  signalPath: string;

  // --- Claude Code ---
  /** ~/.claude/ */
  claudeDir: string;
  /** ~/.claude/settings.json */
  claudeSettingsPath: string;

  // --- Gemini CLI ---
  /** ~/.gemini/ (or $GEMINI_HOME) */
  geminiDir: string;
  /** ~/.gemini/settings.json */
  geminiSettingsPath: string;

  // --- OpenCode ---
  /** ~/.config/opencode/ (or $OPENCODE_CONFIG_DIR or $XDG_CONFIG_HOME/opencode) */
  opencodeConfigDir: string;
  /** ~/.config/opencode/plugin/ */
  opencodePluginDir: string;

  // --- OpenClaw ---
  /** ~/.openclaw/ (or $OPENCLAW_STATE_DIR) */
  openclawHome: string;
  /** ~/.openclaw/openclaw.json (or $OPENCLAW_CONFIG_PATH) */
  openclawConfigPath: string;
  /** ~/.config/pew/openclaw-plugin/ */
  openclawPluginDir: string;

  // --- Codex ---
  /** ~/.codex/ (or $CODEX_HOME) */
  codexHome: string;
  /** ~/.codex/config.toml */
  codexConfigPath: string;
  /** ~/.config/pew/codex_notify_original.json */
  codexNotifyOriginalPath: string;
}

/**
 * Resolve all notifier-related paths from home directory and environment variables.
 * Pure function: no I/O, only string manipulation.
 */
function resolveNotifierPaths(
  home: string,
  env?: Record<string, string | undefined>,
): NotifierPaths;
```

### 环境变量映射

| 环境变量 | 影响的路径 | 默认值 |
|---------|-----------|--------|
| `$GEMINI_HOME` | `geminiDir`, `geminiSettingsPath` | `~/.gemini` |
| `$OPENCODE_CONFIG_DIR` | `opencodeConfigDir`, `opencodePluginDir` | (see below) |
| `$XDG_CONFIG_HOME` | `opencodeConfigDir`（当 `$OPENCODE_CONFIG_DIR` 未设时） | `~/.config` |
| `$CODEX_HOME` | `codexHome`, `codexConfigPath` | `~/.codex` |
| `$OPENCLAW_STATE_DIR` | `openclawHome` | `~/.openclaw` |
| `$OPENCLAW_CONFIG_PATH` | `openclawConfigPath` | `~/.openclaw/openclaw.json` |

OpenCode 配置目录解析优先级：`$OPENCODE_CONFIG_DIR` > `$XDG_CONFIG_HOME/opencode` > `~/.config/opencode`

### 测试矩阵（`notifier-paths.test.ts`）

| # | 测试用例 |
|---|---------|
| 1 | 无环境变量 → 所有路径使用默认值 |
| 2 | $GEMINI_HOME 设置 → geminiDir 和 geminiSettingsPath 跟随 |
| 3 | $OPENCODE_CONFIG_DIR 设置 → opencodeConfigDir 和 opencodePluginDir 跟随 |
| 4 | $XDG_CONFIG_HOME 设置（无 $OPENCODE_CONFIG_DIR）→ opencode 路径跟随 |
| 5 | $OPENCODE_CONFIG_DIR 优先于 $XDG_CONFIG_HOME |
| 6 | $CODEX_HOME 设置 → codexHome 和 codexConfigPath 跟随 |
| 7 | $OPENCLAW_STATE_DIR 设置 → openclawHome 跟随 |
| 8 | $OPENCLAW_CONFIG_PATH 设置 → openclawConfigPath 跟随 |
| 9 | 纯函数：相同输入始终相同输出 |

**提交信息**：`feat: add unified notifier path resolver`

---

## Step 4: Claude Code Hook 安装器

**文件**：`packages/cli/src/notifier/claude-hook.ts`

### 配置文件

`~/.claude/settings.json`

### Hook 结构

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/usr/bin/env node ~/.config/pew/bin/notify.cjs --source=claude-code"
          }
        ]
      }
    ]
  }
}
```

### 标识方式

通过 command 字符串匹配。command 格式固定为 `/usr/bin/env node <notifyPath> --source=claude-code`。

### 接口

```ts
interface ClaudeHookOptions {
  /** Path to ~/.claude/settings.json */
  settingsPath: string;
  /** Path to notify.cjs */
  notifyPath: string;
  /** Injected fs operations */
  fs?: { readFile, writeFile, mkdir, copyFile, access };
}

function installClaudeHook(opts: ClaudeHookOptions): Promise<NotifierOperationResult>;
function uninstallClaudeHook(opts: ClaudeHookOptions): Promise<NotifierOperationResult>;
function getClaudeHookStatus(opts: ClaudeHookOptions): Promise<NotifierStatus>;
```

### 安装流程

1. 读取 `settings.json`（不存在则从 `{}` 开始）
2. 确保 `hooks.SessionEnd` 数组存在
3. 检查是否已有匹配 command 的 entry
4. 如已存在且结构正确 → `changed: false`
5. 如已存在但结构异常 → 修正（确保 `type: "command"`）
6. 如不存在 → append 新 entry
7. 写入前创建 `.bak.<timestamp>` 备份
8. 写入更新后的 JSON（2 space indent）

### 卸载流程

1. 读取 `settings.json`（不存在 → skip）
2. 过滤掉匹配 command 的 entry
3. 清理空的 `hooks` / `SessionEnd` 键
4. 备份 + 写入

### 安全措施

- 只匹配包含 `notify.cjs --source=claude-code` 的 command
- 永远不删除非 pew 的 hook entry
- 写入前备份

### 测试矩阵（`claude-hook.test.ts`）

| # | 测试用例 |
|---|---------|
| 1 | settings.json 不存在 → 创建新文件，安装 hook |
| 2 | settings.json 存在但无 hooks → 添加 hooks.SessionEnd |
| 3 | settings.json 已有其他 hook → 追加，不覆盖 |
| 4 | hook 已正确安装 → changed=false |
| 5 | hook 存在但 type 缺失 → 修正为 command |
| 6 | 卸载：移除匹配 entry，保留其他 |
| 7 | 卸载：settings 不存在 → skip |
| 8 | 卸载：清理空 hooks 对象 |
| 9 | status：已安装返回 installed |
| 10 | status：未安装返回 not-installed |
| 11 | 安装时创建 backup 文件 |

**提交信息**：`feat: add Claude Code hook installer`

---

## Step 5: Gemini CLI Hook 安装器

**文件**：`packages/cli/src/notifier/gemini-hook.ts`

### 配置文件

`~/.gemini/settings.json`（路径受 `$GEMINI_HOME` 影响，由 `resolveNotifierPaths` 统一解析）

### Hook 结构

```json
{
  "tools": { "enableHooks": true },
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "name": "pew-tracker",
            "type": "command",
            "command": "/usr/bin/env node ~/.config/pew/bin/notify.cjs --source=gemini-cli"
          }
        ],
        "matcher": "exit|clear|logout|prompt_input_exit|other"
      }
    ]
  }
}
```

### 与 Claude 的区别

| 方面 | Claude | Gemini |
|------|--------|--------|
| `tools.enableHooks` | 不需要 | **必须设为 true** |
| hook `name` 字段 | 无 | `"pew-tracker"` |
| `matcher` 字段 | 无 | `"exit\|clear\|logout\|prompt_input_exit\|other"` |
| 匹配方式 | command 字符串 | name **或** command |
| 配置目录 env var | 无 | `$GEMINI_HOME` |

### 接口

与 Claude 相同模式：`installGeminiHook` / `uninstallGeminiHook` / `getGeminiHookStatus`

Options 接收 `settingsPath` 和 `notifyPath`（由 `resolveNotifierPaths` 提供）。

### 安装流程

1. 读取 `settings.json`
2. **设置 `tools.enableHooks = true`**（Gemini 特有，否则 hook 不生效）
3. 确保 `hooks.SessionEnd` 数组存在
4. 匹配逻辑：检查 name 为 `"pew-tracker"` 或 command 包含 `notify.cjs --source=gemini-cli`
5. 存在 → 修正 name/type/command/matcher；不存在 → append
6. 备份 + 写入

### 测试矩阵（`gemini-hook.test.ts`）

| # | 测试用例 |
|---|---------|
| 1 | 全新安装（无 settings.json） |
| 2 | 已有 settings 但无 hooks → 添加 + 设置 enableHooks |
| 3 | 已有 enableHooks=false → 修正为 true |
| 4 | hook 已正确安装 → changed=false |
| 5 | 通过 name 匹配到旧 command → 更新 command |
| 6 | matcher 缺失 → 补充 |
| 7 | 卸载：移除匹配 entry |
| 8 | 卸载：不移除 enableHooks（可能有其他 hook 依赖） |
| 9 | status 检测 |

**提交信息**：`feat: add Gemini CLI hook installer`

---

## Step 6: OpenCode Plugin 安装器

**文件**：`packages/cli/src/notifier/opencode-plugin.ts`

### 机制

OpenCode 使用文件放置型插件（不修改 settings.json），将 JS 文件写入 plugin 目录。

### 配置目录

由 `resolveNotifierPaths` 统一解析：`$OPENCODE_CONFIG_DIR` > `$XDG_CONFIG_HOME/opencode` > `~/.config/opencode`

### 插件文件

路径：`<opencodePluginDir>/pew-tracker.js`

```js
// PEW_TRACKER_PLUGIN
const notifyPath = "<notifyPath>";
export const PewTrackerPlugin = async ({ $ }) => {
  return {
    event: async ({ event }) => {
      if (!event || event.type !== "session.updated") return;
      try {
        if (!notifyPath) return;
        const proc = $`/usr/bin/env node ${notifyPath} --source=opencode`;
        if (proc && typeof proc.catch === "function") proc.catch(() => {});
      } catch (_) {}
    }
  };
};
```

### 标识方式

文件内 `PEW_TRACKER_PLUGIN` marker 注释。

### 接口

```ts
interface OpenCodePluginOptions {
  /** Path to the plugin directory (from resolveNotifierPaths().opencodePluginDir) */
  pluginDir: string;
  /** Path to notify.cjs */
  notifyPath: string;
  /** Plugin filename (default: "pew-tracker.js") */
  pluginName?: string;
  /** Injected fs operations */
  fs?: { readFile, writeFile, mkdir, unlink, access };
}

function installOpenCodePlugin(opts: OpenCodePluginOptions): Promise<NotifierOperationResult>;
function uninstallOpenCodePlugin(opts: OpenCodePluginOptions): Promise<NotifierOperationResult>;
function getOpenCodePluginStatus(opts: OpenCodePluginOptions): Promise<NotifierStatus>;
```

### 安装流程

1. 生成插件源码（`buildOpenCodePlugin`）
2. 读取现有插件文件（不存在则为空）
3. 内容相同 → `changed: false`
4. 不同 → 备份现有文件，写入新内容
5. 创建 plugin 目录（如不存在）

### 卸载流程

1. 读取文件内容
2. 验证包含 `PEW_TRACKER_PLUGIN` marker
3. 不含 marker → 拒绝删除（`warnings: ["File does not contain pew marker"]`）
4. 含 marker → `unlink`

### 测试矩阵（`opencode-plugin.test.ts`）

| # | 测试用例 |
|---|---------|
| 1 | 全新安装（目录不存在） |
| 2 | 相同内容 → changed=false |
| 3 | 不同内容 → 备份 + 覆盖 |
| 4 | 卸载有 marker 的文件 |
| 5 | 拒绝卸载无 marker 的文件 |
| 6 | 卸载不存在的文件 → skip |
| 7 | status 检测 |
| 8 | 生成的插件源码合法 |

**提交信息**：`feat: add OpenCode plugin installer`

---

## Step 7: OpenClaw Hook 安装器

**文件**：`packages/cli/src/notifier/openclaw-hook.ts`

### 机制

OpenClaw 使用 session plugin，需要：
1. 写入 3 个文件到 plugin 目录
2. 通过 `openclaw plugins install --link` 和 `openclaw plugins enable` 注册

### 目录结构

```
~/.config/pew/openclaw-plugin/pew-session-sync/
├── package.json
├── openclaw.plugin.json
└── index.js
```

### 三个文件内容

**package.json**：
```json
{
  "name": "@pew/openclaw-session-sync",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "openclaw": { "extensions": ["./index.js"] }
}
```

**openclaw.plugin.json**：
```json
{
  "id": "pew-session-sync",
  "name": "Pew OpenClaw Session Sync",
  "description": "Trigger pew sync on OpenClaw agent/session lifecycle events.",
  "configSchema": { "type": "object", "additionalProperties": false, "properties": {} }
}
```

**index.js**：ESM 模块，监听 `agent_end` / `gateway_start` / `gateway_stop` 事件，spawn notify.cjs。

### 标识方式

Plugin ID `"pew-session-sync"` 在 `openclaw.json` 的 `plugins.entries` 中。

### 接口

```ts
interface OpenClawHookOptions {
  /** Directory to place plugin files (from resolveNotifierPaths().openclawPluginDir) */
  pluginBaseDir: string;
  /** Path to notify.cjs */
  notifyPath: string;
  /** Path to OpenClaw config (from resolveNotifierPaths().openclawConfigPath) */
  openclawConfigPath: string;
  /** Injected fs operations */
  fs?: { readFile, writeFile, mkdir, rm, access };
  /** Injected spawn for CLI commands */
  spawn?: (cmd: string, args: string[], opts?: object) => { status: number | null };
}

function installOpenClawHook(opts: OpenClawHookOptions): Promise<NotifierOperationResult>;
function uninstallOpenClawHook(opts: OpenClawHookOptions): Promise<NotifierOperationResult>;
function getOpenClawHookStatus(opts: OpenClawHookOptions): Promise<NotifierStatus>;
```

### 安装流程

1. 确保 plugin 目录存在
2. 写入 3 个文件（package.json、openclaw.plugin.json、index.js）
3. spawn `openclaw plugins install --link <pluginDir>`（30s timeout）
4. spawn `openclaw plugins enable pew-session-sync`
5. probe 状态确认安装成功
6. 任何 CLI 步骤失败 → 返回 warnings 但不 throw

### 卸载流程

1. 读取 `openclaw.json`
2. 从 `plugins.entries`、`plugins.load.paths`、`plugins.installs` 移除匹配条目
3. 写回配置
4. `rm -rf` plugin 目录

### 特殊考虑

- **`openclaw` CLI 可能不存在**：安装前先 `which openclaw`，不存在则 skip 并 warn
- **index.js 有自己的 15s throttle**：通过 `<stateDir>/openclaw.session-sync.trigger-state.json` 记录
- **环境变量传递**：index.js 将 agent_id、session_id、token counts 等通过环境变量传给 notify.cjs

### 测试矩阵（`openclaw-hook.test.ts`）

| # | 测试用例 |
|---|---------|
| 1 | 全新安装（mock spawn 成功） |
| 2 | openclaw CLI 不存在 → skip + warning |
| 3 | 文件已存在且相同 → changed=false |
| 4 | spawn install 失败 → warning 但不 throw |
| 5 | 卸载：清理配置 + 删除目录 |
| 6 | 卸载：配置不存在 → skip |
| 7 | status：检查 openclaw.json 中的 plugin 状态 |
| 8 | 生成的 index.js 包含正确的事件监听 |

**提交信息**：`feat: add OpenClaw session plugin installer`

---

## Step 8: Codex Notifier（TOML notify 字段）

**文件**：`packages/cli/src/notifier/codex-notifier.ts`

### 配置文件

`~/.codex/config.toml`（路径由 `resolveNotifierPaths` 统一解析，受 `$CODEX_HOME` 影响）

### Hook 结构

```toml
notify = ["/usr/bin/env", "node", "~/.config/pew/bin/notify.cjs", "--source=codex"]
```

**注意 `--source=codex` 参数**：这是必须的，否则 notify.cjs 无法判断调用源是 Codex，无法正确转发到 `pew notify --source=codex`，也无法区分何时链式调用原始 notify。

### 标识方式

`notify` 数组的精确值比较。

### 特殊机制：原始 notify 链式调用

Codex 的 `notify` 字段只能有一个值。如果用户已经配置了别的 notify（比如 vibeusage），pew 必须：

1. **保存原始 notify** 到 `~/.config/pew/codex_notify_original.json`
2. **替换为 pew 的 notify**（包含 `--source=codex`）
3. **在 notify.cjs 中链式调用原始 notify**（读取 backup JSON，spawn 原始命令）

卸载时：
1. 从 backup JSON 恢复原始 notify
2. 如果无 backup → 移除整个 notify 行

### 接口

```ts
interface CodexNotifierOptions {
  /** Path to config.toml (from resolveNotifierPaths().codexConfigPath) */
  configPath: string;
  /** Path to notify.cjs */
  notifyPath: string;
  /** Path to store original notify backup (from resolveNotifierPaths().codexNotifyOriginalPath) */
  originalBackupPath: string;
  /** Injected fs operations */
  fs?: { readFile, writeFile, copyFile, access };
}

function installCodexNotifier(opts: CodexNotifierOptions): Promise<NotifierOperationResult>;
function uninstallCodexNotifier(opts: CodexNotifierOptions): Promise<NotifierOperationResult>;
function getCodexNotifierStatus(opts: CodexNotifierOptions): Promise<NotifierStatus>;
```

### TOML 解析策略

**不引入 TOML 解析库**。使用与 vibeusage 相同的启发式行解析：

- `extractNotify(text)`：正则 `^\s*notify\s*=\s*(.*)` 匹配，支持单行和多行数组
- `setNotify(text, value)`：替换 `notify = ...` 行（或 block），保留文件其余内容
- `removeNotify(text)`：删除 `notify = ...` block
- `formatTomlStringArray(arr)`：`["a", "b", "c"]` 格式化

### 测试矩阵（`codex-notifier.test.ts`）

| # | 测试用例 |
|---|---------|
| 1 | config.toml 无 notify 行 → 插入（含 --source=codex） |
| 2 | config.toml 已有其他 notify → 保存原始 + 替换 |
| 3 | config.toml 已有 pew notify（含 --source=codex） → changed=false |
| 4 | 多行 TOML 数组格式处理 |
| 5 | 卸载：有原始 backup → 恢复 |
| 6 | 卸载：无原始 backup → 移除 notify 行 |
| 7 | config.toml 不存在 → skip |
| 8 | 原始 notify backup 只写一次（不覆盖） |
| 9 | status 检测 |
| 10 | 备份文件创建 |

**提交信息**：`feat: add Codex TOML notify installer`

---

## Step 9: Notifier Registry

**文件**：`packages/cli/src/notifier/registry.ts`

### 职责

注册表聚合 5 个安装器，提供统一查询和批量操作接口。Registry 接收 `NotifierPaths` 并负责将正确的路径分发给各安装器。

### 接口

```ts
/** A registered notifier driver */
interface NotifierDriver {
  source: Source;
  displayName: string;
  install(paths: NotifierPaths, fs?: object, spawn?: Function): Promise<NotifierOperationResult>;
  uninstall(paths: NotifierPaths, fs?: object, spawn?: Function): Promise<NotifierOperationResult>;
  status(paths: NotifierPaths, fs?: object): Promise<NotifierStatus>;
}

/** Registry API */
function getAllDrivers(): NotifierDriver[];
function getDriver(source: Source): NotifierDriver | undefined;
function installAll(paths: NotifierPaths, fs?: object, spawn?: Function): Promise<NotifierOperationResult[]>;
function uninstallAll(paths: NotifierPaths, fs?: object, spawn?: Function): Promise<NotifierOperationResult[]>;
function statusAll(paths: NotifierPaths, fs?: object): Promise<Record<Source, NotifierStatus>>;
```

每个 driver 的 `install()` 内部从 `NotifierPaths` 中提取自己需要的路径子集，调用对应安装器：

```ts
// 示例：Claude driver
const claudeDriver: NotifierDriver = {
  source: "claude-code",
  displayName: "Claude Code",
  async install(paths, fs) {
    return installClaudeHook({
      settingsPath: paths.claudeSettingsPath,
      notifyPath: paths.notifyPath,
      fs,
    });
  },
  // ...
};
```

### 注册的 5 个 driver

| Source | displayName | 安装器模块 |
|--------|------------|-----------|
| `claude-code` | Claude Code | `claude-hook.ts` |
| `gemini-cli` | Gemini CLI | `gemini-hook.ts` |
| `opencode` | OpenCode | `opencode-plugin.ts` |
| `openclaw` | OpenClaw | `openclaw-hook.ts` |
| `codex` | Codex | `codex-notifier.ts` |

### 测试矩阵（`registry.test.ts`）

| # | 测试用例 |
|---|---------|
| 1 | getAllDrivers 返回 5 个 driver |
| 2 | getDriver 按 source 查找 |
| 3 | getDriver 不存在的 source → undefined |
| 4 | installAll 调用所有 5 个 driver.install，传入正确的路径子集 |
| 5 | uninstallAll 调用所有 5 个 driver.uninstall |
| 6 | statusAll 返回 5 个 source 的状态 |
| 7 | 单个 driver 失败不影响其他 |

**提交信息**：`feat: add notifier registry`

---

## Step 10: `pew notify` CLI 命令

**文件**：`packages/cli/src/commands/notify.ts`

### 用途

这是 hook/plugin 回调的入口点。当 AI 工具的 hook 触发时，notify.cjs detached spawn `pew notify --source=<source>` 来执行实际的 sync。

### CLI 接口

```
pew notify --source=claude-code [--file=<path>]
```

| 参数 | 类型 | 必须 | 说明 |
|------|------|------|------|
| `--source` | string | 是 | AI 工具标识（`claude-code`, `codex`, `gemini-cli`, `opencode`, `openclaw`） |
| `--file` | string | 否 | 文件路径提示（未来 Plan Layer 可用于 targeted sync） |
| `--dev` | boolean | 否 | 使用 dev 环境 |

### 执行流程

```
pew notify --source=opencode
    │
    ▼
验证 --source 是合法的 Source
    │
    ▼
构建 SyncTrigger { kind: "notify", source, fileHint }
    │
    ▼
调用 coordinatedSync(trigger, opts)
    │
    ├── 获取文件锁成功 → 截断 signal → 执行 sync → check dirty follow-up
    ├── 获取文件锁失败 → append signal → 阻塞等锁 → 拿到锁后跑 sync
    ├── 阻塞等锁超时 → 返回 result with error
    └── 锁 API 异常 → 降级无锁执行
```

### 与 Coordinator 的关系

`pew notify` 直接调用 `coordinatedSync()` — 一个函数调用，不是进程内单例。Coordinator 的跨进程互斥通过文件锁实现：

- **互斥**：`sync.lock` 文件锁（flock）
- **dirty follow-up**：`notify.signal` 文件 size > 0 检查（O_APPEND 原子追加）
- **blocking handoff**：拿锁失败的进程阻塞等锁，拿到后自己跑 sync，保证零 lost wake-up
- **无 throttle**：不做时间窗口节流（由文件锁自然限流）

### execute 函数签名

```ts
interface NotifyOptions {
  source: Source;
  fileHint?: string;
  stateDir: string;
  // ... 所有 sync 需要的 DI 依赖（与 SyncOptions 相同）
}

async function executeNotify(opts: NotifyOptions): Promise<CoordinatorRunResult>;
```

### 测试矩阵（`notify-command.test.ts`）

| # | 测试用例 |
|---|---------|
| 1 | 有效 source，锁空闲 → 执行 sync |
| 2 | 有效 source，锁被占用 → 阻塞等锁 → 拿到锁后执行 sync |
| 3 | 无效 source → 报错退出 |
| 4 | sync 成功 → 返回 result 含 runId |
| 5 | sync 失败 → result.error 有值 |
| 6 | --file 参数透传到 trigger |
| 7 | dirty follow-up 执行 |
| 8 | 阻塞等锁超时 → result.error 有值 |

**提交信息**：`feat: add pew notify command`

---

## Step 11: `pew init` CLI 命令

**文件**：`packages/cli/src/commands/init.ts`

### 用途

一键安装所有 hook/plugin 并生成 notify.cjs。这是用户首次配置 pew 自动同步的入口。

### CLI 接口

```
pew init [--dry-run] [--source=<source>]
```

| 参数 | 类型 | 必须 | 说明 |
|------|------|------|------|
| `--dry-run` | boolean | 否 | 只预览，不实际修改 |
| `--source` | string | 否 | 只安装指定 source 的 hook（默认全部） |
| `--dev` | boolean | 否 | 使用 dev 环境 |

### 执行流程

```
pew init
    │
    ▼
1. 确保 stateDir 和 bin 目录存在
    │
    ▼
2. 解析 pew 绝对路径（resolvePewBin）
    │
    ▼
3. 解析所有 notifier 路径（resolveNotifierPaths）
    │
    ▼
4. 生成并写入 notify.cjs（烤入 stateDir + pewBin）
    │
    ▼
5. 遍历 registry，逐个安装 hook/plugin
    │   ├── Claude Code: upsert settings.json hook
    │   ├── Gemini CLI: upsert settings.json hook + enableHooks
    │   ├── OpenCode: 写入 plugin JS 文件
    │   ├── OpenClaw: 写入 3 文件 + CLI install/enable
    │   └── Codex: 修改 config.toml notify 字段
    │
    ▼
6. 汇总结果，输出安装报告（含 pew 路径）
```

### 输出格式

```
Pew Init — Installing notifier hooks

  pew binary: /Users/nocoo/.bun/bin/pew

  ✓ Claude Code    hook installed → ~/.claude/settings.json
  ✓ Gemini CLI     hook installed → ~/.gemini/settings.json
  ✓ OpenCode       plugin installed → ~/.config/opencode/plugin/pew-tracker.js
  ⚠ OpenClaw       openclaw CLI not found, skipped
  ✓ Codex          notify set → ~/.codex/config.toml

  notify.cjs → ~/.config/pew/bin/notify.cjs

Done! AI tools will now auto-sync token usage to Pew.
```

### dry-run 模式

```
pew init --dry-run

Pew Init — Dry Run (no changes will be made)

  pew binary: /Users/nocoo/.bun/bin/pew

  Claude Code    would install → ~/.claude/settings.json (exists)
  Gemini CLI     would install → ~/.gemini/settings.json (exists)
  OpenCode       would install → ~/.config/opencode/plugin/pew-tracker.js
  OpenClaw       openclaw CLI not found, would skip
  Codex          would install → ~/.codex/config.toml (exists)
```

### execute 函数签名

```ts
interface InitOptions {
  stateDir: string;
  home: string;
  env?: Record<string, string | undefined>;
  dryRun?: boolean;
  sources?: Source[];  // 为空则安装全部
  /** Injected fs and spawn */
  fs?: object;
  spawn?: Function;
  /** Override pew binary resolution for testing */
  pewBin?: string;
  /** Progress callback */
  onProgress?: (event: InitProgressEvent) => void;
}

interface InitResult {
  /** Resolved pew binary path */
  pewBin: string;
  notifyHandler: { changed: boolean; path: string };
  hooks: NotifierOperationResult[];
}

async function executeInit(opts: InitOptions): Promise<InitResult>;
```

### 测试矩阵（`init-command.test.ts`）

| # | 测试用例 |
|---|---------|
| 1 | 全新安装（5 个 hook 全部成功） |
| 2 | 部分 source 已安装 → 跳过已安装的 |
| 3 | dry-run 模式 → 不写入任何文件 |
| 4 | --source 过滤 → 只安装指定 source |
| 5 | 创建 stateDir 和 bin 目录 |
| 6 | notify.cjs 已存在且相同 → 不覆盖 |
| 7 | 单个 hook 失败不影响其他 |
| 8 | 结果包含所有 5 个 source 的状态 |
| 9 | 结果包含解析的 pewBin 路径 |
| 10 | pewBin 解析失败 → 报错，不继续安装 |

**提交信息**：`feat: add pew init command with hook installation`

---

## 提交顺序与依赖关系

```
Step 1: core types
    │
    ▼
Step 2: coordinator (file-lock + signal) ─────────┐
    │                                               │
    ▼                                               │
Step 3: notify-handler                              │
    │                                               │
    ▼                                               │
Step 3.5: notifier paths resolver                   │
    │                                               │
    ├──────┬──────┬──────┬──────┐                   │
    ▼      ▼      ▼      ▼      ▼                  │
  Step4  Step5  Step6  Step7  Step8                 │
 (claude)(gemini)(opencode)(openclaw)(codex)        │
    │      │      │      │      │                   │
    └──────┴──────┴──────┴──────┘                   │
                  │                                  │
                  ▼                                  │
             Step 9: registry                        │
                  │                                  │
                  ├──────────────────────────────────┘
                  ▼
           Step 10: pew notify
                  │
                  ▼
           Step 11: pew init
```

**依赖说明**：
- Step 3.5（路径解析器）是新增步骤，在安装器之前，提供统一路径
- Step 4-8（5 个安装器）可以并行开发，互不依赖，但都依赖 Step 3.5 的路径
- Step 9（registry）依赖 Step 4-8 + Step 3.5
- Step 10（notify 命令）依赖 Step 2（coordinator）
- Step 11（init 命令）依赖 Step 3（notify-handler）+ Step 3.5（paths）+ Step 9（registry）

---

## CLI 注册变更

### `packages/cli/src/cli.ts` 变更

新增两个 subCommand：

```ts
subCommands: {
  sync: syncCommand,
  status: statusCommand,
  login: loginCommand,
  notify: notifyCommand,   // 新增
  init: initCommand,       // 新增
}
```

### `packages/cli/src/__tests__/cli.test.ts` 回归变更

现有 smoke test 硬编码了 subcommand 数量，必须同步更新：

```ts
// cli.test.ts:26 — 现有断言
expect(names).toHaveLength(3);
// 改为：
expect(names).toHaveLength(5);

// cli.test.ts:16-24 — 现有 "should register all subcommands" 测试
// 追加：
expect(names).toContain("notify");
expect(names).toContain("init");
```

**重要**：这个变更必须和 Step 10/11（添加 subcommand）一起提交，否则 CI 会红。

### `packages/cli/src/utils/paths.ts` 变更

新增 `binDir` 和 `notifyPath`（基础路径，不含 env var 解析 — 完整 notifier 路径由 `notifier/paths.ts` 处理）：

```ts
return {
  // ... 现有路径
  /** Pew bin directory: ~/.config/pew/bin/ */
  binDir: join(home, ".config", "pew", "bin"),
  /** notify.cjs path: ~/.config/pew/bin/notify.cjs */
  notifyPath: join(home, ".config", "pew", "bin", "notify.cjs"),
};
```

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| hook 写入破坏用户 settings.json | 用户丢失 AI 工具配置 | 所有写入前创建 `.bak` 备份；JSON 解析失败 → 不写入 |
| TOML 启发式解析不够健壮 | Codex notify 设置错误 | 测试覆盖单行/多行/嵌套场景；保存原始值用于恢复 |
| `openclaw` CLI 版本变化 | 安装失败 | spawn 有 timeout；失败只 warn 不 throw |
| pew 二进制路径变化 | hook 触发后 sync 不执行 | init 时固化绝对路径 + npx fallback；输出中打印路径方便验证 |
| 跨进程并发 sync | 状态竞争 | 文件锁（flock）保证互斥；O_APPEND signal 原子追加保证不丢 notify |
| flock 在某些文件系统不可靠（NFS） | 锁失效 | state dir 通常在本地盘；若 lock() 不可用则降级为无锁执行 |
| at-most-once sync 语义下崩溃丢数据 | 少量 token 数据丢失 | 见"已知局限"章节；hook 驱动缩小增量窗口；后续阶段改 staged commit |

---

## 不做的事情（明确排除）

1. **不做 Plan Layer**：sync 仍然使用现有的全量扫描，不做 targeted sync
2. **不做 Source Registry**：source 能力仍然分散在各处，后续统一（`notifier/paths.ts` 只解决 notifier 路径，不是完整 registry）
3. **不改 Queue/Cursor 语义**：保持现有 at-most-once，后续改 staged commit
4. **不做 Run Log**：不写 `~/.config/pew/runs/<runId>.json`，后续补
5. **不做 Every Code**：pew 当前只支持 5 个 source，不支持 Every Code（vibeusage 特有）
6. **不做 OpenClaw legacy hook**：只支持新的 session plugin 模式
7. **不做 auth 集成**：init 不处理 login 流程，用户需先 `pew login`
