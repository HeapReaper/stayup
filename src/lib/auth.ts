import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import WelcomeEmail from '@/emails/welcome-email';

export const auth = betterAuth({
    emailAndPassword: {
        enabled: true,
    },
    database: prismaAdapter(prisma, {
        provider: 'sqlite',
    }),
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