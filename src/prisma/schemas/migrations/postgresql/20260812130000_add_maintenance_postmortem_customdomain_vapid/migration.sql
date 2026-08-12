-- AlterTable
ALTER TABLE "incident" ADD COLUMN "postmortem" TEXT;
ALTER TABLE "incident" ADD COLUMN "postmortemPublishedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "status_page" ADD COLUMN "customDomain" TEXT;

-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN "vapidPublicKey" TEXT;
ALTER TABLE "app_settings" ADD COLUMN "vapidPrivateKey" TEXT;

-- CreateTable
CREATE TABLE "maintenance_window" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_window_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_window_monitor" (
    "id" TEXT NOT NULL,
    "maintenanceWindowId" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,

    CONSTRAINT "maintenance_window_monitor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "status_page_customDomain_key" ON "status_page"("customDomain");

-- CreateIndex
CREATE INDEX "maintenance_window_createdById_idx" ON "maintenance_window"("createdById");

-- CreateIndex
CREATE INDEX "maintenance_window_startsAt_endsAt_idx" ON "maintenance_window"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "maintenance_window_monitor_maintenanceWindowId_idx" ON "maintenance_window_monitor"("maintenanceWindowId");

-- CreateIndex
CREATE INDEX "maintenance_window_monitor_monitorId_idx" ON "maintenance_window_monitor"("monitorId");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_window_monitor_maintenanceWindowId_monitorId_key" ON "maintenance_window_monitor"("maintenanceWindowId", "monitorId");

-- AddForeignKey
ALTER TABLE "maintenance_window" ADD CONSTRAINT "maintenance_window_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_window_monitor" ADD CONSTRAINT "maintenance_window_monitor_maintenanceWindowId_fkey" FOREIGN KEY ("maintenanceWindowId") REFERENCES "maintenance_window"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_window_monitor" ADD CONSTRAINT "maintenance_window_monitor_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
