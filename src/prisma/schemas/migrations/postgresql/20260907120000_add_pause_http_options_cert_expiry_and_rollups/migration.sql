-- AlterTable
ALTER TABLE "monitor" ADD COLUMN     "certExpiresAt" TIMESTAMP(3),
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "expectedStatusCodes" TEXT,
ADD COLUMN     "followRedirects" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "keyword" TEXT,
ADD COLUMN     "keywordInverted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'GET',
ADD COLUMN     "requestBody" TEXT,
ADD COLUMN     "requestHeaders" TEXT;

-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN     "certExpiryWarningDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "checkRetentionDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "deliveryRetentionDays" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "monitor_daily_stat" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "totalChecks" INTEGER NOT NULL,
    "upChecks" INTEGER NOT NULL,
    "degradedChecks" INTEGER NOT NULL,
    "downChecks" INTEGER NOT NULL,
    "avgResponseTime" INTEGER,
    "uptime" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_daily_stat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monitor_daily_stat_day_idx" ON "monitor_daily_stat"("day");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_daily_stat_monitorId_day_key" ON "monitor_daily_stat"("monitorId", "day");

-- AddForeignKey
ALTER TABLE "monitor_daily_stat" ADD CONSTRAINT "monitor_daily_stat_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

