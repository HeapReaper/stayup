import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@prisma/client';
import { createTRPCRouter, protectedProcedure, baseProcedure } from '../init';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import type { IncidentImpact, IncidentStatus } from '@/lib/incidents';
import { getVisibleMaintenanceWindows } from '@/lib/maintenance';

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

export type StatusPageGroupInput = {
  name: string | null; // null = ungrouped bucket
  monitorIds: string[];
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

export type PublicMonitorView = {
  id: string;
  name: string;
  type: string;
  status: string;
  uptime: number;
  underMaintenance: boolean;
  tags: { id: string; name: string; color: string }[];
  days: DayBucket[];
};

export type PublicMonitorGroup = {
  id: string | null;
  name: string | null;
  monitors: PublicMonitorView[];
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
  groups: PublicMonitorGroup[];
  incidents: PublicIncident[];
  maintenanceWindows: PublicMaintenanceWindow[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeOverallStatus(monitorStatuses: string[]): OverallStatus {
  if (monitorStatuses.some((s) => s === 'Down')) return 'Outage';
  if (monitorStatuses.some((s) => s === 'Degraded')) return 'Degraded';
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

    let monitorOrder = 0;
    for (const monitorId of group.monitorIds) {
      await tx.statusPageMonitor.create({
        data: { statusPageId, monitorId, groupId, order: monitorOrder },
      });
      monitorOrder += 1;
    }
  }
}

/** Buckets a monitor's checks (and incidents) into one entry per day for the last `days` days. */
function bucketByDay(
  checks: { status: string; checkedAt: Date }[],
  incidents: { title: string; createdAt: Date }[],
  days: number,
): DayBucket[] {
  const checkBuckets = new Map<string, { up: number; down: number; degraded: number }>();
  for (const check of checks) {
    const key = check.checkedAt.toISOString().slice(0, 10);
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

const statusPageGroupInput = z.object({
  name: z.string().trim().min(1).max(80).nullable(),
  monitorIds: z.array(z.string()),
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
  logoUrl: z.union([z.string().trim().url().max(2000), z.literal('')]).optional(),
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
        monitors: { include: { monitor: { select: { status: true } } } },
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
      monitorCount: page.monitors.length,
      subscriberCount: page._count.subscribers,
      overallStatus: computeOverallStatus(page.monitors.map((m) => m.monitor.status)),
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
          monitors: { orderBy: { order: 'asc' } },
        },
      });

      if (!page) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Status page not found' });
      }

      const groups: StatusPageGroupInput[] = [
        { name: null, monitorIds: page.monitors.filter((m) => !m.groupId).map((m) => m.monitorId) },
        ...page.groups.map((group) => ({
          name: group.name,
          monitorIds: page.monitors.filter((m) => m.groupId === group.id).map((m) => m.monitorId),
        })),
      ].filter((group) => group.name !== null || group.monitorIds.length > 0);

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

  create: protectedProcedure.input(statusPageInput).mutation(async ({ input, ctx }) => {
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

  update: protectedProcedure.input(statusPageInput.extend({ id: z.string() })).mutation(async ({ input, ctx }) => {
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
        await tx.statusPageMonitor.deleteMany({ where: { statusPageId: input.id } });
        await tx.statusPageGroup.deleteMany({ where: { statusPageId: input.id } });
        await applyGroups(tx, input.id, input.groups);

        return updated;
      });

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

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const existing = await prisma.statusPage.findUnique({ where: { id: input.id } });

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Status page not found' });
    }

    await prisma.statusPage.delete({ where: { id: input.id } });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'DELETED_STATUS_PAGE',
      target: existing.name,
      ipAddress: ctx.ipAddress,
    });

    return { id: input.id };
  }),

  togglePublish: protectedProcedure
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
          monitors: {
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

      const monitorIds = page.monitors.map((m) => m.monitorId);

      const windowStart = new Date();
      windowStart.setUTCDate(windowStart.getUTCDate() - (page.historyWindowDays - 1));
      windowStart.setUTCHours(0, 0, 0, 0);

      const now = new Date();

      const [checks, incidents, maintenanceWindows] = await Promise.all([
        monitorIds.length
          ? prisma.monitorCheck.findMany({
              where: { monitorId: { in: monitorIds }, checkedAt: { gte: windowStart } },
              select: { monitorId: true, status: true, checkedAt: true },
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

      const monitorNameById = new Map(page.monitors.map((m) => [m.monitorId, m.monitor.name] as const));

      const checksByMonitor = new Map<string, typeof checks>();
      for (const check of checks) {
        const list = checksByMonitor.get(check.monitorId) ?? [];
        list.push(check);
        checksByMonitor.set(check.monitorId, list);
      }

      const incidentsByMonitor = new Map<string, typeof incidents>();
      for (const incident of incidents) {
        if (!incident.monitorId) continue;
        const list = incidentsByMonitor.get(incident.monitorId) ?? [];
        list.push(incident);
        incidentsByMonitor.set(incident.monitorId, list);
      }

      const buildMonitorView = (link: (typeof page.monitors)[number]): PublicMonitorView => ({
        id: link.monitor.id,
        name: link.monitor.name,
        type: link.monitor.type,
        status: link.monitor.status,
        uptime: link.monitor.uptime,
        underMaintenance: monitorIdsUnderMaintenanceNow.has(link.monitor.id),
        tags: link.monitor.tags.map(({ tag }) => tag),
        days: bucketByDay(
          checksByMonitor.get(link.monitorId) ?? [],
          incidentsByMonitor.get(link.monitorId) ?? [],
          page.historyWindowDays,
        ),
      });

      const groupBuckets: PublicMonitorGroup[] = [];

      const ungrouped = page.monitors.filter((m) => !m.groupId).map(buildMonitorView);
      if (ungrouped.length > 0) groupBuckets.push({ id: null, name: null, monitors: ungrouped });

      for (const group of page.groups) {
        const monitors = page.monitors.filter((m) => m.groupId === group.id).map(buildMonitorView);
        if (monitors.length > 0) groupBuckets.push({ id: group.id, name: group.name, monitors });
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
        overallStatus: computeOverallStatus(page.monitors.map((m) => m.monitor.status)),
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
