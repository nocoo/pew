# Hermes Agent 支持

> **编号**: 35  
> **状态**: 设计阶段  
> **创建时间**: 2026-04-08  
> **修订**: v3 - 简化为总量收集模式，接受时间/模型模糊性  
> **目标**: 为 pew 添加 Hermes Agent 的 token 总量统计支持

---

## 设计原则

### ✅ 接受的限制

1. **时间模糊性**: Token 时间戳使用 sync 时间，长会话有延迟可接受
2. **模型模糊性**: `/model` 切换时归因不准确可接受（session-level 归因）
3. **延迟同步**: 不追求实时，允许分钟级延迟
4. **本地只收集**: 不计算 pricing，只收集原始 token 数据

### ✅ 严格保证

1. **幂等性**: 重复同步产生相同结果
2. **总量准确**: Session 总 token 数必须准确
3. **增量正确**: Diff 计算不丢失、不重复

---

## 一、Hermes 数据模型分析

### 1.1 数据库结构

**Sessions 表** (`~/.hermes/state.db`):
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,              -- session_20260408_064634_0b0f4143
  model TEXT,                       -- claude-opus-4.6-1m (COALESCE 首次设置不变)
  started_at REAL NOT NULL,         -- Unix timestamp (session 开始时间)
  input_tokens INTEGER DEFAULT 0,   -- 累积值 (UPDATE ... + ?)
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  reasoning_tokens INTEGER DEFAULT 0,
  ...
);
```

**关键事实**:
- ✅ Token 字段是**累积值**（每次 turn 后 `UPDATE ... + delta`）
- ✅ 单行单 session（UPDATE 模式，非 INSERT 新行）
- ⚠️ `model` 字段首次设置后不变（`COALESCE(model, ?)`）
- ⚠️ `started_at` 是会话开始时间（不反映 token 产生时间）
- ❌ **没有 per-turn token 时间戳**（messages 表无 usage 数据）

---

### 1.2 核心挑战

#### 挑战 1: 时间戳缺失

**问题**: 
- `sessions.started_at` = 会话开始时间（固定）
- `messages.timestamp` 存在，但 `messages` 表无 token 数据
- **无法获取每次 token 增量的准确时间**

**解决方案**: 
- 用 **sync 执行时间** 作为 token 时间戳
- 所有 delta 记录到 sync 发生的半小时 bucket

**影响**:
- ⚠️ 长时间运行的会话，token 会被延迟记录
- 例如：会话从 10:00 开始，11:30 才 sync → 所有 token 记到 11:30

---

#### 挑战 2: Model 切换不可见

**问题**:
- 用户可在会话中 `/model claude-opus-4` 切换模型
- DB 的 `sessions.model` 字段**不会更新**（COALESCE 逻辑）
- 切换后的 token 仍被记到首个模型

**解决方案**:
- 接受 session-level model 归因
- 文档明确说明限制

**影响**:
- ⚠️ 混合模型会话的 token 全部归到首个模型
- 总量准确，但模型分布可能不准

---

#### 挑战 3: Diff 模型的幂等性

**问题**:
- 同一 session 的 token 持续累加
- 必须记录"上次已同步的值"，计算增量
- 重复同步不能重复计数

**解决方案**:
- Session-level diff cursor（下文详述）

---

## 二、Token 统计方案

### 2.1 数据源

**路径**: `$HERMES_HOME/state.db`（默认 `~/.hermes/state.db`）

**路径解析**:
```typescript
// packages/cli/src/utils/paths.ts
const hermesHome = normalizeEnvPath(env.HERMES_HOME) ?? join(home, ".hermes");
const hermesDbPath = join(hermesHome, "state.db");
```

**关键**: 必须支持 `HERMES_HOME` 环境变量（profile 隔离）

---

### 2.2 增量策略：Session-level Diff

**核心思想**: 
- 每个 session 存储"上次已知的 token 总量"
- 每次同步计算 `Delta = 当前值 - 上次值`
- 只上报非零 delta

**游标结构**:
```typescript
// packages/core/src/types.ts
export interface HermesSqliteCursor {
  /** Map of session_id → last known token totals */
  sessionTotals: Record<string, {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
  }>;
  /** DB file inode (detect file replacement) */
  inode: number;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
}
```

**CursorState 扩展**:
```typescript
export interface CursorState {
  version: 1;
  files: Record<string, FileCursor>;
  dirMtimes?: Record<string, number>;
  openCodeSqlite?: OpenCodeSqliteCursor;
  knownFilePaths?: Record<string, true>;
  knownDbSources?: Record<string, true>;
  hermesSqlite?: HermesSqliteCursor;  // 新增
  updatedAt: string | null;
}
```

---

### 2.3 Diff 计算逻辑

**SQL 查询** (无 WHERE 过滤，读所有 session):
```sql
SELECT 
  id,
  model,
  input_tokens,
  output_tokens,
  cache_read_tokens,
  cache_write_tokens,
  reasoning_tokens
FROM sessions
WHERE input_tokens > 0 OR output_tokens > 0  -- 过滤零值 session
ORDER BY id ASC
```

**Diff 计算**:
```typescript
for (const row of rows) {
  const sessionId = row.id;
  const last = cursor.sessionTotals[sessionId] || { input: 0, output: 0, ... };
  
  const delta = {
    inputTokens: Math.max(0, row.input_tokens - last.input),
    cachedInputTokens: Math.max(0, 
      (row.cache_read_tokens + row.cache_write_tokens) - 
      (last.cacheRead + last.cacheWrite)
    ),
    outputTokens: Math.max(0, row.output_tokens - last.output),
    reasoningOutputTokens: Math.max(0, row.reasoning_tokens - last.reasoning),
  };
  
  if (isAllZero(delta)) continue;  // 跳过零增量
  
  deltas.push({
    source: "hermes",
    model: row.model || "unknown",
    timestamp: new Date().toISOString(),  // 使用 sync 时间
    tokens: delta,
  });
  
  // 更新游标
  cursor.sessionTotals[sessionId] = {
    input: row.input_tokens,
    output: row.output_tokens,
    cacheRead: row.cache_read_tokens,
    cacheWrite: row.cache_write_tokens,
    reasoning: row.reasoning_tokens,
  };
}
```

**幂等性保证**:
- ✅ 同一 session 的值只在有增量时产生 delta
- ✅ 重复同步（值未变）产生零 delta，被过滤
- ✅ 游标持久化，下次从正确位置继续

---

### 2.4 字段映射

| Hermes 字段 | pew 字段 | 说明 |
|------------|---------|------|
| `input_tokens` | `inputTokens` | 直接映射 |
| `cache_read_tokens + cache_write_tokens` | `cachedInputTokens` | 两者相加（与 OpenCode 一致） |
| `output_tokens` | `outputTokens` | 直接映射 |
| `reasoning_tokens` | `reasoningOutputTokens` | 支持 reasoning |
| `new Date().toISOString()` | `timestamp` | ⚠️ **使用 sync 时间**（非会话时间） |
| `model` (session-level) | `model` | ⚠️ **会话首个模型**（可能不准） |

---

### 2.5 边缘场景处理

#### 场景 1: Session 被删除

**问题**: 游标中有，DB 中无

**处理**: 保留游标（不删除），不影响统计

**原因**: Session 可能临时不可见，保留游标避免下次重新全量计数

---

#### 场景 2: DB 文件替换

**问题**: 用户重建了 `state.db`（inode 变化）

**处理**: 清空游标，触发全量重扫

**实现**:
```typescript
const st = await stat(dbPath);
if (cursor.inode && cursor.inode !== st.ino) {
  // DB 文件被替换，清空游标
  cursor.sessionTotals = {};
  cursor.inode = st.ino;
}
```

---

#### 场景 3: Token 减少（异常）

**问题**: 新值 < 旧值（理论上不应发生）

**处理**: `Math.max(0, newValue - oldValue)` 确保非负

**结果**: 产生零 delta，被过滤

---

#### 场景 4: 游标丢失

**问题**: `cursors.json` 被删除或损坏

**处理**: 
- 检测 `knownDbSources.hermesSqlite` 存在但 cursor 为空
- 触发全量重扫（所有 session 产生全量 delta）
- 可能导致一次性重复计数（可接受的代价）

---

## 三、自动同步方案

### 3.1 Notifier 集成

**目标**: 复用现有 notifier/coordinator 架构，不引入新机制

**Hermes Plugin** (`~/.hermes/plugins/pew/__init__.py`):
```python
"""pew plugin — auto-trigger sync after each turn."""
import subprocess
import logging

logger = logging.getLogger("plugins.pew")

# 由 pew init 时注入绝对路径
PEW_BIN = "/usr/local/bin/pew"  # ← 实际安装时替换为 which pew 的结果

def _trigger_pew_notify(**kwargs):
    """Trigger pew notify (non-blocking, fire-and-forget)."""
    try:
        subprocess.Popen(
            [PEW_BIN, "notify", "--source=hermes"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )
        logger.debug("pew notify triggered")
    except Exception as e:
        logger.warning(f"pew notify failed: {e}")

def register(ctx):
    """Register post_llm_call hook."""
    ctx.register_hook("post_llm_call", _trigger_pew_notify)
```

**Plugin 元数据** (`plugin.yaml`):
```yaml
name: pew
version: 1.0.0
description: Auto-trigger pew sync after each conversation turn
author: pew
homepage: https://github.com/nocoo/pew
```

---

### 3.2 触发流程

```
Hermes post_llm_call hook
  → subprocess.Popen([PEW_BIN, "notify", "--source=hermes"])  # ← 使用注入的绝对路径
    → coordinator 检查 lockfile
    → coordinator 检查 cooldown（默认无，可配置）
    → 触发 pew sync
      → 解析 sessions diff
      → 上报到 SaaS
```

**关键特性**:
- ✅ 非阻塞（`Popen` 不等待）
- ✅ 使用绝对路径（install 时注入，避免 PATH 不完整）
- ✅ 复用 coordinator 的 trailing-edge 机制（多次触发合并）
- ✅ 复用 lockfile 防并发
- ✅ 可配置 cooldown（避免过度同步）

---

### 3.3 路径解析

**NotifierPaths 扩展**:
```typescript
// packages/cli/src/notifier/paths.ts
export interface NotifierPaths {
  // 现有字段...
  hermesHome: string;           // $HERMES_HOME 或 ~/.hermes
  hermesPluginDir: string;      // $hermesHome/plugins
}

export function resolveNotifierPaths(
  home: string,
  env: Record<string, string | undefined>,
): NotifierPaths {
  const hermesHome = normalizeEnvPath(env.HERMES_HOME) ?? join(home, ".hermes");
  
  return {
    // 现有字段...
    hermesHome,
    hermesPluginDir: join(hermesHome, "plugins"),
  };
}
```

---

### 3.4 Notifier Driver 实现

```typescript
// packages/cli/src/notifier/drivers/hermes.ts
export const HermesNotifierDriver: NotifierDriver = {
  source: "hermes",
  
  async install(paths: NotifierPaths): Promise<NotifierOperationResult> {
    const pluginDir = join(paths.hermesPluginDir, "pew");
    
    // 检查 hermesHome 是否存在
    if (!await exists(paths.hermesHome)) {
      return {
        source: "hermes",
        action: "skip",
        changed: false,
        detail: "Hermes not installed (no ~/.hermes directory)",
      };
    }
    
    // 获取 pew 可执行路径（复用现有 helper）
    const pewBin = await resolvePewBin();  // 已处理 argv[1]、which/where.exe、Windows shim
    
    // 创建插件目录
    await mkdir(pluginDir, { recursive: true });
    
    // 写入 plugin.yaml
    const yamlContent = buildPluginYaml();
    await writeFile(join(pluginDir, "plugin.yaml"), yamlContent);
    
    // 写入 __init__.py（注入 pew 绝对路径）
    const pyContent = buildPluginPython(pewBin);  // 注入 pew 命令路径
    await writeFile(join(pluginDir, "__init__.py"), pyContent);
    
    return {
      source: "hermes",
      action: "install",
      changed: true,
      detail: "Hermes plugin installed",
    };
  },
  
  async uninstall(paths: NotifierPaths): Promise<NotifierOperationResult> {
    const pluginDir = join(paths.hermesPluginDir, "pew");
    
    try {
      await rm(pluginDir, { recursive: true });
      return {
        source: "hermes",
        action: "uninstall",
        changed: true,
        detail: "Hermes plugin removed",
      };
    } catch (err) {
      if (err.code === "ENOENT") {
        return {
          source: "hermes",
          action: "skip",
          changed: false,
          detail: "Hermes plugin not found",
        };
      }
      throw err;
    }
  },
  
  async status(paths: NotifierPaths): Promise<NotifierStatus> {
    const pluginPath = join(paths.hermesPluginDir, "pew", "__init__.py");
    const content = await readFile(pluginPath, "utf8").catch(() => null);
    
    if (!content) return "not-installed";
    return content.includes("PEW_PLUGIN_MARKER") ? "installed" : "error";
  },
};
```

---

## 四、Source 类型系统性扩展

### 4.1 必须修改的文件

所有引用 `Source` 类型或 `VALID_SOURCES` 的地方：

**Core**:
```typescript
// packages/core/src/types.ts (第 20 行)
export type Source = ... | "hermes";

// packages/core/src/constants.ts (第 16 行)
export const SOURCES: readonly Source[] = Object.freeze([
  "claude-code",
  "codex",
  "gemini-cli",
  "opencode",
  "openclaw",
  "vscode-copilot",
  "copilot-cli",
  "hermes",  // ← 新增
] as const);
```

**CLI**:
```typescript
// packages/cli/src/cli.ts (第 42 行)
function isSource(value: string): value is Source {
  return [
    "claude-code",
    "codex",
    "gemini-cli",
    "opencode",
    "openclaw",
    "vscode-copilot",
    "copilot-cli",
    "hermes",  // ← 新增
  ].includes(value);
}
```

**Web API** (每个路由各自维护 VALID_SOURCES，必须逐个添加):
```typescript
// packages/web/src/app/api/usage/route.ts (第 21 行)
const VALID_SOURCES = new Set([
  "claude-code",
  "codex",
  "gemini-cli",
  "opencode",
  "openclaw",
  "vscode-copilot",
  "copilot-cli",
  "hermes",  // ← 新增
]);

// packages/web/src/app/api/sessions/route.ts (第 21 行)
const VALID_SOURCES = new Set([
  // ... 同上，添加 "hermes"
]);

// packages/web/src/app/api/projects/route.ts (第 14 行)
const VALID_SOURCES = new Set([
  // ... 同上，添加 "hermes"
]);

// packages/web/src/app/api/projects/[id]/route.ts (第 14 行)
const VALID_SOURCES = new Set([
  // ... 同上，添加 "hermes"
]);

// packages/web/src/app/api/users/[slug]/route.ts (第 28 行)
const VALID_SOURCES = new Set([
  // ... 同上，添加 "hermes"
]);
```

**Web 样式/配置**:
```typescript
// packages/web/src/lib/pricing.ts (第 105 行)
export const DEFAULT_SOURCE_DEFAULTS: Record<string, ModelPricing> = {
  "claude-code": { input: 3, output: 15, cached: 0.3 },
  // ...
  hermes: { input: 3, output: 15, cached: 0.3 },  // ← 新增
};

// packages/web/src/lib/palette.ts (第 72 行)
const AGENT_COLOR_MAP: Record<string, ChartColor> = {
  "claude-code": { color: chart.violet, token: "chart-1" },
  // ...
  hermes: { color: chart.acid, token: "chart-8" },  // ← 新增（复用 acid 绿，8色循环）
};
```

---

## 五、原子化提交计划

### Commit 1: Source 类型全局扩展 ✅

**范围**: 所有 Source 引用点（一次性完成，避免遗漏）

**状态**: 已完成（commit: feat(core,web,cli): add hermes to Source type globally）

**文件变更**:
```
M packages/core/src/types.ts          # Source union 添加 "hermes"
M packages/core/src/constants.ts      # SOURCES 数组添加 "hermes"
M packages/cli/src/cli.ts             # isSource() 添加 "hermes"
M packages/web/src/lib/pricing.ts     # DEFAULT_SOURCE_DEFAULTS 添加 hermes
M packages/web/src/lib/palette.ts     # AGENT_COLOR_MAP 添加 hermes
M packages/web/src/app/api/usage/route.ts        # VALID_SOURCES 添加 "hermes"
M packages/web/src/app/api/sessions/route.ts     # VALID_SOURCES 添加 "hermes"
M packages/web/src/app/api/projects/route.ts     # VALID_SOURCES 添加 "hermes"
M packages/web/src/app/api/projects/[id]/route.ts  # VALID_SOURCES 添加 "hermes"
M packages/web/src/app/api/users/[slug]/route.ts   # VALID_SOURCES 添加 "hermes"
```

**测试**:
```bash
bun run test packages/core
bun run build  # 确保 Web 编译通过
```

**Commit Message**:
```
feat(core,web,cli): add hermes to Source type globally

- Add "hermes" to Source union type (types.ts)
- Add to SOURCES runtime array (constants.ts)
- Add to CLI isSource() guard (cli.ts line 42)
- Add hermes pricing (conservative: $3/$15/$0.3)
- Add hermes color palette (acid green, chart-8)
- Update VALID_SOURCES in 5 Web API routes (usage/sessions/projects/users)

BREAKING CHANGE: Source type now includes "hermes"
```

---

### Commit 2: 路径解析与 sync 主链路集成 ✅

**范围**: Path resolution + sync orchestration

**状态**: 已完成（commit: feat(cli): add HERMES_HOME support and sync orchestration）

**文件变更**:
```
M packages/cli/src/utils/paths.ts
M packages/cli/src/notifier/paths.ts
M packages/cli/src/commands/sync.ts
M packages/cli/src/drivers/registry.ts
M packages/cli/src/__tests__/paths.test.ts
M packages/cli/src/__tests__/notifier-paths.test.ts
```

**变更内容**:
```typescript
// packages/cli/src/utils/paths.ts
export interface DefaultPaths {
  // ...
  hermesDbPath: string;  // 新增
}

// packages/cli/src/notifier/paths.ts
export interface NotifierPaths {
  // ...
  hermesHome: string;        // 新增
  hermesPluginDir: string;   // 新增
}

// packages/cli/src/commands/sync.ts
export interface SyncOptions {
  stateDir: string;
  deviceId: string;
  // ...
  hermesDbPath?: string;  // 新增（第 43 行后）
}

export interface SyncResult {
  totalDeltas: number;
  totalRecords: number;
  sources: {
    claude: number;
    // ...
    hermes: number;  // 新增（第 72 行）
  };
  filesScanned: {
    claude: number;
    // ...
    hermes: number;  // 新增（第 82 行）
  };
}

function sourceKey(source: Source): keyof SyncResult["sources"] {
  if (source === "claude-code") return "claude";
  // ...
  if (source === "hermes") return "hermes";  // 新增（第 94 行后）
  throw new Error(`Unknown source: ${source}`);
}

// packages/cli/src/drivers/registry.ts
export interface TokenDriverRegistryOpts {
  claudeDir?: string;
  // ...
  hermesDbPath?: string;  // 新增（第 63 行后）
}

export function createTokenDrivers(opts: TokenDriverRegistryOpts): TokenDriverSet {
  // ...
  if (opts.hermesDbPath) {
    dbDrivers.push(hermesTokenDriver);  // 新增（第 89 行后）
  }
  // ...
}
```

**测试**:
```bash
bun run test packages/cli/src/__tests__/paths.test.ts
bun run test packages/cli/src/__tests__/notifier-paths.test.ts
```

**Commit Message**:
```
feat(cli): add HERMES_HOME support and sync orchestration

- resolveDefaultPaths: add hermesDbPath (from HERMES_HOME or ~/.hermes)
- resolveNotifierPaths: add hermesHome, hermesPluginDir
- SyncOptions: add hermesDbPath field
- SyncResult: add hermes to sources/filesScanned maps
- sourceKey(): handle "hermes" source
- TokenDriverRegistryOpts: add hermesDbPath field
- createTokenDrivers(): register hermes DB driver when path present
- Honor HERMES_HOME env var (profile isolation)
- Add unit tests for HERMES_HOME override
```

---

### Commit 3: Hermes SQLite parser + session-level diff ✅

**范围**: Parser + diff cursor

**状态**: 已完成（commit: feat(cli): implement hermes SQLite parser with session-level diff）

**新增文件**:
```
A packages/cli/src/parsers/hermes-sqlite.ts
A packages/cli/src/__tests__/hermes-sqlite.test.ts
```

**变更文件**:
```
M packages/core/src/types.ts  (HermesSqliteCursor)
```

**核心逻辑**:
```typescript
// parseHermesDatabase()
// 1. 查询所有 session (WHERE input_tokens > 0)
// 2. 对每个 session 计算 diff
// 3. 过滤零 delta
// 4. 更新游标
```

**测试覆盖**:
- ✅ 首次同步（全量）
- ✅ 增量同步（只返回 delta）
- ✅ 无变化（返回空）
- ✅ 新 session 出现
- ✅ Session 删除（游标保留）
- ✅ DB inode 变化（重置）
- ✅ 游标丢失（全量重扫）
- ✅ Token 减少（Math.max 保护）

**Commit Message**:
```
feat(cli): implement hermes SQLite parser with session-level diff

- Query all sessions from state.db
- Diff current vs last known totals (per session)
- Store session-level cursor (sessionTotals map)
- Use sync time as timestamp (accept time fuzziness)
- Accept session-level model (accept model fuzziness)
- Add comprehensive unit tests (100% coverage)

Ref: similar to Gemini/OpenCode cumulative diff model
```

---

### Commit 4: Hermes token driver ✅

**范围**: Driver + registry integration

**状态**: 已完成（commit: feat(cli): implement hermes token driver）

**新增文件**:
```
A packages/cli/src/drivers/token/hermes-token-driver.ts
A packages/cli/src/__tests__/drivers/token/hermes-token-driver.test.ts
```

**变更文件**:
```
M packages/cli/src/drivers/registry.ts
```

**Commit Message**:
```
feat(cli): add hermes token driver

- Implement HermesTokenDriver (DB-based, session-level diff)
- Register in token driver registry
- Support hermesDbPath override
- Add driver unit tests
```

---

### Commit 5: Hermes notifier driver

**范围**: Notifier install/uninstall

**新增文件**:
```
A packages/cli/src/notifier/drivers/hermes.ts
A packages/cli/src/__tests__/notifier-drivers/hermes.test.ts
```

**变更文件**:
```
M packages/cli/src/notifier/registry.ts
```

**核心实现**:
- 复用 `resolvePewBin()` - 已处理 argv[1]、which/where.exe、Windows shim（notify-handler.ts:195）
- `buildPluginPython(pewBin: string)` - 注入绝对路径到 plugin
- `install()` - 创建 `~/.hermes/plugins/pew/`，注入 pew 绝对路径
- `uninstall()` - 删除插件目录
- `status()` - 检查 marker（与接口方法名一致）

**Commit Message**:
```
feat(cli): add hermes notifier driver

- Install pew plugin to $HERMES_HOME/plugins/pew/
- Plugin triggers `PEW_BIN notify --source=hermes` on post_llm_call
- Reuse resolvePewBin() from notify-handler.ts (no new helper needed)
- resolvePewBin() handles argv[1], which/where.exe, Windows shim
- buildPluginPython() takes pewBin not notifyPath (Python env needs pew CLI)
- Support HERMES_HOME override
- Add install/uninstall/status tests
```

---

### Commit 6: Integration tests

**范围**: E2E 流程测试

**新增文件**:
```
A packages/cli/src/__tests__/e2e/hermes-e2e.test.ts
```

**测试策略**:
```typescript
// 创建临时 SQLite DB
const tempDir = await mkdtemp(join(tmpdir(), "pew-hermes-"));
const stateDir = join(tempDir, ".config/pew");
const hermesHome = join(tempDir, ".hermes");
const dbPath = join(hermesHome, "state.db");
await mkdir(stateDir, { recursive: true });
await mkdir(hermesHome, { recursive: true });

// 插入测试数据
const db = new Database(dbPath);
db.exec(`CREATE TABLE sessions (...)`);
db.prepare(`INSERT INTO sessions VALUES (...)`).run(...);

// 第一次同步（全量）
const result1 = await executeSync({ 
  stateDir,
  deviceId: "test-device",
  hermesDbPath: dbPath,
});
expect(result1.sources.hermes).toBe(2);  // 2 sessions

// 修改 DB（模拟 token 增加）
db.prepare(`UPDATE sessions SET input_tokens = ? WHERE id = ?`).run(2000, "s1");

// 第二次同步（增量）
const result2 = await executeSync({ 
  stateDir,
  deviceId: "test-device",
  hermesDbPath: dbPath,
});
expect(result2.sources.hermes).toBe(1);  // 只有 1 个 delta

// 验证幂等性
const result3 = await executeSync({ 
  stateDir,
  deviceId: "test-device",
  hermesDbPath: dbPath,
});
expect(result3.sources.hermes).toBe(0);  // 无新增量
```

**Commit Message**:
```
test(cli): add hermes E2E integration tests

- Create temp SQLite DB with test sessions
- Test full sync pipeline (parse → diff → queue)
- Test cursor persistence and diff calculation
- Test idempotency (repeat sync returns zero delta)
- Test DB inode change (trigger rescan)
- Use temp dir (no real ~/.hermes dependency)
```

---

### Commit 7: 文档更新

**文件变更**:
```
M README.md
M docs/03-data-pipeline.md
M docs/05-token-accounting.md
A docs/35-hermes-support.md
M CHANGELOG.md
```

**README 章节**:
```markdown
### Supported AI Tools

- ✅ Claude Code
- ✅ Codex
- ✅ Gemini CLI
- ✅ OpenCode
- ✅ OpenClaw
- ✅ VS Code Copilot
- ✅ GitHub Copilot CLI
- ✅ **Hermes Agent** (with limitations, see docs/35)

#### Hermes Limitations

⚠️ **Time accuracy**: Token timestamps use sync time (may lag for long sessions)  
⚠️ **Model accuracy**: `/model` switching may cause misattribution (session-level only)  
⚠️ **No pricing**: Hermes token records don't calculate costs locally (server-side only)

See [docs/35-hermes-support.md](./docs/35-hermes-support.md) for details.
```

**Commit Message**:
```
docs: add hermes support documentation

- Update README with hermes + explicit limitations
- Add hermes to data pipeline docs (session-level diff model)
- Document field mappings and timestamp strategy
- Add design doc (docs/35-hermes-support.md)
- Update CHANGELOG

Limitations clearly stated: time/model fuzziness acceptable
```

---

## 六、文档化的限制与权衡

### 6.1 时间准确性

**限制**: Token 时间戳使用 sync 执行时间，非真实产生时间

**影响**:
- 长会话（跨多小时）的 token 会被延迟记录
- 小时级图表可能显示"尖峰"（大量 token 集中在 sync 时刻）

**示例**:
```
实际情况:
  10:00 - 用户开始会话，产生 1000 tokens
  10:30 - 继续对话，产生 500 tokens
  11:00 - 继续对话，产生 300 tokens
  11:30 - pew sync 触发

pew 记录:
  11:30 - 1800 tokens (全部记到这个时间点)
```

**缓解**:
- 建议用户设置较短的 sync 间隔（如 5 分钟 cron）
- Web UI 可添加 tooltip 说明 hermes 的时间特性

---

### 6.2 模型准确性

**限制**: `/model` 切换不更新 `sessions.model` 字段

**影响**:
- 混合模型会话的 token 全部归到首个模型
- 总量准确，但模型分布可能失真

**示例**:
```
实际情况:
  用户: hello (使用 claude-sonnet-4)
  用户: /model claude-opus-4
  用户: complex task (使用 claude-opus-4)

pew 记录:
  claude-sonnet-4: 所有 token
  claude-opus-4: 0 tokens
```

**缓解**:
- 文档明确说明此限制
- 大多数用户不频繁切换模型，影响有限

---

### 6.3 延迟同步

**限制**: 不追求实时，可能有分钟级延迟

**影响**:
- Dashboard 数据可能滞后
- 适合长期统计，不适合实时监控

**缓解**:
- 默认无 cooldown，每次 turn 后触发
- 用户可配置 cooldown 平衡频率与延迟

---

## 七、测试覆盖率

| 组件 | 目标 | 关键场景 |
|-----|-----|---------|
| Parser | 100% | 首次/增量/零delta/session删除/inode变化/游标丢失 |
| Driver | 100% | discover/parse/hermesDbPath覆盖 |
| Notifier Driver | 100% | install/uninstall/status/HERMES_HOME |
| Integration (E2E) | >95% | 完整流程 + 幂等性 |

---

## 八、时间估算

| Commit | 预计工时 | 累计 |
|--------|---------|-----|
| 1. Source 全局扩展 | 1.5h | 1.5h |
| 2. 路径解析 | 1h | 2.5h |
| 3. Parser + cursor | 3h | 5.5h |
| 4. Token driver | 1h | 6.5h |
| 5. Notifier driver | 2h | 8.5h |
| 6. Integration tests | 2h | 10.5h |
| 7. 文档 | 1.5h | 12h |

---

## 九、FAQ

### Q1: 为什么不 JOIN messages 表获取准确时间？

**A**: 
1. `messages` 表无 token 数据（只有 timestamp）
2. JOIN 10万+ messages 性能差
3. 仍然只能得到"最后一条消息时间"，不是"token 产生时间"
4. 复杂度高，收益低

### Q2: 为什么不读 JSONL 文件补充 model 信息？

**A**:
1. JSONL 可能被删除/压缩
2. 需维护双数据源（SQLite + JSONL）
3. 复杂度高，且大多数用户不切换模型
4. Session-level 归因对总量统计足够

### Q3: 幂等性如何保证？

**A**:
1. Diff cursor 存储每个 session 的上次值
2. 重复同步产生零 delta（被过滤）
3. 游标持久化，状态可恢复
4. E2E 测试验证幂等性

### Q4: 如果用户删除 cursors.json 会怎样？

**A**:
1. `knownDbSources` 检测到游标丢失
2. 触发全量重扫（所有 session 全量 delta）
3. 可能导致一次性重复计数
4. 可接受的代价（用户操作导致）

---

## 十、References

- Hermes 源码: `/Users/nocoo/workspace/reference/hermes-agent/`
- `hermes_state.py:412` - `update_token_counts()` 逻辑
- `hermes_state.py:41` - Sessions 表定义
- `hermes_constants.py:11` - `get_hermes_home()` 实现
- `run_agent.py` - `post_llm_call` hook 触发点

---

**End of Document**
