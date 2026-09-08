# AGENTS.md

Working notes for AI coding agents (and new contributors) on **StayUp**. Read `README.md` first for
what the product does; this file is about how to change it without breaking things.

---

## 1. The one-paragraph mental model

StayUp is **two runtimes sharing one database**: a Next.js 16 app (`src/`, TypeScript, Prisma, tRPC)
and a Go module of standalone workers (`worker/`, hand-written SQL, no Prisma). They never call each
other — all coordination happens through database rows. The dashboard queues work by inserting
`IntegrationDelivery` rows; the workers poll for them. Anything a worker needs to know about
configuration lives in the single-row `AppSettings` table, which the workers re-read on every tick.

## 2. Repository map

| Path | What lives there |
|---|---|
| `src/app/(dashboard)/dashboard/*` | Authenticated pages. Always a pair: `page.tsx` (server component, fetches via the tRPC `caller`) + `*-client.tsx` (`'use client'`, mutations/interactivity). |
| `src/app/(status)/status/[slug]` | The public status page. |
| `src/app/(public)`, `login/`, `register/`, `logout/` | Auth surfaces. `/` redirects to `/login`. |
| `src/app/api/` | better-auth handler, tRPC handler, and `public/status-domain` (custom-domain → slug lookup for the proxy). |
| `src/trpc/routers/` | The entire API. `init.ts` defines `baseProcedure` / `protectedProcedure`; `_app.ts` is the registry. |
| `src/lib/` | Server-side domain logic and clients (prisma, auth, settings, incidents, integration-delivery, maintenance, email, discord, push, audit, logging, redis, updates, version, permissions, workers). |
| `src/lib/permissions.ts` | The whole authorization model: roles → capabilities. Enforced only by `capabilityProcedure` in `src/trpc/init.ts`. |
| `src/app/api/health/` | Unauthenticated container healthcheck. 200/503 on the *database*; worker liveness is reported but never fails it. |
| `src/prisma/schemas/` | `sqlite.prisma` and `postgresql.prisma` **plus one migration folder each**. |
| `src/proxy.ts` | Next middleware: auth redirects + custom-domain rewrite. |
| `Dockerfile` | Both images: `runner` (web) and `worker-runner` (all six Go binaries). |
| `docker-compose.build.yml` | Builds from source — the contributor stack. |
| `docker-compose.yaml` | Pulls published images — the *user* stack, imported by URL. Standalone: no build context, no `.env`, no local paths. |
| `docker-compose.coolify.yaml` | The same user stack behind Coolify's proxy: `expose:` instead of `ports:`, port fixed at 3000, secrets from Coolify's `SERVICE_*` magic variables. |
| `.gitlab-ci.yml` | SAST + secret detection, and the two image-build jobs. |
| `worker/cmd/*` | One `main.go` per binary: `https`, `port`, `ping`, `dns`, `integrations`, `janitor`. |
| `worker/internal/checkers/` | "How do I check one monitor" — one function per monitor type. |
| `worker/internal/runner/` | The shared poll → check → persist → roll-up → incident-sync loop. |
| `worker/internal/store/` | All SQL. Both providers, one query string each. |
| `worker/internal/{incidents,delivery,notify,maintenance,settings,db,logging,ids,updates,version}/` | Go counterparts of the matching `src/lib/` files. |
| `worker/internal/store/janitor.go` | Retention + rollup SQL, plus `RecordHeartbeat`. The part of the Go side with no TypeScript counterpart — the dashboard never prunes, aggregates or writes heartbeats. |
| `worker/cmd/janitor` | Daily pass: roll up → prune → update check. The update check is last and non-fatal, so a GitLab outage can't cost a day of rollups. |
| `public/sw.js` | Service worker for Web Push. Third place the push payload shape is written down, after `src/lib/push.ts` and `worker/internal/notify/push.go`. |

## 3. Invariants — break these and things silently diverge

1. **The TS/Go mirror pairs must stay behaviourally identical.** A manual dashboard action and an
   automatic worker action must produce the same rows.

   | TypeScript | Go |
   |---|---|
   | `src/lib/incidents.ts` | `worker/internal/incidents` |
   | `src/lib/integration-delivery.ts` | `worker/internal/delivery` + `worker/internal/notify` |
   | `src/lib/maintenance.ts` | `worker/internal/maintenance` |
   | `src/lib/settings.ts` | `worker/internal/settings` |
   | `src/lib/prisma.ts` | `worker/internal/db` |
   | `src/lib/updates.ts` | `worker/internal/updates` (+ `version.ts` / `internal/version`) |
   | `src/emails/*.tsx` | `worker/internal/notify/email_templates.go` |

   Changing notification wording, incident-lifecycle rules or delivery behaviour on one side without
   the other is the single most common way to break this repo.

2. **Two Prisma schemas, two migration histories.** `src/prisma/schemas/sqlite.prisma` and
   `postgresql.prisma` are maintained by hand and must be kept in sync. A schema change means editing
   both and generating a migration under both `src/prisma/schemas/migrations/sqlite/` and
   `.../postgresql/`. `prisma.config.ts` picks the pair from `DB_PROVIDER`.

3. **The Go workers don't know about Prisma.** A new column they need must also be added to the
   relevant `SELECT`/`INSERT` in `worker/internal/store/`, and the SQL must work on both SQLite and
   Postgres (`worker/internal/db` handles placeholders, timestamps and booleans — use it, don't
   hand-roll provider branches in `store/`).

4. **Authorization is one file plus one procedure builder.** `src/lib/permissions.ts` maps the three
   roles (`Admin` | `Member` | `Viewer`) onto capabilities; `capabilityProcedure('x:write')` in
   `src/trpc/init.ts` is the only thing that enforces them. Every mutation that changes shared state
   goes through one — queries stay on `protectedProcedure`, because *reading* is not gated by role.

   Three things that are easy to get wrong:
   - **A new mutation is ungated unless you pick a capability for it.** `protectedProcedure` still
     means "any signed-in user", so it's the thing to check in review.
   - The role is read from the database on every call, never from the session — a session cookie
     carries whatever the role was at sign-in, so reading it there would leave a demoted user at
     full strength until their session expired.
   - `normalizeRole()` maps anything unrecognised onto `Admin`, including better-auth's own default
     (`"user"`, which is what the first `/register` account gets). That's deliberate: the
     alternative locks the only account out of the instance it just created.

   `user.updateProfile` is the one mutation that is deliberately only `protectedProcedure`: it edits
   the caller's own account and nothing else.

5. **No superjson transformer.** Serialise `Date` → ISO string inside routers, so the RSC `caller`
   and the HTTP client return identical shapes. Follow `serializeMonitor` in
   `src/trpc/routers/monitor.ts`.

6. **Every meaningful mutation writes an audit-log entry** via `logAudit(...)` with
   `ctx.ipAddress`. Match the existing `ACTION_VERB_NOUN` naming (`CREATED_MONITOR`,
   `RESOLVED_INCIDENT`, …).

7. **`AppSettings` is a singleton** (`id = "singleton"`). Always read it through `getSettings()`
   (TS) / `settings.Get()` (Go) — those create the row, generate the API key/webhook secret, and
   lazily backfill VAPID keys. Never `prisma.appSettings.findFirst()` directly.

8. **Raw check history is sacred.** `MonitorCheck` rows always record what actually happened. Only
   the monitor's *rolled-up* status is debounced by `failedAttemptsThreshold`
   (`confirmedStatus` in `worker/internal/runner/runner.go`). Don't "fix" uptime by not writing rows.

9. **Three compose files, kept in step.** `docker-compose.build.yml` (build from source),
   `docker-compose.yaml` (published images) and `docker-compose.coolify.yaml` (published images
   behind Coolify's proxy) describe the same stack. A change to services, commands, capabilities,
   healthchecks or environment in one belongs in the others too. The two deploy files must stay
   standalone — no `build:`, no `env_file:`, no relative paths — or importing them by URL breaks.
   Adding a worker binary means touching the `for cmd in …` loop in the `Dockerfile` and adding a
   service to **all three** compose files.

   Only three things may differ between `docker-compose.yaml` and the Coolify variant, and each is
   forced by the proxy in front of it: `web` uses `expose:` rather than publishing a host port;
   `PORT` is hardcoded to 3000 (Coolify's `SERVICE_FQDN_WEB_3000` embeds the port in the variable
   *name*, so it can't be interpolated); and `BETTER_AUTH_URL`/`BETTER_AUTH_SECRET` come from
   Coolify's `SERVICE_URL_WEB_3000`/`SERVICE_REALBASE64_64_AUTH` instead of `${VAR:-…}`/`${VAR:?}`.
   Anything else diverging is a bug.

   A `SERVICE_*` magic variable may only ever be the *whole* value of an environment variable.
   Coolify does not substitute one inside a longer string, so `POSTGRES_PASSWORD` stays a plain
   `${VAR:?}` in both files: it also appears in the middle of `DB_URL`, where a magic variable
   would silently resolve to an empty password and the app would fail to authenticate (P1000)
   against a database that came up fine. `BETTER_AUTH_URL` is hand-set for a related reason —
   `SERVICE_URL_WEB_3000` is empty until Coolify has assigned the domain, and an empty base URL
   makes better-auth infer `http://` from the request and reject the proxy's `https://` origin
   with "Invalid origin".

   Two deploy traps worth knowing, both reported as something else entirely: a `POSTGRES_PASSWORD`
   containing `@ / ? # [ ] %` or a space makes every Go worker die at startup on
   `net/url: invalid userinfo` (pgx parses `DB_URL` as a URL; Prisma is no happier), and a
   `BETTER_AUTH_URL` that doesn't match the browser's origin exactly turns every sign-in into
   `Invalid origin`.

10. **Never prune before rolling up.** `cmd/janitor` summarizes each finished day into
    `MonitorDailyStat` *and then* deletes raw checks past their retention, in that order, because the
    rollup is the only thing that survives the delete — the public status page reads rollups for past
    days and raw checks only for today. Reordering those two steps silently erases history.

11. **`src/proxy.ts` must not import Prisma.** It runs in the middleware runtime; it reaches data over
   loopback HTTP (`http://127.0.0.1:$PORT`, never `request.nextUrl.origin` — behind a TLS-terminating
   proxy that origin is `https://` while the process only speaks plain HTTP).

## 4. Commands

```bash
# app
npm run dev            # next dev, honours PORT from .env via scripts/load-port-env.js
npm run build
npm run lint           # biome check
npm run format         # biome format --write

# database
npx prisma generate            # regenerate client for $DB_PROVIDER
npx prisma migrate dev         # dev migration for $DB_PROVIDER only — repeat for the other provider
npx prisma migrate deploy      # production

# workers (from worker/)
go run ./cmd/https             # or port | ping | dns | integrations
go build -o bin/https ./cmd/https
go vet ./... && go test ./...

# everything, built from source
docker compose -f docker-compose.build.yml up --build

# everything, from the published images (what users run)
BETTER_AUTH_SECRET=... POSTGRES_PASSWORD=... docker compose up -d

# validate before committing any compose file / the Dockerfile
docker compose config                       # copy it to an empty dir first: a local .env would mask a missing default
docker compose -f docker-compose.build.yml config
docker compose -f docker-compose.coolify.yaml config   # warns about unset SERVICE_* vars outside Coolify; that's expected
docker build --check --target runner .
docker build --check --target worker-runner .
```

The tests are `worker/internal/checkers/http_test.go` (the HTTP checker's request options,
status-code spec and certificate-expiry logic), `worker/internal/updates/updates_test.go` (the
version comparison) and `worker/internal/notify/discord_test.go` (the alert embed's fields, colours
and truncation). The last two exist because their logic is duplicated in TypeScript: the tables
there mirror `src/lib/updates.ts` and `src/lib/discord.ts`, so a change to either side's rules
belongs in both. Both pairs were checked by generating the same inputs through each
implementation and diffing the output — worth redoing after touching either side. Everything else is verified by running the affected
worker and/or the dashboard and watching `logs/` and the Logs page. `ping` needs `CAP_NET_RAW` (i.e.
`sudo`) outside Docker.

CI runs neither the Go tests nor the build — it only does SAST, secret detection, and the two image
builds — so run them yourself before pushing.

## 5. Conventions

- **TypeScript**: 2-space indent, single quotes, semicolons. Biome (`biome.json`) is authoritative —
  run `npm run format` rather than hand-aligning.
- **Imports**: `@/…` maps to `src/`.
- **Comments explain *why*, not *what*.** This codebase is unusually heavily commented, and the
  comments carry real decisions (why the proxy uses loopback, why the ping worker sends three
  packets, why `--require` instead of `--env-file`). Match that density; when you change a decision,
  update the comment that justified the old one.
- **Enums are Zod enums in the router, plain strings in the DB** (SQLite has no enums). Narrow with
  `as` only when reading rows that were written through a validated mutation.
- **Status/impact vocabularies** — keep these exact strings in sync across TS, Go and the DB:
  - monitor `type`: `HTTP` | `Ping` | `Port` | `DNS` | `Postgres` | `MySQL` | `Redis` | `SMTP` |
    `IMAP` | `gRPC` | `WebSocket` | `Domain`
  - monitor `status`: `Up` | `Down` | `Degraded`
  - monitor `interval`: `15s` | `30s` | `60s` | `5m` | `1h` | `12h` | `24h`
  - monitor `dnsRecordType`: `A` | `AAAA` | `CNAME` | `MX` | `NS` | `TXT` | `SRV`
  - incident `status`: `Investigating` | `Identified` | `Monitoring` | `Resolved`
  - incident `impact`: `Critical` | `Major` | `Minor`
  - integration `type`: `Discord` | `Slack` | `Webhook` | `Telegram` | `Email` | `PagerDuty` | `Push`
  - delivery `status`: `Pending` | `Sent` | `Failed`
- **Go**: package-level doc comment on every `internal/` package, stating which TS file it mirrors.
  Errors are logged with `logging.Error(context, err)` and the tick continues — a worker should never
  exit because one monitor failed.

## 6. Adding things — the usual recipes

**A new monitor type**
1. `worker/internal/checkers/<type>.go` implementing `runner.PerformCheck`.
2. `worker/cmd/<type>/main.go` — copy an existing one, change the three labels.
3. Add the binary to the `for cmd in …` loop in `Dockerfile` and a `worker-<type>` service in
   **all three** of `docker-compose.build.yml`, `docker-compose.yaml` and
   `docker-compose.coolify.yaml`, plus its name to `EXPECTED_WORKERS` in `src/lib/workers.ts` —
   a worker missing from that list is invisible on the dashboard rather than reported as down.
   (A worker built on `internal/runner` gets its heartbeat for free; one with its own loop must
   call `store.RecordHeartbeat` per tick, like `cmd/integrations` and `cmd/janitor` do — including
   `MemoryKB: procstat.ResidentKB()`, or its tile on the dashboard shows no memory figure.)
4. Extend `monitorTypeEnum` in `src/trpc/routers/monitor.ts` and `normalizeUrl`, plus the monitor form.
   Per-type request options belong behind `httpOptionsFor()`-style blanking so they can't leak
   between types.

**A new integration channel**
1. Add it to `integrationTypeEnum` (`src/trpc/routers/integration.ts`) and the form UI.
2. Implement it in **both** `src/lib/integration-delivery.ts` (used by "Send test") and
   `worker/internal/delivery/delivery.go` (used by real, queued alerts).
3. Both take an alert *context* (the incident/monitor the alert is about) alongside subject and
   message. Only Discord renders it today — as embed fields, see `src/lib/discord.ts` /
   `worker/internal/notify/discord.go`. A channel that ignores it behaves exactly as before, so
   adding one is not blocked on supporting it; a channel that uses it must read the same fields on
   both sides. On the Go side that context comes from one query, `store.AlertForIncident`, so the
   queued path and the status-page-subscriber path can't drift apart.

**A new dashboard page**
1. `src/app/(dashboard)/dashboard/<name>/{page.tsx,<name>-client.tsx}`.
2. A router in `src/trpc/routers/`, registered in `_app.ts`, all `protectedProcedure`.
3. An entry in the `navigation` array in `src/components/core/sidebar.tsx`.

**A release**: push to `main` (publishes `:latest` + `:<short-sha>`) or push a git tag (also
publishes `:<tag>`). Both images are built by `.gitlab-ci.yml`; users pin via `STAYUP_VERSION`.
Anything a new version needs beyond a schema migration — a new env var, a new service — must be
reflected in the header comment of `docker-compose.yaml` *and* `docker-compose.coolify.yaml`,
since those files are the deploy documentation for people who never clone the repo.

**A schema change**: edit both `.prisma` files → `DB_PROVIDER=sqlite npx prisma migrate dev` →
`DB_PROVIDER=postgresql npx prisma migrate dev` → update `worker/internal/store/` if a worker reads
or writes the column.

## 7. Known rough edges (don't mistake these for bugs to "fix" silently)

- `worker/internal/incidents` hardcodes `http://localhost:3000/dashboard/incidents` as the incident
  link in worker-sent e-mails. The Discord embed's link does *not*: it reads `BETTER_AUTH_URL` and
  only falls back to that same default (`dashboardBaseUrl()` in `src/lib/discord.ts`,
  `dashboardBaseURL()` in `worker/internal/notify/discord.go`). So on a configured instance the
  embed links to the real origin while the e-mails still point at localhost — fixing the e-mail
  side means porting that helper to `src/emails/*` and `worker/internal/notify/email_templates.go`.
- `src/lib/redis.ts` and `REDIS_URL` are a leftover from the NextTemp template — Redis is running in
  compose but nothing reads or writes it.
- `src/trpc/routers/hello.ts` is template scaffolding.
- **Worker liveness has a one-minute floor.** `isStale` in `src/lib/workers.ts` allows three missed
  ticks but never less than 60s, so a dead 5-second check worker takes a minute to show up as "not
  reporting". Lowering it would make a single slow tick look like an outage.
- **Inert configuration.** Some `AppSettings` fields are still editable in the UI but read by
  nothing: `defaultCheckInterval` (the monitor form doesn't use it as its default), `timezone`
  (timestamps render in the viewer's locale), and `apiKey` / `webhookSigningSecret` (there is no
  public API to authenticate, and outgoing webhooks aren't signed).
- **Uptime is still raw-check based.** `runner`'s 30-day uptime percentage counts `MonitorCheck`
  rows, not rollups, so a `checkRetentionDays` below 30 quietly narrows the window it covers. The
  status page's day bars don't have this problem — they prefer rollups.
- **The check workers don't claim work.** `runner.tick` selects every due monitor of its type with
  no lease or lock, so running two replicas of the same worker double-checks every monitor.
- Incident subscribers can subscribe ("Notify me" on the public status page) but there is no
  unsubscribe flow, and no double opt-in.
- The update checker's release channel needs actual git tags: with no releases *and* no tags on the
  project, a tag-pinned install records "no releases, tags or commits found" rather than a version.
  Installs on `latest` compare commits and work regardless.
- `package.json` is still named `my-app`.
- `src/lib/email.ts` sets `tls.rejectUnauthorized: false` for the fallback SMTP transport.

## 8. Safety notes for agents

- **Never commit `.env`** (it is gitignored and contains a real `BETTER_AUTH_SECRET` and SMTP
  credentials). Don't echo its contents into logs, commit messages or PR descriptions.
- **Don't run `prisma migrate reset`** or anything else destructive against `dev.db` or a configured
  Postgres without being asked to.
- Integrations really do send outbound traffic. Don't trigger `integration.testSend`, escalation, or
  a worker against production webhooks while experimenting.
- The GitLab CI pipeline (`.gitlab-ci.yml`) only runs SAST and secret detection — CI passing is not
  evidence that anything works.
