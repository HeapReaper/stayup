import { createTRPCRouter, protectedProcedure } from '../init';
import { getWorkerStatuses } from '@/lib/workers';

export type { WorkerStatusView } from '@/lib/workers';

/**
 * Worker liveness for the dashboard. Read-only by nature — the heartbeat rows
 * are written exclusively by the Go binaries (see src/lib/workers.ts).
 */
export const workerRouter = createTRPCRouter({
  getAll: protectedProcedure.query(async () => getWorkerStatuses()),
});
