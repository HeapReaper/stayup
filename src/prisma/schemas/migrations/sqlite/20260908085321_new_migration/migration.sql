/*
  Warnings:

  - You are about to drop the `Session` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `VerificationToken` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `access_token` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `expires_at` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `id_token` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `provider` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `providerAccountId` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `refresh_token` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `session_state` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `token_type` on the `Account` table. All the data in the column will be lost.
  - Added the required column `accountId` to the `Account` table without a default value. This is not possible if the table is not empty.
  - Added the required column `providerId` to the `Account` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Account` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Session_sessionToken_key";

-- DropIndex
DROP INDEX "User_email_key";

-- DropIndex
DROP INDEX "VerificationToken_identifier_token_key";

-- DropIndex
DROP INDEX "VerificationToken_token_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Session";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "User";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "VerificationToken";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "role" TEXT,
    "banned" BOOLEAN DEFAULT false,
    "banReason" TEXT,
    "banExpires" DATETIME
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "impersonatedBy" TEXT,
    "userId" TEXT NOT NULL,
    CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" DATETIME,
    "refreshTokenExpiresAt" DATETIME,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "type" TEXT,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Account" ("id", "scope", "type", "userId") SELECT "id", "scope", "type", "userId" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE TABLE "new_audit_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_audit_log" ("action", "actorId", "actorName", "createdAt", "id", "ipAddress", "target") SELECT "action", "actorId", "actorName", "createdAt", "id", "ipAddress", "target" FROM "audit_log";
DROP TABLE "audit_log";
ALTER TABLE "new_audit_log" RENAME TO "audit_log";
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log"("createdAt");
CREATE TABLE "new_escalation_policy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "escalation_policy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_escalation_policy" ("createdAt", "createdById", "id", "name", "updatedAt") SELECT "createdAt", "createdById", "id", "name", "updatedAt" FROM "escalation_policy";
DROP TABLE "escalation_policy";
ALTER TABLE "new_escalation_policy" RENAME TO "escalation_policy";
CREATE INDEX "escalation_policy_createdById_idx" ON "escalation_policy"("createdById");
CREATE TABLE "new_incident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "impact" TEXT NOT NULL DEFAULT 'Major',
    "status" TEXT NOT NULL DEFAULT 'Investigating',
    "monitorId" TEXT,
    "createdById" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "postmortem" TEXT,
    "postmortemPublishedAt" DATETIME,
    "acknowledgedAt" DATETIME,
    "acknowledgedById" TEXT,
    "escalationStep" INTEGER NOT NULL DEFAULT 0,
    "lastEscalatedAt" DATETIME,
    CONSTRAINT "incident_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "incident_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "incident_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_incident" ("acknowledgedAt", "acknowledgedById", "createdAt", "createdById", "escalationStep", "id", "impact", "lastEscalatedAt", "monitorId", "postmortem", "postmortemPublishedAt", "resolvedAt", "status", "title", "updatedAt") SELECT "acknowledgedAt", "acknowledgedById", "createdAt", "createdById", "escalationStep", "id", "impact", "lastEscalatedAt", "monitorId", "postmortem", "postmortemPublishedAt", "resolvedAt", "status", "title", "updatedAt" FROM "incident";
DROP TABLE "incident";
ALTER TABLE "new_incident" RENAME TO "incident";
CREATE INDEX "incident_monitorId_idx" ON "incident"("monitorId");
CREATE INDEX "incident_createdById_idx" ON "incident"("createdById");
CREATE INDEX "incident_acknowledgedById_idx" ON "incident"("acknowledgedById");
CREATE TABLE "new_incident_update" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incident_update_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incident" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "incident_update_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_incident_update" ("authorId", "createdAt", "id", "incidentId", "message", "status") SELECT "authorId", "createdAt", "id", "incidentId", "message", "status" FROM "incident_update";
DROP TABLE "incident_update";
ALTER TABLE "new_incident_update" RENAME TO "incident_update";
CREATE INDEX "incident_update_incidentId_createdAt_idx" ON "incident_update"("incidentId", "createdAt");
CREATE TABLE "new_integration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "secret" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "integration_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_integration" ("createdAt", "createdById", "enabled", "id", "name", "secret", "target", "type", "updatedAt") SELECT "createdAt", "createdById", "enabled", "id", "name", "secret", "target", "type", "updatedAt" FROM "integration";
DROP TABLE "integration";
ALTER TABLE "new_integration" RENAME TO "integration";
CREATE INDEX "integration_createdById_idx" ON "integration"("createdById");
CREATE TABLE "new_maintenance_window" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "cancelledAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "maintenance_window_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_maintenance_window" ("cancelledAt", "createdAt", "createdById", "endsAt", "id", "message", "startsAt", "title", "updatedAt") SELECT "cancelledAt", "createdAt", "createdById", "endsAt", "id", "message", "startsAt", "title", "updatedAt" FROM "maintenance_window";
DROP TABLE "maintenance_window";
ALTER TABLE "new_maintenance_window" RENAME TO "maintenance_window";
CREATE INDEX "maintenance_window_createdById_idx" ON "maintenance_window"("createdById");
CREATE INDEX "maintenance_window_startsAt_endsAt_idx" ON "maintenance_window"("startsAt", "endsAt");
CREATE TABLE "new_monitor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'HTTP',
    "status" TEXT NOT NULL DEFAULT 'Up',
    "interval" TEXT NOT NULL DEFAULT '60s',
    "port" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "uptime" REAL NOT NULL DEFAULT 100,
    "responseTime" INTEGER,
    "lastCheckedAt" DATETIME,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "requestHeaders" TEXT,
    "requestBody" TEXT,
    "followRedirects" BOOLEAN NOT NULL DEFAULT true,
    "expectedStatusCodes" TEXT,
    "keyword" TEXT,
    "keywordInverted" BOOLEAN NOT NULL DEFAULT false,
    "certExpiresAt" DATETIME,
    "createdById" TEXT,
    "escalationPolicyId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "monitor_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "monitor_escalationPolicyId_fkey" FOREIGN KEY ("escalationPolicyId") REFERENCES "escalation_policy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_monitor" ("certExpiresAt", "createdAt", "createdById", "enabled", "escalationPolicyId", "expectedStatusCodes", "followRedirects", "id", "interval", "keyword", "keywordInverted", "lastCheckedAt", "method", "name", "port", "requestBody", "requestHeaders", "responseTime", "status", "type", "updatedAt", "uptime", "url") SELECT "certExpiresAt", "createdAt", "createdById", "enabled", "escalationPolicyId", "expectedStatusCodes", "followRedirects", "id", "interval", "keyword", "keywordInverted", "lastCheckedAt", "method", "name", "port", "requestBody", "requestHeaders", "responseTime", "status", "type", "updatedAt", "uptime", "url" FROM "monitor";
DROP TABLE "monitor";
ALTER TABLE "new_monitor" RENAME TO "monitor";
CREATE INDEX "monitor_createdById_idx" ON "monitor"("createdById");
CREATE INDEX "monitor_escalationPolicyId_idx" ON "monitor"("escalationPolicyId");
CREATE TABLE "new_status_page" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "customDomain" TEXT,
    "description" TEXT,
    "logoUrl" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "primaryColor" TEXT NOT NULL DEFAULT '#7c3aed',
    "historyWindowDays" INTEGER NOT NULL DEFAULT 90,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "showTags" BOOLEAN NOT NULL DEFAULT false,
    "requireLogin" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "status_page_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_status_page" ("createdAt", "createdById", "customDomain", "description", "historyWindowDays", "id", "isPublished", "logoUrl", "name", "primaryColor", "requireLogin", "showTags", "slug", "theme", "updatedAt") SELECT "createdAt", "createdById", "customDomain", "description", "historyWindowDays", "id", "isPublished", "logoUrl", "name", "primaryColor", "requireLogin", "showTags", "slug", "theme", "updatedAt" FROM "status_page";
DROP TABLE "status_page";
ALTER TABLE "new_status_page" RENAME TO "status_page";
CREATE UNIQUE INDEX "status_page_slug_key" ON "status_page"("slug");
CREATE UNIQUE INDEX "status_page_customDomain_key" ON "status_page"("customDomain");
CREATE INDEX "status_page_createdById_idx" ON "status_page"("createdById");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");
