# Kosmos / PM Studio 支持

> **编号**: 36  
> **状态**: 已实现  
> **创建时间**: 2026-04-08  
> **目标**: 为 pew 添加 Kosmos 及其品牌变体 PM Studio 的 token 用量和会话统计支持

---

## 设计原则

### ✅ 严格保证

1. **数据准确性**: 使用 API 返回的真实 `usage`（`prompt_tokens` / `completion_tokens`），非本地估算
2. **幂等性**: 重复同步产生相同结果，消息 ID 去重保证不重复计数
3. **向后兼容**: 没有 `usage` 字段的旧消息自动跳过，不报错
4. **只读原则**: pew 绝不修改 Kosmos 的 chatSession 文件

### ✅ 接受的限制

1. **缓存 token 不可见**: GitHub Copilot API 不报告 `cached_input_tokens`，硬编码为 0
2. **推理 token 不可见**: 同上，`reasoning_output_tokens` 硬编码为 0
3. **无项目关联**: Kosmos 没有项目维度的概念，`projectRef` 始终为 `null`
4. **需要 Kosmos 升级**: 旧版 Kosmos（未合并 usage 持久化改动）产生的文件不包含 token 数据

---

## 一、Kosmos 数据模型分析

### 1.1 什么是 Kosmos

Kosmos 是基于 Electron + React 的桌面 AI 工作台，通过 GitHub Copilot API 统一调用多种模型（GPT-4.1, Claude, Gemini 等）。PM Studio 是 Kosmos 的品牌变体——同一套代码，不同 branding 配置，面向项目管理场景。

### 1.2 数据目录

平台特定路径，同时扫描两个 app 目录：

| 平台 | Kosmos | PM Studio |
|------|--------|-----------|
| macOS | `~/Library/Application Support/kosmos-app/` | `~/Library/Application Support/pm-studio-app/` |
| Windows | `%APPDATA%/kosmos-app/` | `%APPDATA%/pm-studio-app/` |
| Linux | `~/.config/kosmos-app/` | `~/.config/pm-studio-app/` |

### 1.3 文件结构

```
{dataDir}/profiles/{userAlias}/chat_sessions/
  {chatId}/
    index.json                           # Chat 级索引（不读）
    {YYYYMM}/
      index.json                         # 月度索引（不读）
      chatSession_{YYYYMMDDHHMMSS}.json  # ← pew 读这个
```

### 1.4 chatSession JSON 结构

```json
{
  "chatSession_id": "chatSession_20260306190225",
  "title": "Edge Mac DAU MoM Report Generation",
  "last_updated": "2026-03-06T11:07:49.933Z",
  "chat_history": [
    {
      "id": "msg_user_1772795023674_abc",
      "role": "user",
      "content": [{"type": "text", "text": "Generate the report..."}],
      "timestamp": 1772795023674
    },
    {
      "id": "msg_1772795028734_def",
      "role": "assistant",
      "content": [{"type": "text", "text": "I'll start by..."}],
      "timestamp": 1772795028734,
      "model": "claude-opus-4.6",
      "usage": {
        "prompt_tokens": 51117,
        "completion_tokens": 363,
        "total_tokens": 51480
      }
    },
    {
      "id": "tool_1772795028738_ghi",
      "role": "tool",
      "content": [{"type": "text", "text": "{...}"}],
      "tool_call_id": "call_1",
      "name": "load_skill",
      "timestamp": 1772795028738
    }
  ],
  "context_history": [...]
}
```

### 1.5 核心事实

- ✅ `usage` 和 `model` 字段仅存在于 `role: "assistant"` 的消息上
- ✅ `usage` 包含 API 返回的真实 token 计数（非本地估算）
- ⚠️ 文件是**全量重写**的（非 append-only），每次新增消息整个 JSON 被重写
- ⚠️ 旧版 Kosmos 产生的消息没有 `usage` / `model` 字段
- ❌ GitHub Copilot API 不报告 `cached_input_tokens` 和 `reasoning_tokens`

---

## 二、关键挑战与解决方案

### 挑战 1: Kosmos 不持久化 token 用量

**问题**:
- Kosmos 的 `agentChatStreamingService.ts` 已经从 SSE 流中提取了 `usage` 数据
- 但 `agentChatTurnRunner.ts` 只把 usage 传给 `BuddyManager.addXP()`（经验值系统）
- **未附加到 Message 对象上，也未写入磁盘**

**解决方案**: 修改 Kosmos 代码（4 个文件，+26 行）
- `Message` 接口新增可选 `usage` 和 `model` 字段
- Turn Runner 中将 `streamingResponse.usage` 附加到 `response` Message
- `/chat/completions` 请求添加 `stream_options: { include_usage: true }`

**影响**: 改动后的 Kosmos 新消息自动包含 usage + model，旧消息不受影响

---

### 挑战 2: 文件全量重写（非 append-only）

**问题**:
- Claude Code、OpenClaw 等工具使用 JSONL（逐行追加），可用字节偏移做增量
- Kosmos 每次新增消息后重写整个 `chatSession_*.json`
- 字节偏移策略不适用

**解决方案**: 消息 ID 去重

```typescript
export interface KosmosCursor extends FileCursorBase {
  processedMessageIds: string[];  // 已处理过的 assistant 消息 ID
}
```

- 快速跳过：`fileUnchanged(cursor, fingerprint)`（inode + mtime + size 三重校验）
- 文件变化时：全量读取 JSON，遍历所有 assistant 消息
- 跳过 `processedMessageIds` 中已有的 ID
- `buildCursor()` 合并旧 IDs + 新 IDs

---

### 挑战 3: 两个 API 端点的 usage 获取方式不同

**问题**:
- `/responses` 端点：`response.completed` 事件天然包含 `response.usage`
- `/chat/completions` 端点：streaming 模式默认不返回 usage

**解决方案**: 对 `/chat/completions` 添加 `stream_options: { include_usage: true }`

```typescript
// agentChatStreamingService.ts
} else {
  requestBody = {
    ...requestOptions,
    stream_options: { include_usage: true },
  };
}
```

> **注意**: 需验证 GitHub Copilot API 是否支持此选项。若不支持，`/responses` 端点的 usage 仍可正常工作。

---

## 三、Token 统计方案

### 3.1 字段映射

| Kosmos 字段 | pew 字段 | 说明 |
|------------|---------|------|
| `usage.prompt_tokens` | `inputTokens` | 直接映射 |
| _(不可用)_ | `cachedInputTokens` | 硬编码 `0`（GHC API 不报告） |
| `usage.completion_tokens` | `outputTokens` | 直接映射 |
| _(不可用)_ | `reasoningOutputTokens` | 硬编码 `0` |
| `model` | `model` | 直接映射（如 `"claude-opus-4.6"`） |
| `timestamp` (epoch ms) | `timestamp` | 转为 ISO 8601 |

### 3.2 解析逻辑

```typescript
// parsers/kosmos.ts
for (const msg of chatHistory) {
  if (msg.role !== "assistant") continue;     // 只处理 assistant 消息
  if (!msg.usage) continue;                   // 没有 usage 的旧消息跳过
  if (!msg.id) continue;                      // 没有 ID 的消息跳过
  allMessageIds.push(msg.id);                 // 记录所有有 usage 的消息 ID
  if (knownMessageIds?.has(msg.id)) continue; // 增量去重
  if (!msg.timestamp) continue;               // 没有时间戳跳过
  // ... 提取 tokens、构建 ParsedDelta
}
```

### 3.3 幂等性保证

- ✅ 消息 ID 去重：同一消息只产生一次 delta
- ✅ `fileUnchanged()` 快速跳过未变化的文件
- ✅ `isAllZero(tokens)` 过滤零值 token
- ✅ cursor 持久化到 `~/.config/pew/cursors.json`

---

## 四、Session 统计方案

### 4.1 SessionSnapshot 提取

从 `chat_history` 中提取：

| 字段 | 来源 |
|------|------|
| `sessionKey` | `"kosmos:{chatSession_id}"` |
| `source` | `"kosmos"` |
| `kind` | `"human"` |
| `startedAt` | 首条消息的 `timestamp` |
| `lastMessageAt` | 末条消息的 `timestamp` |
| `durationSeconds` | `(lastTimestamp - firstTimestamp) / 1000` |
| `userMessages` | `role === "user"` 的消息数 |
| `assistantMessages` | `role === "assistant"` 的消息数 |
| `totalMessages` | 所有消息数（含 tool、system 等） |
| `model` | 最后一个 assistant 消息的 `model` 字段 |
| `projectRef` | `null`（Kosmos 无项目关联） |

### 4.2 增量策略

Session driver 使用标准 `mtime + size` 双重检查跳过。Session 是快照语义（overwrite），不是增量累加，所以文件变化时全量重扫即可。

---

## 五、Kosmos 侧改动详情

### 5.1 Message 接口扩展

```typescript
// src/shared/types/chatTypes.ts
export interface Message {
  // ... 现有字段 ...
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model?: string;
}
```

### 5.2 Turn Runner 中附加 usage + model

```typescript
// src/main/lib/chat/agentChatTurnRunner.ts（streaming 响应后）
if (streamingResponse.usage) {
  response.usage = {
    prompt_tokens: streamingResponse.usage.promptTokens,
    completion_tokens: streamingResponse.usage.completionTokens,
    total_tokens: streamingResponse.usage.totalTokens,
  };
}
response.model = this.deps.getCurrentModelId();
```

> `usage` 使用 snake_case 匹配 OpenAI API 原始格式，`streamingResponse.usage` 内部是 camelCase，转换在此处完成。

---

## 六、部署注意事项

1. **Kosmos 侧先合并**: 确保用户的 Kosmos/PM Studio 更新后，chatSession 文件才会包含 `usage` + `model` 字段
2. **pew Worker 必须重新部署**: `@pew/core` 的 `VALID_SOURCES` 在 Worker 构建时打包，`wrangler deploy` 后才能接受 `"kosmos"` source
3. **向后兼容**: 没有 `usage` 字段的旧 chatSession 文件会被 parser 自动跳过，不产生任何 token delta
4. **多 profile 支持**: pew 扫描 `profiles/` 下的所有子目录，支持 Kosmos 的多用户 profile 功能

---

## 七、References

- Kosmos 源码: `src/main/lib/chat/agentChatStreamingService.ts` — SSE usage 提取逻辑
- Kosmos 品牌配置: `brands/kosmos/config.json`, `brands/pm-studio/config.json`
