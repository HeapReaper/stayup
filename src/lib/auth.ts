import { betterAuth, APIError } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { createAuthMiddleware } from 'better-auth/api';
import { admin, genericOAuth, twoFactor } from 'better-auth/plugins';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { getSettings } from '@/lib/settings';
import { logger } from '@/lib/logging';
import { oidcConfig } from '@/lib/oidc';
import { USER_ROLES, type UserRole } from '@/lib/permissions';
import WelcomeEmail from '@/emails/welcome-email';

/**
 * Name shown in an authenticator app next to the 6-digit code.
 *
 * Static because a TOTP issuer is baked into the QR code at enrolment: it
 * cannot follow AppSettings.organizationName without silently relabelling —
 * or, on some authenticator apps, orphaning — every code already enrolled.
 */
const TOTP_ISSUER = 'StayUp';

/**
 * The role a user gets when nothing else assigns one.
 *
 * This used to be decided implicitly by `normalizeRole()`, whose "anything
 * unrecognised means Admin" fallback exists so the very first account — made
 * through /register, before there is anyone to grant it a role — isn't locked
 * out of the instance it just created. That was safe while the only two ways
 * to get an account were /register (first user only) and the invite form
 * (which always writes a real role).
 *
 * SSO breaks that: an IdP can create accounts, and every one of them would
 * have landed on the Admin fallback. So the role is now written explicitly at
 * creation — Admin for the first account, and OIDC_DEFAULT_ROLE (Viewer
 * unless configured otherwise) for everyone the IdP brings in afterwards.
 * `normalizeRole()` still covers rows written before this existed.
 */
function defaultRoleForNewUser(isFirstUser: boolean): UserRole {
  if (isFirstUser) return 'Admin';

  const configured = (process.env.OIDC_DEFAULT_ROLE ?? '').trim();
  return (USER_ROLES as readonly string[]).includes(configured) ? (configured as UserRole) : 'Viewer';
}

/** The genericOAuth plugin, or nothing at all when SSO isn't configured. */
function oidcPlugins() {
  const config = oidcConfig();
  if (!config) return [];

  logger.info(`[Auth] OIDC sign-in enabled for provider "${config.providerId}"`);

  return [
    genericOAuth({
      config: [
        {
          providerId: config.providerId,
          name: config.name,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          discoveryUrl: config.discoveryUrl,
          authorizationUrl: config.authorizationUrl,
          tokenUrl: config.tokenUrl,
          userInfoUrl: config.userInfoUrl,
          scopes: config.scopes,
          // Off means an IdP account with no StayUp user is rejected rather
          // than provisioned — for an IdP that covers more people than this
          // instance should let in.
          disableSignUp: !config.allowSignUp,
        },
      ],
    }),
  ];
}

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
    //
    // twoFactor adds TOTP: a self-hosted instance where an Admin can reroute
    // every alert and read every credential is exactly the kind of thing a
    // stolen password should not be enough for. Nothing is enforced until a
    // user enrols — see the Security tab in the profile sheet.
    //
    // genericOAuth is only present when the environment configures it
    // (src/lib/oidc.ts), so an instance without SSO carries no extra surface.
    plugins: [admin(), twoFactor({ issuer: TOTP_ISSUER }), ...oidcPlugins()],
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
                // Runs for every account, however it was created: /register,
                // the invite form, or an IdP. The invite form has already put
                // a real role on the row, so this only fills in the blanks.
                before: async (user) => {
                    const role = (user as { role?: string | null }).role;
                    if (role) return;

                    const isFirstUser = (await prisma.user.count()) === 0;
                    return { data: { ...user, role: defaultRoleForNewUser(isFirstUser) } };
                },
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
