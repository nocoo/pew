FROM oven/bun:1 AS base

# --- Install dependencies ---
# Include all workspace package.json files so bun.lock stays consistent.
# Lifecycle scripts must run so platform-specific native addons (e.g. sharp's
# @img/sharp-linux-x64 binding) are properly installed.
FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/web/package.json packages/web/
COPY packages/worker/package.json packages/worker/
COPY packages/worker-read/package.json packages/worker-read/
RUN bun install --frozen-lockfile

# --- Build ---
FROM base AS builder
WORKDIR /app

# Install Node.js — required for `next build` on linux/amd64. Bun's runtime
# resolver cannot load sharp's @img/sharp-linux-x64 native binding from
# inside Next.js's Turbopack page-data collection workers under bun's
# isolated install layout, so `bun next build` fails at page-data with
# "Could not load the sharp module using the linux-x64 runtime". Real Node
# resolves the same layout correctly.
RUN apt-get update \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

# Railway injects service env vars as Docker build args.
# Next.js needs these at build time for page data collection.
ARG CF_ACCOUNT_ID
ARG CF_D1_DATABASE_ID
ARG CF_D1_API_TOKEN
ARG WORKER_INGEST_URL
ARG WORKER_SECRET
ARG AUTH_SECRET
ENV CF_ACCOUNT_ID=$CF_ACCOUNT_ID
ENV CF_D1_DATABASE_ID=$CF_D1_DATABASE_ID
ENV CF_D1_API_TOKEN=$CF_D1_API_TOKEN
ENV WORKER_INGEST_URL=$WORKER_INGEST_URL
ENV WORKER_SECRET=$WORKER_SECRET
ENV AUTH_SECRET=$AUTH_SECRET

COPY --from=deps /app ./
COPY . .
# Build @pew/core with bun (pure TS, no native deps).
# Build @pew/web with real Node.js — see comment above.
RUN bun run --filter @pew/core build \
  && cd packages/web \
  && /usr/bin/node ./node_modules/.bin/next build

# --- Production image ---
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/packages/web/.next/standalone ./
COPY --from=builder /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=builder /app/packages/web/public ./packages/web/public

EXPOSE 7020
ENV PORT=7020
ENV HOSTNAME="0.0.0.0"

CMD ["node", "packages/web/server.js"]
