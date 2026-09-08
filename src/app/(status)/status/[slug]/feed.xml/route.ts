import { statusFeedResponse } from '@/app/(status)/status/[slug]/feed-response';

/** RSS 2.0 incident feed — /status/<slug>/feed.xml */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return statusFeedResponse(request, await params, 'rss');
}
