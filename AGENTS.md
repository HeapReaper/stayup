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
| `src/lib/` | Server-side domain logic and clients (prisma, auth, settings, incidents, integration-delivery, maintenance, email, discord, push, audit, logging, redis). |
| `src/prisma/schemas/` | `sqlite.prisma` and `postgresql.prisma` **plus one migration folder each**. |
| `src/proxy.ts` | Next middleware: auth redirects + custom-domain rewrite. |
| `worker/cmd/*` | One `main.go` per binary: `https`, `port`, `ping`, `dns`, `integrations`. |
| `worker/internal/checkers/` | "How do I check one monitor" — one function per monitor type. |
| `worker/internal/runner/` | The shared poll → check → persist → roll-up → incident-sync loop. |
| `worker/internal/store/` | All SQL. Both providers, one query string each. |
| `worker/internal/{incidents,delivery,notify,maintenance,settings,db,logging,ids}/` | Go counterparts of the matching `src/lib/` files. |

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

4. **`protectedProcedure` is the only authorization boundary.** There is no roles/permissions concept:
   every signed-in user has full dashboard access. `User.role` exists solely because better-auth's
   admin plugin requires the column. Don't write code that assumes role-based gating works.

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

9. **`src/proxy.ts` must not import Prisma.** It runs in the middleware runtime; it reaches data over
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
go vet ./... && gofmt -l .

# everything
docker compose up --build
```

There is **no test suite**. Verify changes by running the affected worker and/or the dashboard and
watching `logs/` and the Logs page. `ping` needs `CAP_NET_RAW` (i.e. `sudo`) outside Docker.

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
  - monitor `type`: `HTTP` | `Ping` | `Port` | `DNS`
  - monitor `status`: `Up` | `Down` | `Degraded`
  - monitor `interval`: `15s` | `30s` | `60s` | `5m`
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
   `docker-compose.yml`.
4. Extend `monitorTypeEnum` in `src/trpc/routers/monitor.ts` and `normalizeUrl`, plus the monitor form.

**A new integration channel**
1. Add it to `integrationTypeEnum` (`src/trpc/routers/integration.ts`) and the form UI.
2. Implement it in **both** `src/lib/integration-delivery.ts` (used by "Send test") and
   `worker/internal/delivery/delivery.go` (used by real, queued alerts).

**A new dashboard page**
1. `src/app/(dashboard)/dashboard/<name>/{page.tsx,<name>-client.tsx}`.
2. A router in `src/trpc/routers/`, registered in `_app.ts`, all `protectedProcedure`.
3. An entry in the `navigation` array in `src/components/core/sidebar.tsx`.

**A schema change**: edit both `.prisma` files → `DB_PROVIDER=sqlite npx prisma migrate dev` →
`DB_PROVIDER=postgresql npx prisma migrate dev` → update `worker/internal/store/` if a worker reads
or writes the column.

## 7. Known rough edges (don't mistake these for bugs to "fix" silently)

- `public/sw.js` **does not exist** in the repo, but `integrations-client.tsx` registers `/sw.js`
  for Web Push. Push registration will fail until that file is added.
- `worker/internal/incidents` hardcodes `http://localhost:3000/dashboard/incidents` as the incident
  link in worker-sent e-mails.
- `src/lib/redis.ts` and `REDIS_URL` are a leftover from the NextTemp template — Redis is running in
  compose but nothing reads or writes it.
- `src/trpc/routers/hello.ts` is template scaffolding.
- `IncidentSubscriber` rows can't be created from the UI's own flow yet, but every incident update
  already e-mails whoever is in that table.
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
