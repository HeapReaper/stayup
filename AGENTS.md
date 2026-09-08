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
| `src/app/api/` | better-auth handler, tRPC handler, `reports/pdf` (server-rendered SLA report) and `files` (upload + serve — both are file responses/bodies, which is why they aren't tRPC procedures), `public/status-domain` (custom-domain → slug lookup for the proxy), `v1/*` (the public REST API — authenticated by `AppSettings.apiKey`, not a session, so it can't be a tRPC procedure), `heartbeat/[...segments]` and `agent/[token]` (where the two push monitor types report in; unauthenticated by necessity, the token in the URL is the credential). |
| `src/trpc/routers/` | The entire API. `init.ts` defines `baseProcedure` / `protectedProcedure`; `_app.ts` is the registry. |
| `src/lib/` | Server-side domain logic and clients (prisma, auth, settings, incidents, integration-delivery, maintenance, email, discord, push, audit, logging, redis, updates, version, permissions, workers, sla-report, report-pdf, stored-files-server). `report-range.ts`, `monitor-types.ts` and `stored-files.ts` are the Prisma-free half: client components import them, so they must stay free of server imports — which is why the upload cleanup helper lives in `stored-files-server.ts` instead. |
| `src/lib/api-v1.ts` | The REST API's front door: bearer-key authentication, the published monitor shape, and the TRPCError → status-code mapping that lets one implementation serve both the dashboard and the API. |
| `src/lib/permissions.ts` | The whole authorization model: roles → capabilities. Enforced only by `capabilityProcedure` in `src/trpc/init.ts`. |
| `src/app/api/health/` | Unauthenticated container healthcheck. 200/503 on the *database*; worker liveness is reported but never fails it. |
| `src/prisma/schemas/` | `sqlite.prisma` and `postgresql.prisma` **plus one migration folder each**. |
| `src/proxy.ts` | Next middleware: auth redirects + custom-domain rewrite. |
| `Dockerfile` | Both images: `runner` (web) and `worker-runner` (nine Go binaries — the eight workers plus `agent`, which ships there to be copied out). |
| `docker-compose.build.yml` | Builds from source — the contributor stack. |
| `docker-compose.yaml` | Pulls published images — the *user* stack, imported by URL. Standalone: no build context, no `.env`, no local paths. |
| `docker-compose.coolify.yaml` | The same user stack behind Coolify's proxy: `expose:` instead of `ports:`, port fixed at 3000, secrets from Coolify's `SERVICE_*` magic variables. |
| `.gitlab-ci.yml` | SAST + secret detection, and the two image-build jobs. |
| `worker/cmd/*` | One `main.go` per binary: `https`, `port`, `ping`, `dns`, `probes`, `heartbeat`, `integrations`, `janitor`, `agent`. |
| `worker/cmd/agent` | The only binary that does not run next to StayUp. It runs on the machine being watched, reads that machine's own CPU/memory/disk/load (`internal/hostmetrics`) and POSTs them to a Server monitor's push URL. No database, no store, no settings — it knows one URL. Built into the worker image so it can be copied out; it has no compose service on purpose. |
| `worker/internal/region/` | Which region this worker checks from (`STAYUP_REGION`), and the per-process instance id that holds a monitor's lease. |
| `worker/cmd/heartbeat` | The inverted worker: it checks nothing and dials nothing, it notices a Heartbeat monitor whose ping *stopped* arriving. Doesn't build on `internal/runner` for that reason — there is no check to perform — but shares everything after the result (the `MonitorCheck` row, the rolled-up status, `internal/incidents`). Its recovery half lives in the Next.js app (`src/lib/heartbeat.ts`), because a heartbeat recovers by arriving. |
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
   | `src/lib/maintenance-notify.ts` | `worker/internal/maintenance/notify.go` |
   | `src/lib/monitor-dependencies.ts` | `worker/internal/dependencies` |
   | `src/lib/webhook-signature.ts` | `worker/internal/notify/signature.go` |
   | `src/lib/server-metrics.ts` (thresholds) | `worker/internal/hostmetrics` (measurement) |
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
     alternative locks the only account out of the instance it just created. **That fallback is not
     a safety net for new sign-up paths.** SSO can create accounts too, and every one of them would
     have landed on it — so `databaseHooks.user.create.before` in `src/lib/auth.ts` now writes a
     role explicitly (Admin for the very first account, `OIDC_DEFAULT_ROLE` — Viewer by default —
     for everyone after), and `normalizeRole()` only covers rows written before that existed. Any
     future way of creating a user must decide its own role there rather than leaning on the
     fallback.

   `user.updateProfile` is the one mutation that is deliberately only `protectedProcedure`: it edits
   the caller's own account and nothing else.

   **The REST API is a fourth door into the same mutations** (`src/app/api/v1`, authenticated by
   `AppSettings.apiKey` rather than a session). It deliberately does *not* go through
   `capabilityProcedure` — there is no user to look a role up for — so it calls the exported
   `createMonitor`/`updateMonitor`/`deleteMonitor`/`setMonitorEnabled` functions in
   `src/trpc/routers/monitor.ts` directly, and the key's ceiling is decided by which of those the
   API exposes at all. It exposes monitors and nothing else on purpose: users and instance settings
   stay behind a human login. Adding an endpoint there is granting the API key a capability.

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

10. **Uploaded files live in the database, not on a volume.** `stored_file` holds the bytes for status
    page logos and profile pictures. That is deliberate: the two deploy compose files are imported by URL
    and mount only their own `logs` volume, so a container filesystem would lose every upload on the next
    redeploy — and a second `web` replica would never see the first one's files. Rows are immutable
    (replacing an image writes a new row and deletes the old one), which is what lets `/api/files/[id]`
    serve them `immutable` for a year. Two cleanup paths, both needed: `forgetStoredFile`
    (`src/lib/stored-files-server.ts`) when a `logoUrl`/`image` stops pointing at one, and
    `store.PruneOrphanFiles` in `cmd/janitor` for uploads that were never attached at all — the upload has
    to exist before the form is saved, since a status page being created has no id yet.

11. **Never prune before rolling up.** `cmd/janitor` summarizes each finished day into
    `MonitorDailyStat` *and then* deletes raw checks past their retention, in that order, because the
    rollup is the only thing that survives the delete — the public status page reads rollups for past
    days and raw checks only for today. Reordering those two steps silently erases history.

12. **Incident suppression is one function, and it only ever suppresses *opening*.**
   `incidents.Suppressed` (`worker/internal/incidents`) is the single place that answers "is this
   failure already explained": an active maintenance window, or an ancestor that is already Down
   (`internal/dependencies`, mirrored by `src/lib/monitor-dependencies.ts`). Both the runner and
   `cmd/heartbeat` call it, and a third failing path must too — two copies of that question would
   drift the moment a third reason is added.

   Recovery is never gated on any of it, and neither is `Monitor.autoIncidents`. An incident that is
   already open — opened before the window started, before the parent fell over, or by a human — has
   to reach *Monitoring* when the monitor comes back, or flipping any of those mid-outage strands it
   as permanently investigating.

13. **A maintenance window has four announcements and two senders**, split by which runtime is awake
   when the transition happens: the dashboard sends `Scheduled` and `Cancelled` (a person did it),
   `worker/internal/maintenance/notify.go` sends `Started` and `Ended` (a clock did). The wording is
   mirrored line for line, because one window's notices have to read as one conversation.

   Two things hold it together: the `notified*At` columns are send-once marks (a five-second poll
   loop must not re-announce every tick, so they are written even when some sends failed), and
   `announceGrace` bounds how stale a transition may be — without it, the first tick after an
   upgrade would mail out every window that came and went while nobody was listening.

14. **Due-ness is per region, and every check is claimed.** `monitor.lastCheckedAt` is the newest
   check from *anywhere* and is what the dashboard shows; the scheduler reads
   `monitor_lease.lastCheckedAt` for its own region instead. Sharing one column across regions would
   mean whichever region ticked first was the only one that ever checked anything.

   The same table is the lock the check workers never had, so a second replica no longer
   double-checks everything. Two rules to keep: claim before checking and release after (the lease is
   time-bounded, so a worker killed mid-check frees the monitor by expiry rather than stranding it),
   and release *before* asking for consensus, so this region's own verdict is one of the votes.

   The consensus rule itself (`decideConsensus`) errs towards alerting in both of its softenings —
   the requirement is capped at the regions actually reporting, and recovery is never gated. Getting
   either backwards produces a monitor that can never alert, which is the one failure mode nobody
   notices.

15. **`src/proxy.ts` must not import Prisma.** It runs in the middleware runtime; it reaches data over
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
go run ./cmd/https             # or port | ping | dns | probes | heartbeat | integrations | janitor
STAYUP_REGION=eu-central go run ./cmd/https   # same worker, a second region
go run ./cmd/agent -url http://localhost:3000/api/agent/<token> -once
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
version comparison), `worker/internal/notify/discord_test.go` (the alert embed's fields, colours
and truncation) and `worker/internal/notify/signature_test.go` (the webhook HMAC, against a vector
generated with the TypeScript half). The last two exist because their logic is duplicated in TypeScript: the tables
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
    `IMAP` | `gRPC` | `WebSocket` | `Domain` | `Heartbeat` | `Server`
  - monitor `status`: `Up` | `Down` | `Degraded`
  - monitor `interval`: `15s` | `30s` | `60s` | `5m` | `1h` | `12h` | `24h`
  - monitor `dnsRecordType`: `A` | `AAAA` | `CNAME` | `MX` | `NS` | `TXT` | `SRV`
  - incident `status`: `Investigating` | `Identified` | `Monitoring` | `Resolved`
  - incident `impact`: `Critical` | `Major` | `Minor`
  - integration `type`: `Discord` | `Slack` | `Webhook` | `Telegram` | `Email` | `PagerDuty` | `Push`
  - delivery `status`: `Pending` | `Sent` | `Failed`
  - maintenance announcement phase: `Scheduled` | `Started` | `Ended` | `Cancelled` (the TS side
    sends the two a person triggers, the Go side the two a clock does — see invariant 13)
- **Go**: package-level doc comment on every `internal/` package, stating which TS file it mirrors.
  Errors are logged with `logging.Error(context, err)` and the tick continues — a worker should never
  exit because one monitor failed.

## 6. Adding things — the usual recipes

**A new monitor type**
0. First decide whether StayUp dials it or it dials StayUp. A *push* type (`Heartbeat`, `Server`)
   skips steps 1-3 entirely: it needs an endpoint under `src/app/api/`, an entry in `PUSH_TYPES`
   (`src/lib/monitor-types.ts`), and `worker/cmd/heartbeat` already marks it down when its report
   stops arriving. Everything below is for a type with something to dial.
1. `worker/internal/checkers/<type>.go` implementing `runner.PerformCheck`.
2. `worker/cmd/<type>/main.go` — copy an existing one, change the three labels.
3. Add the binary to the `for cmd in …` loop in `Dockerfile` and a `worker-<type>` service in
   **all three** of `docker-compose.build.yml`, `docker-compose.yaml` and
   `docker-compose.coolify.yaml`, plus its name to `EXPECTED_WORKERS` *and* `WORKER_LABELS` in
   `src/lib/workers.ts` —
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

**Hand-written migration SQL must be applied against a real Postgres before it ships.** SQLite is
the forgiving provider — it compares table names case-insensitively, among other things — so a
migration that runs clean against `dev.db` proves nothing about the other half of the pair. The
table that catches people is `Account`: every model in this schema is snake_cased by an `@@map`
except that one, so its table is `"Account"`, and `ALTER TABLE "account"` fails on Postgres with
`relation "account" does not exist` while succeeding on SQLite.

Throwaway Postgres, apply everything from empty, then ask whether the result matches the schema:

```bash
docker run -d --name migtest -e POSTGRES_USER=stayup -e POSTGRES_PASSWORD=testpw \
  -e POSTGRES_DB=stayup -p 55432:5432 postgres:16-alpine
export PG="postgresql://stayup:testpw@localhost:55432/stayup?schema=public"

DB_PROVIDER=postgresql DB_URL=$PG npx prisma migrate deploy
DB_PROVIDER=postgresql DB_URL=$PG npx prisma migrate diff \
  --from-config-datasource --to-schema src/prisma/schemas/postgresql.prisma --exit-code
docker rm -f migtest
```

`migrate diff` answering "No difference detected" is the actual check — it compares the migrated
database against the schema, so a migration that applied cleanly but built the wrong thing still
fails it. Run the same pair against `dev.db` with `DB_PROVIDER=sqlite` for the other provider.

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
- **A private status page and a custom domain don't combine.** Signing in happens on the app's own
  origin, because that is where the session cookie lives and a browser will not send it to a vanity
  hostname. `src/proxy.ts` redirects the auth paths off a custom domain rather than rewriting them
  (which used to produce `/status/<slug>/login` and a 404 loop), and the status page editor warns
  when both are set — but the visitor still lands on the page at the app's address, not the vanity
  one. Fixing it properly means a one-time token hand-off that sets a cookie on the custom domain.
- **Inert configuration.** Two `AppSettings` fields are still editable in the UI but read by
  nothing: `defaultCheckInterval` (the monitor form doesn't use it as its default) and `timezone`
  (timestamps render in the viewer's locale — `timezone` *is* read, but only by the notification
  rules' active windows). `apiKey` and `webhookSigningSecret` used to be on this list; both are now
  live (`src/app/api/v1`, `src/lib/webhook-signature.ts`).
- **A heartbeat monitor's uptime is coarser than a dialled one's.** `cmd/heartbeat` writes one check
  per missed deadline (`interval` + grace), not one per interval, so a silent job produces slightly
  fewer Down rows than a healthy one would have produced Up rows. Close enough for a percentage,
  not a basis for anything exact.
- **Maintenance start/end announcements have a one-hour cutoff.** `announceGrace` in
  `worker/internal/maintenance/notify.go` — a transition older than that is never announced rather
  than announced stale, which is also what stops an upgrade mailing out a backlog. A window that
  starts and ends while the integrations worker is down is therefore never announced at all.
- **Two-factor enrolment shows a setup key, not a QR code.** Rendering one needs an encoder and the
  repo has no dependency for it; every authenticator accepts a typed key, and the `otpauth://` link
  works on a phone.
- **Uptime is still raw-check based.** `runner`'s 30-day uptime percentage counts `MonitorCheck`
  rows, not rollups, so a `checkRetentionDays` below 30 quietly narrows the window it covers. The
  status page's day bars don't have this problem — they prefer rollups.
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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
