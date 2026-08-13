// Standalone worker that delivers queued Integration notifications (Discord,
// Slack, generic Webhook, Telegram, Email, PagerDuty). src/lib/incidents.ts
// queues an IntegrationDelivery row (status: Pending) for every enabled
// Integration whenever an incident is created or updated — this worker picks
// those up, attempts delivery via src/lib/integration-delivery.ts, and
// retries failures up to MAX_ATTEMPTS before giving up.
//
// It also owns escalation policies: each tick, escalateOverdueIncidents()
// (src/lib/incidents.ts) checks every open, unacknowledged incident whose
// monitor has an EscalationPolicy attached and queues an IntegrationDelivery
// for whichever step is next due — so escalation pages flow through the
// exact same retry-up-to-5x queue as everything else here.
//
// This doesn't check monitors, so it doesn't build on src/lib/monitor-worker.ts
// — it's a different domain (delivery queue, not scheduled checks) with its
// own small poll loop, following the same shape as the other workers.
//
// Run it with `npm run worker:integrations` (see package.json). It's a
// separate long-running process from `next dev`/`next start` — it does not
// run inside the Next.js server.
import 'dotenv/config';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logging';
import { deliverToIntegration } from '@/lib/integration-delivery';
import { escalateOverdueIncidents } from '@/lib/incidents';
import type { Integration, IntegrationDelivery } from '@prisma/client';

const TICK_INTERVAL_MS = 5_000;
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processDelivery(delivery: IntegrationDelivery & { integration: Integration }) {
  const result = await deliverToIntegration(delivery.integration, delivery.event, delivery.message);
  const attempts = delivery.attempts + 1;
  const label = `"${delivery.event}" via ${delivery.integration.name} (${delivery.integration.type})`;

  if (result.success) {
    await prisma.integrationDelivery.update({
      where: { id: delivery.id },
      data: { status: 'Sent', attempts, sentAt: new Date(), error: null },
    });
    logger.info(`[integrations-worker] ✓ Delivered ${label}`);
    return;
  }

  if (attempts >= MAX_ATTEMPTS) {
    await prisma.integrationDelivery.update({
      where: { id: delivery.id },
      data: { status: 'Failed', attempts, error: result.error },
    });
    logger.error(`[integrations-worker] ✗ Gave up on ${label} after ${attempts} attempts: ${result.error}`);
    return;
  }

  await prisma.integrationDelivery.update({
    where: { id: delivery.id },
    data: { attempts, error: result.error },
  });
  logger.warn(`[integrations-worker] ⚠ Attempt ${attempts}/${MAX_ATTEMPTS} failed for ${label}: ${result.error}`);
}

async function tick(): Promise<void> {
  await escalateOverdueIncidents();

  const pending = await prisma.integrationDelivery.findMany({
    where: { status: 'Pending' },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
    include: { integration: true },
  });

  if (pending.length === 0) return;

  const results = await Promise.allSettled(pending.map(processDelivery));

  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      logger.error(`[integrations-worker] Failed to process delivery ${pending[index].id}`, result.reason);
    }
  }
}

async function main() {
  logger.info(`[integrations-worker] Started — polling every ${TICK_INTERVAL_MS / 1000}s`);

  let running = true;
  const shutdown = (signal: string) => {
    logger.info(`[integrations-worker] Received ${signal}, shutting down...`);
    running = false;
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  while (running) {
    try {
      await tick();
    } catch (error) {
      logger.error('[integrations-worker] Tick failed', error);
    }

    await sleep(TICK_INTERVAL_MS);
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((error) => {
  logger.error('[integrations-worker] Fatal error', error);
  process.exit(1);
});
