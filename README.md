<p align="center"><img src="logo.png" width="128" height="128"/></p>

<h1 align="center">pew</h1>

<p align="center"><strong>AI 编程工具的 contribution graph</strong><br>追踪 token 用量 · 可视化消耗趋势 · 排行榜竞技</p>

[![npm](https://img.shields.io/npm/v/@nocoo/pew)](https://www.npmjs.com/package/@nocoo/pew)
[![Node](https://img.shields.io/node/v/@nocoo/pew)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/nocoo/pew)](LICENSE)

---

## 这是什么

pew 自动从本地 AI 编程工具的日志文件中提取 token 用量数据，聚合后上传至 SaaS 仪表盘，帮你了解每天在 AI 辅助编程上花了多少 token。类似于 GitHub 的 contribution graph，但计数单位是 token 而非 commit。

```
┌──────────────────────────────────────────────────────────────────┐
│  Local AI Tool Logs (read-only)                                  │
│  Claude Code · Codex · Gemini CLI · GitHub Copilot CLI · Hermes  │
│  Kosmos · OpenCode · OpenClaw · Pi · PM Studio · VS Code Copilot │
└───────────────┬──────────────────────────────────────────────────┘
                │  pew sync (incremental parse)
                ▼
       ParsedDelta[] → 30-min bucket aggregation → QueueRecord[]
                │
                │  upload (idempotent upsert)
                ▼
┌──────────────────────────────────────────────────────────────────┐
│  SaaS Dashboard                                                  │
│  仪表盘 · 模型分析 · 设备追踪 · 会话统计 · 排行榜 · 赛季       │
└──────────────────────────────────────────────────────────────────┘
```

## 功能

**Token 追踪**

- **11 种 AI 工具** — Claude Code、Codex、Gemini CLI、GitHub Copilot CLI、Hermes、Kosmos、OpenCode、OpenClaw、Pi、PM Studio、VS Code Copilot
- **四维 token 计数** — 输入 token、缓存命中 token、输出 token、推理 token
- **增量同步** — 基于字节偏移/数组索引/时间水位的增量解析，不重复计数
- **幂等上传** — 服务端 upsert 语义，重复上传不会导致数据膨胀

**SaaS 仪表盘**

- **多维分析** — 按小时/天、按模型、按设备、按项目查看用量
- **会话统计** — 消息数、持续时长、工具调用等会话级指标
- **排行榜** — 公开排行榜 + 赛季系统，与其他开发者比拼
- **团队协作** — 创建团队，汇总成员用量

**自动化**

- **通知钩子** — `pew init` 一键安装，AI 工具会话结束后自动触发同步（支持 8 种工具；Hermes、Kosmos、PM Studio 需手动安装插件）
- **只读设计** — 绝不修改用户的 AI 工具原始日志文件

## 安装

```bash
npm install -g @nocoo/pew
```

## 命令一览

| 命令 | 说明 |
|------|------|
| `pew sync` | 解析本地 AI 工具用量并上传到仪表盘 |
| `pew status` | 显示同步状态和 token 用量摘要 |
| `pew login` | 通过浏览器 OAuth 连接仪表盘 |
| `pew init` | 为已支持的 AI 工具安装通知钩子（Hermes 除外，需手动安装） |
| `pew uninstall` | 移除通知钩子 |
| `pew reset` | 清除所有同步/上传状态，准备全量重扫 |
| `pew update` | 从 npm 更新到最新版本 |

## 项目结构

```
pew/
├── packages/
│   ├── core/           # 共享 TypeScript 类型 (@pew/core)
│   ├── cli/            # CLI 工具 (@nocoo/pew, published to npm)
│   ├── web/            # SaaS 仪表盘 (Next.js 16 + App Router)
│   ├── worker/         # Cloudflare Worker — D1 写入
│   └── worker-read/    # Cloudflare Worker — D1 读取
├── docs/               # 设计文档与架构决策记录
├── scripts/            # 发布、E2E、安全扫描脚本
└── .husky/             # Git hooks (pre-commit, pre-push)
```

## 技术栈

| 层 | 技术 |
|----|------|
| 运行时 & 包管理 | [Bun](https://bun.sh/) |
| CLI 框架 | [citty](https://github.com/unjs/citty) + [picocolors](https://github.com/alexeyraspopov/picocolors) |
| Web 框架 | [Next.js 16](https://nextjs.org/) (App Router) |
| UI | [React 19](https://react.dev/) + [Tailwind CSS 4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) + [Recharts](https://recharts.org/) |
| 认证 | [NextAuth.js v5](https://authjs.dev/) (Google OAuth) |
| 数据库 | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite) |
| 边缘计算 | [Cloudflare Workers](https://workers.cloudflare.com/) |
| 类型系统 | [TypeScript](https://www.typescriptlang.org/) (strict mode) |

## 开发

**环境要求**: [Bun](https://bun.sh/) ≥ 1.0, [Node.js](https://nodejs.org/) ≥ 18

```bash
# 安装依赖（自动配置 Git hooks）
bun install

# 构建所有包
bun run build

# 启动 Web 开发服务器 (port 7020)
bun run dev
```

| 命令 | 说明 |
|------|------|
| `bun run build` | 构建所有包 (core → cli → web → worker) |
| `bun run dev` | 启动 Web 开发服务器 |
| `bun run test` | 运行单元测试 (Vitest) |
| `bun run test:coverage` | 单元测试 + V8 覆盖率（≥ 90% 阈值） |
| `bun run lint` | TypeScript 类型检查 (5 packages) + ESLint |
| `bun run test:e2e` | L2 API E2E 测试 (port 17020) |
| `bun run test:e2e:ui` | L3 BDD E2E 测试 via Playwright (port 27020) |
| `bun run test:security` | 安全扫描 |
| `bun run release` | 版本发布（bump + changelog + tag） |

## 测试

| 层级 | 内容 | 工具 | 触发时机 |
|------|------|------|----------|
| L1 Unit | 业务逻辑、解析器、工具函数 | Vitest | pre-commit |
| L2 API E2E | HTTP 端到端、Worker 集成 | Vitest | pre-push |
| L3 BDD E2E | 浏览器端用户流程 | Playwright | pre-push |
| G1 Static | TypeScript strict + ESLint `--max-warnings=0` | tsc + ESLint | pre-push |
| G2 Security | 依赖审计 + 自定义安全规则 | scripts/run-security.ts | 手动 |

覆盖率目标 90%（statements / branches / functions / lines），每次 commit 强制检查。

## 文档

| 文档 | 说明 |
|------|------|
| [docs/01-plan.md](docs/01-plan.md) | 初始规划 |
| [docs/03-data-pipeline.md](docs/03-data-pipeline.md) | 数据管线架构 |
| [docs/04-sync-resilience.md](docs/04-sync-resilience.md) | 同步容错机制 |
| [docs/05-token-accounting.md](docs/05-token-accounting.md) | Token 计量规则 |
| [docs/06-session-statistics.md](docs/06-session-statistics.md) | 会话统计设计 |
| [docs/18-season-system.md](docs/18-season-system.md) | 赛季系统 |
| [docs/30-quality-system-upgrade.md](docs/30-quality-system-upgrade.md) | 质量体系 |

## License

[MIT](LICENSE) © 2026