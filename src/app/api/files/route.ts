import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logging';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  humanBytes,
  sniffImageType,
  storedFileUrl,
} from '@/lib/stored-files';

/**
 * File upload: `multipart/form-data` with one `file` field, answering with the
 * URL to store on whatever the file is for (a status page's `logoUrl`, a
 * user's `image`).
 *
 * A route handler rather than a tRPC mutation because the payload is bytes:
 * tRPC would mean base64 in a JSON envelope — a third bigger over the wire,
 * fully buffered as a string on both sides — for a request the platform
 * already parses natively.
 *
 * Any signed-in user may upload, because anyone may change their own profile
 * picture. That is deliberately weaker than the capability needed to *attach*
 * one to something shared: a Viewer can upload bytes but cannot save a status
 * page, and an upload that never gets attached is swept by cmd/janitor.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart form upload' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Attach a file in the "file" field' }, { status: 400 });
  }

  // Checked before reading the body into memory: File.size comes from the
  // parsed multipart part, so this rejects an oversized upload without
  // holding all of it.
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `That file is ${humanBytes(file.size)}; the limit is ${humanBytes(MAX_UPLOAD_BYTES)}` },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // The bytes decide the type, and the type they claim has to be one we allow.
  // Both checks matter: the first stops a renamed executable, the second stops
  // a perfectly valid TIFF nobody asked for.
  const detected = sniffImageType(bytes);
  if (!detected) {
    return NextResponse.json(
      { error: `That file is not a ${ALLOWED_IMAGE_TYPES.map((type) => type.replace('image/', '')).join(', ')} image` },
      { status: 415 },
    );
  }

  const stored = await prisma.storedFile.create({
    data: {
      // Never used as a filesystem path — it only lands in a
      // Content-Disposition header — but a name with control characters or
      // quotes in it would break that header, so keep it plain.
      filename: (file.name || `upload.${detected.replace('image/', '')}`).replace(/[^\w.\- ]+/g, '_').slice(0, 120),
      contentType: detected,
      size: bytes.byteLength,
      data: Buffer.from(bytes),
      checksum: createHash('sha256').update(bytes).digest('hex'),
      uploadedById: session.user.id,
    },
    select: { id: true, filename: true, contentType: true, size: true },
  });

  logger.info(
    `[Files] ${session.user.email} uploaded ${stored.filename} (${stored.contentType}, ${humanBytes(stored.size)}) as ${stored.id}`,
  );

  return NextResponse.json({ ...stored, url: storedFileUrl(stored.id) }, { status: 201 });
}
