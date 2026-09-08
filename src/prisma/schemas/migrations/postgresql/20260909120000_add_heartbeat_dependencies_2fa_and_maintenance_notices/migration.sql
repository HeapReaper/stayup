-- Five features in one migration, because they land together:
--
--   1. Heartbeat monitors  — monitor.heartbeatToken / heartbeatGraceSeconds
--   2. Monitor dependencies — monitor.parentId
--   3. Maintenance notices  — maintenance_window.notify* columns
--   4. TOTP two-factor auth — the two_factor table + user.twoFactorEnabled
--   5. OIDC sign-in         — account.idToken
--
-- Every column is nullable or defaulted, so existing rows keep behaving
-- exactly as they did: no parent means no suppression, no heartbeat token
-- means the monitor is dialled rather than dialling in, and a maintenance
-- window that has already started is marked as never announced (its start
-- announcement is skipped by the worker's "only windows that started since I
-- last looked" cutoff, not by these columns).

-- 1 + 2 — heartbeat and dependency columns.
ALTER TABLE "monitor" ADD COLUMN     "heartbeatToken" TEXT;
ALTER TABLE "monitor" ADD COLUMN     "heartbeatGraceSeconds" INTEGER;
ALTER TABLE "monitor" ADD COLUMN     "parentId" TEXT;

CREATE UNIQUE INDEX "monitor_heartbeatToken_key" ON "monitor"("heartbeatToken");
CREATE INDEX "monitor_parentId_idx" ON "monitor"("parentId");

ALTER TABLE "monitor" ADD CONSTRAINT "monitor_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "monitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3 — maintenance window announcements. The three notified* marks are what
-- make the worker's start/end sweep idempotent: it polls every few seconds
-- and must announce each transition exactly once.
ALTER TABLE "maintenance_window" ADD COLUMN     "notifySubscribers" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "maintenance_window" ADD COLUMN     "notifiedScheduledAt" TIMESTAMP(3);
ALTER TABLE "maintenance_window" ADD COLUMN     "notifiedStartedAt" TIMESTAMP(3);
ALTER TABLE "maintenance_window" ADD COLUMN     "notifiedEndedAt" TIMESTAMP(3);

-- 4 — better-auth's twoFactor plugin. Column names come from the plugin's own
-- schema; nothing in StayUp reads this table directly.
ALTER TABLE "user" ADD COLUMN     "twoFactorEnabled" BOOLEAN DEFAULT false;

CREATE TABLE "two_factor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "two_factor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "two_factor_userId_idx" ON "two_factor"("userId");
CREATE INDEX "two_factor_secret_idx" ON "two_factor"("secret");

ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5 — OIDC. better-auth stores the provider's id token here; RP-initiated
-- logout needs it, and without the column every OIDC sign-in fails on write.
ALTER TABLE "account" ADD COLUMN     "idToken" TEXT;
