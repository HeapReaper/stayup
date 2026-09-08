import { betterAuth, APIError } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { createAuthMiddleware } from 'better-auth/api';
import { admin } from 'better-auth/plugins';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { getSettings } from '@/lib/settings';
import { logger } from '@/lib/logging';
import WelcomeEmail from '@/emails/welcome-email';

export const auth = betterAuth({
    emailAndPassword: {
        enabled: true,
    },
    database: prismaAdapter(prisma, {
        provider: process.env.DB_PROVIDER === 'postgresql' ? 'postgresql' : 'sqlite',
    }),
    // Lets an already-authenticated dashboard user create other users
    // (src/trpc/routers/user.ts's `create`, via auth.api.createUser) without
    // going through the public /register flow, which the hook below closes
    // once the first account exists. The plugin only supplies the `role`
    // column it writes into; what a role may actually *do* is StayUp's own
    // model — see src/lib/permissions.ts, enforced by `capabilityProcedure`
    // in src/trpc/init.ts.
    plugins: [admin()],
    hooks: {
        before: createAuthMiddleware(async (ctx) => {
            if (ctx.path !== '/sign-up/email') return;

            const existingUserCount = await prisma.user.count();
            if (existingUserCount > 0) {
                throw new APIError('FORBIDDEN', {
                    message: 'Self-service registration is disabled. Ask an administrator to invite you.',
                });
            }
        }),
    },
    databaseHooks: {
        user: {
            create: {
                after: async (user) => {
                    if (!user.email) return;

                    // Sent in the background on purpose: a mail server that is
                    // slow or misconfigured must not fail the account creation
                    // that triggered it.
                    void (async () => {
                        const { organizationName } = await getSettings();
                        await sendEmail({
                            to: user.email,
                            subject: `Welcome to StayUp at ${organizationName}`,
                            react: WelcomeEmail({ name: user.name, organizationName }),
                        });
                    })().catch((error) => {
                        logger.error(`[Auth] Welcome email to ${user.email} failed`, error);
                    });
                },
            },
        },
    },
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
