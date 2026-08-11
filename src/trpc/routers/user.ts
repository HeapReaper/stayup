import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { APIError } from 'better-auth';
import type { User as PrismaUser } from '@prisma/client';
import { createTRPCRouter, protectedProcedure } from '../init';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { registerSchema } from '@/validations/auth';

export const userRoleEnum = z.enum(['Admin', 'Member', 'Viewer']);
export type UserRole = z.infer<typeof userRoleEnum>;

// Dates serialized to ISO strings here so the shape returned by the direct
// server-side caller (RSC) matches what actually comes back over the
// httpBatchLink (no superjson transformer is configured, so Dates go over
// the wire as strings) — see src/trpc/routers/monitor.ts for the same pattern.
export type User = Omit<PrismaUser, 'createdAt' | 'updatedAt' | 'banExpires'> & {
  createdAt: string;
  updatedAt: string;
  banExpires: string | null;
};

function serializeUser(user: PrismaUser): User {
  return {
    ...user,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    banExpires: user.banExpires ? user.banExpires.toISOString() : null,
  };
}

export const userRouter = createTRPCRouter({
  getAll: protectedProcedure.query(async () => {
    const users = await prisma.user.findMany();
    return users.map(serializeUser);
  }),
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async (opts) => {
      const user = await prisma.user.findFirst({
        where: {
          id: opts.input.id
        }
      });

      return user ? serializeUser(user) : null;
    }),

  /**
   * Creates a user directly from the dashboard (Users page "Invite User").
   * This is the only way to create a user once one already exists — public
   * self-service /register closes itself after the first account (see
   * src/lib/auth.ts and src/app/register/page.tsx).
   *
   * Goes through better-auth's admin-plugin API (auth.api.createUser) rather
   * than a raw prisma.user.create so the password gets hashed and linked as
   * a credential account exactly like the normal sign-up flow does. Called
   * with no request headers, which bypasses the admin plugin's OWN
   * role-based permission check — this app has no roles/permissions concept,
   * so `protectedProcedure` (any logged-in user) is the real authorization
   * boundary here, same as every other mutation in this app.
   */
  create: protectedProcedure
    .input(registerSchema.extend({ role: userRoleEnum }))
    .mutation(async ({ input, ctx }) => {
      try {
        // `role` goes through the loosely-typed `data` bag rather than the
        // top-level `role` field: better-auth's admin plugin types that
        // field against its configured access-control roles (default
        // "user" | "admin"), which don't match this app's Admin/Member/
        // Viewer vocabulary — a distinction that only matters for the type
        // checker, since we don't use role-based permissions anywhere.
        const result = await auth.api.createUser({
          body: {
            name: input.name,
            email: input.email,
            password: input.password,
            data: { role: input.role },
          },
        });

        await logAudit({
          actorId: ctx.session.user.id,
          actorName: ctx.session.user.name,
          action: 'CREATED_USER',
          target: result.user.email,
          ipAddress: ctx.ipAddress,
        });

        return { id: result.user.id };
      } catch (error) {
        if (error instanceof APIError) {
          throw new TRPCError({ code: 'CONFLICT', message: error.message });
        }
        throw error;
      }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.user.findUnique({ where: { id: input.id } });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      if (existing.id === ctx.session.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "You can't delete your own account" });
      }

      await prisma.user.delete({ where: { id: input.id } });

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'DELETED_USER',
        target: existing.email,
        ipAddress: ctx.ipAddress,
      });

      return { id: input.id };
    }),
});
