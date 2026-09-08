import { initTRPC, TRPCError } from '@trpc/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  can,
  normalizeRole,
  type Capability,
  CAPABILITY_LABELS,
} from '@/lib/permissions';

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

/**
 * A protected procedure that also requires one capability (src/lib/permissions.ts).
 *
 * Every mutation that changes shared state goes through one of these; queries
 * stay on `protectedProcedure`, because reading is not gated by role.
 *
 * The role is read from the database on each call rather than taken from the
 * session: a session cookie carries whatever the role was at sign-in, so
 * demoting someone would leave their existing session at full strength until
 * it expired. One primary-key lookup per mutation is a fair price for a
 * demotion that takes effect immediately.
 */
export const capabilityProcedure = (capability: Capability) =>
  protectedProcedure.use(async ({ ctx, next }) => {
    const user = await prisma.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { role: true },
    });

    const role = normalizeRole(user?.role);
    if (!can(role, capability)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Your role (${role}) is not allowed to ${CAPABILITY_LABELS[capability]}.`,
      });
    }

    return next({ ctx: { ...ctx, role } });
  });