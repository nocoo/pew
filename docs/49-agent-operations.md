# 49 · 时间、CLI 状态与发布约定

工程入口和本地 6DQ 目标见根 CLAUDE.md。旧文档 31 和旧测试 runner 仍描述远程测试资源；它们是待替换实现，不再构成创建或使用远程 `-test` 资源的指令。

## 时间语义


All date/time values follow a strict UTC-in, local-out pattern:

- **Storage (D1 SQLite)**: All `created_at`, `updated_at`, `hour_start` use `datetime('now')` which returns UTC. Season `start_date`/`end_date` are ISO 8601 UTC strings (`YYYY-MM-DDTHH:mm:ssZ`).
- **Computation (API routes, Worker, CLI)**: All date arithmetic uses UTC (`toISOString()`, `Date.UTC()`, `getUTC*()` methods). Never use `setDate()`/`getDate()` for server-side date math — always use `setUTCDate()`/`getUTCDate()`.
- **Display (Web UI)**: Convert to user's local timezone before rendering. Use the `tzOffset` pattern (`new Date().getTimezoneOffset()`) for data bucketing. For timestamps use `toLocaleString()`/`toLocaleDateString()` on the client.
- **Form input (`datetime-local`)**: The input shows local wallclock time. On load, convert UTC → local via `utcToLocalDatetimeValue()`. On submit, convert local → UTC via `localDatetimeValueToUtc()`. Both helpers live in `date-helpers.ts`. Never append `Z` to a `datetime-local` value directly — that treats local time as UTC.
- **Season dates**: Stored as ISO 8601 UTC datetime (e.g. `2026-03-15T00:00:00Z`), **precision to minute**. Status derived at read time via `deriveSeasonStatus()`, never stored.
- **Date comparison**: Always use epoch ms (`new Date(x).getTime()`) for ordering/equality checks. Never use string comparison — ISO formats with/without seconds or milliseconds have unstable lexicographic order.


## CLI 状态与源数据

- 原始 AI 日志/SQLite 永远只读。每个来源独立；`ON CONFLICT` 上传按相同输入幂等覆盖，不累加重复快照。
- CLI 自有状态位于 `~/.config/pew/`：`config.json`（生产凭据）、`config.dev.json`（开发凭据）、`cursors.json`（两种目标共享游标）、`queue.jsonl` 和 `queue.state.json`。不要在测试中读写这些真实状态；CLI 测试使用临时目录和合成数据。
- 不要把 `sync --no-upload` 误写成无副作用预览；它仍更新本地队列。`init`/`uninstall` 修改所选工具配置，必须属于实际请求范围。
- 根构建只构建 core 与 Web。发布 CLI 前额外运行 `bun run --filter '@nocoo/pew' build`。
- `@pew/core` 只有类型，为 private/devDependency，使用 `import type`，不发布到 npm。
- 特定来源、文件路径与解析兼容约束以 `packages/cli/src/utils/paths.ts` 和来源文档为准。不要读取真实会话正文来构造 fixtures。

## 发布

- 授权的发布入口为根目录 `bun run release`（patch 默认；可指定 minor/major/版本）。同步版本和 lockfile，生成 CHANGELOG 并验证旧版本引用。标签不可移动。
- npm 发布对象只有 `packages/cli` 的 `@nocoo/pew`。完整构建后运行测试、核对 package/dist 版本、在 CLI 目录进行 `npm publish --dry-run`，随后才是获授权的正式发布/OTP 验证。
- Web 由 Git/CI 驱动 Railway 发布；不要使用 `railway up`。保留 Dockerfile 的 pinned Bun、standalone public/static 和完整 `@swc/helpers` 修复。
- Worker ingest/read 分别发布；先应用其依赖迁移，再发布对应 Worker 并核对运行版本/实际行为。Web 发布不等于 Worker 已更新。
- 推送后检查对应提交的 CI，而不是只依赖本地 hook。旧 pre-push 的远程 E2E 前置条件必须先被本地 harness 替代；不能绕过它发布。

## 专项审查

Pew 的 ponytail 审查入口为 `.agents/skills/ponytail-audit/SKILL.md` 与 `sh scripts/ponytail-audit.sh`。检查 parser → cursor → spool → upload → UPSERT → API/UI 全链路、隐私、时间和兼容性；只输出标准输出，不写报告、不碰真实日志/状态/队列/服务。完整测试和独立复审是另外的验证。
