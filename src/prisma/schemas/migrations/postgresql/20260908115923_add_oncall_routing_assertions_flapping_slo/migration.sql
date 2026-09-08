-- AlterTable
ALTER TABLE "monitor" ADD COLUMN     "assertionType" TEXT NOT NULL DEFAULT 'Contains',
ADD COLUMN     "credential" TEXT,
ADD COLUMN     "domainExpiresAt" TIMESTAMP(3),
ADD COLUMN     "flappingSince" TIMESTAMP(3),
ADD COLUMN     "jsonPath" TEXT,
ADD COLUMN     "sloTarget" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "monitor_daily_stat" ADD COLUMN     "maxResponseTime" INTEGER,
ADD COLUMN     "p50ResponseTime" INTEGER,
ADD COLUMN     "p95ResponseTime" INTEGER,
ADD COLUMN     "p99ResponseTime" INTEGER;

-- AlterTable
ALTER TABLE "escalation_step" ADD COLUMN     "onCallScheduleId" TEXT,
ALTER COLUMN "integrationId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN     "domainExpiryWarningDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "domainExpiryWarningEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "flappingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "flappingThreshold" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "flappingWindowMinutes" INTEGER NOT NULL DEFAULT 60;

-- CreateTable
CREATE TABLE "on_call_schedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "rotationType" TEXT NOT NULL DEFAULT 'Weekly',
    "handoffHour" INTEGER NOT NULL DEFAULT 9,
    "handoffDay" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "on_call_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "on_call_participant" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "integrationId" TEXT NOT NULL,

    CONSTRAINT "on_call_participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "on_call_override" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "participantId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "on_call_override_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_rule" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_rule_integration" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,

    CONSTRAINT "notification_rule_integration_pkey" PRIMARY KEY ("id")
);

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

-- CreateIndex
CREATE INDEX "escalation_step_onCallScheduleId_idx" ON "escalation_step"("onCallScheduleId");

-- AddForeignKey
ALTER TABLE "escalation_step" ADD CONSTRAINT "escalation_step_onCallScheduleId_fkey" FOREIGN KEY ("onCallScheduleId") REFERENCES "on_call_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_call_schedule" ADD CONSTRAINT "on_call_schedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_call_participant" ADD CONSTRAINT "on_call_participant_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "on_call_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_call_participant" ADD CONSTRAINT "on_call_participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_call_participant" ADD CONSTRAINT "on_call_participant_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_call_override" ADD CONSTRAINT "on_call_override_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "on_call_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_call_override" ADD CONSTRAINT "on_call_override_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "on_call_participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_rule" ADD CONSTRAINT "notification_rule_matchTagId_fkey" FOREIGN KEY ("matchTagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_rule" ADD CONSTRAINT "notification_rule_matchMonitorId_fkey" FOREIGN KEY ("matchMonitorId") REFERENCES "monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_rule" ADD CONSTRAINT "notification_rule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_rule_integration" ADD CONSTRAINT "notification_rule_integration_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "notification_rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_rule_integration" ADD CONSTRAINT "notification_rule_integration_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

