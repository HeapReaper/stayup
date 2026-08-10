import { z } from 'zod';
import { baseProcedure, createTRPCRouter, protectedProcedure } from '../init';
import { userRouter } from './user';
import { helloRouter } from '@/trpc/routers/hello';

export const appRouter = createTRPCRouter({
  hello: helloRouter,
  user: userRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;