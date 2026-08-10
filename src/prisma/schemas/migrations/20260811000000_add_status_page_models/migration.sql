-- CreateTable
CREATE TABLE "status_page" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "primaryColor" TEXT NOT NULL DEFAULT '#7c3aed',
    "historyWindowDays" INTEGER NOT NULL DEFAULT 90,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "status_page_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "status_page_group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "statusPageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "status_page_group_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "status_page" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "status_page_monitor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "statusPageId" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "groupId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "status_page_monitor_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "status_page" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "status_page_monitor_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "status_page_monitor_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "status_page_group" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "status_page_subscriber" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "statusPageId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "status_page_subscriber_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "status_page" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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

