# NextTemp
A NextJS template made the way i like it.


---

## Get Started

### Installation

- Use git clone on  `git@gitlab.com:HeapReaper/nexttemp.git` or download the repo on https://gitlab.com/HeapReaper/nexttemp
- Put in the repo directory or initiate a repo
- Run `npm install`
- Copy `.env.example` to `.env`
- Fill in: `DB_URL` and make a long `BETTER_AUTH_SECRET` secret
- Run `npx prisma generate` to generate prisma client
- Run `npx prisma migrate dev` to apply the schema to the database
- Run `npm run dev` to start the development server

## Working with NextTemp

### Middleware
By default in `src/middleware.ts`, `/dashboard` is protected for logged-in users only.
Here is also sends an welcome e-mail.

### Logging
To use logging, you can use it like this: 
```ts
import { logger } from '@/lib/logging';

// logger.error() and logger.debug() are also possible
logger.info(`[Mail] Welcome email successfully send to ${to}!`);

```
The helper for it can be found in `src/lib/logging.ts`

### TRPC
To create a new procedure, make a new file in `src/trpc/routers`, like `user.ts`.  
Add the following to it (or similar):
```ts
import { z } from 'zod';
import { baseProcedure, createTRPCRouter } from '../init';

export const userRouter = createTRPCRouter({
  getAll: baseProcedure.query(async () => {
    return [{ id: '1', name: 'Kelvin' }];
  }),
  getById: baseProcedure
    .input(z.object({ id: z.string() }))
    .query(async (opts) => {
      return { id: opts.input.id, name: 'Kelvin' };
    }),
});
```

To Query it, there are 2 ways:  
Server side:
```ts
import { caller } from '@/trpc/server';

const query = await caller.hello.world({ text: 'Kelvin' });
console.log(query.greeting);
```

Client side:
```ts
import { useTRPC } from '@/trpc/client';
import { useQuery } from '@tanstack/react-query';

const trpc = useTRPC();

const { data, isLoading, error } = useQuery(
  trpc.hello.world.queryOptions({ text: 'Kelvin'})
)

{data?.greeting}
```

To make a procedure only accessible for logged in users, use the  
`protectedProcedure` instead of `baseProcedure`.

### Email
You can send e-mails server-side like this::
```ts
import { sendEmail } from '@/lib/email';

await sendEmail({
    to: user.email,
    subject: 'Welcome to NextTemp!',
    react: WelcomeEmail({ name: user.name }),
});
```

### Zod
To validate user input, you can use Zod like this::
```ts
import { z } from 'zod';

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email address'),
  password: z
    .string()
    .min(1, 'Password is required')
});

export type loginInput = z.infer<typeof loginSchema>;
```

And then validate like this::
```ts
import { loginSchema } from '@/validations/auth';

const rawData = {
  email: formData.get('email') as string,
  password: formData.get('password') as string,
};

const validationResult = loginSchema.safeParse(rawData);

if (!validationResult.success) {
  const formattedErrors = validationResult.error.format();
  setFieldErrors({
    email: formattedErrors.email?._errors[0],
    password: formattedErrors.password?._errors[0],
  });
  return;
}
```

To save schema's, there is the `src/validations` directory.

### Prisma
It has built in support for SQLite and PostgreSQL.  
To change database, edit `.env` and edit `src/lib/auth.ts` to use the correct provider (found in `.env.example`)  

You can run database queries like this:: 
```ts
import { prisma } from '@/lib/prisma';

await prisma.user.findFirst({
    where: {
        email: form.email
    }
});
```
The helper file can be found in `src/lib/prisma.ts`.

### Redis
You can use Redis like this::
```ts
import { redis } from '@/lib/redis';

async function exampleUsage() {
  await redis.set('user:123:theme', 'dark');

  const theme = await redis.get('user:123:theme');
  console.log(theme);

  await redis.del('user:123:theme');
}
```
The helper file can be found in `src/lib/redis.ts`.

### Workers
Long-running checks (e.g. pinging monitors) run as standalone Go binaries in `worker/`, a separate Go
module living alongside the Next.js app, not inside it — talking to the same Postgres/SQLite database
directly (hand-written SQL, no Prisma) via `DB_PROVIDER`/`DB_URL`, same as `src/lib/prisma.ts`. They used to
be `tsx`-run TypeScript scripts in `src/workers/`; they were ported to Go purely for the RAM savings — a
Node/V8 process per worker vs. a few MB of RSS for a static Go binary.

Each worker only implements "how do I check one monitor" (`worker/internal/checkers`) — the polling loop,
writing the `MonitorCheck` row (the "pings"), rolling the result up onto the monitor's
`status`/`responseTime`/`uptime`/`lastCheckedAt`, and opening/updating an incident when a monitor goes
Down/Degraded, all live once in `worker/internal/runner` and are shared by every worker below.

| Worker | Monitor type | How it checks |
|---|---|---|
| `worker/cmd/https` | `HTTP` | GETs the URL |
| `worker/cmd/port` | `Port` | Raw TCP connect to `host:port` |
| `worker/cmd/ping` | `Ping` | Native ICMP echo request (needs `CAP_NET_RAW` — granted in `docker-compose.yml`) |
| `worker/cmd/dns` | `DNS` | Resolves the hostname's A record(s) |

The Settings page's Monitoring Defaults tab (request timeout, latency threshold) is read live by each of
these on every check via `worker/internal/settings`'s `Get()` — save a new value there and it applies on
the very next check, no restart needed.

A different kind of worker delivers outgoing notifications instead of checking monitors:

| Worker | Polls | Delivers via |
|---|---|---|
| `worker/cmd/integrations` | `IntegrationDelivery` rows (status `Pending`) queued by `src/lib/incidents.ts` (dashboard actions) or `worker/internal/incidents` (automatic incidents) whenever an incident is created or updated | `worker/internal/delivery` — Discord/Slack webhook, generic Webhook POST, Telegram Bot API, Email, Push, or PagerDuty Events API v2, depending on the Integration's `type`. Retries up to 5 times before marking a delivery `Failed`. |

Each tick, this same worker also calls `EscalateOverdueIncidents` (`worker/internal/incidents`): if a
monitor has an `EscalationPolicy` attached (`Monitor.escalationPolicyId`), its incidents skip the normal
broadcast to every enabled Integration and are instead paged through that policy's ordered steps — step 1,
then step 2 after its `delayMinutes` if nobody's acknowledged the incident yet, and so on — stopping as soon
as someone acknowledges it (`incident.acknowledge`) or it's resolved. Escalation deliveries are just more
`IntegrationDelivery` rows, so they get the same retry-up-to-5x handling as everything else here.

Run them all with:
```bash
cd worker
go run ./cmd/https
go run ./cmd/port
go run ./cmd/ping   # needs CAP_NET_RAW, i.e. `sudo` or an equivalent, outside Docker
go run ./cmd/dns
go run ./cmd/integrations
```

Note: unlike `next dev`, nothing here hot-reloads — if you edit worker code while one is already running,
restart it to pick up the change. `go build -o bin/<name> ./cmd/<name>` from `worker/` produces a standalone
binary in the gitignored `worker/bin/` if you'd rather not `go run` each time.

### Docker
`docker-compose.yml` runs the whole stack: Postgres, Redis, the Next.js app, and all five workers above.
`web` and every `worker-*` service build from the same `Dockerfile` but different targets: `web` is the
Node/Next.js image (target `runner`), each `worker-*` is a small `alpine` image holding only that worker's
static Go binary (target `worker-runner`) — no Node runtime in those containers at all.

```bash
cp .env.example .env   # fill in BETTER_AUTH_SECRET, POSTGRES_PASSWORD, SMTP_*, etc.
docker compose up --build
```

A few things worth knowing:
- **Postgres only.** The compose file forces `DB_PROVIDER=postgresql` and points `DB_URL`/`REDIS_URL` at
  the in-network `postgres`/`redis` hostnames, regardless of what your `.env` has for local `npm run dev`
  (which defaults to SQLite). Running multiple worker containers against a shared SQLite file is exactly
  the kind of concurrent-writer situation SQLite isn't built for.
- **Two migration histories.** Because the SQL is provider-specific, SQLite and Postgres each have their
  own migration folder — `src/prisma/schemas/migrations/sqlite/` and `.../migrations/postgresql/` — selected
  automatically via `prisma.config.ts`'s `migrations.path`, based on `DB_PROVIDER`.
- **No dedicated `migrate` service.** Only `web` runs `prisma migrate deploy` (the Go workers don't carry
  Prisma, or Node, at all); every `worker-*` service `depends_on: web: condition: service_healthy`, and
  `web`'s healthcheck only passes once it's actually serving requests — i.e. after `migrate deploy` has
  already applied the schema — so workers never race a cold, unmigrated database. This all runs as
  long-lived services on purpose (no one-shot container that exits after migrating): some deployment
  platforms (Coolify, at least) don't reliably handle an intentionally-exiting container inside a compose
  stack — the deploy would hang on `web` never leaving "Created", then fail with
  `Error response from daemon: No such container: <id>` once whatever was polling its status couldn't find
  it anymore.
- Verified end to end with a real `docker compose up --build`: `web` applies the Postgres migration
  history cleanly, and all five Go workers check monitors, open/recover incidents, and retry/deliver
  Integration notifications correctly against it.

### Shadcn UI
You can change the theme by going to [ui.shadcn.com/create](https://ui.shadcn.com/create).  
After changing the style, go to `get code` and `existing project` and copy the command and execute it.  
All components can be found in `src/components/ui`.

### Framer Motion
You can use Framer Motion client side like this: 
```tsx
import { motion } from 'framer-motion';

<motion.div
  // Initial state (before animation starts)
  initial={{ opacity: 0, scale: 0.8 }}
  // Target state (animated into on mount)
  animate={{ opacity: 1, scale: 1 }}
  // Interactive hover state
  whileHover={{ scale: 1.05 }}
  // Interactive click/tap state
  whileTap={{ scale: 0.95 }}
  // Animation physics (spring physics for natural movement)
  transition={{
    type: 'spring',
    stiffness: 260,
    damping: 20,
  }}
  className="cursor-pointer rounded-2xl bg-primary p-8 text-primary-foreground shadow-lg"
>
  <h3 className="text-xl font-bold">Framer Motion Card</h3>
  <p className="mt-2 text-sm text-primary-foreground/80">
    Hover over me or click on me!
  </p>
</motion.div>
```

### Lucide React
You can use Lucide React like this
```tsx
import { RefreshCw } from 'lucide-react';

<button className="group flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground font-medium">
  <span>Refresh</span>
  <RefreshCw className="h-4 w-4 transition-transform duration-300 group-hover:rotate-180" />
</button>
```
---