import { notFound } from 'next/navigation';
import { TRPCError } from '@trpc/server';
import StatusPageClient from '@/app/(status)/status/[slug]/status-page-client';
import { caller } from '@/trpc/server';

interface StatusPageRouteProps {
  params: Promise<{ slug: string }>;
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
    throw error;
  }
}
