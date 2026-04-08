# pew — Documentation Index

| # | Document | Description | Status |
|---|----------|-------------|--------|
| 01 | [01-plan.md](01-plan.md) | Monorepo skeleton & implementation plan | done |
| 02 | [02-worker-ingest.md](02-worker-ingest.md) | Cloudflare Worker ingest migration (REST → native D1) | done |
| 03 | [03-data-pipeline.md](03-data-pipeline.md) | Data pipeline & token collection reference | done |
| 04 | [04-sync-resilience.md](04-sync-resilience.md) | Sync resilience fixes for data loss bugs | done |
| 05 | [05-token-accounting.md](05-token-accounting.md) | Token counting, aggregation & reporting spec | done |
| 06 | [06-session-statistics.md](06-session-statistics.md) | Session-level metadata pipeline (duration, messages, hours) | done |
| 07 | [07-opencode-sqlite-migration.md](07-opencode-sqlite-migration.md) | OpenCode JSON → SQLite storage migration | done |
| 08 | [08-opencode-release-corroboration.md](08-opencode-release-corroboration.md) | OpenCode 发布时间线佐证 (中文) | reference |
| 09 | [09-pew-vibeusage-sync-architecture.md](09-pew-vibeusage-sync-architecture.md) | pew 与 VibeUsage sync 架构对比 | reference |
| 10 | [10-tracker-coordinator-architecture-plan.md](10-tracker-coordinator-architecture-plan.md) | Phase 1: Tracker / Coordinator architecture | done |
| 10b | [10b-notifier-implementation-plan.md](10b-notifier-implementation-plan.md) | Notifier implementation plan (companion to 10) | done |
| 11 | [11-phase2-run-log-and-notify-fix.md](11-phase2-run-log-and-notify-fix.md) | Phase 2: Run log + notify session sync fix | done |
| 12 | [12-invite-code-system.md](12-invite-code-system.md) | Invite code gated registration system | done |
| 13 | [13-phase3-unified-source-drivers.md](13-phase3-unified-source-drivers.md) | Phase 3+4: Unified source driver architecture | done |
| 15 | [15-dashboard-viz-improvements.md](15-dashboard-viz-improvements.md) | Dashboard visualization improvements roadmap | in-progress |
| 16 | [16-public-leaderboard-overhaul.md](16-public-leaderboard-overhaul.md) | Public leaderboard & profile overhaul | done |
| 17 | [17-projects.md](17-projects.md) | Two-layer project management | done |
| 18 | [18-season-system.md](18-season-system.md) | 赛季系统 — team-based seasonal competition | in-progress |
| 19 | [19-vscode-copilot-token-estimation.md](19-vscode-copilot-token-estimation.md) | VSCode Copilot token tracking research | done |
| 20 | [20-by-device.md](20-by-device.md) | Multi-device analytics & management pages | done |
| 21 | [21-token-inflation-audit.md](21-token-inflation-audit.md) | Token inflation audit & fix plan | done |
| 22 | [22-e2e-validation-record.md](22-e2e-validation-record.md) | E2E validation record (v1.6.0 inflation fixes) | done |
| 23 | [23-session-queue-growth.md](23-session-queue-growth.md) | Session queue unbounded growth fix | done |
| 24 | [24-d1-query-optimization.md](24-d1-query-optimization.md) | D1 query optimization & index inventory | reference |
| 25 | [25-leaderboard-armory-refactor.md](25-leaderboard-armory-refactor.md) | Leaderboard armory-style shared layout refactor | done |
| 26 | [26-by-project.md](26-by-project.md) | By-project analytics page | done |
| 27 | [27-token-queue-full-reupload.md](27-token-queue-full-reupload.md) | Token queue dirty-key tracking (eliminate full re-uploads) | done |
| 28 | [28-notify-concurrency-dirty-key-loss.md](28-notify-concurrency-dirty-key-loss.md) | Notify concurrency: dirty-key loss under unlocked parallel sync | in-progress |
| 29 | [29-worker-read-migration.md](29-worker-read-migration.md) | Worker read migration — D1 REST API → Worker native binding | in-progress |
| 30 | [30-quality-system-upgrade.md](30-quality-system-upgrade.md) | Quality system upgrade — L1+L2+L3+G1+G2 | done |
| 31 | [31-d1-test-isolation.md](31-d1-test-isolation.md) | D1 test isolation — quality system → Tier S | done |
| 32 | [32-proxy-token-gap-investigation.md](32-proxy-token-gap-investigation.md) | Proxy token gap investigation | reference |
| 33 | [33-achievement-system-overhaul.md](33-achievement-system-overhaul.md) | Achievement system overhaul | in-progress |
| 34 | [34-showcase-system.md](34-showcase-system.md) | ProductHunt-style showcase system | design-complete |
| 35 | [35-hermes-support.md](35-hermes-support.md) | Hermes Agent token tracking support | done |
| 36 | [36-organization-system.md](36-organization-system.md) | Organization entity for interest-based grouping | done |
| 37 | [37-github-actions-ci.md](36-github-actions-ci.md) | GitHub Actions CI — Phase 1 (no secrets) | in-progress |

> **Note:** Number 14 is intentionally vacant (original doc 14 was renumbered to 12 to fill a gap).
