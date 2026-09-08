/**
 * Update checks — "is a newer StayUp out?".
 *
 * Mirrored by worker/internal/updates (invariant 1 in AGENTS.md): the manual
 * "Check now" button in Dashboard → Settings → Updates runs this file,
 * worker/cmd/janitor's daily pass runs the Go copy, and both must write the
 * same AppSettings columns from the same GitLab responses.
 *
 * The comparison depends on what the running image is tagged as, because
 * that's all a container knows about itself:
 *
 *   - pinned to a release tag (STAYUP_VERSION=v1.4.0) → BUILD_VERSION is
 *     "v1.4.0", so compare it against the project's newest release tag.
 *   - tracking `latest` → BUILD_VERSION is a commit short SHA, which orders
 *     against nothing; compare it against the newest commit on the default
 *     branch instead, where "different" is the only signal available.
 *   - built locally → "dev", nothing to compare. Report that, don't guess.
 *
 * Nothing here ever installs anything: a container can't replace its own
 * image, so an available update is reported, and the operator runs
 * `docker compose pull && docker compose up -d` (or Redeploy, on Coolify).
 */

import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';
import { logger } from '@/lib/logging';
import { currentRevision, currentVersion, UNKNOWN_BUILD } from '@/lib/version';

/**
 * GitLab REST API root of the project releases are published from. Overridable
 * so a fork — or a self-hosted GitLab — can be tracked instead; must be a
 * project endpoint (`.../api/v4/projects/<url-encoded path>`), since the
 * releases/tags/commits paths are appended to it.
 */
const PROJECT_API =
  process.env.STAYUP_UPDATE_PROJECT_API?.trim() ||
  'https://gitlab.com/api/v4/projects/HeapReaper%2Fstayup';

/** Web root of the same project, used to build human-facing links. */
const PROJECT_WEB =
  process.env.STAYUP_UPDATE_WEB_URL?.trim() || 'https://gitlab.com/HeapReaper/stayup';

/** Branch the `latest` tag is built from. */
const DEFAULT_BRANCH = process.env.STAYUP_UPDATE_BRANCH?.trim() || 'main';

/**
 * A check that hangs must not hold a dashboard request (or the janitor's
 * daily pass) open: the answer is never urgent enough to wait longer.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Which of the two comparisons applies to the running build — decided by the
 * *shape* of its version string, never configured, so an install can't claim
 * to be on a channel it isn't.
 */
export type UpdateChannel = 'release' | 'edge' | 'unknown';

export type UpdateStatusView = {
  /** Whether the janitor checks on its own once a day. */
  updateCheckEnabled: boolean;
  channel: UpdateChannel;
  /** Release tag, commit short SHA, or "dev" — whatever this build is stamped with. */
  currentVersion: string;
  currentRevision: string;
  /** Newest version the last successful check saw, in the same shape as currentVersion. */
  latestVersion: string | null;
  latestVersionUrl: string | null;
  latestVersionPublishedAt: string | null;
  lastCheckedAt: string | null;
  /** Why the last check failed, or null when it succeeded. */
  lastError: string | null;
  updateAvailable: boolean;
};

type Semver = { major: number; minor: number; patch: number; prerelease: string };

/** One release/commit as the GitLab API described it. */
type RemoteVersion = {
  version: string;
  url: string | null;
  publishedAt: Date | null;
};

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;

export function parseSemver(value: string): Semver | null {
  const match = SEMVER_RE.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? '',
  };
}

/**
 * Semver precedence, reduced to what release tags actually use: numeric
 * fields first, then "a prerelease sorts below the release it precedes"
 * (1.4.0-rc.1 < 1.4.0), then a plain compare between prerelease strings.
 */
export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

export function channelFor(version: string): UpdateChannel {
  if (parseSemver(version)) return 'release';
  if (SHA_RE.test(version)) return 'edge';
  return 'unknown';
}

/**
 * Is `candidate` something to upgrade to, given we're running `current`?
 *
 * Only ever compares like with like. Two SHAs can't be ordered, but the edge
 * check only ever records the *newest* commit on the branch, so any
 * difference means the branch has moved on. Anything else — a tag against a
 * SHA, or either against "dev" — is not a comparison at all, and answering
 * "no" keeps a locally built image from nagging about a release it may well
 * already contain.
 */
export function isNewer(candidate: string | null, current: string): boolean {
  if (!candidate) return false;

  const candidateSemver = parseSemver(candidate);
  const currentSemver = parseSemver(current);
  if (candidateSemver && currentSemver) return compareSemver(candidateSemver, currentSemver) > 0;

  if (SHA_RE.test(candidate) && SHA_RE.test(current)) {
    // Compare on the shorter of the two: CI stamps images with an 8-character
    // short SHA while the API hands back 8 or 40 depending on the endpoint.
    const length = Math.min(candidate.length, current.length);
    return candidate.slice(0, length).toLowerCase() !== current.slice(0, length).toLowerCase();
  }

  return false;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`);
  }
  return response.json();
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Newest release tag, ignoring prereleases: someone running v1.4.0 shouldn't
 * be told to move to v1.5.0-rc.1. Falls back to the plain tag list, because
 * a tagged pipeline publishes images whether or not anyone wrote release
 * notes for that tag.
 */
async function fetchLatestRelease(): Promise<RemoteVersion | null> {
  const releases = await fetchJson(`${PROJECT_API}/releases?per_page=20`);
  const best = highestSemver(
    Array.isArray(releases)
      ? releases.map((entry) => {
          const release = entry as { tag_name?: unknown; released_at?: unknown; _links?: { self?: unknown } };
          return {
            version: typeof release.tag_name === 'string' ? release.tag_name : '',
            url: typeof release._links?.self === 'string' ? release._links.self : null,
            publishedAt: toDate(release.released_at),
          };
        })
      : [],
  );
  if (best) return best;

  const tags = await fetchJson(`${PROJECT_API}/repository/tags?per_page=50`);
  return highestSemver(
    Array.isArray(tags)
      ? tags.map((entry) => {
          const tag = entry as { name?: unknown; commit?: { created_at?: unknown } };
          const name = typeof tag.name === 'string' ? tag.name : '';
          return {
            version: name,
            url: name ? `${PROJECT_WEB}/-/tags/${encodeURIComponent(name)}` : null,
            publishedAt: toDate(tag.commit?.created_at),
          };
        })
      : [],
  );
}

function highestSemver(candidates: RemoteVersion[]): RemoteVersion | null {
  let best: { entry: RemoteVersion; semver: Semver } | null = null;

  for (const entry of candidates) {
    const semver = parseSemver(entry.version);
    if (!semver || semver.prerelease) continue;
    if (!best || compareSemver(semver, best.semver) > 0) best = { entry, semver };
  }

  return best?.entry ?? null;
}

/** Newest commit on the branch `latest` is built from. */
async function fetchLatestCommit(): Promise<RemoteVersion | null> {
  const commits = await fetchJson(
    `${PROJECT_API}/repository/commits?ref_name=${encodeURIComponent(DEFAULT_BRANCH)}&per_page=1`,
  );
  if (!Array.isArray(commits) || commits.length === 0) return null;

  const commit = commits[0] as {
    short_id?: unknown;
    id?: unknown;
    created_at?: unknown;
    web_url?: unknown;
  };
  const version =
    typeof commit.short_id === 'string'
      ? commit.short_id
      : typeof commit.id === 'string'
        ? commit.id.slice(0, 8)
        : '';
  if (!version) return null;

  return {
    version,
    url: typeof commit.web_url === 'string' ? commit.web_url : null,
    publishedAt: toDate(commit.created_at),
  };
}

type SettingsRow = Awaited<ReturnType<typeof getSettings>>;

function serialize(settings: SettingsRow): UpdateStatusView {
  const version = currentVersion();

  return {
    updateCheckEnabled: settings.updateCheckEnabled,
    channel: channelFor(version),
    currentVersion: version,
    currentRevision: currentRevision(),
    latestVersion: settings.latestVersion,
    latestVersionUrl: settings.latestVersionUrl,
    latestVersionPublishedAt: settings.latestVersionPublishedAt?.toISOString() ?? null,
    lastCheckedAt: settings.lastUpdateCheckAt?.toISOString() ?? null,
    lastError: settings.lastUpdateCheckError,
    // Decided here rather than stored, so pulling the new image clears the
    // banner on the next page load instead of at the next check.
    updateAvailable: isNewer(settings.latestVersion, version),
  };
}

/** Reads the last known result. Never touches the network. */
export async function getUpdateStatus(): Promise<UpdateStatusView> {
  return serialize(await getSettings());
}

/**
 * Asks GitLab what the newest version is and records the answer — including
 * a failure, so the Updates tab can say "the last check failed" instead of
 * presenting a stale `latestVersion` as current. Never throws: a check that
 * can't reach GitLab is a status to display, not an error to propagate.
 */
export async function checkForUpdates(): Promise<UpdateStatusView> {
  const settings = await getSettings();
  const version = currentVersion();
  const channel = channelFor(version);
  const now = new Date();

  if (channel === 'unknown') {
    return serialize(
      await prisma.appSettings.update({
        where: { id: settings.id },
        data: {
          lastUpdateCheckAt: now,
          lastUpdateCheckError: `This build isn't stamped with a version (${UNKNOWN_BUILD}), so there is nothing to compare against.`,
        },
      }),
    );
  }

  try {
    const latest = channel === 'release' ? await fetchLatestRelease() : await fetchLatestCommit();
    if (!latest) throw new Error('No releases, tags or commits found for the configured project');

    return serialize(
      await prisma.appSettings.update({
        where: { id: settings.id },
        data: {
          latestVersion: latest.version,
          latestVersionUrl: latest.url,
          latestVersionPublishedAt: latest.publishedAt,
          lastUpdateCheckAt: now,
          lastUpdateCheckError: null,
        },
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[Updates] Update check failed', error);

    return serialize(
      await prisma.appSettings.update({
        where: { id: settings.id },
        data: { lastUpdateCheckAt: now, lastUpdateCheckError: message.slice(0, 500) },
      }),
    );
  }
}

export async function setUpdateCheckEnabled(enabled: boolean): Promise<UpdateStatusView> {
  const settings = await getSettings();
  return serialize(
    await prisma.appSettings.update({
      where: { id: settings.id },
      data: { updateCheckEnabled: enabled },
    }),
  );
}
