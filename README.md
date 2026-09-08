# StayUp

> **Vibe coded.** Large parts of this codebase were written with AI assistance. The security-relevant
> code — authentication and session handling, the authorization boundary on every tRPC procedure,
> input validation, the middleware redirects and custom-domain rewrite, secret handling and the
> container/deployment setup — and the core of the product (the monitor-check loop, the incident
> lifecycle and the notification/escalation path) were written and reviewed by hand.

Self-hosted uptime monitoring, incident management and public status pages.

StayUp checks your HTTP endpoints, TCP ports, hosts (ICMP) and DNS records on a schedule, opens and
resolves incidents automatically, pages you through Discord/Slack/Telegram/PagerDuty/e-mail/web-push,
and publishes a customer-facing status page with uptime history, incident timelines and scheduled
maintenance notices.

It's a Next.js dashboard plus a set of small standalone Go workers that share one database. No SaaS,
no agent to install on the monitored machines — one `docker compose up` and you're running.

---

## Features

| | |
|---|---|
| **Monitors** | HTTP(s), Ping (ICMP), Port (raw TCP), DNS, PostgreSQL, MySQL, Redis, SMTP, IMAP, gRPC, WebSocket and Domain-expiry checks, at 15s/30s/60s/5m/1h/12h/24h intervals. Pause a monitor without losing its history, tag it, and see uptime % over a rolling 30-day window, response-time history and a full ping log. Timeout, latency threshold and failures-before-alerting are per-monitor overrides of the instance defaults — a nightly batch API and a health endpoint are never usefully held to the same numbers. |
| **HTTP checks** | Beyond "did it answer": request method, headers and body, redirect policy, which status codes count as up (`200,201`, `200-204,301`), and a content assertion on the response body — a substring, an RE2 regex, or a JSON path (`$.db.connected` equals `true`). Any of the three can be inverted. |
| **DNS records** | A DNS monitor picks its record type — `A`, `AAAA`, `CNAME`, `MX`, `NS`, `TXT` or `SRV` — and optionally the value it must contain (matched case-insensitively anywhere in the answer; blank just asserts the record still resolves). The records worth watching on their own are the ones whose loss is invisible to an HTTP check: an `MX` that stops resolving takes mail down while the website stays green, and a `TXT` holding SPF or DKIM can be clobbered by a well-meaning DNS edit and only surface when mail starts bouncing. |
| **Connection checks** | Each speaks just enough of its protocol to prove the service is really answering, not merely listening: PostgreSQL runs `SELECT 1`, MySQL reads the server handshake (or logs in and runs `SELECT 1`, given a `mysql://` connection string), Redis sends `PING`, SMTP does greeting/EHLO/NOOP/QUIT, IMAP reads the `* OK` greeting, gRPC calls `grpc.health.v1.Health/Check` (h2c or TLS), and WebSocket completes the RFC 6455 upgrade — the proxy that answers HTTP but never upgrades fails here and passes every other check. |
| **Domain expiry** | A Domain monitor looks the registration up over RDAP and goes Degraded inside the warning window, Down once the date has passed. A forgotten renewal takes the site, the mail and the certificate with it, and nothing renews it automatically. |
| **TLS certificates** | Every HTTPS check records the certificate's expiry; a monitor goes Degraded — opening an incident and paging your integrations — once it's inside the warning window. Verification can be switched off per instance for self-signed and internal-CA hosts. |
| **Incidents** | Opened automatically when a monitor goes Down/Degraded and moved to *Monitoring* on recovery, or created by hand. Impact levels, a status timeline (Investigating → Identified → Monitoring → Resolved), acknowledgement, and post-mortems that can be drafted privately and published later. |
| **Status pages** | Multiple pages, each with its own slug, branding (logo, primary colour, theme), ordered component groups, history window (7/30/90 days) and incident feed. Optionally reachable on a custom domain, or locked to signed-in users only. |
| **Components** | A line on a status page is usually a monitor, but does not have to be. A component with no monitor behind it — a payment provider, a shipping partner, a feature behind a flag — carries its own name, blurb and a state you set by hand, so "Payments: degraded" needs no endpoint to poll. |
| **Badges & feeds** | `/status/<slug>/badge/<id>.svg` renders an embeddable shields-style badge for any component — `?metric=uptime` for the percentage, `overall` for the whole page, `?label=` to retitle it. `/status/<slug>/feed.xml` and `/atom.xml` publish the incident history as RSS 2.0 and Atom 1.0: no account, no confirmation, no unsubscribe. All of them work on a custom domain too. |
| **Maintenance windows** | Scheduled windows that suppress incident creation for the covered monitors while active, and show as "Scheduled maintenance" on the status page instead of an outage. |
| **Integrations** | Discord, Slack, generic Webhook, Telegram, E-mail, PagerDuty (Events API v2) and browser Web Push. Queued, retried up to 5×, with a delivery log. Discord alerts arrive as embeds — monitor, incident status, impact, endpoint, response time, 30-day uptime and a relative "last check", colour-coded by severity. |
| **Escalation policies** | Ordered paging chains ("page on-call, then the team channel after 10 minutes if nobody acknowledged") attachable per monitor. Each rung targets either a fixed integration or an on-call schedule. |
| **On-call schedules** | Daily or weekly rotations with a handoff hour in the team's own timezone, and overrides for "I'm ill this week" — including an override that covers a window with *nobody*, so paging falls through to the next step instead of waking someone who is away. A rotation step resolves at the moment it fires, not when the incident opened. |
| **Notification routing** | Ordered rules deciding where an alert goes when its monitor has no escalation policy: match on tag, monitor or impact, restrict to a weekday/time window in the instance timezone, and either route to specific integrations or suppress entirely. "Staging alerts only during office hours, and only to #dev" is one row. With no rules, the original broadcast-to-everything behaviour is unchanged. |
| **Flapping detection** | "Failed attempts before alerting" debounces one dip; this catches the opposite — a monitor that alternates up and down all afternoon. Past N transitions in a rolling window it is marked flapping, and one standing incident replaces the storm until it settles. |
| **SLA reports** | Per-monitor uptime, p50/p95/p99 and max response time per calendar month, against an optional per-monitor SLO target with the error budget it spent. CSV export and a print-to-PDF layout. Read from the daily rollups, so a month older than your raw-check retention still reports. |
| **Subscribers** | E-mail/Discord subscribers per status page, and e-mail subscribers per incident, notified on every incident update. |
| **Logs & audit trail** | Every check, every notification delivery and every significant dashboard action, with actor and IP. |
| **Retention** | Raw checks and finished notifications are pruned on a schedule you set, after each day is summarized into a rollup (counts, average *and* the response-time percentiles) — so a 90-day status page and a year-old SLA report keep working on a 7-day raw retention. |
| **Users & roles** | Invite-only. The first account is created through `/register` (and is an Admin); after that self-service sign-up is closed and further users are invited from the dashboard. **Admin** runs the instance (accounts, settings), **Member** runs the monitoring, **Viewer** reads. Everyone can edit their own profile. |
| **Worker health** | Every worker writes a heartbeat each tick, so the dashboard names the worker that stopped instead of leaving you to infer it from monitors that went quiet. `/api/health` reports the same thing, and is what the containers' healthcheck uses. |
| **Update checks** | Knows which build it is running and, once a day, whether a newer one has been published — shown on Settings → Updates and as a badge in the sidebar. Switchable off; nothing is ever installed automatically. |

## Stack

- **Next.js 16** (App Router, React 19, React Compiler) + **TypeScript**
- **tRPC 11** + **TanStack Query** for the API layer
- **Prisma 7** with driver adapters — **SQLite** (dev) or **PostgreSQL** (production)
- **better-auth** (e-mail/password) for sessions
- **Tailwind CSS 4** + **shadcn/ui** (Base UI) + Lucide + Framer Motion + Recharts
- **Go 1.25** for the monitor-check and notification workers (`worker/`)
- **Biome** for lint/format, **Winston** for logging, **React Email** + Nodemailer for mail

---

## Architecture

```
                          ┌──────────────────────────┐
   browser ──────────────►│  Next.js app  (src/)     │
                          │  dashboard, status pages │
                          │  tRPC API, better-auth   │
                          └────────────┬─────────────┘
                                       │ Prisma
                          ┌────────────▼─────────────┐
                          │  PostgreSQL  or  SQLite  │
                          └────────────▲─────────────┘
                                       │ hand-written SQL (no Prisma)
   ┌───────────────────────────────────┴────────────────────────────────────┐
   │  Go workers (worker/) — one process each, no Node runtime              │
   │  https · port · ping · dns   →  check monitors, write pings/incidents  │
   │  probes                      →  database/mail/gRPC/WebSocket/domain    │
   │  integrations                →  deliver queued notifications, escalate │
   └───────────────────────────────────┬────────────────────────────────────┘
                                       ▼
                    Discord · Slack · Telegram · PagerDuty · SMTP · Web Push
```

The database is the only thing the app and the workers share — there is no RPC between them. The
dashboard queues work by writing rows (`IntegrationDelivery`), and the workers pick them up on their
next poll. That's also why the workers can be scaled, restarted or run on another host independently
of the web app.

Two code paths deliberately mirror each other, and must stay behaviourally identical:

| TypeScript (dashboard actions) | Go (automatic, worker-driven) |
|---|---|
| `src/lib/incidents.ts` | `worker/internal/incidents` |
| `src/lib/integration-delivery.ts` | `worker/internal/delivery` + `worker/internal/notify` |
| `src/lib/maintenance.ts` | `worker/internal/maintenance` |
| `src/lib/oncall.ts` | `worker/internal/oncall` |
| `src/lib/notification-rules.ts` | `worker/internal/routing` |
| `src/lib/assertions.ts` (validation) | `worker/internal/checkers/assert.go` (evaluation) |
| `src/lib/email.ts` | `worker/internal/notify/email.go` |
| monitor overrides (`monitor.ts` router) | `worker/internal/settings`'s `ForMonitor` |
| `src/lib/settings.ts` | `worker/internal/settings` |
| `src/lib/prisma.ts` | `worker/internal/db` |
| `src/lib/updates.ts` | `worker/internal/updates` |

A manually created incident and an automatically detected one produce the same incident, timeline and
notification records.

---

## Resource usage

The whole stack idles at roughly **250 MB of RAM** across nine containers, so a 1 GB VPS is
comfortable. Measured with `docker stats` on an idle instance (no monitors configured yet) running
the pre-built images from `docker-compose.yaml`:

| Container | Idle memory |
|---|---|
| `web` (Next.js) | 146 MiB |
| `postgres` | 78 MiB |
| `worker-port` | 3.7 MiB |
| `worker-https` | 3.3 MiB |
| `worker-dns` | 3.1 MiB |
| `worker-probes` | ~3 MiB \* |
| `worker-integrations` | 3.1 MiB |
| `worker-ping` | 3.0 MiB |
| `worker-janitor` | 2.8 MiB |
| **Total** | **~246 MiB** |

\* `worker-probes` is estimated: the eight other figures are measured, and every worker is the same
binary shape. The eight measured containers come to 243 MiB.

Almost all of it is the Node runtime and Postgres; all seven Go workers together account for about
22 MiB, or under 10% of the total. That is the point of the Go rewrite — adding a worker costs a few
megabytes, not a whole V8 heap, so the per-worker footprint stays flat as you scale checks out.

Adding monitors barely moves these numbers. Each worker loads the monitors of its own type once per
poll (`store.ListByType`) and drops them again, and a monitor row is a few hundred bytes — hundreds
of monitors are still well under a megabyte of working set. What actually grows is the *database*,
and how fast is up to your retention settings in Dashboard → Settings → Monitoring, where the
janitor rolls finished days up into daily summaries and deletes the raw checks behind them.

Reproduce it yourself with:

```bash
docker compose up -d
docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}'
```

---

## Getting started

### Requirements

- Node.js 20+
- Go 1.25+ (only if you want to run the workers outside Docker)
- Optionally Docker + Docker Compose (runs everything, including Postgres and Redis)
- ~250 MB of RAM for the full Docker stack — see [Resource usage](#resource-usage)

### Local development

```bash
git clone git@gitlab.com:HeapReaper/stayup.git
cd stayup
npm install

cp .env.example .env          # set BETTER_AUTH_SECRET, DB_URL, SMTP_*, ...
npx prisma generate           # generates the client for $DB_PROVIDER
npx prisma migrate dev        # applies the migration history for $DB_PROVIDER

npm run dev                   # http://localhost:3000
```

Open `/register` and create the first account — that's the only time the public sign-up form works.
Every further user is created from **Dashboard → Users**.

The workers are separate processes; start the ones you need in their own terminals:

```bash
cd worker
go run ./cmd/https
go run ./cmd/port
go run ./cmd/ping          # opens a raw ICMP socket — needs CAP_NET_RAW (sudo) outside Docker
go run ./cmd/dns
go run ./cmd/probes       # Postgres, MySQL, Redis, SMTP, IMAP, gRPC, WebSocket, Domain
go run ./cmd/integrations
go run ./cmd/janitor      # retention + daily rollups; one pass at startup, then once per UTC day
```

Nothing in `worker/` hot-reloads: restart a worker after editing its code. `go build -o bin/<name>
./cmd/<name>` writes a standalone binary to the gitignored `worker/bin/`.

### Docker (build from source)

`docker-compose.build.yml` runs the whole stack — Postgres, Redis, the Next.js app and all seven
workers — built from your checkout. Use it when you're changing the code; to just *run* StayUp, use
the pre-built images below instead (that's what the default `docker-compose.yaml` does).

```bash
cp .env.example .env   # fill in BETTER_AUTH_SECRET, POSTGRES_PASSWORD, SMTP_*, etc.
docker compose -f docker-compose.build.yml up --build
```

`web` and every `worker-*` service build from the same `Dockerfile` but different targets: `web` is
the Node/Next.js image (target `runner`), each `worker-*` is a small `alpine` image holding only that
worker's static Go binary (target `worker-runner`) — no Node runtime in those containers at all.

A few things worth knowing:

- **Postgres only.** Compose forces `DB_PROVIDER=postgresql` and points `DB_URL`/`REDIS_URL` at the
  in-network `postgres`/`redis` hostnames, regardless of what your `.env` says for local `npm run dev`
  (which defaults to SQLite). Running six worker containers against one SQLite file is exactly the
  concurrent-writer situation SQLite isn't built for.
- **No dedicated `migrate` service.** Only `web` runs `prisma migrate deploy` (the Go workers carry
  neither Prisma nor Node); every `worker-*` service waits for `web` to become *healthy*, and that
  healthcheck only passes once it's serving requests — i.e. after migrations were applied — so workers
  never race a cold database. Everything stays a long-lived service on purpose: some platforms
  (Coolify) don't reliably handle an intentionally-exiting one-shot container inside a compose stack.
- **`PORT`** is honoured by the app, the compose port mapping and the healthcheck (default 3000).

---

## Deploying with pre-built images

Every push to `main` and every git tag publishes two images to the GitLab container registry
(`.gitlab-ci.yml`), both built from the one `Dockerfile` in this repo:

| Image | Contains |
|---|---|
| `registry.gitlab.com/heapreaper/stayup/web` | the Next.js app (dashboard, API, status pages) |
| `registry.gitlab.com/heapreaper/stayup/worker` | all seven Go binaries — the `command:` decides which one a container runs |

Tags: `latest` (tip of `main`), the release tag on tagged builds, and the commit short SHA on every
build. Pin `latest` for a rolling install, or a tag for a reproducible one.

**`docker-compose.yaml` — the repo's default compose file — is the deploy file.** It builds nothing,
references no local paths and needs no `.env` next to it, so it can be imported straight from a URL
in Portainer, Coolify, Dokploy or anything else that consumes a compose file:

```
https://gitlab.com/HeapReaper/stayup/-/raw/main/docker-compose.yaml
```

or, on a plain Docker host:

```bash
curl -O https://gitlab.com/HeapReaper/stayup/-/raw/main/docker-compose.yaml
BETTER_AUTH_SECRET="$(openssl rand -base64 32)" POSTGRES_PASSWORD='pick-one' \
  docker compose up -d
```

`BETTER_AUTH_SECRET` and `POSTGRES_PASSWORD` are the only required variables — the stack refuses to
start without them rather than booting with a guessable secret. Keep `POSTGRES_PASSWORD`
alphanumeric (`openssl rand -hex 24`): it is substituted into `DB_URL`, and a URL's userinfo field
can't carry `@ / ? # [ ] %` or spaces unescaped — the Go workers reject such a connection string
outright and restart-loop. Optional ones (all documented at the
top of the file): `STAYUP_VERSION` (image tag, default `latest`), `STAYUP_REGISTRY`, `PORT`,
`BETTER_AUTH_URL` (set this to your public origin in production), `LOG_LEVEL` and `SMTP_*`.

Then open the app and register — that first account is the only one the public sign-up form ever
creates, and it is an Admin. Everyone after that is invited from Dashboard → Users with a role.

The stack is healthy once `web`'s healthcheck goes green, which now means `/api/health` answered
200 — i.e. the database is reachable *and* `prisma migrate deploy` has finished. The workers wait
for exactly that before they start.

Upgrading is a pull plus a recreate:

```bash
docker compose pull
docker compose up -d
```

`web` runs `prisma migrate deploy` on every start, so schema changes apply themselves, and the
workers wait for it to report healthy before they touch the database.

The published stack ships Postgres, the app and the seven workers — no Redis, since nothing reads or
writes it yet. Images are `linux/amd64`; see the `PLATFORMS` variable in `.gitlab-ci.yml` for
building `linux/arm64` as well.

### Coolify

`docker-compose.yaml` deploys in Coolify as-is, but it publishes port 3000 on the host — *beside*
Coolify's proxy rather than behind it, so the dashboard ends up reachable over plain HTTP next to
its TLS-terminated domain. `docker-compose.coolify.yaml` is the same stack with that corrected:
`expose:` instead of `ports:`, the internal port fixed at 3000 (Coolify's routing variable embeds
the port in its *name*, `SERVICE_FQDN_WEB_3000`, so it can't be interpolated), and
`BETTER_AUTH_SECRET` generated by Coolify's `SERVICE_REALBASE64_64_*` magic variable instead of
typed in.

> New Resource → Public Repository → `https://gitlab.com/HeapReaper/stayup`
> Build Pack: **Docker Compose**, Docker Compose Location: `/docker-compose.coolify.yaml`

(Or "Docker Compose Empty" and paste the file, to edit it in the UI instead of tracking the repo.)

Two values to fill in under *Environment Variables*, because a `SERVICE_*` magic variable only
substitutes where it is the entire value of a variable: `POSTGRES_PASSWORD` (alphanumeric — it goes
inside `DB_URL`) and `BETTER_AUTH_URL` (the exact public origin, scheme included — better-auth
validates every sign-in against it and answers *Invalid origin* on a mismatch, and behind a
TLS-terminating proxy it cannot infer the `https://` itself). Coolify still assigns `web` a domain
on your wildcard domain, or uses the hostname you set under the service's *Domains* — just make
sure `BETTER_AUTH_URL` says the same thing. Status pages on custom domains go
on that **same** service — Coolify accepts several, comma-separated — and `src/proxy.ts` matches
them on the `Host` header.

Two things it doesn't do for you. The bundled `postgres` is a plain compose service, not a Coolify
*managed database*, so the backup scheduler ignores it: schedule your own `pg_dump`, or delete the
service and point `DB_URL` at a managed Postgres. And upgrades stay manual — Redeploy while on
`latest`, or bump `STAYUP_VERSION` to a release tag first.

### Knowing when to update

Both images are stamped at build time with the git tag (or commit short SHA) they were built from,
and the running process reads that back — so StayUp can tell you when it's behind. **Dashboard →
Settings → Updates** shows the running build, the newest published one and a badge in the sidebar
when they differ; `worker/cmd/janitor` refreshes that once a day, and the tab has a "Check now"
button for the impatient. It is the only outbound request StayUp makes that isn't a monitor check or
a notification, and it can be switched off on that same tab.

What it compares against follows how you deployed, because an image tag is all a container knows
about itself:

| `STAYUP_VERSION` | Build is stamped | Compared against |
|---|---|---|
| a release tag (`v1.4.0`) | `v1.4.0` | the project's newest release tag, prereleases skipped |
| `latest` | the commit short SHA | the newest commit on `main` |
| built locally | `dev` | nothing — the tab says so rather than guessing |

Nothing installs itself: a container can't replace its own image. An available update is reported,
and you run `docker compose pull && docker compose up -d` (or Redeploy on Coolify) when it suits
you — `web` applies any pending migrations on start.

Running a fork? Point the checker at your own project with `STAYUP_UPDATE_PROJECT_API` (a GitLab
REST project endpoint, e.g. `https://gitlab.com/api/v4/projects/<url-encoded path>`),
`STAYUP_UPDATE_WEB_URL` and `STAYUP_UPDATE_BRANCH`.

---

## Configuration

Two layers, on purpose:

**`.env` — infrastructure**, read at process start by both the app and the workers.

| Variable | Notes |
|---|---|
| `DB_PROVIDER` | `sqlite` or `postgresql`. Selects the Prisma schema *and* migration folder. |
| `DB_URL` | `file:./dev.db` or `postgresql://user:pass@host:5432/stayup?schema=public` |
| `BETTER_AUTH_SECRET` | Long random string. Required. |
| `BETTER_AUTH_URL` | Public origin of the app; also used to recognise this app's own hostname during custom-domain rewrites. |
| `PORT` | Port `next dev`/`next start` binds to (default 3000). |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Fallback mail transport. |
| `REDIS_URL` | Optional; a helper exists (`src/lib/redis.ts`) but nothing depends on it yet. |
| `LOG_LEVEL` | `debug` \| `info` \| `warning` \| `error` |
| `POSTGRES_PASSWORD` | Docker Compose only — the password of the `postgres` container. |

**Dashboard → Settings — runtime behaviour**, stored in the single-row `AppSettings` table and read
live by the workers on every tick. Changing these takes effect on the *next check*, no restart:

- *General* — organisation name, timezone, support e-mail
- *Monitoring defaults* — default interval, HTTP timeout, failed attempts before alerting, latency
  threshold (above it a check reports **Degraded**), TLS verification, the certificate- and
  domain-expiry warning windows, flapping detection (transitions and window), and how long raw
  checks and finished notifications are kept. The timeout, latency threshold and failure count are
  each overridable per monitor, on the monitor's own form; blank there means "use these
- *SMTP* — overrides the `.env` mail settings **per field** (blank falls back to `SMTP_*`), applied to
  the very next send by both the app and the workers, with a "send test e-mail" button that reports
  the mail server's own error
- *API* — API key and webhook signing secret (regeneratable), plus the auto-generated VAPID key pair
  used for Web Push
- *Updates* — which build is running, whether a newer one exists, and whether to look once a day

---

## How the monitoring loop works

1. Each check worker polls the DB every 5s for monitors of its type whose `interval` has elapsed and
   that aren't paused (`worker/internal/runner`), and checks all due ones concurrently. Each check
   resolves the monitor's own timeout/latency/failure-count overrides over the instance defaults
   first (`settings.ForMonitor`), so everything downstream reads one already-resolved value.
2. Every check writes a `MonitorCheck` row — the raw "ping" history, always recorded verbatim.
3. The monitor's rolled-up `status`, `responseTime`, `lastCheckedAt` and 30-day `uptime` are
   recomputed from those rows.
4. A Down/Degraded result is only *reported* as such once `failedAttemptsThreshold` checks in a row
   have failed (default 1 = immediately). Below the threshold the monitor is held at **Up** — a single
   dropped packet or a 502 mid-deploy shouldn't page anyone. The ping history and uptime % still count
   every individual failure.
5. For HTTP monitors, "did it pass" means: the status code is accepted, the keyword assertion holds,
   and — if it's HTTPS — the certificate isn't about to expire. The first two failing make it Down;
   an expiring certificate or a slow response make it Degraded.
6. Status transitions over a rolling window are counted; past the flapping threshold the monitor is
   marked flapping and steps 6–7 are suppressed until it settles, with one standing "is flapping"
   incident in place of the churn.
7. A confirmed Down/Degraded opens an incident, unless the monitor is inside an active maintenance
   window or is flapping. Recovery moves the open incident to *Monitoring* (a human still resolves it).
8. Each incident event either follows the notification rules (route to specific integrations, or
   suppress during quiet hours), broadcasts to every enabled integration when no rule applies, or —
   if the monitor has an escalation policy — pages that policy's steps one by one until someone
   acknowledges. A step targeting an on-call schedule resolves the rotation at the moment it fires.
   Either way it becomes a `Pending` `IntegrationDelivery` row.
9. `worker/cmd/integrations` polls that queue every 5s, delivers each row through its channel, and
   retries up to 5 times before marking it `Failed`. Everything lands in **Dashboard → Logs**.
10. Once a day `worker/cmd/janitor` summarizes each finished day into one `MonitorDailyStat` row per
   monitor — counts, average and nearest-rank p50/p95/p99 — then deletes raw checks and finished notifications past their retention. Status pages read
   those summaries for past days, so history outlives the checks it was built from.

| Worker | Monitor type | How it checks |
|---|---|---|
| `worker/cmd/https` | `HTTP` | GETs the URL, 2xx = up |
| `worker/cmd/port` | `Port` | Raw TCP connect to `host:port` |
| `worker/cmd/ping` | `Ping` | Burst of 3 native ICMP echoes; any reply = reachable |
| `worker/cmd/dns` | `DNS` | Resolves the hostname's A record(s) |
| `worker/cmd/probes` | `Postgres`, `MySQL`, `Redis`, `SMTP`, `IMAP`, `gRPC`, `WebSocket`, `Domain` | Opens a connection and speaks the minimum that proves the service answers |
| `worker/cmd/integrations` | — | Delivers queued notifications and drives escalation |
| `worker/cmd/janitor` | — | Rolls finished days up into daily summaries, prunes past retention, and runs the daily update check |

Every one of them upserts a row into `worker_heartbeat` at the top of each tick, which is what
**Dashboard → Overview** and `/api/health` read to tell "this worker isn't running" apart from
"this monitor has no checks yet".

---

## Project structure

```
src/
  app/
    (public)/            /            → redirects to /login
    (dashboard)/         /dashboard/* → monitors, incidents, maintenance, status pages,
                                        integrations, escalations, on-call, routing, reports,
                                        users, logs, settings
    (status)/            /status/[slug] → the public status page
                         /status/[slug]/badge/[component] → embeddable SVG badge
                         /status/[slug]/{feed,atom}.xml   → incident feeds
    login/ register/ logout/
    api/auth/[...all]/   better-auth handler
    api/trpc/[trpc]/     tRPC handler
    api/public/status-domain/  custom-domain → slug lookup used by the proxy
  components/core/       sidebar, navbar, footer, auto-refresh
  components/ui/         shadcn/ui primitives
  emails/                React Email templates
  lib/                   prisma, auth, settings, incidents, integration-delivery, maintenance,
                         email, discord, push, audit, logging, redis,
                         oncall, notification-rules, assertions, badge, status-feed
  prisma/schemas/        sqlite.prisma + postgresql.prisma, each with its own migrations/ folder
  trpc/                  init.ts (context + procedures), client/server helpers, routers/
  validations/           Zod schemas
  proxy.ts               auth redirects + custom-domain rewrite (Next middleware)

worker/                  separate Go module
  cmd/{https,port,ping,dns,probes,integrations,janitor}/   one binary each
  internal/checkers/     "how do I check one monitor" per type
  internal/runner/       shared poll → check → persist → incident-sync loop
  internal/store/        hand-written SQL for both providers
  internal/{db,settings,incidents,maintenance,delivery,notify,logging,ids}/
  internal/oncall/       who holds the pager at a given instant
  internal/routing/      which integrations an alert goes to, and when
  internal/flapping/     transition counting and flapping state
```

Every dashboard page is split into a server component (`page.tsx`, fetches via the direct tRPC
`caller`) and a client component (`*-client.tsx`, mutations and interactivity).

---

## Working in this codebase

### tRPC

Add a router in `src/trpc/routers/` and register it in `_app.ts`. Use `protectedProcedure` for
anything behind the dashboard, `baseProcedure` only for genuinely public endpoints (the status page
and its subscribe forms).

```ts
export const exampleRouter = createTRPCRouter({
  getAll: protectedProcedure.query(async () => prisma.monitor.findMany()),
});
```

Server side (React Server Components):

```ts
import { caller } from '@/trpc/server';
const monitors = await caller.monitor.getAll();
```

Client side:

```tsx
const trpc = useTRPC();
const { data, isLoading } = useQuery(trpc.monitor.getAll.queryOptions());
```

No superjson transformer is configured, so `Date`s must be serialised to ISO strings inside the
router — see `serializeMonitor` in `src/trpc/routers/monitor.ts`.

### Database

Schemas live in `src/prisma/schemas/{sqlite,postgresql}.prisma` and are kept in sync by hand; a
schema change means writing **both** and generating a migration in **both** histories
(`src/prisma/schemas/migrations/<provider>/`). `prisma.config.ts` picks the pair based on
`DB_PROVIDER`. The Go workers don't use Prisma — a new column they need must also be added to the
relevant query in `worker/internal/store/`.

### Logging

```ts
import { logger } from '@/lib/logging';
logger.info('[Mail] Welcome email sent');   // also .error() / .debug()
```

Writes to the console and to `logs/`. The Go side has the same interface in `worker/internal/logging`.

### E-mail

```ts
import { sendEmail } from '@/lib/email';
await sendEmail({ to, subject: 'Welcome', react: WelcomeEmail({ name }) });
```

Templates are React Email components in `src/emails/`. The workers send mail themselves through
`worker/internal/notify` with plain Go templates — a template change usually needs to be made twice.

### Audit logging

Every significant mutation records one:

```ts
await logAudit({ actorId, actorName, action: 'CREATED_MONITOR', target: monitor.name, ipAddress: ctx.ipAddress });
```

### UI

shadcn/ui components live in `src/components/ui/` (style `base-nova`, base colour `mauve`). Re-theme
via [ui.shadcn.com/create](https://ui.shadcn.com/create) → *Get code* → *Existing project*.

### Lint & format

```bash
npm run lint      # biome check
npm run format    # biome format --write
cd worker && go vet ./... && go test ./...
```

The Go workers have unit tests for the HTTP checker's request options, status-code spec and
certificate-expiry logic (`worker/internal/checkers/http_test.go`). There is no test suite on the
TypeScript side.

---

## Deployment notes

- **Images and CI.** `.gitlab-ci.yml` builds `web` (target `runner`) and `worker` (target
  `worker-runner`) with buildx, caching to a `:buildcache` tag in the registry, and pushes them with
  the job token — no registry credentials to configure. Non-default branches can build the images
  manually from an MR pipeline without moving `latest`.
- **Custom status-page domains.** Setting `customDomain` on a status page makes `src/proxy.ts`
  rewrite requests for that host to `/status/<slug>`. Pointing the DNS record at this app and
  terminating TLS for it is the operator's job.
- **Behind a reverse proxy.** Internal calls use `http://127.0.0.1:$PORT` on purpose: with TLS
  terminated at the edge, dialling the public origin would attempt TLS against a plaintext server.
- **Web Push** is served by `public/sw.js`, which the Integrations page registers as `/sw.js`. VAPID
  keys are generated automatically on first use. Browsers only allow it over HTTPS (or localhost).
- **Incident links in worker-sent e-mails** currently hardcode `http://localhost:3000/dashboard/incidents`
  (`worker/internal/incidents`).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, what to run before pushing, and how to add a
migration without breaking the other provider's history. [AGENTS.md](AGENTS.md) is the architecture
guide behind it — worth reading first whether you're a person or an AI assistant.

## License

Apache-2.0 — see [LICENSE](LICENSE).
