-- CreateTable
CREATE TABLE "monitor_daily_stat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monitorId" TEXT NOT NULL,
    "day" DATETIME NOT NULL,
    "totalChecks" INTEGER NOT NULL,
    "upChecks" INTEGER NOT NULL,
    "degradedChecks" INTEGER NOT NULL,
    "downChecks" INTEGER NOT NULL,
    "avgResponseTime" INTEGER,
    "uptime" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "monitor_daily_stat_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
INSERT INTO "new_monitor" ("createdAt", "createdById", "escalationPolicyId", "id", "interval", "lastCheckedAt", "name", "port", "responseTime", "status", "type", "updatedAt", "uptime", "url") SELECT "createdAt", "createdById", "escalationPolicyId", "id", "interval", "lastCheckedAt", "name", "port", "responseTime", "status", "type", "updatedAt", "uptime", "url" FROM "monitor";
DROP TABLE "monitor";
ALTER TABLE "new_monitor" RENAME TO "monitor";
CREATE INDEX "monitor_createdById_idx" ON "monitor"("createdById");
CREATE INDEX "monitor_escalationPolicyId_idx" ON "monitor"("escalationPolicyId");
CREATE TABLE "new_app_settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "organizationName" TEXT NOT NULL DEFAULT 'My Organization',
    "timezone" TEXT NOT NULL DEFAULT 'utc',
    "supportEmail" TEXT,
    "defaultCheckInterval" TEXT NOT NULL DEFAULT '60s',
    "httpTimeoutSeconds" INTEGER NOT NULL DEFAULT 30,
    "failedAttemptsThreshold" INTEGER NOT NULL DEFAULT 1,
    "latencyThresholdMs" INTEGER NOT NULL DEFAULT 2000,
    "sslCheckEnabled" BOOLEAN NOT NULL DEFAULT true,
    "certExpiryWarningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "certExpiryWarningDays" INTEGER NOT NULL DEFAULT 14,
    "checkRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "deliveryRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUser" TEXT,
    "smtpPass" TEXT,
    "smtpFromEmail" TEXT,
    "smtpFromName" TEXT,
    "smtpUseTls" BOOLEAN NOT NULL DEFAULT true,
    "apiKey" TEXT NOT NULL,
    "webhookSigningSecret" TEXT NOT NULL,
    "vapidPublicKey" TEXT,
    "vapidPrivateKey" TEXT,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_app_settings" ("apiKey", "certExpiryWarningEnabled", "defaultCheckInterval", "failedAttemptsThreshold", "httpTimeoutSeconds", "id", "latencyThresholdMs", "organizationName", "smtpFromEmail", "smtpFromName", "smtpHost", "smtpPass", "smtpPort", "smtpUseTls", "smtpUser", "sslCheckEnabled", "supportEmail", "timezone", "updatedAt", "vapidPrivateKey", "vapidPublicKey", "webhookSigningSecret") SELECT "apiKey", "certExpiryWarningEnabled", "defaultCheckInterval", "failedAttemptsThreshold", "httpTimeoutSeconds", "id", "latencyThresholdMs", "organizationName", "smtpFromEmail", "smtpFromName", "smtpHost", "smtpPass", "smtpPort", "smtpUseTls", "smtpUser", "sslCheckEnabled", "supportEmail", "timezone", "updatedAt", "vapidPrivateKey", "vapidPublicKey", "webhookSigningSecret" FROM "app_settings";
DROP TABLE "app_settings";
ALTER TABLE "new_app_settings" RENAME TO "app_settings";
CREATE UNIQUE INDEX "app_settings_apiKey_key" ON "app_settings"("apiKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "monitor_daily_stat_day_idx" ON "monitor_daily_stat"("day");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_daily_stat_monitorId_day_key" ON "monitor_daily_stat"("monitorId", "day");

