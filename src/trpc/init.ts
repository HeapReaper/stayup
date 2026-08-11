import { initTRPC, TRPCError } from '@trpc/server';
import { auth } from '@/lib/auth';

/**
 * Context creator which fetches session from headers
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  const session = await auth.api.getSession({
    headers: opts.headers,
  });

  // Behind a proxy/load balancer, the real client IP shows up in
  // x-forwarded-for (first entry) or x-real-ip. Neither is set for direct
  // local requests, hence the fallback — used for audit log entries only,
  // not for anything security-sensitive.
  const ipAddress =
    opts.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    opts.headers.get('x-real-ip') ||
    'unknown';

  return {
    session,
    ipAddress,
  };
};

const t = initTRPC
  .context<Awaited<ReturnType<typeof createTRPCContext>>>()
  .create({
    /**
     * @see https://trpc.io/docs/server/data-transformers
     */
    // transformer: superjson,
  });

// Base router, caller factory & public procedure helpers
export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const baseProcedure = t.procedure;

/**
 * Protected procedure: Only for logged in users
 * Throws an UNAUTHORIZED when a unauthenticated user tries to access it
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session || !ctx.session.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Not authenticated',
    });
  }

  return next({
    ctx: {
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});