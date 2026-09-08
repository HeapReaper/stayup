-- CreateTable
CREATE TABLE "worker_heartbeat" (
    "id" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "intervalSeconds" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "version" TEXT,
    "revision" TEXT,

    CONSTRAINT "worker_heartbeat_pkey" PRIMARY KEY ("id")
);
