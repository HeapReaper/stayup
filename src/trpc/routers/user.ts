import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { APIError } from 'better-auth';
import { Prisma, type User as PrismaUser } from '@prisma/client';
import { createTRPCRouter, protectedProcedure } from '../init';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { registerSchema } from '@/validations/auth';

/**
 * Shared shape of an edit, whether it's someone editing their own profile
 * (`updateProfile`) or another account (`update`). `newPassword` empty means
 * "leave the password alone" — the field is blank in both dialogs.
 */
const userEditSchema = z.object({
  name: registerSchema.shape.name,
  email: registerSchema.shape.email,
  newPassword: z.union([registerSchema.shape.password, z.literal('')]).optional(),
});

/**
 * Writes a new password the way better-auth itself would: its own hasher,
 * its own credential-account row (`auth.$context` is the same context its
 * endpoints run in). Going through the admin plugin's `setUserPassword`
 * endpoint instead would fail here — that route checks the caller's
 * better-auth role, and this app's `User.role` holds Admin/Member/Viewer,
 * which its permission system knows nothing about (see the note on
 * `create` below, and invariant 4 in AGENTS.md).
 */
async function setUserPassword(userId: string, newPassword: string) {
  const authContext = await auth.$context;

  // Every account in this app is created with a password (through /register
  // or the invite flow), so the credential row is always there. Checked
  // anyway because internalAdapter.updatePassword matches on providerId and
  // would otherwise update nothing at all, reporting success.
  const accounts = await authContext.internalAdapter.findAccounts(userId);
  if (!accounts.some((account) => account.providerId === 'credential')) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This account has no password to change',
    });
  }

  const hashed = await authContext.password.hash(newPassword);
  await authContext.internalAdapter.updatePassword(userId, hashed);
}

/**
 * Applies name/email/role/password to one user. Prisma's unique constraint on
 * email is what enforces uniqueness — checking first and then writing would
 * race two concurrent edits into the same address.
 */
async function applyUserEdit(
  id: string,
  input: { name: string; email: string; role?: UserRole; newPassword?: string },
) {
  try {
    const user = await prisma.user.update({
      where: { id },
      data: {
        name: input.name,
        email: input.email,
        ...(input.role ? { role: input.role } : {}),
      },
    });

    if (input.newPassword) await setUserPassword(id, input.newPassword);

    return user;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new TRPCError({ code: 'CONFLICT', message: 'That email address is already in use' });
      }
      if (error.code === 'P2025') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
    }
    throw error;
  }
}

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
  /**
   * The signed-in user, read fresh rather than taken from the session: the
   * session cookie still carries the name and e-mail from sign-in time, so
   * the sidebar would keep showing the old ones after a profile edit.
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await prisma.user.findUnique({ where: { id: ctx.session.user.id } });
    if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    return serializeUser(user);
  }),

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

  /**
   * Edits the signed-in user's own name, e-mail and password (sidebar →
   * profile). Deliberately does not ask for the current password before
   * setting a new one: `update` below lets any signed-in user change any
   * account's password anyway, so gating only the self-service path would
   * protect nothing while making the dialog worse. Changing it also doesn't
   * invalidate other sessions — better-auth's updatePassword touches the
   * credential row, not the session table.
   */
  updateProfile: protectedProcedure
    .input(userEditSchema)
    .mutation(async ({ input, ctx }) => {
      const user = await applyUserEdit(ctx.session.user.id, input);

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'UPDATED_PROFILE',
        target: user.email,
        ipAddress: ctx.ipAddress,
      });

      return serializeUser(user);
    }),

  /** Edits any user from the Users page. Same authorization as everything else here: signed in. */
  update: protectedProcedure
    .input(userEditSchema.extend({ id: z.string(), role: userRoleEnum }))
    .mutation(async ({ input, ctx }) => {
      const user = await applyUserEdit(input.id, input);

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'UPDATED_USER',
        target: user.email,
        ipAddress: ctx.ipAddress,
      });

      return serializeUser(user);
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
