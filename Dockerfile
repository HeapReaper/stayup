# One image, six services (see docker-compose.yml): `web` runs `next start`,
# the four `worker-*` services run their src/workers/*.ts file via tsx, and
# `migrate` runs `prisma migrate deploy`. All five need the full source tree
# and full node_modules (including dev dependencies — tsx is only needed at
# runtime for the workers), so this deliberately skips Next's `standalone`
# output trimming: that only traces what the Next.js app itself imports, and
# would drop `tsx` and anything only a worker uses.
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
RUN npm ci

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
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
# The ping worker shells out to the OS `ping` binary (see src/workers/ping.ts
# for why) — Alpine's busybox includes one, but install iputils explicitly
# so it isn't left to chance.
RUN apk add --no-cache iputils

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src ./src

EXPOSE 3000

# Overridden by docker-compose.yml's `command:` for the worker/migrate services.
CMD ["npm", "start"]
