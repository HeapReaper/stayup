# Two images from one Dockerfile: `web` (target `runner`) runs
# `prisma migrate deploy && next start`; the eight `worker-*` services (target
# `worker-runner`) each run one statically-linked Go binary built from
# worker/ — no Node/V8 involved, which is the whole point (RAM footprint per
# worker container drops from a full Node runtime to a few MB). All eight
# binaries live in that one worker image; which one a container runs is just
# its `command:`.
#
# Nine binaries are built, not eight: `agent` is the odd one out. It runs on a
# machine being *watched* rather than next to StayUp, so it has no compose
# service — it ships in the worker image so it can be copied out
# (`docker cp <container>:/usr/local/bin/agent .`) onto the host it belongs on.
#
# Built from source by docker-compose.build.yml, and published to the GitLab
# container registry as <registry>/web and <registry>/worker by
# .gitlab-ci.yml's `build:web`/`build:worker` jobs — those images are what
# docker-compose.yaml pulls.
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
# better-sqlite3 publishes no musl prebuild, so npm ci always falls through to
# `node-gyp rebuild` here. Left to itself node-gyp downloads the matching node
# headers from unofficial-builds.nodejs.org — a host that regularly resets the
# connection and takes the whole build with it. The node image already ships
# those headers under /usr/local/include/node, so point node-gyp at them and
# the build stops touching the network for this at all.
ENV npm_config_nodedir=/usr/local
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

# Populated by CI (.gitlab-ci.yml) with the git tag/short SHA and the full
# commit SHA; both default to "dev" so a plain local `docker build` needs no
# extra flags. Declared here rather than globally so changing them only
# invalidates this last layer, not the whole build.
ARG BUILD_VERSION=dev
ARG BUILD_REVISION=dev
LABEL org.opencontainers.image.title="StayUp web" \
      org.opencontainers.image.description="StayUp dashboard, API and public status pages" \
      org.opencontainers.image.source="https://gitlab.com/HeapReaper/stayup" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="$BUILD_VERSION" \
      org.opencontainers.image.revision="$BUILD_REVISION"

# The same two values as env vars, not only labels: labels are metadata *about*
# the image that the process inside it can't read, and the update checker
# (src/lib/updates.ts) needs to know which version it is in order to compare
# itself against the newest published one.
ENV STAYUP_BUILD_VERSION=$BUILD_VERSION
ENV STAYUP_BUILD_REVISION=$BUILD_REVISION

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts

# Documentation only — doesn't restrict the actual bind port, which follows
# $PORT (default 3000; see .env/.env.example and the `web` service's `ports:`
# in both compose files) via the `dev`/`start` npm scripts.
EXPOSE 3000

# Overridden by the compose files' `command:` for `web`; a sane default if
# this target is ever run standalone.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]

# ---- Go workers ----

# --platform=$BUILDPLATFORM: build the binaries on the *builder's* native
# architecture and cross-compile to the target one below, instead of emulating
# the whole toolchain under QEMU — Go cross-compiles for free, emulation
# doesn't. Only matters for multi-arch `docker buildx build --platform`; a
# plain single-arch build behaves exactly as before.
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS go-builder
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src/worker
COPY worker/go.mod worker/go.sum ./
RUN --mount=type=cache,target=/root/go/pkg/mod go mod download
COPY worker/ .
# CGO_ENABLED=0: both DB drivers (pgx, modernc.org/sqlite) and the ping
# worker's ICMP library are pure Go, so every binary stays static — no libc
# dependency to match at runtime, which is what lets worker-runner below be
# just `alpine` + `ca-certificates` instead of needing glibc/musl-dev shims.
RUN --mount=type=cache,target=/root/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} sh -c '\
    for cmd in https port ping dns probes heartbeat integrations janitor agent; do \
      go build -ldflags="-s -w" -o /out/$cmd ./cmd/$cmd; \
    done'

FROM alpine:3.20 AS worker-runner
# ca-certificates: every worker talks TLS outbound (SMTP, Discord/Slack/
# Telegram/PagerDuty webhooks, Postgres) and needs a trust store to verify it.
RUN apk add --no-cache ca-certificates
COPY --from=go-builder /out/ /usr/local/bin/
WORKDIR /app

ARG BUILD_VERSION=dev
ARG BUILD_REVISION=dev
LABEL org.opencontainers.image.title="StayUp worker" \
      org.opencontainers.image.description="StayUp monitor-check and notification workers (https, port, ping, dns, integrations)" \
      org.opencontainers.image.source="https://gitlab.com/HeapReaper/stayup" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="$BUILD_VERSION" \
      org.opencontainers.image.revision="$BUILD_REVISION"

# Read by worker/internal/version — cmd/janitor runs the daily update check
# and has to know which version is asking. Same values, same reasoning as the
# web image above.
ENV STAYUP_BUILD_VERSION=$BUILD_VERSION
ENV STAYUP_BUILD_REVISION=$BUILD_REVISION

# Overridden by the compose files' `command:` for every worker-* service;
# https is just a sane default if this target is ever run standalone.
CMD ["/usr/local/bin/https"]
