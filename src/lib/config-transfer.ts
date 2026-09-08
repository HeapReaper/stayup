/**
 * Config export and import.
 *
 * The unit of transfer is *configuration*, never history: monitors, tags,
 * integrations, escalation policies, notification rules, status pages and
 * maintenance windows. Checks, incidents and uptime figures stay behind on
 * purpose — grafting one instance's uptime onto another instance's monitors
 * would make the Reports page say something that never happened.
 *
 * Three rules shape the whole file, and the import behaviour follows from
 * them:
 *
 *   1. **Names, not ids.** Every cross-reference in the document is a name
 *      ("the Postgres tag", "the PagerDuty integration"), because a cuid from
 *      another instance means nothing here. Names are how a human describes
 *      their own setup anyway.
 *   2. **No secrets.** A monitor's `credential` and an integration's `secret`
 *      never leave the database. An export is a file that gets mailed around
 *      and committed to git; the two columns that would turn that into a
 *      breach are replaced by a flag saying "this one needs a secret typed in
 *      after import".
 *   3. **Additive, never destructive.** Import creates what is missing and
 *      skips what already exists under the same name. It never updates and
 *      never deletes, so running it against a live instance cannot take
 *      anything down, and running it twice does nothing the second time.
 *
 * Rule 3 is also why the import isn't one big transaction: a partial import
 * that reports exactly what it created beats an all-or-nothing that fails on
 * item 300 and leaves the operator guessing. Re-running fills in the rest.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ASSERTION_TYPES } from '@/lib/assertions';
import { currentVersion } from '@/lib/version';
import {
  DEFAULT_PORTS,
  PROBE_TYPES,
  dnsRecordTypeEnum,
  monitorIntervalEnum,
  monitorMethodEnum,
  monitorTypeEnum,
  type MonitorType,
} from '@/lib/monitor-types';

/**
 * Bumped only when a document written by an older StayUp can no longer be
 * read as-is. Import checks it up front so a mismatch is one clear error
 * rather than a hundred field-level ones.
 */
export const CONFIG_FORMAT_VERSION = 1;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a colour like #7c3aed');

const tagSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: hexColor.default('#7c3aed'),
});

const integrationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(40),
  target: z.string().trim().min(1).max(2000),
  enabled: z.boolean().default(true),
  /** True when the source integration had a secret that was deliberately left out. */
  secretRequired: z.boolean().default(false),
});

const escalationPolicySchema = z.object({
  name: z.string().trim().min(1).max(120),
  steps: z
    .array(
      z.object({
        order: z.number().int().min(0),
        delayMinutes: z.number().int().min(0).max(10_080),
        /** Name of an integration in this document (or already on the instance). */
        integration: z.string().trim().min(1).max(120).nullable().default(null),
      }),
    )
    .default([]),
});

const monitorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(500),
  type: monitorTypeEnum,
  interval: monitorIntervalEnum,
  port: z.number().int().min(1).max(65535).nullable().default(null),
  enabled: z.boolean().default(true),

  method: monitorMethodEnum.default('GET'),
  requestHeaders: z.string().max(4000).nullable().default(null),
  requestBody: z.string().max(10_000).nullable().default(null),
  followRedirects: z.boolean().default(true),
  expectedStatusCodes: z.string().max(200).nullable().default(null),
  keyword: z.string().max(1000).nullable().default(null),
  keywordInverted: z.boolean().default(false),
  assertionType: z.enum(ASSERTION_TYPES).default('Contains'),
  jsonPath: z.string().max(200).nullable().default(null),

  dnsRecordType: dnsRecordTypeEnum.default('A'),
  dnsExpectedValue: z.string().max(500).nullable().default(null),

  sloTarget: z.number().min(0).max(100).nullable().default(null),
  // Defaults to true, so a document exported before this switch existed
  // imports as a monitor that alerts — the behaviour it had at export time.
  autoIncidents: z.boolean().default(true),
  httpTimeoutSeconds: z.number().int().min(1).max(300).nullable().default(null),
  failedAttemptsThreshold: z.number().int().min(1).max(20).nullable().default(null),
  latencyThresholdMs: z.number().int().min(50).max(60_000).nullable().default(null),

  tags: z.array(z.string().trim().min(1).max(40)).default([]),
  escalationPolicy: z.string().trim().min(1).max(120).nullable().default(null),
  /** True when the source monitor had a password that was deliberately left out. */
  credentialRequired: z.boolean().default(false),
});

const notificationRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  order: z.number().int().min(0).default(0),
  matchTag: z.string().trim().min(1).max(40).nullable().default(null),
  matchMonitor: z.string().trim().min(1).max(120).nullable().default(null),
  matchImpact: z.enum(['Critical', 'Major', 'Minor']).nullable().default(null),
  activeDays: z.string().max(20).nullable().default(null),
  activeFromMinute: z.number().int().min(0).max(1439).nullable().default(null),
  activeUntilMinute: z.number().int().min(0).max(1439).nullable().default(null),
  action: z.enum(['Route', 'Suppress']).default('Route'),
  integrations: z.array(z.string().trim().min(1).max(120)).default([]),
});

const statusPageSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120),
  customDomain: z.string().trim().max(255).nullable().default(null),
  description: z.string().max(2000).nullable().default(null),
  logoUrl: z.string().max(2000).nullable().default(null),
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  primaryColor: hexColor.default('#7c3aed'),
  historyWindowDays: z.number().int().min(1).max(365).default(90),
  isPublished: z.boolean().default(true),
  showTags: z.boolean().default(false),
  requireLogin: z.boolean().default(false),
  groups: z
    .array(z.object({ name: z.string().trim().min(1).max(120), order: z.number().int().min(0).default(0) }))
    .default([]),
  components: z
    .array(
      z.object({
        /** Name of a monitor; null for a component that describes something no monitor checks. */
        monitor: z.string().trim().min(1).max(120).nullable().default(null),
        group: z.string().trim().min(1).max(120).nullable().default(null),
        name: z.string().trim().max(120).nullable().default(null),
        description: z.string().max(2000).nullable().default(null),
        order: z.number().int().min(0).default(0),
        manualStatus: z.string().max(40).nullable().default(null),
      }),
    )
    .default([]),
});

const maintenanceWindowSchema = z.object({
  title: z.string().trim().min(1).max(200),
  message: z.string().max(4000).nullable().default(null),
  startsAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  endsAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  monitors: z.array(z.string().trim().min(1).max(120)).default([]),
});

/**
 * The file itself. Everything below `stayup` is optional so a hand-written
 * document with nothing but a `monitors` array is a valid import — which is
 * the shape most people will actually write.
 */
export const configDocumentSchema = z.object({
  stayup: z.object({
    format: z.number().int(),
    version: z.string().optional(),
    exportedAt: z.string().optional(),
  }),
  tags: z.array(tagSchema).default([]),
  integrations: z.array(integrationSchema).default([]),
  escalationPolicies: z.array(escalationPolicySchema).default([]),
  monitors: z.array(monitorSchema).default([]),
  notificationRules: z.array(notificationRuleSchema).default([]),
  statusPages: z.array(statusPageSchema).default([]),
  maintenanceWindows: z.array(maintenanceWindowSchema).default([]),
});

export type ConfigDocument = z.infer<typeof configDocumentSchema>;
export type ConfigMonitor = z.infer<typeof monitorSchema>;

export const CONFIG_ENTITIES = [
  'tags',
  'integrations',
  'escalationPolicies',
  'monitors',
  'notificationRules',
  'statusPages',
  'maintenanceWindows',
] as const;
export type ConfigEntity = (typeof CONFIG_ENTITIES)[number];

export type ImportSummary = {
  created: Record<ConfigEntity, number>;
  /** Already present under that name, so left exactly as it was. */
  skipped: Record<ConfigEntity, number>;
  /**
   * Everything the operator has to know about afterwards: items that could
   * not be created, references that didn't resolve, and secrets to type in.
   */
  warnings: string[];
};

function emptyCounts(): Record<ConfigEntity, number> {
  return Object.fromEntries(CONFIG_ENTITIES.map((key) => [key, 0])) as Record<ConfigEntity, number>;
}

/** Reads the whole config graph out of the database into a document. */
export async function exportConfig(): Promise<ConfigDocument> {
  const [tags, integrations, escalationPolicies, monitors, notificationRules, statusPages, maintenanceWindows] =
    await Promise.all([
      prisma.tag.findMany({ orderBy: { name: 'asc' } }),
      prisma.integration.findMany({ orderBy: { name: 'asc' } }),
      prisma.escalationPolicy.findMany({
        orderBy: { name: 'asc' },
        include: { steps: { orderBy: { order: 'asc' }, include: { integration: { select: { name: true } } } } },
      }),
      prisma.monitor.findMany({
        orderBy: { name: 'asc' },
        include: {
          tags: { include: { tag: { select: { name: true } } } },
          escalationPolicy: { select: { name: true } },
        },
      }),
      prisma.notificationRule.findMany({
        orderBy: { order: 'asc' },
        include: {
          matchTag: { select: { name: true } },
          matchMonitor: { select: { name: true } },
          integrations: { include: { integration: { select: { name: true } } } },
        },
      }),
      prisma.statusPage.findMany({
        orderBy: { name: 'asc' },
        include: {
          groups: { orderBy: { order: 'asc' } },
          components: { orderBy: { order: 'asc' }, include: { monitor: { select: { name: true } }, group: true } },
        },
      }),
      prisma.maintenanceWindow.findMany({
        orderBy: { startsAt: 'asc' },
        include: { monitors: { include: { monitor: { select: { name: true } } } } },
      }),
    ]);

  return {
    stayup: {
      format: CONFIG_FORMAT_VERSION,
      version: currentVersion(),
      exportedAt: new Date().toISOString(),
    },
    tags: tags.map((tag) => ({ name: tag.name, color: tag.color })),
    integrations: integrations.map((integration) => ({
      name: integration.name,
      type: integration.type,
      target: integration.target,
      enabled: integration.enabled,
      // Rule 2: the secret stays in the database, but the fact that there was
      // one has to travel — otherwise an imported integration looks complete
      // and silently fails to deliver.
      secretRequired: !!integration.secret,
    })),
    escalationPolicies: escalationPolicies.map((policy) => ({
      name: policy.name,
      steps: policy.steps.map((step) => ({
        order: step.order,
        delayMinutes: step.delayMinutes,
        integration: step.integration?.name ?? null,
      })),
    })),
    monitors: monitors.map((monitor) => ({
      name: monitor.name,
      url: monitor.url,
      type: monitor.type as MonitorType,
      interval: monitor.interval as ConfigMonitor['interval'],
      port: monitor.port,
      enabled: monitor.enabled,
      method: monitor.method as ConfigMonitor['method'],
      requestHeaders: monitor.requestHeaders,
      requestBody: monitor.requestBody,
      followRedirects: monitor.followRedirects,
      expectedStatusCodes: monitor.expectedStatusCodes,
      keyword: monitor.keyword,
      keywordInverted: monitor.keywordInverted,
      assertionType: monitor.assertionType as ConfigMonitor['assertionType'],
      jsonPath: monitor.jsonPath,
      dnsRecordType: monitor.dnsRecordType as ConfigMonitor['dnsRecordType'],
      dnsExpectedValue: monitor.dnsExpectedValue,
      sloTarget: monitor.sloTarget,
      autoIncidents: monitor.autoIncidents,
      httpTimeoutSeconds: monitor.httpTimeoutSeconds,
      failedAttemptsThreshold: monitor.failedAttemptsThreshold,
      latencyThresholdMs: monitor.latencyThresholdMs,
      tags: monitor.tags.map(({ tag }) => tag.name),
      escalationPolicy: monitor.escalationPolicy?.name ?? null,
      credentialRequired: !!monitor.credential,
    })),
    notificationRules: notificationRules.map((rule) => ({
      name: rule.name,
      enabled: rule.enabled,
      order: rule.order,
      matchTag: rule.matchTag?.name ?? null,
      matchMonitor: rule.matchMonitor?.name ?? null,
      matchImpact: rule.matchImpact as 'Critical' | 'Major' | 'Minor' | null,
      activeDays: rule.activeDays,
      activeFromMinute: rule.activeFromMinute,
      activeUntilMinute: rule.activeUntilMinute,
      action: rule.action as 'Route' | 'Suppress',
      integrations: rule.integrations.map(({ integration }) => integration.name),
    })),
    statusPages: statusPages.map((page) => ({
      name: page.name,
      slug: page.slug,
      customDomain: page.customDomain,
      description: page.description,
      logoUrl: page.logoUrl,
      theme: page.theme as 'light' | 'dark' | 'system',
      primaryColor: page.primaryColor,
      historyWindowDays: page.historyWindowDays,
      isPublished: page.isPublished,
      showTags: page.showTags,
      requireLogin: page.requireLogin,
      groups: page.groups.map((group) => ({ name: group.name, order: group.order })),
      components: page.components.map((component) => ({
        monitor: component.monitor?.name ?? null,
        group: component.group?.name ?? null,
        name: component.name,
        description: component.description,
        order: component.order,
        manualStatus: component.manualStatus,
      })),
    })),
    maintenanceWindows: maintenanceWindows.map((window) => ({
      title: window.title,
      message: window.message,
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
      monitors: window.monitors.map(({ monitor }) => monitor.name),
    })),
  };
}

/**
 * Creates everything in `document` that this instance doesn't already have.
 *
 * Matching is by the name a human would use — tag name, integration name,
 * monitor name, status page slug, maintenance window title+start. Anything
 * that matches is left untouched and counted as skipped; nothing is ever
 * updated or deleted (see rule 3 at the top of this file).
 *
 * Order is dictated by what references what: tags and integrations first
 * because policies, monitors and rules point at them, monitors before the
 * status pages and maintenance windows that list them.
 */
export async function importConfig(document: ConfigDocument, actorId: string | null): Promise<ImportSummary> {
  const summary: ImportSummary = { created: emptyCounts(), skipped: emptyCounts(), warnings: [] };

  // Each item is created in its own try: one bad monitor in a file of two
  // hundred should cost you that monitor and a warning, not the import.
  const attempt = async (entity: ConfigEntity, label: string, run: () => Promise<'created' | 'skipped'>) => {
    try {
      const outcome = await run();
      summary[outcome][entity] += 1;
    } catch (error) {
      summary.skipped[entity] += 1;
      summary.warnings.push(`${label}: ${error instanceof Error ? error.message : 'could not be imported'}`);
    }
  };

  for (const tag of document.tags) {
    await attempt('tags', `Tag "${tag.name}"`, async () => {
      const existing = await prisma.tag.findUnique({ where: { name: tag.name } });
      if (existing) return 'skipped';
      await prisma.tag.create({ data: { name: tag.name, color: tag.color } });
      return 'created';
    });
  }

  for (const integration of document.integrations) {
    await attempt('integrations', `Integration "${integration.name}"`, async () => {
      const existing = await prisma.integration.findFirst({ where: { name: integration.name } });
      if (existing) return 'skipped';
      await prisma.integration.create({
        data: {
          name: integration.name,
          type: integration.type,
          target: integration.target,
          // Rule 2: an export never carries the secret, so an imported
          // integration starts without one and the warning below is the only
          // thing standing between the operator and alerts that silently fail.
          secret: null,
          enabled: integration.enabled,
          createdById: actorId,
        },
      });
      if (integration.secretRequired) {
        summary.warnings.push(
          `Integration "${integration.name}" needs its secret re-entered — exports never carry secrets.`,
        );
      }
      return 'created';
    });
  }

  // Resolved once per entity, after the things they point at exist.
  const integrationIdByName = nameIndex(await prisma.integration.findMany({ select: { id: true, name: true } }));

  for (const policy of document.escalationPolicies) {
    await attempt('escalationPolicies', `Escalation policy "${policy.name}"`, async () => {
      const existing = await prisma.escalationPolicy.findFirst({ where: { name: policy.name } });
      if (existing) return 'skipped';

      const steps = policy.steps.map((step) => {
        const integrationId = step.integration ? integrationIdByName.get(step.integration) ?? null : null;
        if (step.integration && !integrationId) {
          summary.warnings.push(
            `Escalation policy "${policy.name}" step ${step.order + 1} points at unknown integration "${step.integration}" — the step was created without one.`,
          );
        }
        return { order: step.order, delayMinutes: step.delayMinutes, integrationId };
      });

      await prisma.escalationPolicy.create({
        data: { name: policy.name, createdById: actorId, steps: { create: steps } },
      });
      return 'created';
    });
  }

  const policyIdByName = nameIndex(await prisma.escalationPolicy.findMany({ select: { id: true, name: true } }));

  for (const monitor of document.monitors) {
    await attempt('monitors', `Monitor "${monitor.name}"`, async () => {
      const existing = await prisma.monitor.findFirst({ where: { name: monitor.name } });
      if (existing) return 'skipped';

      let escalationPolicyId: string | null = null;
      if (monitor.escalationPolicy) {
        escalationPolicyId = policyIdByName.get(monitor.escalationPolicy) ?? null;
        if (!escalationPolicyId) {
          summary.warnings.push(
            `Monitor "${monitor.name}" points at unknown escalation policy "${monitor.escalationPolicy}" — imported without one.`,
          );
        }
      }

      await prisma.monitor.create({
        data: {
          name: monitor.name,
          url: monitor.url,
          type: monitor.type,
          interval: monitor.interval,
          // The same default the monitor router applies, so an imported
          // Postgres monitor with no port is checked on 5432 rather than
          // failing every check against port 0.
          port: monitor.port ?? (PROBE_TYPES.includes(monitor.type) ? DEFAULT_PORTS[monitor.type] ?? null : null),
          enabled: monitor.enabled,
          method: monitor.method,
          requestHeaders: monitor.requestHeaders,
          requestBody: monitor.requestBody,
          followRedirects: monitor.followRedirects,
          expectedStatusCodes: monitor.expectedStatusCodes,
          keyword: monitor.keyword,
          keywordInverted: monitor.keywordInverted,
          assertionType: monitor.assertionType,
          jsonPath: monitor.jsonPath,
          dnsRecordType: monitor.dnsRecordType,
          dnsExpectedValue: monitor.dnsExpectedValue,
          sloTarget: monitor.sloTarget,
          autoIncidents: monitor.autoIncidents,
          httpTimeoutSeconds: monitor.httpTimeoutSeconds,
          failedAttemptsThreshold: monitor.failedAttemptsThreshold,
          latencyThresholdMs: monitor.latencyThresholdMs,
          escalationPolicyId,
          createdById: actorId,
          // connectOrCreate rather than a lookup: a document may name a tag
          // its own `tags` array never declared, and losing the tag would be
          // a worse answer than creating it.
          tags: {
            create: monitor.tags.map((name) => ({
              tag: { connectOrCreate: { where: { name }, create: { name } } },
            })),
          },
        },
      });

      if (monitor.credentialRequired) {
        summary.warnings.push(
          `Monitor "${monitor.name}" needs its password re-entered — exports never carry credentials.`,
        );
      }
      return 'created';
    });
  }

  const monitorIdByName = nameIndex(await prisma.monitor.findMany({ select: { id: true, name: true } }));
  const tagIdByName = nameIndex(await prisma.tag.findMany({ select: { id: true, name: true } }));
  const ruleIntegrationIdByName = nameIndex(await prisma.integration.findMany({ select: { id: true, name: true } }));

  for (const rule of document.notificationRules) {
    await attempt('notificationRules', `Notification rule "${rule.name}"`, async () => {
      const existing = await prisma.notificationRule.findFirst({ where: { name: rule.name } });
      if (existing) return 'skipped';

      const integrationIds = rule.integrations
        .map((name) => ruleIntegrationIdByName.get(name))
        .filter((id): id is string => !!id);
      if (integrationIds.length !== rule.integrations.length) {
        summary.warnings.push(
          `Notification rule "${rule.name}" references integrations that don't exist here — it was created with the ones that do.`,
        );
      }

      await prisma.notificationRule.create({
        data: {
          name: rule.name,
          enabled: rule.enabled,
          order: rule.order,
          matchTagId: rule.matchTag ? tagIdByName.get(rule.matchTag) ?? null : null,
          matchMonitorId: rule.matchMonitor ? monitorIdByName.get(rule.matchMonitor) ?? null : null,
          matchImpact: rule.matchImpact,
          activeDays: rule.activeDays,
          activeFromMinute: rule.activeFromMinute,
          activeUntilMinute: rule.activeUntilMinute,
          action: rule.action,
          createdById: actorId,
          integrations: { create: integrationIds.map((integrationId) => ({ integrationId })) },
        },
      });
      return 'created';
    });
  }

  for (const page of document.statusPages) {
    await attempt('statusPages', `Status page "${page.slug}"`, async () => {
      const existing = await prisma.statusPage.findUnique({ where: { slug: page.slug } });
      if (existing) return 'skipped';

      // customDomain is unique instance-wide: importing one that another page
      // already serves would fail the whole page, so it's dropped with a note.
      let customDomain = page.customDomain;
      if (customDomain && (await prisma.statusPage.findUnique({ where: { customDomain } }))) {
        summary.warnings.push(
          `Status page "${page.slug}" was imported without its custom domain ${customDomain} — another page already uses it.`,
        );
        customDomain = null;
      }

      const created = await prisma.statusPage.create({
        data: {
          name: page.name,
          slug: page.slug,
          customDomain,
          description: page.description,
          logoUrl: page.logoUrl,
          theme: page.theme,
          primaryColor: page.primaryColor,
          historyWindowDays: page.historyWindowDays,
          isPublished: page.isPublished,
          showTags: page.showTags,
          requireLogin: page.requireLogin,
          createdById: actorId,
          groups: { create: page.groups.map((group) => ({ name: group.name, order: group.order })) },
        },
        include: { groups: true },
      });

      const groupIdByName = new Map(created.groups.map((group) => [group.name, group.id]));

      for (const component of page.components) {
        const monitorId = component.monitor ? monitorIdByName.get(component.monitor) ?? null : null;
        if (component.monitor && !monitorId) {
          summary.warnings.push(
            `Status page "${page.slug}" lists monitor "${component.monitor}", which isn't on this instance — that component was left out.`,
          );
          continue;
        }
        await prisma.statusPageComponent.create({
          data: {
            statusPageId: created.id,
            monitorId,
            groupId: component.group ? groupIdByName.get(component.group) ?? null : null,
            name: component.name,
            description: component.description,
            order: component.order,
            manualStatus: component.manualStatus,
          },
        });
      }

      return 'created';
    });
  }

  for (const window of document.maintenanceWindows) {
    await attempt('maintenanceWindows', `Maintenance window "${window.title}"`, async () => {
      const startsAt = new Date(window.startsAt);
      const endsAt = new Date(window.endsAt);

      // Title alone is a poor key — "Database upgrade" happens more than once
      // — so the start time is part of the match.
      const existing = await prisma.maintenanceWindow.findFirst({ where: { title: window.title, startsAt } });
      if (existing) return 'skipped';

      const monitorIds = window.monitors
        .map((name) => monitorIdByName.get(name))
        .filter((id): id is string => !!id);

      await prisma.maintenanceWindow.create({
        data: {
          title: window.title,
          message: window.message,
          startsAt,
          endsAt,
          createdById: actorId,
          monitors: { create: monitorIds.map((monitorId) => ({ monitorId })) },
        },
      });
      return 'created';
    });
  }

  return summary;
}

/** Name → id, for resolving the document's name-based references. */
function nameIndex(rows: { id: string; name: string }[]): Map<string, string> {
  return new Map(rows.map((row) => [row.name, row.id]));
}
