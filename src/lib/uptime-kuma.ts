/**
 * Reads an Uptime Kuma backup (Settings → Backup → Export) and turns it into
 * a StayUp config document, which src/lib/config-transfer.ts then imports
 * like any other.
 *
 * Converting rather than importing directly is the whole point: Kuma's export
 * is the only format worth special-casing (it's where most self-hosters are
 * coming from), and routing it through the same document means the migration
 * path gets the same additive, name-keyed, nothing-overwritten behaviour as a
 * StayUp-to-StayUp import — and the same warnings.
 *
 * What does not survive the crossing is reported, never guessed at. A monitor
 * type StayUp has no checker for is skipped with its name and reason; a
 * setting with no equivalent (Kuma's upside-down mode, per-monitor TLS
 * ignoring) is a warning on a monitor that was otherwise imported. Silently
 * importing a check that watches something *other* than what it watched in
 * Kuma is the one outcome worse than not importing it.
 */
import { z } from 'zod';
import { validateJsonPath } from '@/lib/assertions';
import { CONFIG_FORMAT_VERSION, type ConfigDocument, type ConfigMonitor } from '@/lib/config-transfer';
import type { MonitorInterval, MonitorType } from '@/lib/monitor-types';

/**
 * Kuma's export is hand-rolled JSON that has changed shape across versions,
 * so everything is optional and unknown keys are kept: a missing field must
 * degrade to a warning, never to a parse failure that costs the operator
 * their whole file.
 */
const kumaMonitorSchema = z
  .object({
    name: z.string().optional(),
    type: z.string().optional(),
    url: z.string().nullable().optional(),
    hostname: z.string().nullable().optional(),
    port: z.number().nullable().optional(),
    active: z.boolean().optional(),
    forceInactive: z.boolean().optional(),
    interval: z.number().nullable().optional(),
    timeout: z.number().nullable().optional(),
    maxretries: z.number().nullable().optional(),
    // Kuma's grace period for a push monitor: how long after the interval a
    // missing ping is still tolerated. Same meaning as heartbeatGraceSeconds.
    retryInterval: z.number().nullable().optional(),
    method: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
    headers: z.string().nullable().optional(),
    maxredirects: z.number().nullable().optional(),
    accepted_statuscodes: z.array(z.string()).nullable().optional(),
    keyword: z.string().nullable().optional(),
    invertKeyword: z.boolean().nullable().optional(),
    jsonPath: z.string().nullable().optional(),
    expectedValue: z.string().nullable().optional(),
    dns_resolve_type: z.string().nullable().optional(),
    databaseConnectionString: z.string().nullable().optional(),
    upsideDown: z.boolean().nullable().optional(),
    ignoreTls: z.boolean().nullable().optional(),
    tags: z
      .array(z.object({ name: z.string().optional(), color: z.string().optional(), value: z.string().nullable().optional() }).passthrough())
      .nullable()
      .optional(),
  })
  .passthrough();

const kumaBackupSchema = z
  .object({
    version: z.string().optional(),
    monitorList: z.array(kumaMonitorSchema).default([]),
    notificationList: z
      .array(z.object({ name: z.string().optional(), type: z.string().optional(), active: z.boolean().optional(), config: z.string().optional() }).passthrough())
      .default([]),
  })
  .passthrough();

export type KumaConversion = {
  document: ConfigDocument;
  /** Things that were imported but changed shape on the way in. */
  warnings: string[];
  /** Things that were not imported at all, with the reason. */
  skipped: { name: string; reason: string }[];
};

/**
 * Kuma monitor type → StayUp monitor type. Absent means "StayUp has no
 * checker for this", which is a skip with a reason rather than a silent drop.
 */
const MONITOR_TYPE_MAP: Record<string, MonitorType> = {
  http: 'HTTP',
  keyword: 'HTTP',
  'json-query': 'HTTP',
  port: 'Port',
  ping: 'Ping',
  dns: 'DNS',
  postgres: 'Postgres',
  mysql: 'MySQL',
  redis: 'Redis',
  'grpc-keyword': 'gRPC',
  // Kuma's push monitor is exactly StayUp's Heartbeat monitor: the job calls
  // in and silence is the failure. The token is *not* carried across — it
  // addresses a different instance, and it is a credential — so an imported
  // one gets a fresh ping URL and a warning saying so.
  push: 'Heartbeat',
};

/** Why a Kuma type has no StayUp equivalent, in the operator's terms. */
const UNSUPPORTED_REASONS: Record<string, string> = {
  group: 'monitor groups have no equivalent — its children were imported individually',
  docker: 'Docker container checks need the Docker socket, which StayUp deliberately never takes',
  'real-browser': 'headless-browser checks are not supported',
  mongodb: 'MongoDB is not a supported monitor type',
  sqlserver: 'SQL Server is not a supported monitor type',
  mqtt: 'MQTT is not a supported monitor type',
  'kafka-producer': 'Kafka is not a supported monitor type',
  radius: 'RADIUS is not a supported monitor type',
  steam: 'Steam game-server checks are not supported',
  gamedig: 'game-server checks are not supported',
  snmp: 'SNMP is not a supported monitor type',
  'tailscale-ping': 'Tailscale ping is not a supported monitor type',
};

/** DNS record types StayUp can look up (see dnsRecordTypeEnum). */
const SUPPORTED_DNS_RECORDS = new Set(['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SRV']);

/**
 * Kuma stores an interval in seconds; StayUp offers a fixed ladder. Always
 * rounds *up* to the next rung: checking a third party more often than they
 * were being checked before is how an import earns someone a rate-limit ban.
 */
const INTERVAL_LADDER: [number, MonitorInterval][] = [
  [15, '15s'],
  [30, '30s'],
  [60, '60s'],
  [300, '5m'],
  [3600, '1h'],
  [43_200, '12h'],
  [86_400, '24h'],
];

export function intervalFromSeconds(seconds: number | null | undefined): MonitorInterval {
  if (!seconds || seconds <= 0) return '60s';
  return INTERVAL_LADDER.find(([bound]) => seconds <= bound)?.[1] ?? '24h';
}

/** Kuma notification type → StayUp integration type, and where its target lives. */
const NOTIFICATION_MAP: Record<string, { type: string; targetKey: string; secretKey?: string }> = {
  discord: { type: 'Discord', targetKey: 'discordWebhookUrl' },
  slack: { type: 'Slack', targetKey: 'slackwebhookURL' },
  webhook: { type: 'Webhook', targetKey: 'webhookURL' },
  telegram: { type: 'Telegram', targetKey: 'telegramChatID', secretKey: 'telegramBotToken' },
  PagerDuty: { type: 'PagerDuty', targetKey: 'pagerdutyIntegrationKey' },
  smtp: { type: 'Email', targetKey: 'smtpTo' },
};

// Same spec the monitor router validates against — a Kuma value that doesn't
// match is dropped rather than saved for the worker to choke on.
const STATUS_CODE_SPEC = /^\s*[1-5]\d{2}(\s*-\s*[1-5]\d{2})?(\s*,\s*[1-5]\d{2}(\s*-\s*[1-5]\d{2})?)*\s*$/;

export function parseUptimeKumaBackup(raw: unknown): KumaConversion {
  const parsed = kumaBackupSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("This doesn't look like an Uptime Kuma backup — expected a JSON object with a monitorList.");
  }

  const backup = parsed.data;
  const warnings: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  const tags = new Map<string, string>();
  const monitors: ConfigMonitor[] = [];

  for (const [index, source] of backup.monitorList.entries()) {
    const name = (source.name ?? '').trim() || `Unnamed monitor ${index + 1}`;
    const kumaType = (source.type ?? '').trim();

    const type = MONITOR_TYPE_MAP[kumaType];
    if (!type) {
      skipped.push({ name, reason: UNSUPPORTED_REASONS[kumaType] ?? `unsupported Uptime Kuma type "${kumaType}"` });
      continue;
    }

    const target = targetFor(type, source);
    // A Heartbeat monitor has no target by definition — it is the one type
    // that is called rather than calling.
    if (!target && type !== 'Heartbeat') {
      skipped.push({ name, reason: 'no usable host, URL or connection string in the backup' });
      continue;
    }

    const monitor: ConfigMonitor = {
      name,
      url: target ?? '',
      type,
      interval: intervalFromSeconds(source.interval),
      port: type === 'Port' || type === 'gRPC' ? source.port ?? null : source.port ?? null,
      // forceInactive is what Kuma sets on the children of a paused group;
      // both of them mean "not being checked".
      enabled: (source.active ?? true) && !(source.forceInactive ?? false),
      method: methodFor(source.method),
      requestHeaders: headersFor(name, source.headers, warnings),
      requestBody: type === 'HTTP' ? source.body?.trim() || null : null,
      followRedirects: (source.maxredirects ?? 10) > 0,
      expectedStatusCodes: statusCodesFor(name, source.accepted_statuscodes, warnings),
      keyword: null,
      keywordInverted: false,
      assertionType: 'Contains',
      jsonPath: null,
      dnsRecordType: 'A',
      dnsExpectedValue: null,
      sloTarget: null,
      // Kuma has no equivalent switch — every monitor there alerts — so an
      // imported one alerts too.
      autoIncidents: true,
      // Kuma's per-monitor timeout and retry count map exactly onto the
      // per-monitor overrides added for the same reason.
      httpTimeoutSeconds: clamp(source.timeout, 1, 300),
      failedAttemptsThreshold: clamp(source.maxretries, 1, 20),
      latencyThresholdMs: null,
      // Kuma's grace period is in seconds too, under a different name.
      heartbeatGraceSeconds: type === 'Heartbeat' ? clamp(source.retryInterval, 0, 86_400) : null,
      tags: tagsFor(source, tags),
      escalationPolicy: null,
      // Kuma's monitor groups are folders, not dependencies: a child of a
      // paused group is imported as paused (see `enabled` above), but nothing
      // in a Kuma backup says one monitor's failure explains another's.
      parent: null,
      credentialRequired: false,
    };

    if (type === 'Heartbeat') {
      warnings.push(`"${name}" was imported as a heartbeat monitor with a new ping URL — update whatever job calls it.`);
    }

    applyAssertion(kumaType, source, monitor, warnings);

    if (type === 'DNS') {
      const record = (source.dns_resolve_type ?? 'A').toUpperCase();
      if (!SUPPORTED_DNS_RECORDS.has(record)) {
        skipped.push({ name, reason: `StayUp cannot look up ${record} records` });
        continue;
      }
      monitor.dnsRecordType = record as ConfigMonitor['dnsRecordType'];
    }

    if (source.upsideDown) {
      warnings.push(`"${name}" used Kuma's upside-down mode, which has no equivalent — it now alerts on failure, not success.`);
    }
    if (source.ignoreTls) {
      warnings.push(`"${name}" ignored TLS errors. In StayUp that is instance-wide: Settings → Monitoring → SSL/TLS certificate check.`);
    }
    // `target` is only ever null for a Heartbeat monitor, which is not in
    // PASSWORD_BEARING — the ?? keeps the narrowing local rather than
    // widening hasInlineCredentials' contract.
    if (PASSWORD_BEARING.has(type) && !hasInlineCredentials(target ?? '')) {
      monitor.credentialRequired = true;
    }

    monitors.push(monitor);
  }

  const integrations = backup.notificationList.flatMap((notification) => {
    const name = (notification.name ?? '').trim();
    if (!name) return [];

    let config: Record<string, unknown> = {};
    try {
      config = notification.config ? (JSON.parse(notification.config) as Record<string, unknown>) : {};
    } catch {
      skipped.push({ name, reason: 'its notification config was not readable JSON' });
      return [];
    }

    const kumaType = String(config.type ?? notification.type ?? '');
    const mapping = NOTIFICATION_MAP[kumaType];
    if (!mapping) {
      skipped.push({ name, reason: `notification type "${kumaType}" has no StayUp equivalent` });
      return [];
    }

    const target = String(config[mapping.targetKey] ?? '').trim();
    if (!target) {
      skipped.push({ name, reason: `its ${kumaType} configuration had no ${mapping.targetKey}` });
      return [];
    }

    // Imported switched off, always. A half-migrated instance that starts
    // paging on-call is the one import mistake you cannot take back, so
    // enabling these stays a deliberate act.
    return [{ name, type: mapping.type, target, enabled: false, secretRequired: !!mapping.secretKey }];
  });

  if (integrations.length > 0) {
    warnings.push(
      `${integrations.length} notification${integrations.length === 1 ? ' was' : 's were'} imported switched off — check the target, add any token, then enable on the Integrations page.`,
    );
  }

  return {
    document: {
      stayup: { format: CONFIG_FORMAT_VERSION, version: `uptime-kuma ${backup.version ?? 'unknown'}` },
      tags: [...tags].map(([name, color]) => ({ name, color })),
      integrations,
      escalationPolicies: [],
      monitors,
      notificationRules: [],
      statusPages: [],
      maintenanceWindows: [],
    },
    warnings,
    skipped,
  };
}

/** Types whose check needs a password StayUp keeps in its own column. */
const PASSWORD_BEARING = new Set<MonitorType>(['Postgres', 'MySQL', 'Redis']);

/** True when a DSN already carries `user:password@`, so nothing has to be re-typed. */
function hasInlineCredentials(target: string): boolean {
  const authority = target.split('@')[0];
  return target.includes('@') && authority.includes(':', authority.indexOf('//') + 1);
}

/**
 * Where the thing being checked is written down differs per Kuma type: HTTP
 * monitors have a `url`, the connection-level ones a
 * `databaseConnectionString`, and the rest a bare `hostname`.
 */
function targetFor(type: MonitorType, source: z.infer<typeof kumaMonitorSchema>): string | null {
  if (type === 'Postgres' || type === 'MySQL' || type === 'Redis') {
    return source.databaseConnectionString?.trim() || source.hostname?.trim() || null;
  }
  if (type === 'HTTP' || type === 'gRPC') {
    return source.url?.trim() || source.hostname?.trim() || null;
  }
  return source.hostname?.trim() || source.url?.trim() || null;
}

function methodFor(method: string | null | undefined): ConfigMonitor['method'] {
  const upper = (method ?? 'GET').toUpperCase();
  const known = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
  return (known.includes(upper) ? upper : 'GET') as ConfigMonitor['method'];
}

function clamp(value: number | null | undefined, min: number, max: number): number | null {
  if (value === null || value === undefined) return null;
  const rounded = Math.round(value);
  if (rounded <= 0) return null;
  return Math.min(Math.max(rounded, min), max);
}

function headersFor(name: string, headers: string | null | undefined, warnings: string[]): string | null {
  const raw = headers?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const usable =
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.values(parsed).every((value) => typeof value === 'string');
    if (usable) return JSON.stringify(parsed);
  } catch {
    // falls through to the warning
  }
  warnings.push(`"${name}" had request headers StayUp can't store (it takes a flat JSON object of strings) — they were dropped.`);
  return null;
}

function statusCodesFor(name: string, codes: string[] | null | undefined, warnings: string[]): string | null {
  if (!codes || codes.length === 0) return null;
  const spec = codes.join(',');
  if (STATUS_CODE_SPEC.test(spec)) return spec;
  warnings.push(`"${name}" accepted status codes StayUp can't express ("${spec}") — it now treats any 2xx as up.`);
  return null;
}

/**
 * Kuma's three HTTP flavours are one StayUp type with different assertions:
 * `keyword` searches the body, `json-query` pulls a value out of it, and
 * plain `http` asserts nothing beyond the status code.
 */
function applyAssertion(
  kumaType: string,
  source: z.infer<typeof kumaMonitorSchema>,
  monitor: ConfigMonitor,
  warnings: string[],
): void {
  if (kumaType === 'keyword') {
    monitor.keyword = source.keyword?.trim() || null;
    monitor.keywordInverted = !!source.invertKeyword;
    monitor.assertionType = 'Contains';
    return;
  }

  if (kumaType !== 'json-query') return;

  // Kuma evaluates a JSONata expression; StayUp evaluates a dotted path. The
  // simple ones ("status", "$.data.ok") are the same thing written two ways,
  // and anything past that has to be rewritten by hand — with the monitor
  // still imported, because an up/down check is worth more than nothing.
  const expression = source.jsonPath?.trim();
  const candidate = expression && !expression.startsWith('$') ? `$.${expression}` : expression;

  if (candidate && validateJsonPath(candidate) === null) {
    monitor.assertionType = 'JsonPath';
    monitor.jsonPath = candidate;
    monitor.keyword = source.expectedValue?.trim() || null;
    return;
  }

  warnings.push(
    `"${monitor.name}" used a Kuma JSON query (${expression ?? 'empty'}) that doesn't translate to a StayUp JSON path — it was imported as a plain status-code check, so re-add the assertion by hand.`,
  );
}

/** Collects tag names (with their colours) while returning this monitor's own. */
function tagsFor(source: z.infer<typeof kumaMonitorSchema>, tags: Map<string, string>): string[] {
  const names: string[] = [];

  for (const tag of source.tags ?? []) {
    const base = (tag.name ?? '').trim();
    if (!base) continue;

    // Kuma tags can carry a per-monitor value ("env: prod"); StayUp tags are
    // just names, so the pair becomes one name rather than losing the half
    // that says which environment this is.
    const value = (tag.value ?? '').trim();
    const name = (value ? `${base}:${value}` : base).slice(0, 40);

    if (!tags.has(name)) {
      tags.set(name, /^#[0-9a-fA-F]{6}$/.test(tag.color ?? '') ? (tag.color as string) : '#7c3aed');
    }
    names.push(name);
  }

  return names;
}
