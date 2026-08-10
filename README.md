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
Long-running checks (e.g. pinging monitors) run as standalone scripts in `src/workers/`, separate from the
Next.js server. They're run with [`tsx`](https://github.com/privatenumber/tsx), which understands the
`@/*` path alias from `tsconfig.json`.

Each worker only implements "how do I check one monitor" — the polling loop, writing the `MonitorCheck`
row (the "pings"), rolling the result up onto the monitor's `status`/`responseTime`/`uptime`/`lastCheckedAt`,
and opening/updating an incident when a monitor goes Down/Degraded, all live once in
`src/lib/monitor-worker.ts` and are shared by every worker below.

| Worker | Monitor type | How it checks |
|---|---|---|
| `src/workers/https.ts` | `HTTP` | `fetch()`s the URL |
| `src/workers/port.ts` | `Port` | Raw TCP connect to `host:port` |
| `src/workers/ping.ts` | `Ping` | Shells out to the OS `ping` binary (Node has no built-in ICMP — see comments in the file) |

Run them with:
```bash
npm run worker:https
npm run worker:port
npm run worker:ping
# or, to auto-restart on file changes during development:
npm run worker:https:watch
npm run worker:port:watch
npm run worker:ping:watch
```

Note: these are plain `tsx` processes, not hot-reloaded by Next.js — if you edit worker code (or
`src/lib/monitor-worker.ts`/`src/lib/incidents.ts`) while one is already running, restart it (or use
the `:watch` variant) to pick up the change.

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