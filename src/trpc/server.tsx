import { headers } from 'next/headers';
import { createTRPCContext } from './init';
import { appRouter } from './routers/_app';

export const caller = appRouter.createCaller(async () =>
  createTRPCContext({ headers: await headers() }),
);