// Monitor dependencies — `Monitor.parentId`.
//
// failedAttemptsThreshold debounces one monitor's dip and flapping detection
// catches one monitor changing its mind; neither helps when the *router*
// dies and the thirty monitors behind it all go Down at once, each opening
// its own incident and paging separately. A parent that is Down suppresses
// its children's incidents the same way a maintenance window does — checks
// are still written, statuses still flip, the graphs still show the outage —
// so the page you get names the actual cause.
//
// Mirrors worker/internal/dependencies (invariant 1 in AGENTS.md): the
// workers ask the same question on every failing check, this side answers it
// for the dashboard and enforces the shape of the graph on write.
import { prisma } from '@/lib/prisma';

/**
 * How deep a chain may be walked. There is no cycle in a well-formed graph
 * (setParent refuses to make one), but a hand-edited database row shouldn't
 * be able to hang a worker tick, and nobody has a dependency chain thirty
 * deep on purpose.
 *
 * Must stay in step with maxDependencyDepth in worker/internal/dependencies.
 */
export const MAX_DEPENDENCY_DEPTH = 30;

/**
 * True when any monitor above this one in the chain is currently Down.
 *
 * The whole chain, not just the immediate parent: if the site sits behind a
 * load balancer that sits behind the router, the router going down has to
 * silence both. Only "Down" counts — a Degraded parent is still serving, so
 * a child failing underneath it is news.
 */
export async function isAncestorDown(monitorId: string): Promise<boolean> {
  const seen = new Set<string>([monitorId]);
  let currentId = monitorId;

  for (let depth = 0; depth < MAX_DEPENDENCY_DEPTH; depth++) {
    const current = await prisma.monitor.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    if (!current?.parentId) return false;

    const parent = await prisma.monitor.findUnique({
      where: { id: current.parentId },
      select: { id: true, status: true, enabled: true },
    });
    // A paused parent is not evidence of anything: no worker is checking it,
    // so its last-known status is however it happened to be left.
    if (!parent || !parent.enabled) return false;
    if (parent.status === 'Down') return true;

    // Only reachable from a hand-edited row; stop rather than loop forever.
    if (seen.has(parent.id)) return false;
    seen.add(parent.id);
    currentId = parent.id;
  }

  return false;
}

/**
 * Whether making `parentId` the parent of `monitorId` would close a loop —
 * either directly (a monitor as its own parent) or through the chain above
 * the proposed parent.
 *
 * A cycle is worth refusing rather than tolerating: two monitors that are
 * each other's parent would suppress each other's incidents the moment
 * either went Down, which is an outage nobody hears about.
 */
export async function wouldCreateDependencyCycle(monitorId: string, parentId: string): Promise<boolean> {
  if (monitorId === parentId) return true;

  const seen = new Set<string>([parentId]);
  let currentId: string | null = parentId;

  for (let depth = 0; depth < MAX_DEPENDENCY_DEPTH && currentId; depth++) {
    const current: { parentId: string | null } | null = await prisma.monitor.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    if (!current?.parentId) return false;
    if (current.parentId === monitorId) return true;
    if (seen.has(current.parentId)) return false;

    seen.add(current.parentId);
    currentId = current.parentId;
  }

  return false;
}
