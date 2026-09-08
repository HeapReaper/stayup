/**
 * Who may do what.
 *
 * Until now `User.role` existed only because better-auth's admin plugin
 * requires the column: the invite form wrote Admin/Member/Viewer into it and
 * nothing ever read it back, so every signed-in user could delete other users
 * and change their passwords. This file is the whole authorization model, and
 * `capabilityProcedure` in src/trpc/init.ts is the only thing that enforces
 * it — keep both in step, and prefer adding a capability here over sprinkling
 * role checks through the routers.
 *
 * Reads are deliberately not gated: every signed-in user, Viewer included,
 * can see every monitor, incident and log. The split is about *changing*
 * things.
 */

export const USER_ROLES = ['Admin', 'Member', 'Viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * One per group of mutations that stand or fall together. Named
 * `<domain>:write` rather than per-procedure so a new mutation in an existing
 * router inherits the right guard by default.
 */
export const CAPABILITIES = [
  'monitors:write',
  'incidents:write',
  'maintenance:write',
  'statuspages:write',
  'integrations:write',
  'escalations:write',
  'users:manage',
  'settings:write',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Member is "runs the monitoring", Admin adds "runs the instance" — user
 * accounts and instance-wide settings, the two things that let someone lock
 * everyone else out or reroute every alert. Viewer reads.
 */
const ROLE_CAPABILITIES: Record<UserRole, readonly Capability[]> = {
  Admin: CAPABILITIES,
  Member: [
    'monitors:write',
    'incidents:write',
    'maintenance:write',
    'statuspages:write',
    'integrations:write',
    'escalations:write',
  ],
  Viewer: [],
};

/** Human wording for the FORBIDDEN message and the dashboard. */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  'monitors:write': 'change monitors',
  'incidents:write': 'change incidents',
  'maintenance:write': 'change maintenance windows',
  'statuspages:write': 'change status pages',
  'integrations:write': 'change integrations',
  'escalations:write': 'change escalation policies',
  'users:manage': 'manage users',
  'settings:write': 'change instance settings',
};

/**
 * Maps whatever is in the column onto a role this app understands.
 *
 * Anything unrecognised becomes Admin, and that is deliberate: the first
 * account is created through /register, before there is anyone to assign it a
 * role, and better-auth stamps it with its own default ("user"). Treating
 * that as Viewer would lock the only account out of the instance it just
 * created — a worse failure than the gap this file closes. Every account made
 * since goes through the invite form, which always writes a real role, so the
 * fallback only ever applies to that first user (who can then demote
 * themselves once someone else is an Admin).
 */
export function normalizeRole(raw: string | null | undefined): UserRole {
  return (USER_ROLES as readonly string[]).includes(raw ?? '') ? (raw as UserRole) : 'Admin';
}

export function capabilitiesFor(role: UserRole): readonly Capability[] {
  return ROLE_CAPABILITIES[role];
}

export function can(role: UserRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}
