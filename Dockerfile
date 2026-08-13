# Two images from one Dockerfile (see docker-compose.yml): `web` (target
# `runner`) runs `prisma migrate deploy && next start`; the five `worker-*`
# services (target `worker-runner`) each run one statically-linked Go binary
# built from worker/ — no Node/V8 involved, which is the whole point (RAM
# footprint per worker container drops from a full Node runtime to a few MB).
# `web`'s stages deliberately skip Next's `standalone` output trimming (that
# only traces what the Next.js app itself imports) since it no longer needs
# to — the workers aren't part of this image's Node dependency graph anymore.
FROM node:20-alpine AS base
# openssl: Prisma's generated client needs it on Alpine.
# python3/make/g++: better-sqlite3 is still an unconditional import in
#   src/lib/prisma.ts (this image only ever runs in DB_PROVIDER=postgresql
#   mode via docker-compose, but the import is evaluated eagerly either way,
#   so its native binding must still compile successfully during npm ci).
RUN apk add --no-cache openssl libc6-compat python3 make g++
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
# Cache mount: persists npm's package cache across deploys on the build host,
# independent of layer invalidation — a plain `RUN npm ci` re-downloads
# everything whenever package-lock.json changes, this doesn't.
RUN --mount=type=cache,target=/root/.npm npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The generated Prisma client is provider-specific (it embeds a binary target
# for the container's own platform) — it must be generated in here, not
# copied in from the host. DB_URL is a placeholder: `generate` parses it but
# never connects.
ENV DB_PROVIDER=postgresql
ENV DB_URL=postgresql://user:password@localhost:5432/placeholder
RUN npx prisma generate
# Cache mount for Next's own incremental build cache. `COPY . .` above
# invalidates every deploy (source always changed), so without this the
# entire `next build` recompiles from zero every time — with it, only
# changed files are rebuilt.
RUN --mount=type=cache,target=/app/.next/cache npm run build

FROM base AS runner
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src ./src

EXPOSE 3000

# Overridden by docker-compose.yml's `command:` for `web`; a sane default if
# this target is ever run standalone.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]

# ---- Go workers ----

FROM golang:1.25-alpine AS go-builder
WORKDIR /src/worker
COPY worker/go.mod worker/go.sum ./
RUN --mount=type=cache,target=/root/go/pkg/mod go mod download
COPY worker/ .
# CGO_ENABLED=0: both DB drivers (pgx, modernc.org/sqlite) and the ping
# worker's ICMP library are pure Go, so every binary stays static — no libc
# dependency to match at runtime, which is what lets worker-runner below be
# just `alpine` + `ca-certificates` instead of needing glibc/musl-dev shims.
RUN --mount=type=cache,target=/root/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux sh -c '\
    for cmd in https port ping dns integrations; do \
      go build -ldflags="-s -w" -o /out/$cmd ./cmd/$cmd; \
    done'

FROM alpine:3.20 AS worker-runner
# ca-certificates: every worker talks TLS outbound (SMTP, Discord/Slack/
# Telegram/PagerDuty webhooks, Postgres) and needs a trust store to verify it.
RUN apk add --no-cache ca-certificates
COPY --from=go-builder /out/ /usr/local/bin/
WORKDIR /app

# Overridden by docker-compose.yml's `command:` for every worker-* service;
# https is just a sane default if this target is ever run standalone.
CMD ["/usr/local/bin/https"]
