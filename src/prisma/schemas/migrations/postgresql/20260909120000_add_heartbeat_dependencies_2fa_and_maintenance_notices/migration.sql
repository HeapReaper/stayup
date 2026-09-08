-- Five features in one migration, because they land together:
--
--   1. Heartbeat monitors  — monitor.heartbeatToken / heartbeatGraceSeconds
--   2. Monitor dependencies — monitor.parentId
--   3. Maintenance notices  — maintenance_window.notify* columns
--   4. TOTP two-factor auth — the two_factor table + user.twoFactorEnabled
--   5. OIDC sign-in         — Account.idToken
--
-- Every column is nullable or defaulted, so existing rows keep behaving
-- exactly as they did: no parent means no suppression, no heartbeat token
-- means the monitor is dialled rather than dialling in, and a maintenance
-- window that has already started is marked as never announced (its start
-- announcement is skipped by the worker's "only windows that started since I
-- last looked" cutoff, not by these columns).
--
-- Written defensively — IF NOT EXISTS on every column, table and index, and a
-- catalogue check before each foreign key. The first version of this file
-- named the account table "account"; every other table in this schema is
-- snake_cased by an @@map, but `Account` is the one model that has none, so
-- its table keeps Prisma's default PascalCase. SQLite treats table names
-- case-insensitively and applied it happily; Postgres does not, and the
-- migration failed on the very last statement. Postgres runs a multi-statement
-- script in an implicit transaction, so that failure rolled the whole thing
-- back — but a migration that has already been half-attempted against a
-- production database is not the place to rely on that being true.

-- 1 + 2 — heartbeat and dependency columns.
ALTER TABLE "monitor" ADD COLUMN IF NOT EXISTS "heartbeatToken" TEXT;
ALTER TABLE "monitor" ADD COLUMN IF NOT EXISTS "heartbeatGraceSeconds" INTEGER;
ALTER TABLE "monitor" ADD COLUMN IF NOT EXISTS "parentId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "monitor_heartbeatToken_key" ON "monitor"("heartbeatToken");
CREATE INDEX IF NOT EXISTS "monitor_parentId_idx" ON "monitor"("parentId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'monitor_parentId_fkey') THEN
        ALTER TABLE "monitor" ADD CONSTRAINT "monitor_parentId_fkey"
            FOREIGN KEY ("parentId") REFERENCES "monitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 3 — maintenance window announcements. The three notified* marks are what
-- make the worker's start/end sweep idempotent: it polls every few seconds
-- and must announce each transition exactly once.
ALTER TABLE "maintenance_window" ADD COLUMN IF NOT EXISTS "notifySubscribers" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "maintenance_window" ADD COLUMN IF NOT EXISTS "notifiedScheduledAt" TIMESTAMP(3);
ALTER TABLE "maintenance_window" ADD COLUMN IF NOT EXISTS "notifiedStartedAt" TIMESTAMP(3);
ALTER TABLE "maintenance_window" ADD COLUMN IF NOT EXISTS "notifiedEndedAt" TIMESTAMP(3);

-- 4 — better-auth's twoFactor plugin. Column names come from the plugin's own
-- schema; nothing in StayUp reads this table directly.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS "two_factor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "two_factor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "two_factor_userId_idx" ON "two_factor"("userId");
CREATE INDEX IF NOT EXISTS "two_factor_secret_idx" ON "two_factor"("secret");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'two_factor_userId_fkey') THEN
        ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 5 — OIDC. better-auth stores the provider's id token here; RP-initiated
-- logout needs it, and without the column every OIDC sign-in fails on write.
-- "Account", not "account": see the note at the top of this file.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "idToken" TEXT;
