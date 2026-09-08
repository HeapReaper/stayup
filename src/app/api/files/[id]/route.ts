import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Serves an uploaded file.
 *
 * Unauthenticated by necessity: a public status page's logo is loaded by
 * visitors who have no session, and gating it would mean a broken image on
 * every page this feature exists for. The id is a cuid, so URLs aren't
 * guessable, and the only things stored here are logos and profile pictures —
 * nothing that isn't already on a page somebody can open.
 *
 * Rows are immutable (replacing a logo writes a new row), so the response can
 * be cached forever and a revalidation costs one 304.
 */
export const dynamic = 'force-dynamic';

const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const file = await prisma.storedFile.findUnique({
    where: { id },
    select: { data: true, contentType: true, filename: true, checksum: true, size: true },
  });

  if (!file) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const etag = `"${file.checksum}"`;
  // A conditional request costs a row read either way — the win is not
  // shipping the bytes, which is the whole point on a status page that a
  // monitoring dashboard reloads every 30 seconds.
  if (request.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, 'Cache-Control': CACHE_CONTROL } });
  }

  return new NextResponse(new Uint8Array(file.data), {
    status: 200,
    headers: {
      'Content-Type': file.contentType,
      'Content-Length': String(file.size),
      'Content-Disposition': `inline; filename="${file.filename}"`,
      'Cache-Control': CACHE_CONTROL,
      ETag: etag,
      // The upload route only ever stores a sniffed raster image, so these two
      // are belt-and-braces: nosniff stops a browser second-guessing the type
      // it was given, and a CSP that allows nothing means even a file that
      // somehow got in as HTML can't load a script, a frame or a fetch.
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
