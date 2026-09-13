<p align="center">
  <img src="assets/brand/icon-rounded.png" width="128" height="128" alt="pew" />
</p>

<h1 align="center">pew</h1>

<p align="center">记录 AI 编程工具的用量、会话和使用趋势。</p>

<p align="center">
  <a href="https://pew.md">站点</a> ·
  <a href="docs/README.en.md">English</a>
</p>

## 这是什么

pew 由本地 CLI 和 Web 仪表盘组成。CLI 读取 AI 编程工具的日志与本地数据库，提取 token 用量和会话统计，再上传到仪表盘，按时间、工具、模型、设备和项目查看使用情况。

原始日志保持只读。上传的 token 数据按半小时聚合；会话记录包含时间、消息数和经过哈希处理的项目引用，不包含对话正文。统计完整度取决于上游工具实际保存的数据，费用由模型价格表估算，与供应商账单可能不同。

## 功能

- 汇总输入、缓存输入、输出和推理 token，支持增量扫描、离线上传队列和重复上传去重。
- 展示贡献热力图、小时 / 每日趋势、模型与工具分布、设备和项目分析。
- 查看会话起止时间、持续时长、消息数和人工 / 自动会话分类。
- 管理设备名称和项目映射，按团队、组织与赛季查看汇总，浏览公开排行榜和成就。
- 从动态模型价格与回退价格表估算用量成本，查看价格来源和更新时间。
- 为部分工具配置会话后的自动同步，其余来源可通过 `pew sync` 手动汇总。

当前 token 来源包括 Claude Code、Codex、Gemini CLI、GitHub Copilot CLI、Grok、Hermes、Kosmos、Oh My Pi、OpenClaw、OpenCode、Pi、PM Studio、VS Code Copilot 和 ZCode。会话统计的来源范围较小，目前不含 Hermes 和 VS Code Copilot。

## 使用

推荐使用 Node.js 24 或更新版本。npm 包声明支持 Node.js 18，但 OpenCode、Hermes、ZCode 的 SQLite 数据源依赖运行时内置 SQLite，旧版 Node.js 无法读取这些来源。

```bash
npm install -g @nocoo/pew
pew login
pew sync
pew status
```

`pew login` 通过浏览器连接 [pew.md](https://pew.md)，Web 使用 Google 登录。新账号是否需要邀请码由站点设置决定，默认需要。无浏览器的机器可以在 Web 的 Devices 管理页生成一次性代码，再执行 `pew login --code XXXX-XXXX`。

| 命令 | 用途 |
| --- | --- |
| `pew sync` | 扫描本地数据；已登录时上传 |
| `pew sync --no-upload` | 只解析并写入本地队列 |
| `pew status` | 查看扫描、队列与自动同步状态 |
| `pew init` | 配置受支持工具的自动同步集成 |
| `pew uninstall` | 移除自动同步集成 |
| `pew logout` | 清除当前登录凭据 |
| `pew update` | 更新已安装的 CLI |

自动同步支持 Claude Code、Codex、Gemini CLI、Oh My Pi、OpenClaw、OpenCode 和 Pi；配置过程会修改相应工具的设置。CLI 自己的凭据、游标、队列和运行记录保存在 `~/.config/pew/`。

Copilot CLI 的 OTel 文件可通过 `COPILOT_OTEL_FILE_EXPORTER_PATH` 指定；多个文件或目录可放入 `PEW_COPILOT_OTEL_PATHS`，使用操作系统的路径分隔符。默认来源路径见 [paths.ts](packages/cli/src/utils/paths.ts)。

## 开发

仓库使用 Bun workspaces。使用与当前 CI / Dockerfile 一致的 Bun 1.4.0，并准备 Node.js 24 或更新版本。

```bash
git clone https://github.com/nocoo/pew.git
cd pew
bun install --frozen-lockfile
cp packages/web/.env.example packages/web/.env.local
```

填写 `packages/web/.env.local` 后运行 `bun run dev`，Web 默认地址为 `http://localhost:7020`。Google OAuth 回调为 `http://localhost:7020/api/auth/callback/google`。

| 配置 | 用途 |
| --- | --- |
| `AUTH_SECRET`、`AUTH_GOOGLE_ID`、`AUTH_GOOGLE_SECRET` | 会话与 Google 登录 |
| `CF_ACCOUNT_ID`、`CF_D1_DATABASE_ID`、`CF_D1_API_TOKEN` | D1 REST 写入与数据库访问 |
| `WORKER_INGEST_URL`、`WORKER_SECRET` | 用量与会话批量写入 |
| `WORKER_READ_URL`、`WORKER_READ_SECRET` | 数据查询，运行时必需 |
| `ADMIN_EMAILS` | 管理员邮箱列表 |

应用需要初始化过的 D1 数据库和已配置的两个 Worker；数据库迁移在 [scripts/migrations/](scripts/migrations/)，Worker 的绑定与测试环境在各自的 `wrangler.toml`。团队与组织 Logo 上传还需要 `CF_R2_ENDPOINT`、`CF_R2_ACCESS_KEY_ID`、`CF_R2_SECRET_ACCESS_KEY`、`CF_R2_BUCKET`；当前公开资源域名在 [r2.ts](packages/web/src/lib/r2.ts) 中配置。

```bash
bun run typecheck
bun run lint
bun run build
bun run --filter '@nocoo/pew' build
```

根 `build` 只构建 core 和 Web，CLI 需单独构建。Web 使用 Next.js standalone 产物，容器入口见 [Dockerfile](Dockerfile)。CLI 的正式与开发主机目前在 [login.ts](packages/cli/src/commands/login.ts) 中固定，自部署时需要调整对应地址。

| 目录 | 内容 |
| --- | --- |
| `packages/core` | 共享 TypeScript 类型 |
| `packages/cli` | npm CLI、解析器、队列与自动同步 |
| `packages/web` | 仪表盘、账号与应用 API |
| `packages/worker` | D1 批量写入 Worker |
| `packages/worker-read` | 查询、缓存与模型价格同步 |
| `scripts` | 迁移、测试和维护脚本 |

## 测试

| 测试层 | 命令 | 前提 |
| --- | --- | --- |
| 单元与组件逻辑 | `bun run test` | 已安装依赖 |
| CLI 采集流水线集成 | `bun run test:e2e:cli` | 使用临时目录与测试数据，无需登录 |
| API 端到端 | `bun run test:e2e` | 独立的远端测试 D1 与 Worker；端口 17020 |
| 浏览器端到端 | `bun run test:e2e:ui` | 同一套测试资源、Chromium；端口 27020 |

浏览器测试前运行 `bunx playwright install chromium`。可用 `bun run test:watch` 持续运行单元测试，或用 `bun run test:coverage` 查看报告。

### E2E 配置

API 和浏览器测试读取 `packages/web/.env.local` 与 `packages/web/.env.test`。前者提供应用连接、Cloudflare 凭据与共享密钥；后者提供 `CF_D1_DATABASE_ID_TEST`、`WORKER_INGEST_URL_TEST` 和 `WORKER_READ_URL_TEST`，分别指向独立测试数据库与测试 Worker。

测试脚本核对资源与应用环境不同，并要求测试库中存在 `_test_marker` 标记。准备方法见 [D1 测试环境说明](docs/31-d1-test-isolation.md)。API 测试会写入并清理测试用户数据；浏览器测试通过开发态测试登录运行，不验证真实 Google OAuth。运行前确认测试端口空闲。

## 技术栈

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-14151A?logo=bun&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?logo=nextdotjs&logoColor=white)
![Cloudflare](https://img.shields.io/badge/Cloudflare-F38020?logo=cloudflare&logoColor=white)

| 部分 | 实现 |
| --- | --- |
| CLI | Node.js / Bun、TypeScript、@nocoo/base-cli、运行时内置 SQLite |
| Web | Next.js、React、Basalt、Tailwind CSS、Recharts、SWR |
| 认证 | Auth.js、Google OAuth |
| 数据与存储 | Cloudflare Workers、D1、KV、R2 |
| 开发与测试 | Bun workspaces、Biome、Vitest、Playwright |

## 文档

- [文档索引](docs/README.md)
- [数据流水线](docs/03-data-pipeline.md)
- [隐私说明](PRIVACY.md)
- [变更记录](CHANGELOG.md)

## 许可证

[MIT](LICENSE) © 2026 Zheng Li
