// Embeddable SVG status badges:
//
//   /status/<slug>/badge/<componentId>.svg   one component
//   /status/<slug>/badge/<monitorId>.svg     the component backed by that monitor
//   /status/<slug>/badge/overall.svg         the page's overall status
//
// Query parameters:
//   ?metric=status|uptime   what the right-hand half shows (default: status)
//   ?label=Some%20text      override the left-hand half
//
// Served from the same procedure the page itself uses, so an unpublished page
// has no badge and a login-gated one doesn't leak its state to an anonymous
// <img> — both come back as 404.
import { NextResponse } from 'next/server';
import { TRPCError } from '@trpc/server';
import { caller } from '@/trpc/server';
import type { ComponentStatus, PublicComponentView, PublicStatusPage } from '@/trpc/routers/statuspage';
import { renderBadge, uptimeColor, type BadgeColor } from '@/lib/badge';

const STATUS_COLORS: Record<ComponentStatus, BadgeColor> = {
  Operational: 'brightgreen',
  Degraded: 'yellow',
  Outage: 'red',
  Maintenance: 'blue',
};

const STATUS_MESSAGES: Record<ComponentStatus, string> = {
  Operational: 'operational',
  Degraded: 'degraded',
  Outage: 'outage',
  Maintenance: 'maintenance',
};

/**
 * A minute is short enough that a badge is not visibly stale and long enough
 * that a popular README doesn't turn every viewer into a database query.
 * stale-while-revalidate keeps a CDN serving the old badge while it refreshes.
 */
const CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';

function svg(body: string): NextResponse {
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
    },
  });
}

function findComponent(page: PublicStatusPage, id: string): PublicComponentView | null {
  for (const group of page.groups) {
    for (const component of group.components) {
      // Accept the monitor's id too: it's the id someone has to hand when
      // they're looking at the monitor in the dashboard, and the URL shape
      // people expect.
      if (component.id === id || component.monitorId === id) return component;
    }
  }
  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; component: string }> },
) {
  const { slug, component: rawComponent } = await params;
  // The .svg suffix is conventional for an embedded image and makes some
  // renderers happier; it isn't part of the id.
  const componentId = rawComponent.replace(/\.svg$/i, '');

  let page: PublicStatusPage;
  try {
    page = await caller.statusPage.getPublicBySlug({ slug });
  } catch (error) {
    if (error instanceof TRPCError && (error.code === 'NOT_FOUND' || error.code === 'UNAUTHORIZED')) {
      return new NextResponse('Not found', { status: 404 });
    }
    throw error;
  }

  const url = new URL(request.url);
  const metric = url.searchParams.get('metric') === 'uptime' ? 'uptime' : 'status';
  const labelOverride = url.searchParams.get('label');

  if (componentId === 'overall') {
    // The page-level status has three states, not four — maintenance is per
    // component (see computeOverallStatus).
    const color: BadgeColor =
      page.overallStatus === 'Outage' ? 'red' : page.overallStatus === 'Degraded' ? 'yellow' : 'brightgreen';
    return svg(
      renderBadge({
        label: labelOverride ?? page.name,
        message: page.overallStatus.toLowerCase(),
        color,
      }),
    );
  }

  const found = findComponent(page, componentId);
  if (!found) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (metric === 'uptime') {
    // A manual component was never measured, so there is no honest number to
    // put on a badge — say so rather than inventing 100%.
    if (found.uptime === null) {
      return svg(renderBadge({ label: labelOverride ?? found.name, message: 'not measured', color: 'grey' }));
    }
    return svg(
      renderBadge({
        label: labelOverride ?? found.name,
        message: `${found.uptime.toFixed(2)}%`,
        color: uptimeColor(found.uptime),
      }),
    );
  }

  return svg(
    renderBadge({
      label: labelOverride ?? found.name,
      message: STATUS_MESSAGES[found.status],
      color: STATUS_COLORS[found.status],
    }),
  );
}
