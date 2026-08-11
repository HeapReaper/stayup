import { z } from 'zod';
import { baseProcedure, createTRPCRouter, protectedProcedure } from '../init';
import { userRouter } from './user';
import { monitorRouter } from './monitor';
import { incidentRouter } from './incident';
import { statusPageRouter } from './statuspage';
import { integrationRouter } from './integration';
import { logsRouter } from './logs';
import { settingsRouter } from './settings';
import { helloRouter } from '@/trpc/routers/hello';

export const appRouter = createTRPCRouter({
  hello: helloRouter,
  user: userRouter,
  monitor: monitorRouter,
  incident: incidentRouter,
  statusPage: statusPageRouter,
  integration: integrationRouter,
  logs: logsRouter,
  settings: settingsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;