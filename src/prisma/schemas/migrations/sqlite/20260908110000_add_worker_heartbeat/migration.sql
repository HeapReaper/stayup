-- CreateTable
CREATE TABLE "worker_heartbeat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lastSeenAt" DATETIME NOT NULL,
    "intervalSeconds" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "version" TEXT,
    "revision" TEXT
);
