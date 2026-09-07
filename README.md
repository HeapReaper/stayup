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
| **Monitors** | HTTP(s), Ping (ICMP), Port (raw TCP) and DNS checks, at 15s/30s/60s/5m intervals. Per-monitor tags, uptime % over a rolling 30-day window, response-time history and a full ping log. |
| **Incidents** | Opened automatically when a monitor goes Down/Degraded and moved to *Monitoring* on recovery, or created by hand. Impact levels, a status timeline (Investigating → Identified → Monitoring → Resolved), acknowledgement, and post-mortems that can be drafted privately and published later. |
| **Status pages** | Multiple pages, each with its own slug, branding (logo, primary colour, theme), ordered monitor groups, history window (7/30/90 days) and incident feed. Optionally reachable on a custom domain, or locked to signed-in users only. |
| **Maintenance windows** | Scheduled windows that suppress incident creation for the covered monitors while active, and show as "Scheduled maintenance" on the status page instead of an outage. |
| **Integrations** | Discord, Slack, generic Webhook, Telegram, E-mail, PagerDuty (Events API v2) and browser Web Push. Queued, retried up to 5×, with a delivery log. |
| **Escalation policies** | Ordered paging chains ("page on-call, then the team channel after 10 minutes if nobody acknowledged") attachable per monitor. |
| **Subscribers** | E-mail/Discord subscribers per status page, and e-mail subscribers per incident, notified on every incident update. |
| **Logs & audit trail** | Every check, every notification delivery and every significant dashboard action, with actor and IP. |
| **Users** | Invite-only. The first account is created through `/register`; after that self-service sign-up is closed and further users are created from the dashboard. |

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
| `src/lib/settings.ts` | `worker/internal/settings` |
| `src/lib/prisma.ts` | `worker/internal/db` |

A manually created incident and an automatically detected one produce the same incident, timeline and
notification records.

---

## Getting started

### Requirements

- Node.js 20+
- Go 1.25+ (only if you want to run the workers outside Docker)
- Optionally Docker + Docker Compose (runs everything, including Postgres and Redis)

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
go run ./cmd/integrations
```

Nothing in `worker/` hot-reloads: restart a worker after editing its code. `go build -o bin/<name>
./cmd/<name>` writes a standalone binary to the gitignored `worker/bin/`.

### Docker (build from source)

`docker-compose.yml` runs the whole stack: Postgres, Redis, the Next.js app and all five workers.
Use it when you're changing the code; to just *run* StayUp, use the pre-built images below instead.

```bash
cp .env.example .env   # fill in BETTER_AUTH_SECRET, POSTGRES_PASSWORD, SMTP_*, etc.
docker compose up --build
```

`web` and every `worker-*` service build from the same `Dockerfile` but different targets: `web` is
the Node/Next.js image (target `runner`), each `worker-*` is a small `alpine` image holding only that
worker's static Go binary (target `worker-runner`) — no Node runtime in those containers at all.

A few things worth knowing:

- **Postgres only.** Compose forces `DB_PROVIDER=postgresql` and points `DB_URL`/`REDIS_URL` at the
  in-network `postgres`/`redis` hostnames, regardless of what your `.env` says for local `npm run dev`
  (which defaults to SQLite). Running five worker containers against one SQLite file is exactly the
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
| `registry.gitlab.com/heapreaper/stayup/worker` | all five Go binaries — the `command:` decides which one a container runs |

Tags: `latest` (tip of `main`), the release tag on tagged builds, and the commit short SHA on every
build. Pin `latest` for a rolling install, or a tag for a reproducible one.

**`docker-compose.prod.yml` is the deploy file.** It builds nothing, references no local paths and
needs no `.env` next to it, so it can be imported straight from a URL in Portainer, Coolify, Dokploy
or anything else that consumes a compose file:

```
https://gitlab.com/HeapReaper/stayup/-/raw/main/docker-compose.prod.yml
```

or, on a plain Docker host:

```bash
curl -O https://gitlab.com/HeapReaper/stayup/-/raw/main/docker-compose.prod.yml
BETTER_AUTH_SECRET="$(openssl rand -base64 32)" POSTGRES_PASSWORD='pick-one' \
  docker compose -f docker-compose.prod.yml up -d
```

`BETTER_AUTH_SECRET` and `POSTGRES_PASSWORD` are the only required variables — the stack refuses to
start without them rather than booting with a guessable secret. Optional ones (all documented at the
top of the file): `STAYUP_VERSION` (image tag, default `latest`), `STAYUP_REGISTRY`, `PORT`,
`BETTER_AUTH_URL` (set this to your public origin in production), `LOG_LEVEL` and `SMTP_*`.

Then open the app and register — that first account is the only one the public sign-up form ever
creates.

Upgrading is a pull plus a recreate:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

`web` runs `prisma migrate deploy` on every start, so schema changes apply themselves, and the
workers wait for it to report healthy before they touch the database.

The published stack ships Postgres, the app and the five workers — no Redis, since nothing reads or
writes it yet. Images are `linux/amd64`; see the `PLATFORMS` variable in `.gitlab-ci.yml` for
building `linux/arm64` as well.

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
  threshold (above it a check reports **Degraded**), SSL/cert-expiry toggles
- *SMTP* — overrides the `.env` mail settings, with a "send test e-mail" button
- *API* — API key and webhook signing secret (regeneratable), plus the auto-generated VAPID key pair
  used for Web Push

---

## How the monitoring loop works

1. Each check worker polls the DB every 5s for monitors of its type whose `interval` has elapsed
   (`worker/internal/runner`), and checks all due ones concurrently.
2. Every check writes a `MonitorCheck` row — the raw "ping" history, always recorded verbatim.
3. The monitor's rolled-up `status`, `responseTime`, `lastCheckedAt` and 30-day `uptime` are
   recomputed from those rows.
4. A Down/Degraded result is only *reported* as such once `failedAttemptsThreshold` checks in a row
   have failed (default 1 = immediately). Below the threshold the monitor is held at **Up** — a single
   dropped packet or a 502 mid-deploy shouldn't page anyone. The ping history and uptime % still count
   every individual failure.
5. A confirmed Down/Degraded opens an incident, unless the monitor is inside an active maintenance
   window. Recovery moves the open incident to *Monitoring* (a human still resolves it).
6. Each incident event either broadcasts to every enabled integration, or — if the monitor has an
   escalation policy — pages that policy's steps one by one until someone acknowledges. Either way it
   becomes a `Pending` `IntegrationDelivery` row.
7. `worker/cmd/integrations` polls that queue every 5s, delivers each row through its channel, and
   retries up to 5 times before marking it `Failed`. Everything lands in **Dashboard → Logs**.

| Worker | Monitor type | How it checks |
|---|---|---|
| `worker/cmd/https` | `HTTP` | GETs the URL, 2xx = up |
| `worker/cmd/port` | `Port` | Raw TCP connect to `host:port` |
| `worker/cmd/ping` | `Ping` | Burst of 3 native ICMP echoes; any reply = reachable |
| `worker/cmd/dns` | `DNS` | Resolves the hostname's A record(s) |
| `worker/cmd/integrations` | — | Delivers queued notifications and drives escalation |

---

## Project structure

```
src/
  app/
    (public)/            /            → redirects to /login
    (dashboard)/         /dashboard/* → monitors, incidents, maintenance, status pages,
                                        integrations, escalations, users, logs, settings
    (status)/            /status/[slug] → the public status page
    login/ register/ logout/
    api/auth/[...all]/   better-auth handler
    api/trpc/[trpc]/     tRPC handler
    api/public/status-domain/  custom-domain → slug lookup used by the proxy
  components/core/       sidebar, navbar, footer, auto-refresh
  components/ui/         shadcn/ui primitives
  emails/                React Email templates
  lib/                   prisma, auth, settings, incidents, integration-delivery, maintenance,
                         email, discord, push, audit, logging, redis
  prisma/schemas/        sqlite.prisma + postgresql.prisma, each with its own migrations/ folder
  trpc/                  init.ts (context + procedures), client/server helpers, routers/
  validations/           Zod schemas
  proxy.ts               auth redirects + custom-domain rewrite (Next middleware)

worker/                  separate Go module
  cmd/{https,port,ping,dns,integrations}/   one binary each
  internal/checkers/     "how do I check one monitor" per type
  internal/runner/       shared poll → check → persist → incident-sync loop
  internal/store/        hand-written SQL for both providers
  internal/{db,settings,incidents,maintenance,delivery,notify,logging,ids}/
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
cd worker && go vet ./... && gofmt -l .
```

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
- **Web Push** needs a service worker at `public/sw.js`; the browser registers `/sw.js` from the
  Integrations page. VAPID keys are generated automatically on first use.
- **Incident links in worker-sent e-mails** currently hardcode `http://localhost:3000/dashboard/incidents`
  (`worker/internal/incidents`).

## License

See [LICENSE](LICENSE).
