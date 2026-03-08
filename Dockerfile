FROM oven/bun:1 AS base

# --- Install dependencies ---
FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/web/package.json packages/web/
COPY packages/worker/package.json packages/worker/
RUN bun install --frozen-lockfile

# --- Build ---
FROM base AS builder
WORKDIR /app

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
RUN bun run --filter @zebra/web build

# --- Production image ---
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/packages/web/.next/standalone ./
COPY --from=builder /app/packages/web/.next/static ./packages/web/.next/static

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "packages/web/server.js"]
