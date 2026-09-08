import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { TRPCError } from '@trpc/server';
import StatusPageClient from '@/app/(status)/status/[slug]/status-page-client';
import { caller } from '@/trpc/server';

interface StatusPageRouteProps {
  params: Promise<{ slug: string }>;
}

/**
 * Feed autodiscovery: the <link rel="alternate"> tags a reader looks for when
 * someone pastes the page's own URL into it, rather than the feed's.
 */
export async function generateMetadata({ params }: StatusPageRouteProps): Promise<Metadata> {
  const { slug } = await params;

  return {
    alternates: {
      types: {
        'application/rss+xml': [{ url: `/status/${slug}/feed.xml`, title: 'Incident feed (RSS)' }],
        'application/atom+xml': [{ url: `/status/${slug}/atom.xml`, title: 'Incident feed (Atom)' }],
      },
    },
  };
}

export default async function StatusPageRoute({ params }: StatusPageRouteProps) {
  const { slug } = await params;

  try {
    const page = await caller.statusPage.getPublicBySlug({ slug });
    return <StatusPageClient slug={slug} initialData={page} />;
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'NOT_FOUND') {
      notFound();
    }
    if (error instanceof TRPCError && error.code === 'UNAUTHORIZED') {
      redirect(`/login?callbackUrl=${encodeURIComponent(`/status/${slug}`)}`);
    }
    throw error;
  }
}
