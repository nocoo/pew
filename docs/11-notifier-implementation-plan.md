# 11. Notifier 实现计划

## 概述

本计划覆盖架构计划（`docs/10`）中 **Layer 1（Trigger Layer）** 和 **Layer 2（Coordinator Layer）** 的完整实现，加上 5 个 AI 工具的 hook/plugin 安装器和两个新 CLI 命令。

**实现范围**：Trigger + Coordinator + 5 个 Notifier + CLI 命令
**不在范围内**：Discovery/Plan Layer、Source Registry、Queue/State 改造、Run Log — 后续阶段实现

### 核心原则

1. **纯 DI**：所有模块通过 options 对象注入依赖（fs 操作、spawn、路径），测试不依赖真实文件系统
2. **安全优先**：所有配置写入前创建 `.bak` 备份；卸载前验证 marker，不会误删用户配置
3. **幂等**：重复安装不改变已正确的配置；重复 notify 被 Coordinator 合并
4. **零阻塞**：notify.cjs 和所有 hook 回调始终 exit 0，不阻塞 AI 工具

## 文件清单

```
packages/core/src/types.ts                          # 新增 notifier 类型
packages/cli/src/notifier/coordinator.ts            # Coordinator（mutex + throttle + dirty follow-up）
packages/cli/src/notifier/notify-handler.ts         # notify.cjs 生成器
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
  /** Whether a follow-up run was triggered by dirty flag */
  hadFollowUp: boolean;
  /** Error message if the run failed */
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

## Step 2: Coordinator

**文件**：`packages/cli/src/notifier/coordinator.ts`

### 职责

Coordinator 是内存中的单例调度器，控制 sync 执行的并发和频率。不负责任何业务逻辑（不解析 token、不操作 cursor）。

### 核心接口

```ts
/** Coordinator configuration */
interface CoordinatorOptions {
  /** Minimum interval between sync runs (ms). Default: 20_000 */
  throttleMs?: number;
  /** The actual sync function to execute */
  executeSyncFn: (triggers: SyncTrigger[]) => Promise<void>;
  /** Clock function for testability. Default: Date.now */
  now?: () => number;
}

/** Coordinator public API */
interface Coordinator {
  /** Submit a trigger. Returns immediately. */
  trigger(t: SyncTrigger): Promise<CoordinatorRunResult | null>;
  /** Force a sync regardless of throttle. */
  forceRun(t: SyncTrigger): Promise<CoordinatorRunResult>;
  /** Check if a sync is currently running. */
  isRunning(): boolean;
  /** Shut down: wait for current run + follow-up to finish. */
  shutdown(): Promise<void>;
}
```

### 状态机

```
                    trigger()
                       │
                       ▼
             ┌─────────────────┐
             │  Is sync running? │
             └─────────────────┘
                 │           │
                No          Yes
                 │           │
                 ▼           ▼
          ┌──────────┐  ┌──────────┐
          │ Throttle  │  │ Set dirty│
          │ check     │  │ = true   │
          └──────────┘  └──────────┘
           │       │         │
        Passed   Blocked     │
           │       │         │
           ▼       ▼         │
        ┌──────┐ return      │
        │ RUN  │  null       │
        └──────┘             │
           │                 │
           ▼                 │
     Run complete            │
           │                 │
           ▼                 │
     ┌───────────┐           │
     │ dirty?    │◄──────────┘
     └───────────┘
       │       │
      Yes      No
       │       │
       ▼       ▼
   ┌──────┐  Done
   │ RUN  │  (return result)
   │ again│
   └──────┘
       │
       ▼
    Reset dirty
    Return result
```

### 关键行为

| 场景 | 行为 |
|------|------|
| 首次 trigger，无运行中 | 立即执行 sync |
| 20s 内重复 trigger，无运行中 | 节流跳过，返回 `null` |
| sync 运行中收到 trigger | 不启动新 sync，标记 `dirty = true` |
| sync 运行中收到 N 个 trigger | 只标记一次 `dirty`，triggers 被合并 |
| 当前 run 结束，`dirty = true` | 立即补一轮（无视 throttle），重置 dirty |
| 当前 run 结束，`dirty = false` | 正常返回，不补跑 |
| sync 执行抛异常 | 捕获异常，记录到 result.error，仍然检查 dirty follow-up |
| `forceRun()` | 无视 throttle，但仍然尊重 mutex（等待当前 run 结束） |

### 并发安全

- **不使用文件锁**：Coordinator 是进程内单例，用 Promise 链实现互斥
- **Promise 链模式**：维护一个 `runChain: Promise<void>`，每次新 run append 到链上
- **dirty follow-up 在锁内执行**：不释放锁就检查 dirty，避免 TOCTOU race

### 测试矩阵（`coordinator.test.ts`）

| # | 测试用例 | 断言 |
|---|---------|------|
| 1 | 单次 trigger | executeSyncFn 被调用 1 次，result.triggers 包含该 trigger |
| 2 | throttle 内重复 trigger | 第二次返回 null，executeSyncFn 只调用 1 次 |
| 3 | throttle 过期后 trigger | executeSyncFn 被调用 2 次 |
| 4 | sync 运行中收到 trigger | executeSyncFn 调用 2 次（原始 + follow-up），result.hadFollowUp = true |
| 5 | sync 运行中收到多个 trigger | follow-up 的 triggers 数组包含所有延迟的 trigger |
| 6 | sync 失败后检查 dirty | 仍然执行 follow-up |
| 7 | forceRun 无视 throttle | 即使在 throttle 窗口内也执行 |
| 8 | forceRun 等待当前 run | 不并行执行，串行等待 |
| 9 | shutdown 等待完成 | 等待当前 run + follow-up 完成后 resolve |
| 10 | isRunning 状态正确 | 运行中返回 true，结束后返回 false |

**提交信息**：`feat: add coordinator with mutex, throttle, and dirty follow-up`

---

## Step 3: notify-handler（notify.cjs 生成器）

**文件**：`packages/cli/src/notifier/notify-handler.ts`

### 职责

1. **生成 `notify.cjs` 源码**：纯字符串生成，输出一个零依赖的 CommonJS 脚本
2. **写入 `notify.cjs` 到磁盘**：`~/.config/pew/bin/notify.cjs`

### notify.cjs 行为

所有 5 个 AI 工具的 hook/plugin 最终都调用这个脚本。它的职责是：

1. 解析 `--source=<source>` 参数
2. 写入信号文件 `~/.config/pew/notify.signal`（调试用）
3. 检查 throttle（20s），读写 `~/.config/pew/sync.throttle` 文件
4. 如果未节流，spawn 一个 detached 子进程执行 `pew notify --source=<source>`
5. **对 Codex**：链式调用原始 notify（读取 `~/.config/pew/codex_notify_original.json`）
6. 始终 exit 0

### notify.cjs 源码模板要点

```js
#!/usr/bin/env node
// PEW_NOTIFY_HANDLER — Auto-generated, do not edit
"use strict";

const { writeFileSync, readFileSync, mkdirSync, existsSync, statSync } = require("fs");
const { join } = require("path");
const { spawn } = require("child_process");

const STATE_DIR = "<stateDir>";        // 编译时注入
const THROTTLE_MS = 20000;

// 1. 解析 --source=xxx
// 2. 写信号文件
// 3. throttle 检查
// 4. spawn pew notify --source=xxx（detached, stdio:ignore, unref）
// 5. codex 源：链式调用原始 notify
// 6. exit 0
```

**关键设计决策**：

- **不复制本地 runtime**：vibeusage 把整个包复制到 `~/.vibeusage/app/`，我们不需要这么做。pew 通过 npm 全局安装，notify.cjs 直接 spawn `pew` 命令（通过 `npx @nocoo/pew notify` 或找到全局安装路径）
- **CJS 格式**：因为要被各种 AI 工具的 hook 机制 spawn（`node <path>`），CJS 最兼容
- **Marker 注释**：第一行 `// PEW_NOTIFY_HANDLER`，用于安全卸载时的身份验证

### 接口

```ts
interface BuildNotifyHandlerOptions {
  /** State directory path to bake into the script */
  stateDir: string;
  /** Throttle interval in ms (default: 20_000) */
  throttleMs?: number;
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
```

### 测试矩阵（`notify-handler.test.ts`）

| # | 测试用例 |
|---|---------|
| 1 | 生成的源码包含 PEW_NOTIFY_HANDLER marker |
| 2 | 生成的源码包含正确的 stateDir |
| 3 | 生成的源码包含正确的 throttleMs |
| 4 | 生成的源码是合法的 JS（`new Function()` 不抛异常） |
| 5 | 首次写入创建 bin 目录和文件 |
| 6 | 相同内容重复写入返回 changed=false |
| 7 | 内容变化时创建 backup |

**提交信息**：`feat: add notify.cjs handler generator`

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

`~/.gemini/settings.json`（路径受 `$GEMINI_HOME` 影响）

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

OpenCode 使用文件放置型插件（不修改 settings.json），将 JS 文件写入 `~/.config/opencode/plugin/` 目录。

### 配置目录

`$OPENCODE_CONFIG_DIR` > `$XDG_CONFIG_HOME/opencode` > `~/.config/opencode`

### 插件文件

路径：`<configDir>/plugin/pew-tracker.js`

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
  /** Path to the plugin directory (e.g., ~/.config/opencode/plugin/) */
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
  /** Directory to place plugin files (e.g., ~/.config/pew/openclaw-plugin/) */
  pluginBaseDir: string;
  /** Path to notify.cjs */
  notifyPath: string;
  /** Path to OpenClaw config (e.g., ~/.openclaw/openclaw.json) */
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

`~/.codex/config.toml`（路径受 `$CODEX_HOME` 影响）

### Hook 结构

```toml
notify = ["/usr/bin/env", "node", "~/.config/pew/bin/notify.cjs"]
```

### 标识方式

`notify` 数组的精确值比较。

### 特殊机制：原始 notify 链式调用

Codex 的 `notify` 字段只能有一个值。如果用户已经配置了别的 notify（比如 vibeusage），pew 必须：

1. **保存原始 notify** 到 `~/.config/pew/codex_notify_original.json`
2. **替换为 pew 的 notify**
3. **在 notify.cjs 中链式调用原始 notify**（读取 backup JSON，spawn 原始命令）

卸载时：
1. 从 backup JSON 恢复原始 notify
2. 如果无 backup → 移除整个 notify 行

### 接口

```ts
interface CodexNotifierOptions {
  /** Path to config.toml */
  configPath: string;
  /** Path to notify.cjs */
  notifyPath: string;
  /** Path to store original notify backup (e.g., ~/.config/pew/codex_notify_original.json) */
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
| 1 | config.toml 无 notify 行 → 插入 |
| 2 | config.toml 已有其他 notify → 保存原始 + 替换 |
| 3 | config.toml 已有 pew notify → changed=false |
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

注册表聚合 5 个安装器，提供统一查询和批量操作接口。

### 接口

```ts
/** A registered notifier driver */
interface NotifierDriver {
  source: Source;
  displayName: string;
  install(opts: NotifierResolvedPaths): Promise<NotifierOperationResult>;
  uninstall(opts: NotifierResolvedPaths): Promise<NotifierOperationResult>;
  status(opts: NotifierResolvedPaths): Promise<NotifierStatus>;
}

/** Paths resolved for a specific environment */
interface NotifierResolvedPaths {
  /** ~/.config/pew/ */
  stateDir: string;
  /** ~/.config/pew/bin/notify.cjs */
  notifyPath: string;
  /** Home directory */
  home: string;
  /** Injected fs and spawn (for testability) */
  fs?: object;
  spawn?: Function;
}

/** Registry API */
function getAllDrivers(): NotifierDriver[];
function getDriver(source: Source): NotifierDriver | undefined;
function installAll(paths: NotifierResolvedPaths): Promise<NotifierOperationResult[]>;
function uninstallAll(paths: NotifierResolvedPaths): Promise<NotifierOperationResult[]>;
function statusAll(paths: NotifierResolvedPaths): Promise<Record<Source, NotifierStatus>>;
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
| 4 | installAll 调用所有 5 个 driver.install |
| 5 | uninstallAll 调用所有 5 个 driver.uninstall |
| 6 | statusAll 返回 5 个 source 的状态 |
| 7 | 单个 driver 失败不影响其他 |

**提交信息**：`feat: add notifier registry`

---

## Step 10: `pew notify` CLI 命令

**文件**：`packages/cli/src/commands/notify.ts`

### 用途

这是 hook/plugin 回调的入口点。当 AI 工具的 hook 触发时，notify.cjs spawn `pew notify --source=<source>` 来执行实际的 sync。

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
获取 Coordinator 单例
    │
    ▼
coordinator.trigger(trigger)
    │
    ├── 返回 result → 日志输出 runId
    └── 返回 null → 已节流，静默退出
```

### Coordinator 单例

`pew notify` 命令是短命进程（每次 hook 触发就 spawn 一次），所以 Coordinator 的 throttle 和 dirty 机制不是跨进程的。对于 `pew notify`：

- **进程内 Coordinator**：每次 `pew notify` 调用创建一个 Coordinator，执行一次 sync，退出
- **跨进程节流**：由 notify.cjs 的文件时间戳 throttle 处理（20s）
- **跨进程 mutex**：暂不实现文件锁（后续 tracker 常驻进程时再加）

当前阶段 `pew notify` 每次调用等同于执行一次完整 sync。Coordinator 在这里的价值主要是：
1. 提供统一的 `SyncTrigger` 数据结构
2. 为将来的常驻 tracker 进程预留接口
3. 生成 runId 用于日志

### execute 函数签名

```ts
interface NotifyOptions {
  source: Source;
  fileHint?: string;
  stateDir: string;
  // ... 所有 sync 需要的 DI 依赖
}

async function executeNotify(opts: NotifyOptions): Promise<CoordinatorRunResult>;
```

### 测试矩阵（`notify-command.test.ts`）

| # | 测试用例 |
|---|---------|
| 1 | 有效 source → 执行 sync |
| 2 | 无效 source → 报错退出 |
| 3 | sync 成功 → 返回 result 含 runId |
| 4 | sync 失败 → result.error 有值 |
| 5 | --file 参数透传 |

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
2. 生成并写入 notify.cjs
    │
    ▼
3. 遍历 registry，逐个安装 hook/plugin
    │   ├── Claude Code: upsert settings.json hook
    │   ├── Gemini CLI: upsert settings.json hook + enableHooks
    │   ├── OpenCode: 写入 plugin JS 文件
    │   ├── OpenClaw: 写入 3 文件 + CLI install/enable
    │   └── Codex: 修改 config.toml notify 字段
    │
    ▼
4. 汇总结果，输出安装报告
```

### 输出格式

```
Pew Init — Installing notifier hooks

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
  dryRun?: boolean;
  sources?: Source[];  // 为空则安装全部
  /** Injected fs and spawn */
  fs?: object;
  spawn?: Function;
  /** Progress callback */
  onProgress?: (event: InitProgressEvent) => void;
}

interface InitResult {
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

**提交信息**：`feat: add pew init command with hook installation`

---

## 提交顺序与依赖关系

```
Step 1: core types
    │
    ▼
Step 2: coordinator ──────────────────┐
    │                                  │
    ▼                                  │
Step 3: notify-handler                 │
    │                                  │
    ├──────┬──────┬──────┬──────┐      │
    ▼      ▼      ▼      ▼      ▼     │
  Step4  Step5  Step6  Step7  Step8    │
 (claude)(gemini)(opencode)(openclaw)(codex)
    │      │      │      │      │      │
    └──────┴──────┴──────┴──────┘      │
                  │                     │
                  ▼                     │
             Step 9: registry           │
                  │                     │
                  ├─────────────────────┘
                  ▼
           Step 10: pew notify
                  │
                  ▼
           Step 11: pew init
```

**依赖说明**：
- Step 4-8（5 个安装器）可以并行开发，互不依赖
- Step 9（registry）依赖 Step 4-8
- Step 10（notify 命令）依赖 Step 2（coordinator）和间接依赖 sync 基础设施
- Step 11（init 命令）依赖 Step 3（notify-handler）和 Step 9（registry）

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

### `packages/cli/src/utils/paths.ts` 变更

新增 notifier 相关路径：

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
| notify.cjs 中 `pew` 命令找不到 | hook 触发后 sync 不执行 | fallback 到 `npx @nocoo/pew notify`；在 init 输出中提示确保 pew 在 PATH |
| 跨进程并发 sync | 状态竞争 | 当前阶段由 notify.cjs 20s throttle 粗略控制；后续 tracker 常驻进程用文件锁 |

---

## 不做的事情（明确排除）

1. **不做 Plan Layer**：sync 仍然使用现有的全量扫描，不做 targeted sync
2. **不做 Source Registry**：source 能力仍然分散在各处，后续统一
3. **不改 Queue/Cursor 语义**：保持现有 at-most-once，后续改 staged commit
4. **不做 Run Log**：不写 `~/.config/pew/runs/<runId>.json`，后续补
5. **不做文件锁**：Coordinator 只做进程内互斥，跨进程锁后续加
6. **不做 Every Code**：pew 当前只支持 5 个 source，不支持 Every Code（vibeusage 特有）
7. **不做 OpenClaw legacy hook**：只支持新的 session plugin 模式
8. **不做 auth 集成**：init 不处理 login 流程，用户需先 `pew login`
