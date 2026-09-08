import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@prisma/client';
import { createTRPCRouter, protectedProcedure, baseProcedure, capabilityProcedure } from '../init';
import { prisma } from '@/lib/prisma';
import { storedFileIdFromUrl } from '@/lib/stored-files';
import { forgetStoredFile } from '@/lib/stored-files-server';
import { logAudit } from '@/lib/audit';
import type { IncidentImpact, IncidentStatus } from '@/lib/incidents';
import { getVisibleMaintenanceWindows } from '@/lib/maintenance';

/** Status page changes: Admin and Member. */
const writeStatusPages = capabilityProcedure('statuspages:write');

export const statusPageThemeEnum = z.enum(['light', 'dark', 'system']);
export const historyWindowDaysEnum = z.union([z.literal(7), z.literal(30), z.literal(90)]);
export const subscriberChannelEnum = z.enum(['Email', 'Discord']);

export type StatusPageTheme = z.infer<typeof statusPageThemeEnum>;
export type HistoryWindowDays = z.infer<typeof historyWindowDaysEnum>;
export type SubscriberChannel = z.infer<typeof subscriberChannelEnum>;

// ---------------------------------------------------------------------------
// Shared types (consumed by the dashboard client and the public status page)
// ---------------------------------------------------------------------------

export type OverallStatus = 'Operational' | 'Degraded' | 'Outage';

/**
 * What one component reports. A superset of the monitor statuses, because a
 * component can also be under maintenance, and because "Outage" reads better
 * than "Down" to the customer looking at the page.
 */
export const componentStatusEnum = z.enum(['Operational', 'Degraded', 'Outage', 'Maintenance']);
export type ComponentStatus = z.infer<typeof componentStatusEnum>;

/** Monitor status -> component status. */
const MONITOR_STATUS_TO_COMPONENT: Record<string, ComponentStatus> = {
  Up: 'Operational',
  Degraded: 'Degraded',
  Down: 'Outage',
};

export type StatusPageSummary = {
  id: string;
  name: string;
  slug: string;
  customDomain: string | null;
  theme: StatusPageTheme;
  historyWindowDays: HistoryWindowDays;
  isPublished: boolean;
  requireLogin: boolean;
  monitorCount: number;
  subscriberCount: number;
  overallStatus: OverallStatus;
  createdAt: string;
};

/**
 * One line on a status page, as the editor sends it.
 *
 * `monitorId` null makes it a manual component — something worth telling
 * customers about that this app has no way to poll (a payment provider, a
 * shipping partner, a feature behind a flag). Those carry their own name and
 * a `manualStatus` a human sets; monitor-backed ones fall back to the
 * monitor's name and its checks.
 */
export type StatusPageComponentInput = {
  monitorId: string | null;
  name: string | null;
  description: string | null;
  manualStatus: ComponentStatus | null;
};

export type StatusPageGroupInput = {
  name: string | null; // null = ungrouped bucket
  components: StatusPageComponentInput[];
};

export type StatusPageDetail = {
  id: string;
  name: string;
  slug: string;
  customDomain: string;
  description: string;
  logoUrl: string;
  theme: StatusPageTheme;
  primaryColor: string;
  historyWindowDays: HistoryWindowDays;
  isPublished: boolean;
  showTags: boolean;
  requireLogin: boolean;
  groups: StatusPageGroupInput[];
};

export type DayBucketStatus = 'Up' | 'Down' | 'Degraded' | 'none';

export type DayBucket = {
  date: string; // YYYY-MM-DD (UTC)
  status: DayBucketStatus;
  incidentTitles: string[];
};

export type PublicComponentView = {
  /** The component row's id — a manual component has no monitor to identify it by. */
  id: string;
  monitorId: string | null;
  name: string;
  description: string | null;
  /** The monitor's type, or null for a manual component. */
  type: string | null;
  status: ComponentStatus;
  /** Null for a manual component: nothing measured it. */
  uptime: number | null;
  /** True when a human set this status rather than a check producing it. */
  manual: boolean;
  tags: { id: string; name: string; color: string }[];
  /** Empty for a manual component — there is no check history to draw. */
  days: DayBucket[];
};

export type PublicComponentGroup = {
  id: string | null;
  name: string | null;
  components: PublicComponentView[];
};

export type PublicIncidentUpdate = {
  status: IncidentStatus;
  message: string;
  createdAt: string;
};

export type PublicIncident = {
  id: string;
  title: string;
  impact: IncidentImpact;
  status: IncidentStatus;
  monitorName: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updates: PublicIncidentUpdate[];
  // Only present once the incident's postmortem has been published — see
  // src/trpc/routers/incident.ts's setPostmortem.
  postmortem: string | null;
};

export type PublicMaintenanceWindow = {
  id: string;
  title: string;
  message: string | null;
  startsAt: string;
  endsAt: string;
  monitorNames: string[];
};

export type PublicStatusPage = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  theme: StatusPageTheme;
  primaryColor: string;
  historyWindowDays: HistoryWindowDays;
  overallStatus: OverallStatus;
  showTags: boolean;
  groups: PublicComponentGroup[];
  incidents: PublicIncident[];
  maintenanceWindows: PublicMaintenanceWindow[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * What a component reports right now.
 *
 * `manualStatus` wins whenever it is set — that is what makes it usable both
 * as the whole state of a manual component and as an override on a
 * monitor-backed one ("the checks are green but we know payments are slow").
 * Otherwise an active maintenance window wins over the monitor's own status,
 * and finally the monitor's status maps across.
 */
function resolveComponentStatus(
  component: { manualStatus: string | null; monitor: { status: string } | null },
  underMaintenance = false,
): ComponentStatus {
  if (component.manualStatus) return component.manualStatus as ComponentStatus;
  if (underMaintenance) return 'Maintenance';
  if (!component.monitor) return 'Operational';
  return MONITOR_STATUS_TO_COMPONENT[component.monitor.status] ?? 'Operational';
}

function computeOverallStatus(componentStatuses: ComponentStatus[]): OverallStatus {
  if (componentStatuses.some((s) => s === 'Outage')) return 'Outage';
  // Maintenance is deliberately not an outage at the page level — it's
  // planned, and the maintenance notice above already says so.
  if (componentStatuses.some((s) => s === 'Degraded')) return 'Degraded';
  return 'Operational';
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** P2002's `meta.target` lists the column(s) that collided — used to tell a slug clash from a domain clash. */
function conflictingField(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const target = error.meta?.target;
  if (Array.isArray(target)) return String(target[0] ?? '');
  if (typeof target === 'string') return target;
  return null;
}

/** Replaces a status page's groups/monitor-assignments from the editor's flat input shape. */
async function applyGroups(
  tx: Prisma.TransactionClient,
  statusPageId: string,
  groups: StatusPageGroupInput[],
) {
  let groupOrder = 0;

  for (const group of groups) {
    let groupId: string | null = null;

    if (group.name) {
      const createdGroup = await tx.statusPageGroup.create({
        data: { statusPageId, name: group.name, order: groupOrder },
      });
      groupId = createdGroup.id;
      groupOrder += 1;
    }

    let componentOrder = 0;
    for (const component of group.components) {
      await tx.statusPageComponent.create({
        data: {
          statusPageId,
          groupId,
          order: componentOrder,
          monitorId: component.monitorId,
          name: component.name,
          description: component.description,
          manualStatus: component.manualStatus,
        },
      });
      componentOrder += 1;
    }
  }
}

/** Buckets a monitor's checks (and incidents) into one entry per day for the last `days` days. */
function bucketByDay(
  checks: { status: string; checkedAt: Date }[],
  dailyStats: { day: Date; upChecks: number; degradedChecks: number; downChecks: number }[],
  incidents: { title: string; createdAt: Date }[],
  days: number,
): DayBucket[] {
  // Rollups first, raw checks only for days without one. A finished day always
  // has a rollup (worker/cmd/janitor writes it the following night) and may no
  // longer have any raw checks at all, since those are pruned on their own
  // retention; today has raw checks and no rollup yet. Preferring the rollup
  // also means the bar for a past day can't change as its checks age out.
  const checkBuckets = new Map<string, { up: number; down: number; degraded: number }>();
  for (const stat of dailyStats) {
    checkBuckets.set(stat.day.toISOString().slice(0, 10), {
      up: stat.upChecks,
      down: stat.downChecks,
      degraded: stat.degradedChecks,
    });
  }

  for (const check of checks) {
    const key = check.checkedAt.toISOString().slice(0, 10);
    if (dailyStats.some((stat) => stat.day.toISOString().slice(0, 10) === key)) continue;

    const bucket = checkBuckets.get(key) ?? { up: 0, down: 0, degraded: 0 };
    if (check.status === 'Down') bucket.down += 1;
    else if (check.status === 'Degraded') bucket.degraded += 1;
    else bucket.up += 1;
    checkBuckets.set(key, bucket);
  }

  const incidentBuckets = new Map<string, string[]>();
  for (const incident of incidents) {
    const key = incident.createdAt.toISOString().slice(0, 10);
    const list = incidentBuckets.get(key) ?? [];
    list.push(incident.title);
    incidentBuckets.set(key, list);
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const result: DayBucket[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const bucket = checkBuckets.get(key);

    const status: DayBucketStatus = bucket
      ? bucket.down > 0
        ? 'Down'
        : bucket.degraded > 0
          ? 'Degraded'
          : 'Up'
      : 'none';

    result.push({ date: key, status, incidentTitles: incidentBuckets.get(key) ?? [] });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Slug is required')
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens only');

const statusPageComponentInput = z
  .object({
    monitorId: z.string().nullable(),
    name: z.string().trim().max(120).nullable(),
    description: z.string().trim().max(300).nullable(),
    manualStatus: componentStatusEnum.nullable(),
  })
  // A manual component has nothing else to take a label or a state from, so
  // both are required exactly when there is no monitor behind it.
  .refine((component) => component.monitorId !== null || !!component.name, {
    message: 'A component without a monitor needs a name',
    path: ['name'],
  })
  .refine((component) => component.monitorId !== null || component.manualStatus !== null, {
    message: 'A component without a monitor needs a status you set yourself',
    path: ['manualStatus'],
  });

const statusPageGroupInput = z.object({
  name: z.string().trim().min(1).max(80).nullable(),
  components: z.array(statusPageComponentInput),
});

// Bare hostname only — no protocol, no port, no path. Lowercased and
// trailing-dot-stripped so "Status.Acme.com" and "status.acme.com." both
// normalize to the same value the Host header comparison in src/proxy.ts
// expects.
const customDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(255)
  .transform((value) => value.replace(/\.$/, ''))
  .refine((value) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value), {
    message: 'Enter a bare domain, e.g. status.example.com (no https:// or path)',
  });

const statusPageInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  slug: slugSchema,
  customDomain: z.union([customDomainSchema, z.literal('')]).optional(),
  description: z.string().trim().max(500).optional(),
  // Either an upload on this instance (`/api/files/<id>`, see
  // src/lib/stored-files.ts) or any public image URL, which is all this field
  // used to accept. z.string().url() rejects a path, hence the two shapes.
  logoUrl: z
    .union([
      z
        .string()
        .trim()
        .max(2000)
        .refine((value) => storedFileIdFromUrl(value) !== null || z.string().url().safeParse(value).success, {
          message: 'Upload an image or give a full https:// URL',
        }),
      z.literal(''),
    ])
    .optional(),
  theme: statusPageThemeEnum,
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #7c3aed'),
  historyWindowDays: historyWindowDaysEnum,
  isPublished: z.boolean(),
  showTags: z.boolean(),
  requireLogin: z.boolean(),
  groups: z.array(statusPageGroupInput),
});

const emailSchema = z.string().trim().email();
const discordWebhookSchema = z
  .string()
  .trim()
  .url()
  .refine((url) => /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url), {
    message: 'Must be a Discord webhook URL',
  });

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const statusPageRouter = createTRPCRouter({
  getAll: protectedProcedure.query(async (): Promise<StatusPageSummary[]> => {
    const pages = await prisma.statusPage.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        components: { include: { monitor: { select: { status: true } } } },
        _count: { select: { subscribers: true } },
      },
    });

    return pages.map((page) => ({
      id: page.id,
      name: page.name,
      slug: page.slug,
      customDomain: page.customDomain,
      theme: page.theme as StatusPageTheme,
      historyWindowDays: page.historyWindowDays as HistoryWindowDays,
      isPublished: page.isPublished,
      requireLogin: page.requireLogin,
      monitorCount: page.components.length,
      subscriberCount: page._count.subscribers,
      overallStatus: computeOverallStatus(page.components.map((component) => resolveComponentStatus(component))),
      createdAt: page.createdAt.toISOString(),
    }));
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }): Promise<StatusPageDetail> => {
      const page = await prisma.statusPage.findUnique({
        where: { id: input.id },
        include: {
          groups: { orderBy: { order: 'asc' } },
          components: { orderBy: { order: 'asc' } },
        },
      });

      if (!page) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Status page not found' });
      }

      const toInput = (component: (typeof page.components)[number]): StatusPageComponentInput => ({
        monitorId: component.monitorId,
        name: component.name,
        description: component.description,
        manualStatus: (component.manualStatus as ComponentStatus | null) ?? null,
      });

      const groups: StatusPageGroupInput[] = [
        { name: null, components: page.components.filter((c) => !c.groupId).map(toInput) },
        ...page.groups.map((group) => ({
          name: group.name,
          components: page.components.filter((c) => c.groupId === group.id).map(toInput),
        })),
      ].filter((group) => group.name !== null || group.components.length > 0);

      return {
        id: page.id,
        name: page.name,
        slug: page.slug,
        customDomain: page.customDomain ?? '',
        description: page.description ?? '',
        logoUrl: page.logoUrl ?? '',
        theme: page.theme as StatusPageTheme,
        primaryColor: page.primaryColor,
        historyWindowDays: page.historyWindowDays as HistoryWindowDays,
        isPublished: page.isPublished,
        showTags: page.showTags,
        requireLogin: page.requireLogin,
        groups,
      };
    }),

  create: writeStatusPages.input(statusPageInput).mutation(async ({ input, ctx }) => {
    try {
      const page = await prisma.$transaction(async (tx) => {
        const created = await tx.statusPage.create({
          data: {
            name: input.name,
            slug: input.slug,
            customDomain: input.customDomain || null,
            description: input.description || null,
            logoUrl: input.logoUrl || null,
            theme: input.theme,
            primaryColor: input.primaryColor,
            historyWindowDays: input.historyWindowDays,
            isPublished: input.isPublished,
            showTags: input.showTags,
            requireLogin: input.requireLogin,
            createdById: ctx.session.user.id,
          },
        });

        await applyGroups(tx, created.id, input.groups);

        return created;
      });

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'CREATED_STATUS_PAGE',
        target: page.name,
        ipAddress: ctx.ipAddress,
      });

      return { id: page.id, slug: page.slug };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const field = conflictingField(error);
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            field === 'customDomain'
              ? 'That custom domain is already in use by another status page'
              : 'That slug is already taken',
        });
      }
      throw error;
    }
  }),

  update: writeStatusPages.input(statusPageInput.extend({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const existing = await prisma.statusPage.findUnique({ where: { id: input.id } });

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Status page not found' });
    }

    try {
      const page = await prisma.$transaction(async (tx) => {
        const updated = await tx.statusPage.update({
          where: { id: input.id },
          data: {
            name: input.name,
            slug: input.slug,
            customDomain: input.customDomain || null,
            description: input.description || null,
            logoUrl: input.logoUrl || null,
            theme: input.theme,
            primaryColor: input.primaryColor,
            historyWindowDays: input.historyWindowDays,
            isPublished: input.isPublished,
            showTags: input.showTags,
            requireLogin: input.requireLogin,
          },
        });

        // Full replace — simplest correct way to sync a nested groups/monitors
        // editor without diffing group-by-group.
        await tx.statusPageComponent.deleteMany({ where: { statusPageId: input.id } });
        await tx.statusPageGroup.deleteMany({ where: { statusPageId: input.id } });
        await applyGroups(tx, input.id, input.groups);

        return updated;
      });

      // After the save, not inside the transaction: losing the old logo
      // matters far less than the edit itself going through.
      await forgetStoredFile(existing.logoUrl, input.logoUrl || null);

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'UPDATED_STATUS_PAGE',
        target: page.name,
        ipAddress: ctx.ipAddress,
      });

      return { id: page.id, slug: page.slug };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const field = conflictingField(error);
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            field === 'customDomain'
              ? 'That custom domain is already in use by another status page'
              : 'That slug is already taken',
        });
      }
      throw error;
    }
  }),

  delete: writeStatusPages.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const existing = await prisma.statusPage.findUnique({ where: { id: input.id } });

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Status page not found' });
    }

    await prisma.statusPage.delete({ where: { id: input.id } });
    await forgetStoredFile(existing.logoUrl);

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'DELETED_STATUS_PAGE',
      target: existing.name,
      ipAddress: ctx.ipAddress,
    });

    return { id: input.id };
  }),

  togglePublish: writeStatusPages
    .input(z.object({ id: z.string(), isPublished: z.boolean() }))
    .mutation(async ({ input }) => {
      const page = await prisma.statusPage.update({
        where: { id: input.id },
        data: { isPublished: input.isPublished },
      });

      return { id: page.id, isPublished: page.isPublished };
    }),

  // -- Public (unauthenticated) procedures, used by src/app/(status) --------

  getPublicBySlug: baseProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input, ctx }): Promise<PublicStatusPage> => {
      const page = await prisma.statusPage.findUnique({
        where: { slug: input.slug },
        include: {
          groups: { orderBy: { order: 'asc' } },
          components: {
            orderBy: { order: 'asc' },
            include: { monitor: { include: { tags: { include: { tag: true } } } } },
          },
        },
      });

      if (!page || !page.isPublished) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Status page not found' });
      }

      // Private pages only reveal their content to a signed-in dashboard
      // user — surfaced as UNAUTHORIZED so the route can redirect to /login
      // instead of hiding the page's existence like NOT_FOUND does.
      if (page.requireLogin && !ctx.session?.user) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in to view this status page' });
      }

      // Manual components have no monitor, so every history/incident query
      // below is scoped to the ones that do.
      const monitorIds = page.components
        .map((component) => component.monitorId)
        .filter((id): id is string => id !== null);

      const windowStart = new Date();
      windowStart.setUTCDate(windowStart.getUTCDate() - (page.historyWindowDays - 1));
      windowStart.setUTCHours(0, 0, 0, 0);

      const now = new Date();

      const [checks, dailyStats, incidents, maintenanceWindows] = await Promise.all([
        monitorIds.length
          ? prisma.monitorCheck.findMany({
              where: { monitorId: { in: monitorIds }, checkedAt: { gte: windowStart } },
              select: { monitorId: true, status: true, checkedAt: true },
            })
          : Promise.resolve([]),
        monitorIds.length
          ? prisma.monitorDailyStat.findMany({
              where: { monitorId: { in: monitorIds }, day: { gte: windowStart } },
              select: { monitorId: true, day: true, upChecks: true, degradedChecks: true, downChecks: true },
            })
          : Promise.resolve([]),
        monitorIds.length
          ? prisma.incident.findMany({
              where: { monitorId: { in: monitorIds }, createdAt: { gte: windowStart } },
              orderBy: { createdAt: 'desc' },
              include: {
                monitor: { select: { name: true } },
                updates: { orderBy: { createdAt: 'asc' } },
              },
            })
          : Promise.resolve([]),
        getVisibleMaintenanceWindows(monitorIds, now),
      ]);

      // Monitors currently inside an active (started, not yet ended,
      // uncancelled) window — shown with an "Under maintenance" badge
      // instead of their raw Down/Degraded status.
      const monitorIdsUnderMaintenanceNow = new Set(
        maintenanceWindows
          .filter((w) => w.startsAt <= now && w.endsAt >= now)
          .flatMap((w) => w.monitorIds),
      );

      const monitorNameById = new Map(
        page.components
          .filter((component) => component.monitor !== null)
          .map((component) => [component.monitorId as string, component.monitor!.name] as const),
      );

      const checksByMonitor = new Map<string, typeof checks>();
      for (const check of checks) {
        const list = checksByMonitor.get(check.monitorId) ?? [];
        list.push(check);
        checksByMonitor.set(check.monitorId, list);
      }

      const dailyStatsByMonitor = new Map<string, typeof dailyStats>();
      for (const stat of dailyStats) {
        const list = dailyStatsByMonitor.get(stat.monitorId) ?? [];
        list.push(stat);
        dailyStatsByMonitor.set(stat.monitorId, list);
      }

      const incidentsByMonitor = new Map<string, typeof incidents>();
      for (const incident of incidents) {
        if (!incident.monitorId) continue;
        const list = incidentsByMonitor.get(incident.monitorId) ?? [];
        list.push(incident);
        incidentsByMonitor.set(incident.monitorId, list);
      }

      const buildComponentView = (component: (typeof page.components)[number]): PublicComponentView => {
        const monitor = component.monitor;
        const underMaintenance = monitor ? monitorIdsUnderMaintenanceNow.has(monitor.id) : false;

        return {
          id: component.id,
          monitorId: component.monitorId,
          // A monitor-backed component with no label of its own follows the
          // monitor's name, so renaming the monitor keeps the page in step.
          name: component.name ?? monitor?.name ?? 'Component',
          description: component.description,
          type: monitor?.type ?? null,
          status: resolveComponentStatus(component, underMaintenance),
          uptime: monitor?.uptime ?? null,
          manual: !!component.manualStatus,
          tags: monitor?.tags.map(({ tag }) => tag) ?? [],
          days: monitor
            ? bucketByDay(
                checksByMonitor.get(monitor.id) ?? [],
                dailyStatsByMonitor.get(monitor.id) ?? [],
                incidentsByMonitor.get(monitor.id) ?? [],
                page.historyWindowDays,
              )
            : [],
        };
      };

      const groupBuckets: PublicComponentGroup[] = [];

      const ungrouped = page.components.filter((c) => !c.groupId).map(buildComponentView);
      if (ungrouped.length > 0) groupBuckets.push({ id: null, name: null, components: ungrouped });

      for (const group of page.groups) {
        const components = page.components.filter((c) => c.groupId === group.id).map(buildComponentView);
        if (components.length > 0) groupBuckets.push({ id: group.id, name: group.name, components });
      }

      return {
        id: page.id,
        name: page.name,
        slug: page.slug,
        description: page.description,
        logoUrl: page.logoUrl,
        theme: page.theme as StatusPageTheme,
        primaryColor: page.primaryColor,
        historyWindowDays: page.historyWindowDays as HistoryWindowDays,
        overallStatus: computeOverallStatus(groupBuckets.flatMap((group) => group.components.map((c) => c.status))),
        showTags: page.showTags,
        groups: groupBuckets,
        incidents: incidents.map((incident) => ({
          id: incident.id,
          title: incident.title,
          impact: incident.impact as IncidentImpact,
          status: incident.status as IncidentStatus,
          monitorName: incident.monitor?.name ?? null,
          resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
          createdAt: incident.createdAt.toISOString(),
          updates: incident.updates.map((update) => ({
            status: update.status as IncidentStatus,
            message: update.message,
            createdAt: update.createdAt.toISOString(),
          })),
          postmortem: incident.postmortemPublishedAt ? incident.postmortem : null,
        })),
        maintenanceWindows: maintenanceWindows.map((w) => ({
          id: w.id,
          title: w.title,
          message: w.message,
          startsAt: w.startsAt.toISOString(),
          endsAt: w.endsAt.toISOString(),
          monitorNames: w.monitorIds.map((id) => monitorNameById.get(id)).filter((n): n is string => !!n),
        })),
      };
    }),

  subscribe: baseProcedure
    .input(
      z.object({
        slug: z.string(),
        channel: subscriberChannelEnum,
        target: z.string().trim().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const page = await prisma.statusPage.findUnique({ where: { slug: input.slug } });

      if (!page || !page.isPublished) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Status page not found' });
      }

      const parsed =
        input.channel === 'Email'
          ? emailSchema.safeParse(input.target)
          : discordWebhookSchema.safeParse(input.target);

      if (!parsed.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: parsed.error.issues[0]?.message ?? 'Invalid subscription target',
        });
      }

      try {
        await prisma.statusPageSubscriber.create({
          data: { statusPageId: page.id, channel: input.channel, target: parsed.data },
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'This is already subscribed' });
        }
        throw error;
      }

      return { success: true };
    }),
});
