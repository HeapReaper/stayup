-- CreateTable
CREATE TABLE "escalation_policy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "escalation_policy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "escalation_step" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "escalationPolicyId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "delayMinutes" INTEGER NOT NULL,
    "integrationId" TEXT NOT NULL,
    CONSTRAINT "escalation_step_escalationPolicyId_fkey" FOREIGN KEY ("escalationPolicyId") REFERENCES "escalation_policy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "escalation_step_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integration" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#7c3aed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "monitor_tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monitorId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    CONSTRAINT "monitor_tag_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "monitor_tag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_monitor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'HTTP',
    "status" TEXT NOT NULL DEFAULT 'Up',
    "interval" TEXT NOT NULL DEFAULT '60s',
    "port" INTEGER,
    "uptime" REAL NOT NULL DEFAULT 100,
    "responseTime" INTEGER,
    "lastCheckedAt" DATETIME,
    "createdById" TEXT,
    "escalationPolicyId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "monitor_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "monitor_escalationPolicyId_fkey" FOREIGN KEY ("escalationPolicyId") REFERENCES "escalation_policy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_monitor" ("createdAt", "createdById", "id", "interval", "lastCheckedAt", "name", "port", "responseTime", "status", "type", "updatedAt", "uptime", "url") SELECT "createdAt", "createdById", "id", "interval", "lastCheckedAt", "name", "port", "responseTime", "status", "type", "updatedAt", "uptime", "url" FROM "monitor";
DROP TABLE "monitor";
ALTER TABLE "new_monitor" RENAME TO "monitor";
CREATE INDEX "monitor_createdById_idx" ON "monitor"("createdById");
CREATE INDEX "monitor_escalationPolicyId_idx" ON "monitor"("escalationPolicyId");
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
INSERT INTO "new_incident" ("createdAt", "createdById", "id", "impact", "monitorId", "postmortem", "postmortemPublishedAt", "resolvedAt", "status", "title", "updatedAt") SELECT "createdAt", "createdById", "id", "impact", "monitorId", "postmortem", "postmortemPublishedAt", "resolvedAt", "status", "title", "updatedAt" FROM "incident";
DROP TABLE "incident";
ALTER TABLE "new_incident" RENAME TO "incident";
CREATE INDEX "incident_monitorId_idx" ON "incident"("monitorId");
CREATE INDEX "incident_createdById_idx" ON "incident"("createdById");
CREATE INDEX "incident_acknowledgedById_idx" ON "incident"("acknowledgedById");
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
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "status_page_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_status_page" ("createdAt", "createdById", "customDomain", "description", "historyWindowDays", "id", "isPublished", "logoUrl", "name", "primaryColor", "slug", "theme", "updatedAt") SELECT "createdAt", "createdById", "customDomain", "description", "historyWindowDays", "id", "isPublished", "logoUrl", "name", "primaryColor", "slug", "theme", "updatedAt" FROM "status_page";
DROP TABLE "status_page";
ALTER TABLE "new_status_page" RENAME TO "status_page";
CREATE UNIQUE INDEX "status_page_slug_key" ON "status_page"("slug");
CREATE UNIQUE INDEX "status_page_customDomain_key" ON "status_page"("customDomain");
CREATE INDEX "status_page_createdById_idx" ON "status_page"("createdById");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "escalation_policy_createdById_idx" ON "escalation_policy"("createdById");

-- CreateIndex
CREATE INDEX "escalation_step_escalationPolicyId_idx" ON "escalation_step"("escalationPolicyId");

-- CreateIndex
CREATE INDEX "escalation_step_integrationId_idx" ON "escalation_step"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "escalation_step_escalationPolicyId_order_key" ON "escalation_step"("escalationPolicyId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "tag_name_key" ON "tag"("name");

-- CreateIndex
CREATE INDEX "monitor_tag_monitorId_idx" ON "monitor_tag"("monitorId");

-- CreateIndex
CREATE INDEX "monitor_tag_tagId_idx" ON "monitor_tag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_tag_monitorId_tagId_key" ON "monitor_tag"("monitorId", "tagId");

