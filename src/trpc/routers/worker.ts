import { createTRPCRouter, protectedProcedure } from '../init';
import { getAppProcessStatus, getWorkerStatuses } from '@/lib/workers';

export type { AppProcessView, WorkerStatusView } from '@/lib/workers';

/**
 * Worker liveness for the dashboard. Read-only by nature — the heartbeat rows
 * are written exclusively by the Go binaries (see src/lib/workers.ts).
 */
export const workerRouter = createTRPCRouter({
  getAll: protectedProcedure.query(async () => getWorkerStatuses()),

  /**
   * The web process's own memory and uptime. Separate from getAll because it
   * comes from this process rather than from a heartbeat row — see
   * getAppProcessStatus().
   */
  getAppProcess: protectedProcedure.query(() => getAppProcessStatus()),
});
