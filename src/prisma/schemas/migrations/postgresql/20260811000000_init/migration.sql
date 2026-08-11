-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "type" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'HTTP',
    "status" TEXT NOT NULL DEFAULT 'Up',
    "interval" TEXT NOT NULL DEFAULT '60s',
    "port" INTEGER,
    "uptime" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "responseTime" INTEGER,
    "lastCheckedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_check" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusCode" INTEGER,
    "responseTime" INTEGER,
    "message" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_check_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "impact" TEXT NOT NULL DEFAULT 'Major',
    "status" TEXT NOT NULL DEFAULT 'Investigating',
    "monitorId" TEXT,
    "createdById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_update" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_update_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_subscriber" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_page" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "primaryColor" TEXT NOT NULL DEFAULT '#7c3aed',
    "historyWindowDays" INTEGER NOT NULL DEFAULT 90,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "status_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_page_group" (
    "id" TEXT NOT NULL,
    "statusPageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "status_page_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_page_monitor" (
    "id" TEXT NOT NULL,
    "statusPageId" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "groupId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "status_page_monitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_page_subscriber" (
    "id" TEXT NOT NULL,
    "statusPageId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_page_subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "secret" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_delivery" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "incidentId" TEXT,
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "integration_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "organizationName" TEXT NOT NULL DEFAULT 'My Organization',
    "timezone" TEXT NOT NULL DEFAULT 'utc',
    "supportEmail" TEXT,
    "defaultCheckInterval" TEXT NOT NULL DEFAULT '60s',
    "httpTimeoutSeconds" INTEGER NOT NULL DEFAULT 30,
    "failedAttemptsThreshold" INTEGER NOT NULL DEFAULT 1,
    "latencyThresholdMs" INTEGER NOT NULL DEFAULT 800,
    "sslCheckEnabled" BOOLEAN NOT NULL DEFAULT true,
    "certExpiryWarningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUser" TEXT,
    "smtpPass" TEXT,
    "smtpFromEmail" TEXT,
    "smtpFromName" TEXT,
    "smtpUseTls" BOOLEAN NOT NULL DEFAULT true,
    "apiKey" TEXT NOT NULL,
    "webhookSigningSecret" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "monitor_createdById_idx" ON "monitor"("createdById");

-- CreateIndex
CREATE INDEX "monitor_check_monitorId_checkedAt_idx" ON "monitor_check"("monitorId", "checkedAt");

-- CreateIndex
CREATE INDEX "incident_monitorId_idx" ON "incident"("monitorId");

-- CreateIndex
CREATE INDEX "incident_createdById_idx" ON "incident"("createdById");

-- CreateIndex
CREATE INDEX "incident_update_incidentId_createdAt_idx" ON "incident_update"("incidentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "incident_subscriber_incidentId_email_key" ON "incident_subscriber"("incidentId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "status_page_slug_key" ON "status_page"("slug");

-- CreateIndex
CREATE INDEX "status_page_createdById_idx" ON "status_page"("createdById");

-- CreateIndex
CREATE INDEX "status_page_group_statusPageId_idx" ON "status_page_group"("statusPageId");

-- CreateIndex
CREATE INDEX "status_page_monitor_statusPageId_idx" ON "status_page_monitor"("statusPageId");

-- CreateIndex
CREATE INDEX "status_page_monitor_groupId_idx" ON "status_page_monitor"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "status_page_monitor_statusPageId_monitorId_key" ON "status_page_monitor"("statusPageId", "monitorId");

-- CreateIndex
CREATE INDEX "status_page_subscriber_statusPageId_idx" ON "status_page_subscriber"("statusPageId");

-- CreateIndex
CREATE UNIQUE INDEX "status_page_subscriber_statusPageId_channel_target_key" ON "status_page_subscriber"("statusPageId", "channel", "target");

-- CreateIndex
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log"("createdAt");

-- CreateIndex
CREATE INDEX "integration_createdById_idx" ON "integration"("createdById");

-- CreateIndex
CREATE INDEX "integration_delivery_integrationId_createdAt_idx" ON "integration_delivery"("integrationId", "createdAt");

-- CreateIndex
CREATE INDEX "integration_delivery_status_idx" ON "integration_delivery"("status");

-- CreateIndex
CREATE UNIQUE INDEX "app_settings_apiKey_key" ON "app_settings"("apiKey");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor" ADD CONSTRAINT "monitor_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_check" ADD CONSTRAINT "monitor_check_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident" ADD CONSTRAINT "incident_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident" ADD CONSTRAINT "incident_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_update" ADD CONSTRAINT "incident_update_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_update" ADD CONSTRAINT "incident_update_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_subscriber" ADD CONSTRAINT "incident_subscriber_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_page" ADD CONSTRAINT "status_page_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_page_group" ADD CONSTRAINT "status_page_group_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "status_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_page_monitor" ADD CONSTRAINT "status_page_monitor_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "status_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_page_monitor" ADD CONSTRAINT "status_page_monitor_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_page_monitor" ADD CONSTRAINT "status_page_monitor_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "status_page_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_page_subscriber" ADD CONSTRAINT "status_page_subscriber_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "status_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration" ADD CONSTRAINT "integration_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_delivery" ADD CONSTRAINT "integration_delivery_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_delivery" ADD CONSTRAINT "integration_delivery_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

