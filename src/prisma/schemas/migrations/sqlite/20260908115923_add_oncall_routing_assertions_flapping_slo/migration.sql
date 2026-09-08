-- AlterTable
ALTER TABLE "monitor_daily_stat" ADD COLUMN "maxResponseTime" INTEGER;
ALTER TABLE "monitor_daily_stat" ADD COLUMN "p50ResponseTime" INTEGER;
ALTER TABLE "monitor_daily_stat" ADD COLUMN "p95ResponseTime" INTEGER;
ALTER TABLE "monitor_daily_stat" ADD COLUMN "p99ResponseTime" INTEGER;

-- CreateTable
CREATE TABLE "on_call_schedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "rotationType" TEXT NOT NULL DEFAULT 'Weekly',
    "handoffHour" INTEGER NOT NULL DEFAULT 9,
    "handoffDay" INTEGER NOT NULL DEFAULT 1,
    "startsAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "on_call_schedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "on_call_participant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "integrationId" TEXT NOT NULL,
    CONSTRAINT "on_call_participant_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "on_call_schedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "on_call_participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "on_call_participant_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integration" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "on_call_override" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "participantId" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "on_call_override_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "on_call_schedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "on_call_override_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "on_call_participant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notification_rule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "matchTagId" TEXT,
    "matchMonitorId" TEXT,
    "matchImpact" TEXT,
    "activeDays" TEXT,
    "activeFromMinute" INTEGER,
    "activeUntilMinute" INTEGER,
    "action" TEXT NOT NULL DEFAULT 'Route',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "notification_rule_matchTagId_fkey" FOREIGN KEY ("matchTagId") REFERENCES "tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notification_rule_matchMonitorId_fkey" FOREIGN KEY ("matchMonitorId") REFERENCES "monitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notification_rule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notification_rule_integration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    CONSTRAINT "notification_rule_integration_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "notification_rule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notification_rule_integration_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integration" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "domainExpiryWarningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "domainExpiryWarningDays" INTEGER NOT NULL DEFAULT 30,
    "flappingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "flappingWindowMinutes" INTEGER NOT NULL DEFAULT 60,
    "flappingThreshold" INTEGER NOT NULL DEFAULT 6,
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
    "updateCheckEnabled" BOOLEAN NOT NULL DEFAULT true,
    "latestVersion" TEXT,
    "latestVersionUrl" TEXT,
    "latestVersionPublishedAt" DATETIME,
    "lastUpdateCheckAt" DATETIME,
    "lastUpdateCheckError" TEXT,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_app_settings" ("apiKey", "certExpiryWarningDays", "certExpiryWarningEnabled", "checkRetentionDays", "defaultCheckInterval", "deliveryRetentionDays", "failedAttemptsThreshold", "httpTimeoutSeconds", "id", "lastUpdateCheckAt", "lastUpdateCheckError", "latencyThresholdMs", "latestVersion", "latestVersionPublishedAt", "latestVersionUrl", "organizationName", "smtpFromEmail", "smtpFromName", "smtpHost", "smtpPass", "smtpPort", "smtpUseTls", "smtpUser", "sslCheckEnabled", "supportEmail", "timezone", "updateCheckEnabled", "updatedAt", "vapidPrivateKey", "vapidPublicKey", "webhookSigningSecret") SELECT "apiKey", "certExpiryWarningDays", "certExpiryWarningEnabled", "checkRetentionDays", "defaultCheckInterval", "deliveryRetentionDays", "failedAttemptsThreshold", "httpTimeoutSeconds", "id", "lastUpdateCheckAt", "lastUpdateCheckError", "latencyThresholdMs", "latestVersion", "latestVersionPublishedAt", "latestVersionUrl", "organizationName", "smtpFromEmail", "smtpFromName", "smtpHost", "smtpPass", "smtpPort", "smtpUseTls", "smtpUser", "sslCheckEnabled", "supportEmail", "timezone", "updateCheckEnabled", "updatedAt", "vapidPrivateKey", "vapidPublicKey", "webhookSigningSecret" FROM "app_settings";
DROP TABLE "app_settings";
ALTER TABLE "new_app_settings" RENAME TO "app_settings";
CREATE UNIQUE INDEX "app_settings_apiKey_key" ON "app_settings"("apiKey");
CREATE TABLE "new_escalation_step" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "escalationPolicyId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "delayMinutes" INTEGER NOT NULL,
    "integrationId" TEXT,
    "onCallScheduleId" TEXT,
    CONSTRAINT "escalation_step_escalationPolicyId_fkey" FOREIGN KEY ("escalationPolicyId") REFERENCES "escalation_policy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "escalation_step_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integration" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "escalation_step_onCallScheduleId_fkey" FOREIGN KEY ("onCallScheduleId") REFERENCES "on_call_schedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_escalation_step" ("delayMinutes", "escalationPolicyId", "id", "integrationId", "order") SELECT "delayMinutes", "escalationPolicyId", "id", "integrationId", "order" FROM "escalation_step";
DROP TABLE "escalation_step";
ALTER TABLE "new_escalation_step" RENAME TO "escalation_step";
CREATE INDEX "escalation_step_escalationPolicyId_idx" ON "escalation_step"("escalationPolicyId");
CREATE INDEX "escalation_step_integrationId_idx" ON "escalation_step"("integrationId");
CREATE INDEX "escalation_step_onCallScheduleId_idx" ON "escalation_step"("onCallScheduleId");
CREATE UNIQUE INDEX "escalation_step_escalationPolicyId_order_key" ON "escalation_step"("escalationPolicyId", "order");
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
    "assertionType" TEXT NOT NULL DEFAULT 'Contains',
    "jsonPath" TEXT,
    "credential" TEXT,
    "domainExpiresAt" DATETIME,
    "flappingSince" DATETIME,
    "sloTarget" REAL,
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
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "on_call_schedule_createdById_idx" ON "on_call_schedule"("createdById");

-- CreateIndex
CREATE INDEX "on_call_participant_scheduleId_idx" ON "on_call_participant"("scheduleId");

-- CreateIndex
CREATE INDEX "on_call_participant_userId_idx" ON "on_call_participant"("userId");

-- CreateIndex
CREATE INDEX "on_call_participant_integrationId_idx" ON "on_call_participant"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "on_call_participant_scheduleId_order_key" ON "on_call_participant"("scheduleId", "order");

-- CreateIndex
CREATE INDEX "on_call_override_scheduleId_startsAt_endsAt_idx" ON "on_call_override"("scheduleId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "on_call_override_participantId_idx" ON "on_call_override"("participantId");

-- CreateIndex
CREATE INDEX "notification_rule_matchTagId_idx" ON "notification_rule"("matchTagId");

-- CreateIndex
CREATE INDEX "notification_rule_matchMonitorId_idx" ON "notification_rule"("matchMonitorId");

-- CreateIndex
CREATE INDEX "notification_rule_createdById_idx" ON "notification_rule"("createdById");

-- CreateIndex
CREATE INDEX "notification_rule_integration_ruleId_idx" ON "notification_rule_integration"("ruleId");

-- CreateIndex
CREATE INDEX "notification_rule_integration_integrationId_idx" ON "notification_rule_integration"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_rule_integration_ruleId_integrationId_key" ON "notification_rule_integration"("ruleId", "integrationId");
