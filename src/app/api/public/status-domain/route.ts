// Resolves a Host header to a published status page's slug, for
// src/proxy.ts's custom-domain rewrite (a StatusPage.customDomain like
// "status.acme.com" transparently shows /status/[slug]).
//
// This lives behind a real Next.js route (Node.js runtime, can use Prisma
// directly) rather than being queried from inside the proxy itself — the
// proxy runs before routing and, like the session check in src/proxy.ts,
// talks to routes over loopback HTTP instead of importing the DB client.
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const host = request.nextUrl.searchParams.get('host')?.toLowerCase().trim();

  if (!host) {
    return NextResponse.json({ slug: null });
  }

  const page = await prisma.statusPage.findFirst({
    where: { customDomain: host, isPublished: true },
    select: { slug: true },
  });

  return NextResponse.json({ slug: page?.slug ?? null });
}
