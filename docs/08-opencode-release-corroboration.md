# 08 — OpenCode 发布时间线佐证

> 本文记录一次只读调查，用来佐证这台机器上 OpenCode 从 JSON 文件存储切到
> SQLite 的时间点大约发生在 `2026-02-15 17:00`。

## 1. 问题

这次调查要确认三件事：

1. 这台机器是不是在 `2026-02-15 17:00` 左右开始使用 SQLite 存储 OpenCode
   session 数据。
2. 这个本机切换时间点，是否能和 OpenCode 某个正式发布版本对上。
3. 这次统计断崖更像是“存储后端切换”，还是“模型 / token schema 改坏了”。

## 2. 约束

本次调查严格只读。

- 不修改任何 OpenCode 用户数据。
- 不修改任何本机 OpenCode 配置或状态文件。
- 对克隆下来的 OpenCode 源码也只做读取和检索。

## 3. 检查过的路径

### 3.1 OpenCode 用户配置

- `~/.config/opencode/opencode.json`
- `~/.config/opencode/package.json`

### 3.2 OpenCode 本机状态与存储

- `~/.local/share/opencode/opencode.db`
- `~/.local/share/opencode/storage/message`
- `~/.local/share/opencode/storage/session`
- `~/.local/share/opencode/storage/session_diff`
- `~/.local/share/opencode/storage/part`
- `~/.local/share/opencode/log`

### 3.3 OpenCode 源码仓库

- `~/workspace/personal/opencode`

## 4. 本机证据

### 4.1 这台机器在 SQLite 出现之前就已经在使用 OpenCode

本机很早就已经开始使用 OpenCode，不是到了 `2026-02-15` 才开始工作。

- `~/.local/share/opencode` 创建时间：`2026-01-04 17:25:38`
- `~/.local/share/opencode/storage/message` 创建时间：
  `2026-01-04 17:29:40`
- `~/.local/share/opencode/storage/session_diff` 创建时间：
  `2026-01-04 17:29:40`

这可以排除“机器在 2 月 15 日才首次开始使用 OpenCode”的解释。

### 4.2 SQLite 在一个非常明确的时间点出现

SQLite 数据库第一次出现的时间是：

- `~/.local/share/opencode/opencode.db`：
  `2026-02-15 17:00:07`
- `~/.local/share/opencode/opencode.db-shm`：
  `2026-02-15 17:00:07`
- `~/.local/share/opencode/opencode.db-wal`：
  `2026-02-15 17:00:07`

这是本机文件系统上最明确的“切到数据库存储”的时间标记。

### 4.3 数据库出现后，旧 JSON 还继续写了一段时间

旧的平面文件存储并不是在数据库出现的瞬间就彻底停止。

同一分钟内可见的样本：

- `storage/session_diff/...ses_39f789191ffeUb8F6kWX6f15ph.json`：
  `2026-02-15 17:00:14`
- `storage/message/...msg_c608774f5001rZrIwHeoGV0wlJ.json`：
  `2026-02-15 17:00:15`
- `storage/message/...` 在 `17:00` 之后仍持续有新文件写入

这说明切换更像是：

- 新版本已经开始写 SQLite
- 但旧 JSON 文件在重叠窗口里仍然存在，甚至仍有继续写入

而不是一个完全瞬时的“JSON 关掉，DB 打开”。

### 4.4 最早的数据库记录与建库时间高度重合

SQLite 中最早的记录时间：

- 最早 `session.time_created`：
  `1771146014318` -> `2026-02-15 17:00:14.318`
- 最早 `message.time_created`：
  `1771146014323` -> `2026-02-15 17:00:14.323`

这些记录只比 `opencode.db` 的创建时间 `17:00:07` 晚了几秒。

第一个数据库 session ID 是：

- `ses_39f789191ffeUb8F6kWX6f15ph`

这与本机存储切换时间点是高度对齐的。

## 5. Schema 观察

核心的模型 / token 结构在 SQLite 出现之前就已经存在。

### 5.1 旧 JSON message 里已经有模型与 token 字段

从 `2026-02-13` 的 `storage/message/*/*.json` 抽样可见：

- assistant message 已经包含：
  - `modelID`
  - `providerID`
  - `tokens.total`
  - `tokens.input`
  - `tokens.output`
  - `tokens.reasoning`
  - `tokens.cache.read`
  - `tokens.cache.write`
- user message 已经包含：
  - `model.providerID`
  - `model.modelID`

### 5.2 SQLite `message.data` 与旧 JSON 载荷一致

SQLite 的 `message.data` 存的仍然是和旧 `msg_*.json` 基本同构的消息
payload。

因此更合理的结论是：

- `2026-02-15` 之后统计断崖，更可能是“主数据源从 JSON 切到 SQLite”
- 不像是“核心模型 / token schema 改名或改位置，导致解析失败”

## 6. 源码证据

### 6.1 引入 SQLite 迁移支持的关键提交

在本地克隆的 OpenCode 源码中：

- commit `6d95f0d14cbd83fc8b7775f77ba39ab2881008f3`
- 标题：`sqlite again (#10597)`
- 提交时间：`2026-02-14T04:19:02Z`

这是重新引入 SQLite 存储和 JSON 迁移逻辑的关键提交。

### 6.2 第一个包含该提交的发布 tag

本地 git tag 检查结果：

- 第一个包含 `6d95f0d14` 的 release tag 是 `v1.2.0`

这说明 SQLite 迁移能力最晚在 `v1.2.0` 这一发布线上已经正式进入发布包。

### 6.3 启动时的迁移路径

源码中关键文件：

- `~/workspace/personal/opencode/packages/opencode/src/index.ts`
- `~/workspace/personal/opencode/packages/opencode/src/storage/db.ts`
- `~/workspace/personal/opencode/packages/opencode/src/storage/json-migration.ts`

从代码可以看出：

1. 启动时先检查 `opencode.db` 是否存在。
2. 如果不存在，就执行一次 JSON -> SQLite 迁移。
3. 但 DB client 使用 `create: true`，意味着数据库文件会先被创建，再继续跑迁移。

这意味着如果第一次迁移中途中断：

- 机器上已经会留下一个 `opencode.db`
- 之后再启动时会因为“db 已存在”而跳过迁移

这也是“旧 JSON 没有完整迁进去”在代码层面完全可能发生的原因之一。

### 6.4 紧随其后的迁移修复提交

同一个源码仓库里还有：

- commit `2bab5e8c39f4ed70dbfe6d971728d8d899b88e4f`
- 标题：`fix: derive all IDs from file paths during json migration`

这说明 SQLite 刚上线后，JSON 迁移逻辑很快就又修过一次。

## 7. 发布时间线佐证

### 7.1 `v1.2.0` 发布时间

官方 release 页面：

- <https://github.com/anomalyco/opencode/releases/tag/v1.2.0>

观察到的发布时间：

- `2026-02-14 05:20 UTC`
- 折算上海时间：`2026-02-14 13:20`

这是已知第一个包含 SQLite 迁移能力的正式发布版本线。

### 7.2 `v1.2.5` 发布时间

官方 release 页面：

- <https://github.com/anomalyco/opencode/releases/tag/v1.2.5>

观察到的发布时间：

- `2026-02-15 18:49 UTC`
- 折算上海时间：`2026-02-16 02:49`

这个时间晚于本机 SQLite 切换时间点
`2026-02-15 17:00 Asia/Shanghai`。

因此本机在 `2/15 17:00` 的 SQLite 启用，不可能是依赖 `v1.2.5` 才出现。

### 7.3 `v1.2.9` 发布时间与本机运行日志

官方 release 页面：

- <https://github.com/anomalyco/opencode/releases/tag/v1.2.9>

观察到的发布时间：

- `2026-02-20 01:45 UTC`
- 折算上海时间：`2026-02-20 09:45`

本机最早保留的运行日志：

- `~/.local/share/opencode/log/2026-02-20T100004.log`
- 日志首行显示 `version=1.2.9`

这说明：

- 本机现存日志和官方 release 时间是对得上的
- 虽然 `2/15` 当天的运行日志没有保留下来，但现有日志体系本身并没有明显错位

## 8. 为什么 `2026-02-15 17:00` 这个点是成立的

把本机和发布时间线放在一起看：

1. OpenCode 在 `v1.2.0` 已经发布了 SQLite 迁移能力。
2. `v1.2.0` 的发布时间是 `2026-02-14 13:20 Asia/Shanghai`。
3. 这台机器第一次创建 `opencode.db` 的时间是
   `2026-02-15 17:00:07 Asia/Shanghai`。
4. 首条 DB session / message 在几秒后立即出现。
5. 同一时间窗口内旧 JSON 文件仍在继续写。

最合理的解释是：

- 这台机器在 `v1.2.0` 发布之后、`v1.2.5` 发布之前的某个时间点，升级到了带
  SQLite 能力的 OpenCode 版本
- 这个升级后的版本在 `2026-02-15 17:00` 左右开始创建并写入 `opencode.db`
- 旧 JSON 存储在切换窗口里与 SQLite 并存了一段时间

## 9. 目前还不能直接证明的部分

本机有几类证据没有保留下来：

- 没有保留 `2026-02-15` 当天的 OpenCode 运行日志
- 没有保留 `2026-02-13` 到 `2026-02-16` 之间明确的本机安装 / 更新命令记录
- 当前 Homebrew receipt 是 `2026-03-08` 的，时间太晚，不能用来解释最初的
  SQLite 切换

所以当前结论不是：

- “已经找到 2 月 15 日那次升级动作的单条日志实锤”

而是：

- “已经找到一个在切换前正式发布的版本线，它明确包含 SQLite 迁移代码，而且
  本机首次建库和首次 DB 写入时间与这条发布时间线高度吻合”

## 10. 结论

发布时间线能够显著增强本机侧判断。

- OpenCode 的 SQLite 迁移能力从 `v1.2.0` 开始进入正式发布版本
- `v1.2.0` 的发布时间早于本机 `2026-02-15 17:00` 的建库时间
- 本机 DB 创建后几秒内就出现了首条 session 和 message
- 同一时间段旧 JSON 文件仍在写，说明存在重叠窗口
- 后续保留下来的本机运行日志，与官方 `v1.2.9` 发布时间能对上

最终判断：

强证据支持这台机器是在 `2026-02-15 17:00` 左右进入了
OpenCode 的 SQLite 存储版本线；`2/15` 之后的统计断崖，主因更像是主数据源从
JSON 文件切换到 SQLite，而不是核心模型 / token schema 本身发生破坏性变化。
