import { z } from 'zod';
import { baseProcedure, createTRPCRouter, protectedProcedure } from '../init';
import { userRouter } from './user';
import { monitorRouter } from './monitor';
import { incidentRouter } from './incident';
import { statusPageRouter } from './statuspage';
import { helloRouter } from '@/trpc/routers/hello';

export const appRouter = createTRPCRouter({
  hello: helloRouter,
  user: userRouter,
  monitor: monitorRouter,
  incident: incidentRouter,
  statusPage: statusPageRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;