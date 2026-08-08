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
- run `npm run dev`

### Working with NextTemp

#### Middleware
By default in `src/middleware.ts`, `/dashboard` is protected for logged-in users only.
Here is also sends an welcome e-mail.

#### Logging
You can log with `logger.info("Hello!");`, also `warn`, `debug` and `error` works!

#### Email
You can send e-mails server-side with:
```
import { sendEmail } from "@/lib/email";

await sendEmail({
    to: user.email,
    subject: "Welcome to NextTemp!",
    react: WelcomeEmail({ name: user.name }),
});
```

#### Prisma
You can run database queries with: 
```
import { prisma } from "@/lib/prisma";

await prisma.user.findFirst({
    where: {
        email: form.email
    }
});
```

#### Redis
You can use Redis with:
```
import { redis } from "@/lib/redis";

async function exampleUsage() {
  await redis.set("user:123:theme", "dark");

  const theme = await redis.get("user:123:theme");
  console.log(theme);

  await redis.del("user:123:theme");
}
```

---
## Stack

#### NextJS (Framework)

- Version 16


#### Prisma (database ORM)

- Works out of the box with SQLite and PostgreSQL
- Can be found in `src/prisma/schemas` and `src/lib/prisma.ts`
- To change database, edit `.env` and edit `src/lib/auth.ts` to use the correct provider (found in `.env.example`)

#### BetterAuth (authentication) 

- Uses by default credentials provider
- Can be found in `src/lib/auth.ts`
- Client can be found in `src/lib/auth-client.ts`
- Usage examples: `src/app/login/page.tsx`, `src/app/register` and `src/app/logout`

#### NodeMailer (e-mail)

- Can be found in `src/lib/email.ts`
- Usage example: `src/lib/auth.ts`

#### Zod (validation)

- Usage example: `src/app/login/page.tsx` and `src/validations/auth.ts`

#### Lucide React (icon library)

- Usage example: `src/app/page.tsx`

#### Framer Motion (animations)

- Usage example: `src/app/page.tsx`

#### Redis (in memory database)

- Can be found in `src/lib/redis.ts`

#### Winston (logging)

- Can be found in `src/lib/logging.ts`
- Usage example: `src/lib/auth.ts`

##### Docker (containerized)

- Can be found in `Dockerfile`

---