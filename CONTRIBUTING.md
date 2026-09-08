# Contributing to StayUp

Thanks for wanting to help. StayUp is a small, opinionated, self-hosted uptime monitor — issues,
merge requests and "this bit is confusing" feedback are all welcome.

Two other documents matter here:

- **[README.md](README.md)** — what StayUp does, how to run it, how it's deployed.
- **[AGENTS.md](AGENTS.md)** — the architecture guide: repo map, invariants, and recipes for common
  changes. Written for AI coding agents, but it's the fastest way for a human to get oriented too.
  Read section 3 ("Invariants") before your first merge request; it's the list of things that break
  quietly.

This file is the practical bit: how to set up, what to run before you push, and how changes get in.

---

## Setting up

```bash
git clone git@gitlab.com:HeapReaper/stayup.git
cd stayup
npm install
cp .env.example .env          # set BETTER_AUTH_SECRET at minimum
npx prisma generate
npx prisma migrate dev
npm run dev                   # http://localhost:3000
```

Register the first account at `/register` — that's the only time the public sign-up form works.

SQLite is the default for local work and needs no services. The workers are separate processes; start
whichever ones your change touches:

```bash
cd worker
go run ./cmd/https            # or port | ping | dns | integrations | janitor
```

`cmd/ping` opens a raw ICMP socket and needs `CAP_NET_RAW` (i.e. `sudo`) outside Docker. Nothing in
`worker/` hot-reloads — restart it after an edit.

To work against Postgres instead, set `DB_PROVIDER=postgresql` and a `DB_URL`, or run the whole stack
from your checkout with `docker compose -f docker-compose.build.yml up --build`. (The default
`docker-compose.yaml` is the deploy file — it pulls published images and builds nothing.)

---

## Before you push

There is no CI gate for any of this — the pipeline only runs SAST, secret detection and the container
image builds — so run it yourself:

```bash
npm run lint                  # Biome
npx tsc --noEmit
npm run build                 # catches what tsc alone doesn't

cd worker
gofmt -l .                    # should print nothing for files you touched
go vet ./...
go test ./...
```

If you changed the Dockerfile or any compose file:

```bash
docker build --check --target runner .
docker build --check --target worker-runner .
docker compose -f docker-compose.build.yml config > /dev/null
docker compose config > /dev/null   # copy docker-compose.yaml to an empty dir first, so a local .env can't mask a missing default
docker compose -f docker-compose.coolify.yaml config > /dev/null   # unset SERVICE_* warnings are expected outside Coolify
```

**A note on Biome:** the repository does not currently pass `npm run lint` cleanly — there's a large
backlog of quote-style and formatting complaints predating the linter's arrival. Don't fix those in a
feature MR: a `npm run format` across the tree buries your actual change in thousands of lines of
diff. Just make sure you don't *add* findings in the files you touch:

```bash
npx biome check src/path/you/changed.ts
```

A separate MR that formats the whole tree in one commit would be very welcome.

---

## Changing the database

This is where most mistakes happen, because there are **two schemas and two migration histories** —
one per provider — and they're maintained by hand.

1. Make the identical change in **both** `src/prisma/schemas/sqlite.prisma` and
   `.../postgresql.prisma`. Apart from the `datasource` block at the top, these files must stay
   byte-for-byte the same:
   ```bash
   diff <(sed 1,5d src/prisma/schemas/sqlite.prisma) <(sed 1,5d src/prisma/schemas/postgresql.prisma)
   ```
2. Generate a migration for each provider. The normal way is `npx prisma migrate dev --name <name>`
   with `DB_PROVIDER` set, but that needs a live database of that provider and will offer to reset it
   if it detects drift. To generate the SQL without touching any database:
   ```bash
   git show HEAD:src/prisma/schemas/sqlite.prisma > /tmp/old-sqlite.prisma
   npx prisma migrate diff --from-schema /tmp/old-sqlite.prisma \
       --to-schema src/prisma/schemas/sqlite.prisma --script
   ```
   Save the output as
   `src/prisma/schemas/migrations/<provider>/<YYYYMMDDHHMMSS>_<name>/migration.sql`, using the same
   timestamp and name for both providers.
3. Verify each history applies from scratch:
   ```bash
   DB_PROVIDER=sqlite DB_URL="file:/tmp/fresh.db" npx prisma migrate deploy
   docker run --rm -d --name pgtest -e POSTGRES_PASSWORD=test -e POSTGRES_USER=stayup \
       -e POSTGRES_DB=stayup -p 55433:5432 postgres:16-alpine
   DB_PROVIDER=postgresql DB_URL="postgresql://stayup:test@localhost:55433/stayup" npx prisma migrate deploy
   ```
4. If a Go worker reads or writes the new column, update the matching query in
   `worker/internal/store/` — the workers don't use Prisma, so a schema change alone does nothing for
   them. Write the SQL once with `?` placeholders and let `internal/db` handle the provider
   differences; don't branch on provider inside a query unless the syntax genuinely differs (see
   `dayExpr` in `store/janitor.go` for a case where it does).

**If your own `dev.db` refuses to migrate** ("Drift detected… we need to reset"), don't reset it —
that's usually leftover drift from an older schema and your data is fine. Apply the migration
directly and mark it as applied:

```bash
cp dev.db dev.db.backup
DB_PROVIDER=sqlite DB_URL="file:./dev.db" npx prisma db execute \
    --file src/prisma/schemas/migrations/sqlite/<migration>/migration.sql
DB_PROVIDER=sqlite DB_URL="file:./dev.db" npx prisma migrate resolve --applied <migration>
```

Restart `npm run dev` afterwards: a running server holds SQLite prepared statements against the old
tables.

---

## Changing worker behaviour

The Go workers and the Next.js app implement some of the same logic twice, deliberately — the
dashboard's manual actions in TypeScript, the automatic ones in Go. Those pairs are listed in
[AGENTS.md](AGENTS.md) section 3. **Changing one without the other is the single most common way to
break this project**: a manually created incident and an automatically detected one must produce the
same rows, the same timeline and the same notifications.

The same goes for the three compose files: `docker-compose.build.yml` (builds from source),
`docker-compose.yaml` (pulls published images, and is what `docker compose up` uses by default) and
`docker-compose.coolify.yaml` (the same, adapted to Coolify's proxy) describe the same stack, and
the two deploy ones must stay standalone — no `build:`, no `env_file:`, no relative paths — because
people import them straight from a URL. AGENTS.md invariant 9 lists the only differences the
Coolify variant is allowed to have.

Timestamps: always write UTC (`db.TimeArg` handles it). Prisma maps `DateTime` to a timezone-less
column on both providers and always writes UTC into it, so a worker running in another timezone would
otherwise store times that read back hours off.

---

## Code style

- **Comments explain *why*, not *what*.** This codebase is unusually heavily commented, and those
  comments carry real decisions — why the proxy dials loopback instead of its own origin, why the
  ping check sends three packets, why the janitor rolls up before it prunes. Match that density, and
  when you change a decision, update the comment that justified the old one.
- TypeScript: 2-space indent, `@/…` imports, Zod for every input, `protectedProcedure` for anything
  behind the dashboard. Serialize `Date` to an ISO string inside the router — there's no superjson
  transformer, so the server-side caller and the HTTP client must return the same shape.
- Go: `gofmt`, a package doc comment on every `internal/` package saying which TypeScript file it
  mirrors (if any), and errors logged with the tick continuing — a worker must never exit because one
  monitor failed.
- Record significant dashboard mutations with `logAudit(...)`, matching the existing
  `ACTION_VERB_NOUN` naming (`CREATED_MONITOR`, `RESOLVED_INCIDENT`, `PAUSED_MONITOR`).
- Status vocabularies (`Up`/`Down`/`Degraded`, `Investigating`/`Identified`/`Monitoring`/`Resolved`,
  and the integration types) are plain strings shared across TypeScript, Go and the database. The
  full list is in AGENTS.md section 5 — keep all three in step.

---

## Merge requests

- Branch off `main`; open a merge request against `main` on
  [GitLab](https://gitlab.com/HeapReaper/stayup).
- One concern per MR. A drive-by refactor inside a feature MR makes both harder to review.
- Commit messages: a short sentence in past tense, matching what's already in `git log`
  (*"Added possibility to limit status pages for logged in users only"*, *"Bugfixes for monitor
  uptime"*). No prefix convention, no ticket numbers required.
- Say in the description what you actually ran — which workers, against which provider, and what you
  saw. There's almost no automated test coverage, so "I ran the https worker against Postgres and
  watched it open and recover an incident" is the review evidence.
- Image builds (`build:web`, `build:worker`) can be started manually from an MR pipeline if you want
  to test the containers; they only publish `latest` from `main` and tags.

### What's likely to be accepted

Bug fixes, documentation, and the gaps listed under "Known rough edges" in AGENTS.md section 7 —
that section is effectively the todo list. Larger directions worth discussing in an issue first: a
public API behind the (currently unused) API key, signed outgoing webhooks, real roles and
permissions, heartbeat/cron monitors, unsubscribe flows for status-page subscribers, and any change
to how the check workers claim work (they currently don't, which is why running two replicas of the
same worker double-checks everything).

---

## Security

Please don't open a public issue for a vulnerability. Report it as a **confidential issue** on the
GitLab project (tick "This issue is confidential" when creating it), and give it a week before
disclosing anything publicly.

When contributing:

- **Never commit `.env`.** It's gitignored and holds a real `BETTER_AUTH_SECRET` and SMTP
  credentials. Don't paste its contents into an issue or MR description either — the CI pipeline runs
  secret detection, but that's a backstop, not a filter.
- Don't point a development instance's integrations at production webhooks or on-call rotations while
  experimenting; `integration.testSend` and escalation really do send.
- Every logged-in user currently has full dashboard access — there is no roles or permissions
  concept, despite the `role` column existing for better-auth's admin plugin. Don't write code that
  assumes role-based gating works.

---

## Note on AI assistance

Large parts of this codebase were written with AI assistance, and that's fine here — but the
security-relevant code and the core monitoring logic are reviewed by hand, and contributions are held
to the same bar. If you used an assistant, review its output yourself first: you're the author of the
merge request, and "the model wrote it" isn't a review. Pointing your assistant at
[AGENTS.md](AGENTS.md) first will save you both a round of corrections.

## License

StayUp is Apache-2.0 (see [LICENSE](LICENSE)). By contributing, you agree your contributions are
licensed under the same terms.
