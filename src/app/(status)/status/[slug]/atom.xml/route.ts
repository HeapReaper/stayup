import { statusFeedResponse } from '@/app/(status)/status/[slug]/feed-response';

/** Atom 1.0 incident feed — /status/<slug>/atom.xml */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return statusFeedResponse(request, await params, 'atom');
}
