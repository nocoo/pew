# 09 — pew 与 VibeUsage 的 Sync 架构对比

> 本文记录一次只读调查，对比 `pew` 与 `vibeusage` 在 `sync`、`tracker`
>、本地队列、上传与去重上的架构异同，并总结各自优缺点。

## 1. 问题

这次对比主要回答五个问题：

1. `pew` 和 `vibeusage` 的 `sync` 主链路是否本质相同。
2. `tracker` / hook 在 `vibeusage` 中到底扮演什么角色。
3. 两边是如何避免重复解析、重复入队、重复上传的。
4. `sync` 之后两边的本地状态分别长什么样。
5. 从工程实现角度看，两边各自更适合什么目标。

## 2. 约束

本次调查严格只读。

- 不修改 `pew` 代码或状态文件。
- 不修改 `vibeusage` 代码或状态文件。
- 不修改本机任何 agent 的配置、hook 或插件。

## 3. 对比范围

### 3.1 VibeUsage

- `~/workspace/personal/vibeusage/src/commands/sync.js`
- `~/workspace/personal/vibeusage/src/lib/rollout.js`
- `~/workspace/personal/vibeusage/src/lib/uploader.js`
- `~/workspace/personal/vibeusage/src/lib/vibeusage-api.js`
- `~/.vibeusage/bin/notify.cjs`
- `~/.vibeusage/tracker/config.json`
- `~/.vibeusage/tracker/cursors.json`
- `~/.vibeusage/tracker/queue.jsonl`

### 3.2 pew

- `~/workspace/personal/pew/packages/cli/src/commands/sync.ts`
- `~/workspace/personal/pew/packages/cli/src/commands/session-sync.ts`
- `~/workspace/personal/pew/packages/cli/src/commands/upload.ts`
- `~/workspace/personal/pew/packages/cli/src/commands/session-upload.ts`
- `~/workspace/personal/pew/packages/cli/src/storage/local-queue.ts`
- `~/workspace/personal/pew/packages/core/src/types.ts`

## 4. 共同主链路

两边的主干其实非常接近，都是下面这条链：

`本地原始文件 -> 增量 parser -> 本地 cursor -> 本地 queue -> batch upload -> dashboard`

共同点包括：

- 都不是每次全量重扫，而是基于 cursor 做增量解析。
- 都把“本地采集”和“远端上传”分成两个阶段。
- 都允许本地先落队列，再在后续某次执行里补上传。
- 都按来源分别实现 parser，而不是做一个统一格式的超级 parser。
- 都需要在本地与服务端两侧共同保证幂等。

从系统形态看，两边都属于“本地 usage collector + 延迟上传”模型，而不是
“事件发生时直接把 token 即时打给 API”。

## 5. VibeUsage 的实际工作方式

`vibeusage` 的 hook / plugin 不直接上传 usage。

它的实际链路是：

1. 各 agent 的 hook / plugin 只负责触发通知。
2. 通知脚本 `notify.cjs` 负责节流，并拉起一次 `sync --auto`。
3. `sync.js` 统一扫描本地各来源数据。
4. `rollout.js` 负责增量解析、聚合到 hourly bucket。
5. 聚合结果写入 `~/.vibeusage/tracker/queue.jsonl`。
6. `uploader.js` 再把 queue 批量发送到 `vibeusage-ingest`。

也就是说，`tracker` 在这里更像一个“本地长期运行的采集系统”：

- hook / plugin 负责叫醒它
- `sync` 负责统一收敛数据
- uploader 负责批量上报

而不是“plugin 直接把 OpenCode token 发到 API”。

## 6. pew 的实际工作方式

`pew` 没有 `vibeusage` 那种长期安装的 tracker / notify 体系。

它的核心模型更直接：

1. 用户显式执行 `pew sync`
2. `sync.ts` 解析 token usage
3. `session-sync.ts` 解析 session snapshot
4. 分别写入 token queue 与 session queue
5. `upload.ts` / `session-upload.ts` 负责批量发送到 SaaS

这里最明显的设计选择是：

- token sync 和 session sync 完全拆开
- upload 也分成 token upload 与 session upload 两条路径

因此 `pew` 更像一个“结构清晰的 CLI 数据管线”，而不是“常驻 tracker”。

## 7. 增量与去重机制对比

### 7.1 VibeUsage

`vibeusage` 的去重是多层叠加的。

#### 第一层：避免重复触发 sync

- `notify.cjs` 有节流，默认 20 秒内最多拉起一次 sync
- `sync.js` 还会拿 `sync.lock`

因此多次 hook 触发不会并发跑出多份 sync。

#### 第二层：避免重复解析原始文件

`cursors.json` 里保存了按来源设计的 cursor：

- append-only JSONL 用 `inode + offset`
- Gemini 类 cumulative JSON 用 `inode + lastIndex + lastTotals`
- Codex 还保留 `lastTotal` / `lastModel`

这层保证“同一段原始文件内容”不会被重复解析。

#### 第三层：避免重复写 queue

`vibeusage` 在内存里的 `hourlyState.buckets` 为每个 bucket 保存：

- `totals`
- `queuedKey`

`queuedKey` 本质是当前 token totals 的签名。

如果同一个 `(source, model, hour_start)` 的 totals 没变化，就不会再次
append 到 `queue.jsonl`。

也就是说，它写 queue 时已经做了一次 bucket 级快照去重。

#### 第四层：上传前再次按 bucket key 合并

`uploader.js` 读取 `queue.jsonl` 时，会按：

- `source`
- `model`
- `hour_start`

重新聚合一遍本批次记录，只保留最后一份 bucket 值。

服务端返回里还有：

- `inserted`
- `skipped`

说明服务端本身也存在幂等 / 跳重语义。

### 7.2 pew

`pew` 的去重策略更简单，也更偏“上传前幂等”。

#### 第一层：避免重复解析原始文件

`pew` 同样有 per-file cursor：

- JSONL 用 `offset`
- Gemini 用 `lastIndex + lastTotals`
- OpenCode SQLite 用单独 cursor

这一层和 `vibeusage` 很相似。

#### 第二层：queue 先追加，上传前再聚合

`pew` 的 token queue 是 append-only 的简单 JSONL。

它不会像 `vibeusage` 那样在本地 bucket 状态里维护 `queuedKey` 去阻止重复入队。

而是到了 upload 阶段才做：

- `aggregateRecords()`
- 按 `(source, model, hour_start)` 聚合求和

session queue 则在 upload 前做：

- `deduplicateSessionRecords()`
- 按 `session_key` 保留最新 snapshot

换句话说：

- `vibeusage` 更早去重，在“写 queue 前”就做了很多工作
- `pew` 更晚去重，把主要幂等逻辑推迟到“upload 前”

## 8. Sync 之后的落地形态

### 8.1 VibeUsage

`sync` 之后，`vibeusage` 本地有一套较完整的 tracker 状态：

- `cursors.json`
- `queue.jsonl`
- `queue.state.json`
- `project.queue.jsonl`
- `upload.throttle.json`
- `sync.heartbeat.json`

其中最重要的是：

- `cursors.json` 不只保存 per-file cursor
- 还保存 `hourly.buckets`

这使得它本地更像一个“小型累计账本”。

### 8.2 pew

`pew` 的落地状态更薄：

- cursor store
- local queue
- queue offset

token 与 session 各自维护自己的状态，但不会像 `vibeusage` 那样在本地保存一份
很厚的 hourly 聚合账本。

这让 `pew` 更容易理解，也更容易测试，但也意味着它更依赖：

- 当前磁盘上仍然存在的原始文件
- 以及当前 parser 是否覆盖了所有真实数据源

## 9. OpenCode 场景下的影响

这次调查里，OpenCode 是一个很好的对照样本。

### 9.1 VibeUsage 的优势

`vibeusage` 由于长期运行、长期被 hook / plugin 唤醒：

- 在 OpenCode 仍主要写 JSON 的时期，已经累计吃进了大量历史
- 即使后面原始文件变化、删除，或者数据源切换，它仍保留历史账本

因此它更容易出现这种现象：

- 当前本机文件已经回不出来某段历史
- 但 Dashboard / tracker 历史累计里仍然有那部分数据

### 9.2 pew 的劣势

`pew` 更像后起的回溯式统计工具。

如果某个来源：

- 历史文件已经不存在
- 或存储后端已经变了
- 或 parser 尚未补齐新数据源

那么 `pew` 很容易直接少记。

这也是为什么：

- `vibeusage` 在长期累计上经常更大
- `pew` 在代码结构上更干净，但历史连续性不如 `vibeusage`

## 10. 优点与缺点

### 10.1 VibeUsage 的优点

- 更适合长期后台运行，历史连续性强。
- hook / plugin 驱动，实时性更好。
- 本地 bucket 级去重更深入。
- 对“原始文件后来消失”的场景更有韧性。

### 10.2 VibeUsage 的缺点

- `sync` 逻辑较厚，职责缠绕较多。
- tracker、hook、queue、upload、project usage 混在一条主链里，定位问题成本高。
- 展示口径与 parser / tracker 本地状态之间容易脱节。
- 当某个来源切换存储后端时，兼容点容易被遗漏。

### 10.3 pew 的优点

- 模块边界更清楚，职责分层更自然。
- token 与 session 两条管线显式分离，语义更稳定。
- upload 语义更容易解释：
  - token 是聚合 upsert
  - session 是 latest snapshot upsert
- 更适合作为产品化、长期维护的代码库继续演进。

### 10.4 pew 的缺点

- 没有成熟的“长期驻留 + 自动唤醒”体系。
- 历史连续性更弱，容易受原始文件保留状况影响。
- 某些来源的兼容补齐没有 `vibeusage` 那么深。
- 当前 queue 设计更轻，但也把更多幂等压力放到了 upload 阶段。

## 11. 结论

如果只看系统形态：

- `vibeusage` 更像一个已经在线运行很久的本地 tracker 系统
- `pew` 更像一个结构更清晰的产品化重写

如果只看“长期不丢账”：

- `vibeusage` 更有优势

如果只看“架构可维护性”：

- `pew` 更有优势

因此这两者不是简单的“谁更先进”，而是目标不同：

- `vibeusage` 赢在持续运行积累出来的历史
- `pew` 赢在更清楚的边界、更好的演进空间

这也是为什么在同一台机器上，经常会同时看到：

- `vibeusage` 的历史累计更大
- `pew` 的代码结构更容易解释和修正

## 12. 本次调查的直接判断

基于这次只读对比，更稳的判断是：

1. `vibeusage` 的 hook / tracker 并不是直接把 usage 发给 API，而是统一汇总到
   `sync` 再上传。
2. `vibeusage` 比 `pew` 更依赖“长期运行”这一点，因此历史连续性更强。
3. `pew` 的架构更清楚，但在缺失历史文件或来源切换时，更容易显露 gap。
4. 这台机器上看到的许多统计差异，不能只用 parser 正确性解释，还必须同时考虑：
   - 是否长期运行过 tracker
   - 原始文件是否还存在
   - queue / upload 的幂等与聚合语义
