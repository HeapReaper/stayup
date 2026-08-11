import { betterAuth, APIError } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { createAuthMiddleware } from 'better-auth/api';
import { admin } from 'better-auth/plugins';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
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
    // once the first account exists. This app doesn't otherwise have a
    // roles/permissions concept — every logged-in user has full dashboard
    // access, same as before adding this plugin.
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
                    if (user.email) {
                        void sendEmail({
                            to: user.email,
                            subject: 'Welcome to NextTemp!',
                            react: WelcomeEmail({ name: user.name }),
                        });
                    }
                },
            },
        },
    },
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
