// Shared plumbing for the public REST API (src/app/api/v1).
//
// AppSettings.apiKey has existed — and been regeneratable from the Settings
// page — since the beginning, with nothing to authenticate: there was a
// "regenerate" button for an API that didn't exist. This is that API's front
// door.
//
// Scope, deliberately: one instance-wide key, no per-user tokens and no
// scopes. StayUp is single-tenant by construction (AppSettings is a singleton,
// invariant 7), so a key is "this instance", and the thing it buys is
// provisioning — Terraform, Ansible, a shell script that creates the same
// twelve monitors on every new environment — which is the same audience
// src/lib/config-transfer.ts already serves through the dashboard.
//
// What that means for authorization: a valid key can do anything a Member can
// (src/lib/permissions.ts). It deliberately cannot manage users or change
// instance settings — the two capabilities that let someone lock everyone out
// or reroute every alert, and the two that should stay behind a human login.
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { getSettings } from '@/lib/settings';
import { logger } from '@/lib/logging';
import type { MonitorActor } from '@/trpc/routers/monitor';

/** Name recorded in the audit log for anything done through the API. */
export const API_ACTOR_NAME = 'API key';

export interface ApiRequestContext {
  /** Who to blame in the audit log — an API key is not a person, so `id` is null. */
  actor: MonitorActor;
}

/**
 * Compares two secrets without leaking their contents through how long the
 * comparison took.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself be an
 * oracle, so both sides are hashed to a fixed 32 bytes first — comparing
 * digests answers the same question in constant time regardless of what was
 * presented.
 */
function secretsMatch(presented: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;

  const [scheme, ...rest] = header.split(' ');
  if (scheme.toLowerCase() !== 'bearer') return null;

  const token = rest.join(' ').trim();
  return token || null;
}

/** Behind a proxy the real client address is in x-forwarded-for; audit-only, same as tRPC's context. */
function ipAddressOf(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * Authenticates one API request.
 *
 * Returns the caller's context on success, or the response to send back on
 * failure — so a route handler is one `if` away from being safe, rather than
 * having to remember to check a boolean.
 */
export async function authenticateApiRequest(request: Request): Promise<ApiRequestContext | NextResponse> {
  const presented = bearerToken(request);
  if (!presented) {
    return apiError(401, 'Missing API key. Send it as: Authorization: Bearer <key>');
  }

  const { apiKey } = await getSettings();
  if (!secretsMatch(presented, apiKey)) {
    // Deliberately the same message as a missing key, and deliberately not
    // logged with the presented value: a log of rejected keys is a log of
    // near-miss secrets.
    logger.warn(`[API] Rejected a request to ${new URL(request.url).pathname} with an invalid key`);
    return apiError(401, 'Invalid API key');
  }

  return { actor: { id: null, name: API_ACTOR_NAME, ipAddress: ipAddressOf(request) } };
}

/** A JSON error body in the one shape every endpoint here uses. */
export function apiError(status: number, message: string, details?: unknown): NextResponse {
  return NextResponse.json(details === undefined ? { error: message } : { error: message, details }, { status });
}

/**
 * Maps the errors the shared mutation functions throw onto status codes.
 *
 * Those functions are also the tRPC router's implementation, so they speak
 * TRPCError — mapping it here is what lets one implementation serve both
 * doors without either learning about the other's error type.
 */
export function apiErrorFrom(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return apiError(422, 'Validation failed', error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })));
  }

  if (error instanceof TRPCError) {
    // Only the codes the shared mutations actually raise. Anything else is a
    // surprise, and a 500 is the honest answer to one.
    const statuses: Partial<Record<TRPCError['code'], number>> = {
      NOT_FOUND: 404,
      BAD_REQUEST: 400,
      FORBIDDEN: 403,
      UNAUTHORIZED: 401,
      CONFLICT: 409,
    };
    return apiError(statuses[error.code] ?? 500, error.message);
  }

  // Anything else is a bug rather than a client mistake: say so in the logs
  // with the detail, and say nothing of substance in the response.
  logger.error('[API] Unhandled error', error);
  return apiError(500, 'Internal server error');
}

/** Parses a JSON request body, treating an empty one as `{}`. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const raw = (await request.text()).trim();
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A malformed body is the caller's mistake, not a server fault — say 400
    // rather than letting apiErrorFrom treat a SyntaxError as a bug.
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request body is not valid JSON' });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request body must be a JSON object' });
  }
  return parsed as Record<string, unknown>;
}

/**
 * What the API includes when it reads a monitor. Kept here rather than in the
 * route so every monitor endpoint reads the same relations — a field the
 * serializer needs but a route forgot to include is a runtime error, not a
 * type error.
 */
export const API_MONITOR_RELATIONS = {
  tags: { include: { tag: true } },
  escalationPolicy: { select: { id: true, name: true } },
  parent: { select: { id: true, name: true, status: true } },
} as const;

/**
 * The API's monitor shape.
 *
 * Deliberately not serializeMonitor() from the router: that one is shaped for
 * the dashboard (it flattens tags, adds parentDown, spreads the whole Prisma
 * row) and is free to change whenever a page needs something else. This one
 * is a published contract, so it names its fields explicitly — adding a
 * column to the schema must not silently widen the API, and renaming
 * something in the UI must not silently break somebody's script.
 */
export function serializeApiMonitor(monitor: {
  id: string;
  name: string;
  url: string;
  type: string;
  status: string;
  interval: string;
  port: number | null;
  enabled: boolean;
  uptime: number;
  responseTime: number | null;
  lastCheckedAt: Date | null;
  certExpiresAt: Date | null;
  domainExpiresAt: Date | null;
  flappingSince: Date | null;
  sloTarget: number | null;
  autoIncidents: boolean;
  heartbeatToken: string | null;
  heartbeatGraceSeconds: number | null;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  tags: { tag: { name: string } }[];
  escalationPolicy: { id: string; name: string } | null;
  parent: { id: string; name: string; status: string } | null;
}) {
  return {
    id: monitor.id,
    name: monitor.name,
    url: monitor.url,
    type: monitor.type,
    status: monitor.status,
    interval: monitor.interval,
    port: monitor.port,
    enabled: monitor.enabled,
    uptime: monitor.uptime,
    responseTimeMs: monitor.responseTime,
    lastCheckedAt: monitor.lastCheckedAt?.toISOString() ?? null,
    certExpiresAt: monitor.certExpiresAt?.toISOString() ?? null,
    domainExpiresAt: monitor.domainExpiresAt?.toISOString() ?? null,
    flappingSince: monitor.flappingSince?.toISOString() ?? null,
    sloTarget: monitor.sloTarget,
    autoIncidents: monitor.autoIncidents,
    // The token is the credential a provisioning script needs back: it is
    // what goes on the end of the cron line it is about to write.
    heartbeatToken: monitor.heartbeatToken,
    heartbeatGraceSeconds: monitor.heartbeatGraceSeconds,
    parentId: monitor.parentId,
    parentName: monitor.parent?.name ?? null,
    escalationPolicyId: monitor.escalationPolicy?.id ?? null,
    tags: monitor.tags.map(({ tag }) => tag.name),
    createdAt: monitor.createdAt.toISOString(),
    updatedAt: monitor.updatedAt.toISOString(),
  };
}

