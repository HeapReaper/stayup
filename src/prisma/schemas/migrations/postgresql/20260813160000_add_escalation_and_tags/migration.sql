-- AlterTable
ALTER TABLE "monitor" ADD COLUMN     "escalationPolicyId" TEXT;

-- AlterTable
ALTER TABLE "incident" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "acknowledgedById" TEXT,
ADD COLUMN     "escalationStep" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastEscalatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "status_page" ADD COLUMN     "showTags" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "escalation_policy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "escalation_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_step" (
    "id" TEXT NOT NULL,
    "escalationPolicyId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "delayMinutes" INTEGER NOT NULL,
    "integrationId" TEXT NOT NULL,

    CONSTRAINT "escalation_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#7c3aed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_tag" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "monitor_tag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "escalation_policy_createdById_idx" ON "escalation_policy"("createdById");

-- CreateIndex
CREATE INDEX "escalation_step_escalationPolicyId_idx" ON "escalation_step"("escalationPolicyId");

-- CreateIndex
CREATE INDEX "escalation_step_integrationId_idx" ON "escalation_step"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "escalation_step_escalationPolicyId_order_key" ON "escalation_step"("escalationPolicyId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "tag_name_key" ON "tag"("name");

-- CreateIndex
CREATE INDEX "monitor_tag_monitorId_idx" ON "monitor_tag"("monitorId");

-- CreateIndex
CREATE INDEX "monitor_tag_tagId_idx" ON "monitor_tag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_tag_monitorId_tagId_key" ON "monitor_tag"("monitorId", "tagId");

-- CreateIndex
CREATE INDEX "monitor_escalationPolicyId_idx" ON "monitor"("escalationPolicyId");

-- CreateIndex
CREATE INDEX "incident_acknowledgedById_idx" ON "incident"("acknowledgedById");

-- AddForeignKey
ALTER TABLE "monitor" ADD CONSTRAINT "monitor_escalationPolicyId_fkey" FOREIGN KEY ("escalationPolicyId") REFERENCES "escalation_policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident" ADD CONSTRAINT "incident_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_policy" ADD CONSTRAINT "escalation_policy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_step" ADD CONSTRAINT "escalation_step_escalationPolicyId_fkey" FOREIGN KEY ("escalationPolicyId") REFERENCES "escalation_policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_step" ADD CONSTRAINT "escalation_step_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_tag" ADD CONSTRAINT "monitor_tag_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_tag" ADD CONSTRAINT "monitor_tag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

