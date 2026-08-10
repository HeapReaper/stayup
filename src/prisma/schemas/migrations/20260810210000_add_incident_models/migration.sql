-- CreateTable
CREATE TABLE "incident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "impact" TEXT NOT NULL DEFAULT 'Major',
    "status" TEXT NOT NULL DEFAULT 'Investigating',
    "monitorId" TEXT,
    "createdById" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "incident_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "incident_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "incident_update" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incident_update_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incident" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "incident_update_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "incident_subscriber" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incident_subscriber_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incident" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "incident_monitorId_idx" ON "incident"("monitorId");

-- CreateIndex
CREATE INDEX "incident_createdById_idx" ON "incident"("createdById");

-- CreateIndex
CREATE INDEX "incident_update_incidentId_createdAt_idx" ON "incident_update"("incidentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "incident_subscriber_incidentId_email_key" ON "incident_subscriber"("incidentId", "email");

