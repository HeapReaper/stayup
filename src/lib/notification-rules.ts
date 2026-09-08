// Notification routing for monitors that don't have an escalation policy.
//
// Without any rules the behaviour is what it always was: every incident
// broadcasts to every enabled Integration. With rules, the first enabled one
// (by `order`) that applies decides instead — which is how "staging alerts
// only during office hours, and only to #dev" becomes one row rather than a
// second instance.
//
// Mirrored by worker/internal/routing. The dashboard's manual incident
// actions route through this copy and the workers' automatic ones through
// that copy, so the two must agree or the same incident notifies different
// people depending on who opened it.

export type NotificationRuleAction = 'Route' | 'Suppress';

export interface NotificationRuleRef {
  id: string;
  name: string;
  order: number;
  action: string;
  matchTagId: string | null;
  matchMonitorId: string | null;
  matchImpact: string | null;
  /** Comma-separated ISO weekdays ("1,2,3,4,5"); null means every day. */
  activeDays: string | null;
  /** Minutes since local midnight; both null means "always". */
  activeFromMinute: number | null;
  activeUntilMinute: number | null;
  integrationIds: string[];
}

/** What the incident being routed is, as far as matching is concerned. */
export interface RoutingContext {
  monitorId: string | null;
  monitorTagIds: string[];
  impact: string | null;
}

export type RoutingDecision =
  /** No rule applied — the default, unchanged behaviour. */
  | { kind: 'Broadcast' }
  /** A Route rule applied: notify exactly these integrations. */
  | { kind: 'Route'; integrationIds: string[]; rule: NotificationRuleRef }
  /** Quiet hours, or a Route rule outside its window: notify nobody. */
  | { kind: 'Suppress'; rule: NotificationRuleRef; reason: string };

/**
 * Picks what to do with one incident notification.
 *
 * A Suppress rule only applies *inside* its window — outside it the rule is
 * not considered at all and evaluation continues, so a quiet-hours rule is
 * silent at night and invisible by day. A Route rule applies whenever its
 * match clauses hold, and its window then decides between its integrations
 * and nobody; that asymmetry is what makes "only during office hours" mean
 * "and nothing outside them".
 */
export function decideRouting(
  rules: NotificationRuleRef[],
  context: RoutingContext,
  now: Date,
  timezone: string,
): RoutingDecision {
  const ordered = [...rules].sort((a, b) => a.order - b.order);

  for (const rule of ordered) {
    if (!ruleMatches(rule, context)) continue;

    const inWindow = isWithinWindow(rule, now, timezone);

    if (rule.action === 'Suppress') {
      if (inWindow) {
        return { kind: 'Suppress', rule, reason: `quiet hours rule "${rule.name}" is active` };
      }
      continue;
    }

    if (!inWindow) {
      return { kind: 'Suppress', rule, reason: `rule "${rule.name}" only notifies inside its active window` };
    }
    return { kind: 'Route', integrationIds: rule.integrationIds, rule };
  }

  return { kind: 'Broadcast' };
}

/** Every match clause that is set must hold; all null matches everything. */
export function ruleMatches(rule: NotificationRuleRef, context: RoutingContext): boolean {
  if (rule.matchMonitorId && rule.matchMonitorId !== context.monitorId) return false;
  if (rule.matchTagId && !context.monitorTagIds.includes(rule.matchTagId)) return false;
  if (rule.matchImpact && rule.matchImpact !== context.impact) return false;
  return true;
}

/**
 * Whether `now` falls inside the rule's active window, evaluated against the
 * instance timezone. A window whose end is before its start wraps past
 * midnight (22:00–06:00), and the weekday is matched against the day the
 * window *started* — so a Monday 22:00–06:00 window still covers Tuesday
 * 02:00.
 */
export function isWithinWindow(rule: NotificationRuleRef, now: Date, timezone: string): boolean {
  const hasDays = !!rule.activeDays;
  const hasHours = rule.activeFromMinute !== null && rule.activeUntilMinute !== null;
  if (!hasDays && !hasHours) return true;

  const { isoWeekday, minuteOfDay } = localMoment(now, timezone);
  const days = parseDays(rule.activeDays);

  if (!hasHours) return days === null || days.includes(isoWeekday);

  const from = rule.activeFromMinute as number;
  const until = rule.activeUntilMinute as number;

  if (from <= until) {
    if (days !== null && !days.includes(isoWeekday)) return false;
    return minuteOfDay >= from && minuteOfDay < until;
  }

  // Wrapped window: the tail after midnight belongs to the previous day.
  if (minuteOfDay >= from) {
    return days === null || days.includes(isoWeekday);
  }
  if (minuteOfDay < until) {
    const previousDay = isoWeekday === 1 ? 7 : isoWeekday - 1;
    return days === null || days.includes(previousDay);
  }
  return false;
}

function parseDays(activeDays: string | null): number[] | null {
  if (!activeDays) return null;
  const days = activeDays
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
  return days.length > 0 ? days : null;
}

const ISO_WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatterCache = new Map<string, Intl.DateTimeFormat>();

/** The weekday and minute-of-day `now` reads as in the instance timezone. */
function localMoment(now: Date, timezone: string): { isoWeekday: number; minuteOfDay: number } {
  const parts = formatterFor(timezone).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';

  return {
    isoWeekday: ISO_WEEKDAYS[get('weekday')] ?? 1,
    minuteOfDay: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = build(timezone);
  } catch {
    // AppSettings.timezone is free text; an unknown zone must not take
    // notifications down, so fall back the way the Go side does.
    formatter = build('UTC');
  }
  formatterCache.set(timezone, formatter);
  return formatter;
}

function build(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
}
