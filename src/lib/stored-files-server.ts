// The server half of uploaded-file handling. Split from src/lib/stored-files.ts
// because that module is imported by a client component (the upload control
// needs the size cap and the accepted types) and must therefore stay free of
// Prisma — the same split as monitor-types.ts / report-range.ts.
import { prisma } from '@/lib/prisma';
import { storedFileIdFromUrl } from '@/lib/stored-files';

/**
 * Deletes the uploaded file a field pointed at, when that field stops pointing
 * at it — a replaced status page logo, a replaced profile picture, or the
 * whole record going away (`next` omitted).
 *
 * Nothing else can do this for us: `StatusPage.logoUrl` and `User.image` hold
 * a URL, not a foreign key (the second one is better-auth's own column), so
 * there is no cascade to lean on. Uploads that were never referenced at all
 * are a different problem, swept by cmd/janitor's PruneOrphanFiles.
 *
 * Deliberately non-fatal: an image that outlives its owner by a day until the
 * janitor gets to it is a rounding error, while a failed save because a
 * cleanup failed is a bug someone has to work around.
 */
export async function forgetStoredFile(previous: string | null | undefined, next?: string | null) {
  const id = storedFileIdFromUrl(previous);
  if (!id || storedFileIdFromUrl(next) === id) return;

  try {
    // deleteMany, not delete: the row may already be gone (two saves racing,
    // or the janitor got there first), which is not worth an exception.
    await prisma.storedFile.deleteMany({ where: { id } });
  } catch {
    /* see above: the janitor will sweep it */
  }
}
