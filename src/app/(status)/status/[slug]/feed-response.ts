// Shared handler behind /status/<slug>/feed.xml and /atom.xml — the two
// differ only in which renderer and content type they use.
import { NextResponse } from 'next/server';
import { TRPCError } from '@trpc/server';
import { caller } from '@/trpc/server';
import type { PublicStatusPage } from '@/trpc/routers/statuspage';
import { renderAtomFeed, renderRssFeed } from '@/lib/status-feed';

/**
 * Feed readers poll far more often than a person reloads a page, and an
 * incident feed changes only when someone posts an update.
 */
const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=900';

export async function statusFeedResponse(
  request: Request,
  { slug }: { slug: string },
  format: 'rss' | 'atom',
): Promise<NextResponse> {
  let page: PublicStatusPage;
  try {
    page = await caller.statusPage.getPublicBySlug({ slug });
  } catch (error) {
    // A login-gated page's feed would be a way around the gate, so it is a
    // 404 here rather than a redirect no reader could follow.
    if (error instanceof TRPCError && (error.code === 'NOT_FOUND' || error.code === 'UNAUTHORIZED')) {
      return new NextResponse('Not found', { status: 404 });
    }
    throw error;
  }

  // Built from the request rather than BETTER_AUTH_URL so the links stay on
  // whichever hostname the reader actually fetched from — a status page can
  // be served on its own custom domain (see src/proxy.ts).
  const requestUrl = new URL(request.url);
  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}/status/${slug}`;

  const body = format === 'atom' ? renderAtomFeed(page, baseUrl) : renderRssFeed(page, baseUrl);
  const contentType = format === 'atom' ? 'application/atom+xml' : 'application/rss+xml';

  return new NextResponse(body, {
    headers: { 'Content-Type': `${contentType}; charset=utf-8`, 'Cache-Control': CACHE_CONTROL },
  });
}
