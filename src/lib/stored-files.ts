// Shared rules for uploaded files (status page logos, profile pictures).
//
// Prisma-free on purpose — same reason as src/lib/monitor-types.ts and
// src/lib/report-range.ts: the upload control is a client component and needs
// the size cap and the accepted types to pre-check a file and to fill the
// <input accept="...">. The server re-checks everything anyway (see
// src/app/api/files/route.ts); these constants exist so the two never disagree
// about what "too big" means.

/**
 * Raster formats only, and deliberately no SVG: an SVG is a script host, and
 * these files are served from the app's own origin — a logo could then run
 * JavaScript with the dashboard's cookies. Every other vector of the same
 * problem is closed by nosniff + a locked-down CSP on the file route, but the
 * only safe answer for SVG itself is not to accept it.
 */
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** For an <input type="file"> — a hint to the picker, never a check. */
export const IMAGE_ACCEPT_ATTRIBUTE = ALLOWED_IMAGE_TYPES.join(',');

/**
 * 2 MB. These are icons and avatars: a 40×40 logo needs a few KB, and the
 * bytes live in a database row that every backup carries. Generous enough for
 * an unoptimized PNG straight out of a design tool, small enough that nobody
 * has to think about it.
 */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** Where the file route lives. One definition: it ends up inside stored URLs. */
export const FILE_URL_PREFIX = '/api/files/';

export function storedFileUrl(id: string): string {
  return `${FILE_URL_PREFIX}${id}`;
}

/**
 * The stored-file id inside a URL, or null when the URL points somewhere else
 * — which is the normal case: `logoUrl` has always accepted any public URL,
 * and an upload is only one of the ways to fill it. Callers use this to decide
 * whether replacing a value should also delete a row we own; a remote URL
 * obviously has nothing to clean up.
 *
 * Accepts the relative form we write and an absolute one someone may have
 * pasted back (BETTER_AUTH_URL-prefixed, say), and nothing else — no `..`
 * games, since the id is matched against the shape cuid() produces.
 */
export function storedFileIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  let path = url.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }

  const match = new RegExp(`^${FILE_URL_PREFIX}([a-z0-9]{20,40})$`).exec(path);
  return match ? match[1] : null;
}

/**
 * The type the *bytes* say they are, not the one the browser claimed.
 *
 * A declared Content-Type is caller-supplied text: it decides how the file is
 * later served, so believing it would let someone store an HTML document as
 * `image/png`... or worse, store anything at all and have the route hand it
 * back with a type of the uploader's choosing. Magic bytes are the only part
 * of an upload that isn't a claim.
 */
export function sniffImageType(bytes: Uint8Array): AllowedImageType | null {
  const starts = (...signature: number[]) =>
    signature.length <= bytes.length && signature.every((byte, index) => bytes[index] === byte);

  // PNG: \x89PNG\r\n\x1a\n
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  // JPEG: every variant starts with SOI + a marker.
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  // GIF87a / GIF89a
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  // WebP is RIFF-framed: "RIFF" <4 byte length> "WEBP".
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}
