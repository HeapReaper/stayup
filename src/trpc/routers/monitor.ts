import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Monitor as PrismaMonitor, Prisma } from '@prisma/client';
import { createTRPCRouter, protectedProcedure, capabilityProcedure } from '../init';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { ASSERTION_TYPES, type AssertionType, validateJsonPath, validateRegex } from '@/lib/assertions';
import { generateHeartbeatToken, heartbeatPingUrl } from '@/lib/heartbeat';
import { wouldCreateDependencyCycle } from '@/lib/monitor-dependencies';
// Re-exported below so existing importers of this router keep working; the
// definitions live in a Prisma-free module because client components import
// them as values (see src/lib/monitor-types.ts).
import {
  DEFAULT_HEARTBEAT_GRACE_SECONDS,
  DEFAULT_PORTS,
  PROBE_TYPES,
  dnsRecordTypeEnum,
  monitorIntervalEnum,
  monitorMethodEnum,
  monitorStatusEnum,
  monitorTypeEnum,
  type DnsRecordType,
  type MonitorInterval,
  type MonitorMethod,
  type MonitorStatus,
  type MonitorType,
} from '@/lib/monitor-types';

export {
  DEFAULT_HEARTBEAT_GRACE_SECONDS,
  DEFAULT_PORTS,
  PROBE_TYPES,
  dnsRecordTypeEnum,
  monitorIntervalEnum,
  monitorMethodEnum,
  monitorStatusEnum,
  monitorTypeEnum,
};
export type { DnsRecordType, MonitorInterval, MonitorMethod, MonitorStatus, MonitorType };

/** Monitor changes: Admin and Member (see src/lib/permissions.ts). */
const writeMonitors = capabilityProcedure('monitors:write');

export const assertionTypeEnum = z.enum(ASSERTION_TYPES);

const withRelations = {
  tags: { include: { tag: true } },
  escalationPolicy: { select: { id: true, name: true } },
  // Named so the monitors list can say "suppressed by Core router" rather
  // than showing an id nobody recognises.
  parent: { select: { id: true, name: true, status: true } },
} satisfies Prisma.MonitorInclude;

type RawMonitor = Prisma.MonitorGetPayload<{ include: typeof withRelations }>;

// The `type`/`status`/`interval` columns are plain strings in the DB (SQLite has no
// native enum support), but every row is written through the validated mutations
// below, so it's safe to narrow them back to their literal unions when reading.
// Dates are serialized to ISO strings here too, so the shape returned by the direct
// server-side caller (RSC) matches what actually comes back over the httpBatchLink
// (no superjson transformer is configured, so Dates go over the wire as strings).
export type Monitor = Omit<
  PrismaMonitor,
  | 'type'
  | 'status'
  | 'interval'
  | 'method'
  | 'assertionType'
  | 'dnsRecordType'
  | 'createdAt'
  | 'updatedAt'
  | 'lastCheckedAt'
  | 'certExpiresAt'
  | 'domainExpiresAt'
  | 'flappingSince'
  // Never leaves the server: it's the password half of a database/Redis/mail
  // monitor's connection details, and the dashboard only ever needs to know
  // *whether* one is set (credentialSet below).
  | 'credential'
> & {
  type: MonitorType;
  status: MonitorStatus;
  interval: MonitorInterval;
  method: MonitorMethod;
  assertionType: AssertionType;
  dnsRecordType: DnsRecordType;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
  certExpiresAt: string | null;
  domainExpiresAt: string | null;
  flappingSince: string | null;
  credentialSet: boolean;
  tags: { id: string; name: string; color: string }[];
  escalationPolicyName: string | null;
  parentName: string | null;
  /**
   * True while this monitor's incidents are being suppressed because
   * something it depends on is Down. Only the immediate parent is reflected
   * here — the workers walk the whole chain (src/lib/monitor-dependencies.ts),
   * but a parent that is itself suppressed is Down too, so the badge lands on
   * the right rows either way.
   */
  parentDown: boolean;
  /**
   * The URL a Heartbeat monitor's job pings. Null for every other type, and
   * for a Heartbeat monitor that somehow has no token yet. Carries the token,
   * so it never leaves an authenticated procedure.
   */
  heartbeatUrl: string | null;
};

function serializeMonitor(monitor: RawMonitor): Monitor {
  const { credential, ...rest } = monitor;

  return {
    ...rest,
    type: monitor.type as MonitorType,
    status: monitor.status as MonitorStatus,
    interval: monitor.interval as MonitorInterval,
    method: monitor.method as MonitorMethod,
    assertionType: monitor.assertionType as AssertionType,
    dnsRecordType: monitor.dnsRecordType as DnsRecordType,
    createdAt: monitor.createdAt.toISOString(),
    updatedAt: monitor.updatedAt.toISOString(),
    lastCheckedAt: monitor.lastCheckedAt ? monitor.lastCheckedAt.toISOString() : null,
    certExpiresAt: monitor.certExpiresAt ? monitor.certExpiresAt.toISOString() : null,
    domainExpiresAt: monitor.domainExpiresAt ? monitor.domainExpiresAt.toISOString() : null,
    flappingSince: monitor.flappingSince ? monitor.flappingSince.toISOString() : null,
    credentialSet: !!credential,
    tags: monitor.tags.map(({ tag }) => tag),
    escalationPolicyName: monitor.escalationPolicy?.name ?? null,
    parentName: monitor.parent?.name ?? null,
    parentDown: monitor.parent?.status === 'Down',
    heartbeatUrl: monitor.heartbeatToken ? heartbeatPingUrl(monitor.heartbeatToken) : null,
  };
}

// Normalizes the URL/host field based on monitor type: HTTP monitors get a
// protocol prefixed if the user left it off, WebSocket monitors likewise get
// wss://, and every other type (Ping/Port/DNS and the probe family) takes a
// bare host, DSN or domain name as-is.
function normalizeUrl(type: MonitorType, url: string) {
  const trimmed = url.trim();
  // A Heartbeat monitor has no target — it is the target. Its address is the
  // ping URL derived from heartbeatToken, so the column stays empty rather
  // than holding a URL that would go stale the moment BETTER_AUTH_URL changes.
  if (type === 'Heartbeat') return '';
  if (type === 'HTTP' && !/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  if (type === 'WebSocket' && !/^wss?:\/\//i.test(trimmed)) {
    return `wss://${trimmed}`;
  }
  return trimmed;
}

/**
 * Replaces a monitor's tags from the editor's flat name list — find-or-create
 * per name (case-sensitive exact match; typing "API" twice reuses the same
 * tag, "API" vs "api" makes two — a known simplification, there's no tag
 * management UI to merge/rename them), then a full delete+relink so removed
 * names actually drop off the monitor.
 */
async function applyTags(tx: Prisma.TransactionClient, monitorId: string, tagNames: string[]) {
  await tx.monitorTag.deleteMany({ where: { monitorId } });

  for (const rawName of tagNames) {
    const name = rawName.trim();
    if (!name) continue;

    const tag = await tx.tag.upsert({ where: { name }, create: { name }, update: {} });
    await tx.monitorTag.create({ data: { monitorId, tagId: tag.id } });
  }
}

// Accepted-status-code spec: comma-separated three-digit codes and/or
// inclusive ranges, e.g. "200", "200,201", "200-204,301". Parsed by
// statusCodeAccepted() in worker/internal/checkers/http.go — validated here so
// a typo surfaces in the form instead of silently failing every check.
const STATUS_CODE_SPEC = /^\s*[1-5]\d{2}(\s*-\s*[1-5]\d{2})?(\s*,\s*[1-5]\d{2}(\s*-\s*[1-5]\d{2})?)*\s*$/;

/** Stored as text and handed to the worker verbatim, so it has to be a flat JSON object of strings. */
function isHeaderJsonObject(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.values(parsed).every((v) => typeof v === 'string')
    );
  } catch {
    return false;
  }
}

// Empty strings from the form mean "not set" for every one of these — they're
// nullable columns, and '' would otherwise be a keyword that matches nothing
// or a status spec that accepts nothing.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || null);

const monitorBaseInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  // Optional only because a Heartbeat monitor has nothing to dial; every
  // other type is held to the non-empty rule by a refine below, so the form
  // still reports a missing host the way it always did.
  url: z.string().trim().max(500).optional().default(''),
  type: monitorTypeEnum,
  interval: monitorIntervalEnum,
  port: z.coerce.number().int().min(1).max(65535).optional(),
  // null/'' clears it — this monitor goes back to the default broadcast
  // notification behavior (see src/lib/incidents.ts's notifyOrEscalate).
  escalationPolicyId: z.string().nullable().optional(),
  tagNames: z.array(z.string().trim().min(1).max(40)).max(20).optional().default([]),

  // HTTP-only request options. Accepted (and stored) for every type so the
  // form can stay simple, but blanked out below for Ping/Port/DNS, whose
  // workers ignore them entirely.
  method: monitorMethodEnum.optional().default('GET'),
  requestHeaders: optionalText(4000).refine((value) => value === null || isHeaderJsonObject(value), {
    message: 'Headers must be a JSON object of string values, e.g. {"Authorization": "Bearer …"}',
  }),
  requestBody: optionalText(10_000),
  followRedirects: z.boolean().optional().default(true),
  expectedStatusCodes: optionalText(200).refine((value) => value === null || STATUS_CODE_SPEC.test(value), {
    message: 'Use status codes or ranges, e.g. "200", "200,201" or "200-204,301"',
  }),
  keyword: optionalText(1000),
  keywordInverted: z.boolean().optional().default(false),
  assertionType: assertionTypeEnum.optional().default('Contains'),
  jsonPath: optionalText(200),

  // DNS-only options, blanked out below for every other type. 'A' is the
  // default because that is what a DNS monitor checked before record
  // selection existed.
  dnsRecordType: dnsRecordTypeEnum.optional().default('A'),
  dnsExpectedValue: optionalText(500),

  // Probe-family options. Like the HTTP block above they're accepted for
  // every type and blanked out server-side for the types that ignore them.
  // Blank means "keep the stored one" on update, so the form never has to
  // round-trip the secret.
  credential: z.string().max(500).optional(),
  // Availability target in percent (99.9). Null clears it.
  sloTarget: z.number().min(0).max(100).nullable().optional(),

  // Per-monitor overrides of the instance-wide monitoring defaults. Null (the
  // form's blank) means "use the instance value". Bounds match the Settings
  // page's, so an override can't be set to something the instance-wide field
  // would have rejected — see worker/internal/settings's ForMonitor().
  httpTimeoutSeconds: z.number().int().min(1).max(300).nullable().optional(),
  failedAttemptsThreshold: z.number().int().min(1).max(20).nullable().optional(),
  latencyThresholdMs: z.number().int().min(50).max(60_000).nullable().optional(),

  // Whether a failing check may open an incident for this monitor on its own.
  // Defaults to true — the behaviour every monitor had before the switch
  // existed — and false makes it a watch-only monitor: still checked, still
  // charted, but no incident and therefore no alert (see
  // syncIncidentForResult in worker/internal/runner/runner.go).
  autoIncidents: z.boolean().optional().default(true),

  // The monitor this one sits behind. While the parent is Down, this
  // monitor's failures open no incident — one page for the router instead of
  // thirty for everything behind it. Null/'' clears the dependency.
  parentId: z.string().nullable().optional(),

  // Heartbeat-only: how late the ping may be, on top of the interval, before
  // the monitor is called Down. Null means the instance default.
  heartbeatGraceSeconds: z.number().int().min(0).max(86_400).nullable().optional(),
});

/** True when this monitor actually asserts something about the response body. */
function hasBodyAssertion(data: z.infer<typeof monitorBaseInput>): boolean {
  if (data.type !== 'HTTP') return false;
  return data.assertionType === 'JsonPath' ? !!data.jsonPath : !!data.keyword;
}

const withPortRequiredForPortType = <T extends typeof monitorBaseInput>(schema: T) =>
  schema
    // Every type except Heartbeat is something StayUp dials, and a checker
    // with no address fails every check with a message nobody can act on.
    .refine((data) => data.type === 'Heartbeat' || data.url.trim().length > 0, {
      message: 'URL or host is required',
      path: ['url'],
    })
    .refine((data) => data.type !== 'Port' || typeof data.port === 'number', {
      message: 'Port is required for Port monitors',
      path: ['port'],
    })
    // A HEAD response has no body, so a content assertion on one could only
    // ever fail — catch that here rather than letting it look like an outage.
    .refine((data) => !hasBodyAssertion(data) || data.method !== 'HEAD', {
      message: 'A HEAD request has no response body to assert on',
      path: ['keyword'],
    })
    // Validated against the same subset worker/internal/checkers/assert.go
    // evaluates, so nothing that passes the form can fail at check time.
    .refine((data) => data.assertionType !== 'Regex' || !data.keyword || validateRegex(data.keyword) === null, {
      message: 'Invalid regular expression',
      path: ['keyword'],
    })
    .refine((data) => data.type !== 'HTTP' || data.assertionType !== 'JsonPath' || !!data.jsonPath, {
      message: 'A JSON path is required for a JSON path assertion',
      path: ['jsonPath'],
    })
    .refine((data) => data.assertionType !== 'JsonPath' || !data.jsonPath || validateJsonPath(data.jsonPath) === null, {
      message: 'Use a path like $.status, $.db.connected or $.nodes[0].name',
      path: ['jsonPath'],
    })
    // A Postgres monitor connects with the whole DSN, so a bare hostname
    // would fail every check with an unhelpful driver error.
    .refine((data) => data.type !== 'Postgres' || /^postgres(ql)?:\/\//i.test(data.url.trim()), {
      message: 'Give a full connection string, e.g. postgresql://user:pass@host:5432/dbname',
      path: ['url'],
    })
    // A MySQL monitor takes either a bare host (handshake check) or a
    // mysql:// DSN (authenticated SELECT 1) — a postgresql:// string pasted
    // into the wrong monitor type would otherwise fail every check with a
    // driver error nobody reads.
    .refine(
      (data) =>
        data.type !== 'MySQL' ||
        !/^[a-z][a-z0-9+.-]*:\/\//i.test(data.url.trim()) ||
        /^mysql:\/\//i.test(data.url.trim()),
      {
        message: 'Give a host (db.internal) or a mysql://user@host:3306/dbname connection string',
        path: ['url'],
      },
    )
    // RDAP is looked up per registrable domain, not per URL or host.
    .refine((data) => data.type !== 'Domain' || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(data.url.trim()), {
      message: 'Give a bare domain name, e.g. example.com',
      path: ['url'],
    });

export const monitorCreateInput = withPortRequiredForPortType(monitorBaseInput);
export const monitorUpdateInput = withPortRequiredForPortType(
  monitorBaseInput.extend({ id: z.string() }),
);

export type MonitorCreateInput = z.input<typeof monitorCreateInput>;
export type MonitorUpdateInput = z.input<typeof monitorUpdateInput>;

/**
 * The HTTP-only columns, reduced to their defaults for monitor types whose
 * workers don't read them — so switching a monitor from HTTP to Ping doesn't
 * leave a stale keyword or status-code spec behind, waiting to surprise
 * whoever switches it back.
 */
function httpOptionsFor(input: z.infer<typeof monitorBaseInput>) {
  if (input.type !== 'HTTP') {
    return {
      method: 'GET',
      requestHeaders: null,
      requestBody: null,
      followRedirects: true,
      expectedStatusCodes: null,
      keyword: null,
      keywordInverted: false,
      assertionType: 'Contains',
      jsonPath: null,
    };
  }

  return {
    method: input.method,
    requestHeaders: input.requestHeaders,
    requestBody: input.requestBody,
    followRedirects: input.followRedirects,
    expectedStatusCodes: input.expectedStatusCodes,
    keyword: input.keyword,
    keywordInverted: input.keywordInverted,
    assertionType: input.assertionType,
    // Only meaningful for the JsonPath mode; keeping it otherwise would leave
    // a stale path behind that silently reactivates on a mode switch.
    jsonPath: input.assertionType === 'JsonPath' ? input.jsonPath : null,
  };
}

/**
 * The DNS-only columns, reduced to their defaults for every other type — the
 * same reasoning as httpOptionsFor: a monitor switched away from DNS must not
 * keep an expected MX value that silently reactivates if it is switched back.
 */
function dnsOptionsFor(input: z.infer<typeof monitorBaseInput>) {
  if (input.type !== 'DNS') {
    return { dnsRecordType: 'A', dnsExpectedValue: null };
  }
  return { dnsRecordType: input.dnsRecordType, dnsExpectedValue: input.dnsExpectedValue };
}

/**
 * The heartbeat columns, resolved against what's already stored.
 *
 * The token is generated once, the first time a monitor becomes a Heartbeat,
 * and kept across every later edit — it is pasted into a crontab on some
 * other machine, so silently reissuing it on a name change would break the
 * job without telling anyone. Switching a monitor *away* from Heartbeat
 * clears it, which is what makes the old URL stop answering.
 */
function heartbeatFieldsFor(input: z.infer<typeof monitorBaseInput>, existingToken: string | null) {
  if (input.type !== 'Heartbeat') {
    return { heartbeatToken: null, heartbeatGraceSeconds: null };
  }

  return {
    heartbeatToken: existingToken ?? generateHeartbeatToken(),
    heartbeatGraceSeconds: input.heartbeatGraceSeconds ?? DEFAULT_HEARTBEAT_GRACE_SECONDS,
  };
}

/**
 * The port column: required for Port monitors, optional (with a per-type
 * default the workers apply) for the probe family, and meaningless for
 * everything else.
 */
function portFor(input: z.infer<typeof monitorBaseInput>): number | null {
  if (input.type === 'Port') return input.port ?? null;
  if (!PROBE_TYPES.includes(input.type)) return null;
  return input.port ?? DEFAULT_PORTS[input.type] ?? null;
}

/**
 * The three per-monitor override columns. Only HTTP monitors have a request
 * timeout worth overriding separately... they don't, actually: every checker
 * reads the same three values (see settings.ForMonitor), so these apply to
 * every monitor type.
 */
function overridesFor(input: z.infer<typeof monitorBaseInput>) {
  return {
    httpTimeoutSeconds: input.httpTimeoutSeconds ?? null,
    failedAttemptsThreshold: input.failedAttemptsThreshold ?? null,
    latencyThresholdMs: input.latencyThresholdMs ?? null,
  };
}

/**
 * The credential column, resolved against what's already stored: a blank
 * field means "keep the existing secret" (so the form never has to receive
 * it), and a monitor type that has no credentials clears it outright.
 */
function credentialFor(input: z.infer<typeof monitorBaseInput>, existing: string | null): string | null {
  if (!PROBE_TYPES.includes(input.type)) return null;
  const typed = input.credential?.trim();
  if (typed) return typed;
  return existing;
}

/**
 * Validates a proposed parent: it has to exist, and it must not close a loop
 * back onto the monitor being edited. Two monitors that were each other's
 * parent would suppress each other's incidents the moment either went Down —
 * an outage nobody hears about, which is worse than the storm the feature
 * exists to prevent.
 */
async function assertValidParent(monitorId: string | null, parentId: string | null | undefined) {
  if (!parentId) return;

  const parent = await prisma.monitor.findUnique({ where: { id: parentId }, select: { id: true } });
  if (!parent) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'The monitor this one depends on no longer exists' });
  }

  // A monitor that doesn't exist yet can't be anywhere in the chain above its
  // own parent, so only an edit can produce a cycle.
  if (monitorId && (await wouldCreateDependencyCycle(monitorId, parentId))) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'That would make a dependency loop — the monitor already sits above this one.',
    });
  }
}

/**
 * Who is making the change, for the audit log.
 *
 * `id` is null for anything that isn't a signed-in user — today that means
 * the public API (src/app/api/v1), which authenticates with the instance API
 * key rather than as a person. The audit entry still records *what* happened
 * and from which address; it just can't name a human, which is the honest
 * answer rather than attributing a script's change to whoever created the key.
 */
export interface MonitorActor {
  id: string | null;
  name: string;
  ipAddress: string;
}

/** The signed-in caller, as the shared mutations want them. */
function actorFrom(ctx: { session: { user: { id: string; name: string } }; ipAddress: string }): MonitorActor {
  return { id: ctx.session.user.id, name: ctx.session.user.name, ipAddress: ctx.ipAddress };
}

/**
 * The four mutations below are exported as plain functions and called by both
 * the tRPC router and the public REST API (src/app/api/v1/monitors).
 *
 * Deliberately one implementation rather than two: a monitor created through
 * Terraform has to end up as exactly the same row, with the same normalized
 * URL, the same blanked-out per-type options and the same audit entry, as one
 * created in the form. Two code paths would drift the first time a column was
 * added — which is the same reasoning as invariant 1's TS/Go mirror pairs,
 * one layer up.
 *
 * They throw TRPCError, which the REST layer maps onto status codes
 * (src/app/api/v1/_lib.ts) — so validation and not-found behave identically
 * whichever door the request came through.
 */
export async function createMonitor(
  input: z.output<typeof monitorCreateInput>,
  actor: MonitorActor,
): Promise<Monitor> {
  await assertValidParent(null, input.parentId);

  const monitor = await prisma.$transaction(async (tx) => {
    const created = await tx.monitor.create({
      data: {
        name: input.name,
        url: normalizeUrl(input.type, input.url),
        type: input.type,
        interval: input.interval,
        port: portFor(input),
        escalationPolicyId: input.escalationPolicyId || null,
        parentId: input.parentId || null,
        autoIncidents: input.autoIncidents,
        createdById: actor.id,
        credential: credentialFor(input, null),
        sloTarget: input.sloTarget ?? null,
        ...heartbeatFieldsFor(input, null),
        ...overridesFor(input),
        ...httpOptionsFor(input),
        ...dnsOptionsFor(input),
      },
    });

    await applyTags(tx, created.id, input.tagNames);

    return created;
  });

  await logAudit({
    actorId: actor.id,
    actorName: actor.name,
    action: 'CREATED_MONITOR',
    target: monitor.name,
    ipAddress: actor.ipAddress,
  });

  const full = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id }, include: withRelations });
  return serializeMonitor(full);
}

export async function updateMonitor(
  input: z.output<typeof monitorUpdateInput>,
  actor: MonitorActor,
): Promise<Monitor> {
  const existing = await prisma.monitor.findUnique({ where: { id: input.id } });

  if (!existing) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Monitor not found' });
  }

  await assertValidParent(input.id, input.parentId);

  const monitor = await prisma.$transaction(async (tx) => {
    const updated = await tx.monitor.update({
      where: { id: input.id },
      data: {
        name: input.name,
        url: normalizeUrl(input.type, input.url),
        type: input.type,
        interval: input.interval,
        port: portFor(input),
        escalationPolicyId: input.escalationPolicyId || null,
        parentId: input.parentId || null,
        autoIncidents: input.autoIncidents,
        credential: credentialFor(input, existing.credential),
        sloTarget: input.sloTarget ?? null,
        ...heartbeatFieldsFor(input, existing.heartbeatToken),
        ...overridesFor(input),
        ...httpOptionsFor(input),
        ...dnsOptionsFor(input),
        // A monitor that stops being HTTP can't have a meaningful
        // certificate expiry any more, and one that stops being a Domain
        // monitor can't have a meaningful registry expiry.
        ...(input.type === 'HTTP' ? {} : { certExpiresAt: null }),
        ...(input.type === 'Domain' ? {} : { domainExpiresAt: null }),
      },
    });

    await applyTags(tx, input.id, input.tagNames);

    return updated;
  });

  await logAudit({
    actorId: actor.id,
    actorName: actor.name,
    action: 'UPDATED_MONITOR',
    target: monitor.name,
    ipAddress: actor.ipAddress,
  });

  const full = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id }, include: withRelations });
  return serializeMonitor(full);
}

/**
 * Pause or resume a monitor. Pausing only stops the workers from picking it
 * up (they filter on `enabled`); the monitor keeps its history, its uptime
 * figure and its place on any status page, and any incident it already has
 * open stays open — nobody's outage disappears because someone hit pause.
 */
export async function setMonitorEnabled(id: string, enabled: boolean, actor: MonitorActor): Promise<Monitor> {
  const existing = await prisma.monitor.findUnique({ where: { id } });

  if (!existing) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Monitor not found' });
  }

  await prisma.monitor.update({ where: { id }, data: { enabled } });

  await logAudit({
    actorId: actor.id,
    actorName: actor.name,
    action: enabled ? 'RESUMED_MONITOR' : 'PAUSED_MONITOR',
    target: existing.name,
    ipAddress: actor.ipAddress,
  });

  const full = await prisma.monitor.findUniqueOrThrow({ where: { id }, include: withRelations });
  return serializeMonitor(full);
}

export async function deleteMonitor(id: string, actor: MonitorActor): Promise<{ id: string }> {
  const existing = await prisma.monitor.findUnique({ where: { id } });

  if (!existing) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Monitor not found' });
  }

  await prisma.monitor.delete({ where: { id } });

  await logAudit({
    actorId: actor.id,
    actorName: actor.name,
    action: 'DELETED_MONITOR',
    target: existing.name,
    ipAddress: actor.ipAddress,
  });

  return { id };
}

/**
 * Turns a stored monitor back into the shape the input schema accepts.
 *
 * Only the public API needs this: a PATCH is a partial update, and the
 * validation above (with its cross-field refinements — a Port monitor needs a
 * port, a JsonPath assertion needs a path) can only judge a whole monitor. So
 * a PATCH is merged onto this before it is validated, which means a
 * one-field change is checked against the same rules as the full form.
 *
 * `credential` is deliberately absent rather than round-tripped: a blank one
 * means "keep what's stored" (see credentialFor), which is exactly the
 * behaviour a partial update wants.
 */
export function monitorToInput(monitor: PrismaMonitor & { tags: { tag: { name: string } }[] }): MonitorUpdateInput {
  return {
    id: monitor.id,
    name: monitor.name,
    url: monitor.url,
    type: monitor.type as MonitorType,
    interval: monitor.interval as MonitorInterval,
    port: monitor.port ?? undefined,
    escalationPolicyId: monitor.escalationPolicyId,
    parentId: monitor.parentId,
    tagNames: monitor.tags.map(({ tag }) => tag.name),
    method: monitor.method as MonitorMethod,
    requestHeaders: monitor.requestHeaders ?? undefined,
    requestBody: monitor.requestBody ?? undefined,
    followRedirects: monitor.followRedirects,
    expectedStatusCodes: monitor.expectedStatusCodes ?? undefined,
    keyword: monitor.keyword ?? undefined,
    keywordInverted: monitor.keywordInverted,
    assertionType: monitor.assertionType as AssertionType,
    jsonPath: monitor.jsonPath ?? undefined,
    dnsRecordType: monitor.dnsRecordType as DnsRecordType,
    dnsExpectedValue: monitor.dnsExpectedValue ?? undefined,
    sloTarget: monitor.sloTarget,
    httpTimeoutSeconds: monitor.httpTimeoutSeconds,
    failedAttemptsThreshold: monitor.failedAttemptsThreshold,
    latencyThresholdMs: monitor.latencyThresholdMs,
    autoIncidents: monitor.autoIncidents,
    heartbeatGraceSeconds: monitor.heartbeatGraceSeconds,
  };
}

export const monitorRouter = createTRPCRouter({
  getAll: protectedProcedure.query(async () => {
    const monitors = await prisma.monitor.findMany({
      orderBy: { createdAt: 'desc' },
      include: withRelations,
    });

    return monitors.map(serializeMonitor);
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const monitor = await prisma.monitor.findUnique({
        where: { id: input.id },
        include: withRelations,
      });

      if (!monitor) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Monitor not found' });
      }

      return serializeMonitor(monitor);
    }),

  create: writeMonitors
    .input(monitorCreateInput)
    .mutation(({ input, ctx }) => createMonitor(input, actorFrom(ctx))),

  update: writeMonitors
    .input(monitorUpdateInput)
    .mutation(({ input, ctx }) => updateMonitor(input, actorFrom(ctx))),

  setEnabled: writeMonitors
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ input, ctx }) => setMonitorEnabled(input.id, input.enabled, actorFrom(ctx))),

  /**
   * Issues a fresh ping token for a Heartbeat monitor, immediately
   * invalidating the old URL.
   *
   * Separate from `update` on purpose: the token lives in a crontab on
   * another machine, so rotating it has to be something someone asks for
   * rather than a side effect of renaming the monitor. Nothing else changes —
   * the monitor keeps its history, its status and any open incident, it just
   * stops answering the old URL until the job is updated.
   */
  regenerateHeartbeatToken: writeMonitors
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.monitor.findUnique({ where: { id: input.id } });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Monitor not found' });
      }
      if (existing.type !== 'Heartbeat') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only heartbeat monitors have a ping URL' });
      }

      await prisma.monitor.update({
        where: { id: input.id },
        data: { heartbeatToken: generateHeartbeatToken() },
      });

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'REGENERATED_HEARTBEAT_TOKEN',
        target: existing.name,
        ipAddress: ctx.ipAddress,
      });

      const full = await prisma.monitor.findUniqueOrThrow({ where: { id: input.id }, include: withRelations });
      return serializeMonitor(full);
    }),

  delete: writeMonitors
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => deleteMonitor(input.id, actorFrom(ctx))),
});
