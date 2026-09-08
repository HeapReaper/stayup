// Who is on call, and when. Mirrored by worker/internal/oncall — that Go copy
// is what actually pages (EscalateOverdueIncidents); this one answers the
// dashboard's "who has the pager right now" and renders the upcoming shifts,
// so the two must agree or the schedule page lies about who gets woken up.
//
// Nothing precomputes a calendar: a shift is derived from the rotation's
// anchor every time it's asked for, so reordering participants or fixing the
// handoff hour takes effect immediately rather than from the next handoff.

export type RotationType = 'Daily' | 'Weekly';

export interface OnCallParticipantRef {
  id: string;
  name: string;
  order: number;
  integrationId: string;
}

export interface OnCallOverrideRef {
  startsAt: Date;
  endsAt: Date;
  /** null means "nobody covers this window" — paging falls through. */
  participantId: string | null;
  reason: string | null;
}

export interface OnCallScheduleRef {
  timezone: string;
  rotationType: string;
  handoffHour: number;
  handoffDay: number;
  startsAt: Date;
  participants: OnCallParticipantRef[];
  overrides: OnCallOverrideRef[];
}

export interface OnCallResolution {
  participant: OnCallParticipantRef | null;
  /** True when an override decided this, rather than the rotation. */
  overridden: boolean;
  /** Why nobody holds the pager, when `participant` is null. */
  reason: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves who holds the pager at `at`. An override covering that instant
 * always wins — including an override with no participant, which deliberately
 * resolves to nobody so the escalation chain moves to its next step instead
 * of paging someone who is away.
 */
export function resolveOnCallAt(schedule: OnCallScheduleRef, at: Date): OnCallResolution {
  const participants = [...schedule.participants].sort((a, b) => a.order - b.order);

  const override = schedule.overrides.find((o) => at >= o.startsAt && at < o.endsAt);
  if (override) {
    if (!override.participantId) {
      return { participant: null, overridden: true, reason: override.reason || 'Covered by an override with nobody on call' };
    }
    const covering = participants.find((p) => p.id === override.participantId);
    if (covering) return { participant: covering, overridden: true, reason: null };
    // The override points at a participant who has since been removed from
    // the roster; fall through to the rotation rather than paging nobody.
  }

  if (participants.length === 0) {
    return { participant: null, overridden: false, reason: 'This schedule has no participants yet' };
  }

  const index = rotationIndexAt(schedule, at, participants.length);
  return { participant: participants[index], overridden: false, reason: null };
}

/**
 * Which slot of the rotation `at` falls in, counted from the schedule's anchor.
 *
 * Counted in whole handoff boundaries rather than by dividing elapsed time by
 * a fixed period: a local day is 23 or 25 hours across a DST transition, so
 * duration arithmetic drifts a slot every spring and autumn while the
 * boundaries themselves stay pinned to the local wall clock.
 */
export function rotationIndexAt(schedule: OnCallScheduleRef, at: Date, participantCount: number): number {
  if (participantCount <= 0) return 0;

  const epoch = previousHandoff(schedule, schedule.startsAt);
  if (at < epoch) return 0;

  const periods = periodsBetween(schedule, epoch, previousHandoff(schedule, at));
  return ((periods % participantCount) + participantCount) % participantCount;
}

/** When the shift covering `at` ends — i.e. the next handoff after it. */
export function shiftEndAt(schedule: OnCallScheduleRef, at: Date): Date {
  const current = zonedParts(previousHandoff(schedule, at), schedule.timezone);
  const step = schedule.rotationType === 'Daily' ? 1 : 7;

  // Resolving the wall clock in the zone (rather than adding milliseconds)
  // keeps the next handoff on the same local hour across a DST change.
  return fromZonedWallClock(
    { year: current.year, month: current.month, day: current.day + step, hour: schedule.handoffHour },
    schedule.timezone,
  );
}

/** Handoffs between two boundaries, counted in calendar days in the schedule's zone. */
function periodsBetween(schedule: OnCallScheduleRef, from: Date, to: Date): number {
  const days = civilDays(to, schedule.timezone) - civilDays(from, schedule.timezone);
  if (schedule.rotationType === 'Daily') return days;
  // Both boundaries land on handoffDay, so this is always a whole number.
  return Math.round(days / 7);
}

/**
 * The day number of an instant's *local* date, ignoring its time and offset.
 * Subtracting two of these gives the exact number of calendar days between
 * them, which elapsed-millisecond arithmetic cannot do across a DST change.
 */
function civilDays(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  return Math.round(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

/**
 * The most recent handoff boundary at or before `from`, as an instant.
 * Boundaries are wall-clock in the schedule's own zone (09:00 Monday means
 * 09:00 Amsterdam, whatever the server runs as), which is the whole reason
 * OnCallSchedule carries a timezone of its own.
 */
function previousHandoff(schedule: OnCallScheduleRef, from: Date): Date {
  const parts = zonedParts(from, schedule.timezone);

  let daysBack = 0;
  if (schedule.rotationType !== 'Daily') {
    // ISO weekday 1-7; walk back to the most recent handoff day.
    daysBack = (parts.isoWeekday - schedule.handoffDay + 7) % 7;
  }
  // Before today's handoff hour, the boundary is a whole period earlier.
  if (daysBack === 0 && parts.hour < schedule.handoffHour) {
    daysBack = schedule.rotationType === 'Daily' ? 1 : 7;
  }

  const boundary = new Date(from.getTime() - daysBack * DAY_MS);
  const boundaryParts = zonedParts(boundary, schedule.timezone);

  return fromZonedWallClock(
    { year: boundaryParts.year, month: boundaryParts.month, day: boundaryParts.day, hour: schedule.handoffHour },
    schedule.timezone,
  );
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  isoWeekday: number;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = partsFormatterCache.get(timeZone);
  if (cached) return cached;

  // An unknown zone would otherwise throw on every resolution; UTC is the
  // same fallback the Go side takes for a zone tzdata doesn't know.
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = buildFormatter(timeZone);
  } catch {
    formatter = buildFormatter('UTC');
  }
  partsFormatterCache.set(timeZone, formatter);
  return formatter;
}

function buildFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
}

const ISO_WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** The wall-clock parts an instant has in `timeZone`. */
function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    isoWeekday: ISO_WEEKDAYS[get('weekday')] ?? 1,
  };
}

/**
 * The inverse of zonedParts: the instant at which `timeZone`'s wall clock
 * reads the given date and hour. Solved by guessing UTC and correcting by the
 * offset that guess turns out to have — twice, because the first correction
 * can itself cross a DST transition.
 */
function fromZonedWallClock(
  wall: { year: number; month: number; day: number; hour: number },
  timeZone: string,
): Date {
  const target = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, 0, 0, 0);

  let guess = target;
  for (let i = 0; i < 2; i += 1) {
    const parts = zonedParts(new Date(guess), timeZone);
    const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    const drift = target - actual;
    if (drift === 0) break;
    guess += drift;
  }
  return new Date(guess);
}
