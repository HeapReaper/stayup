/**
 * What build is running.
 *
 * Both images take BUILD_VERSION/BUILD_REVISION as build args — .gitlab-ci.yml
 * fills them with the git tag (on a tagged pipeline) or the commit short SHA,
 * plus the full commit SHA — and the Dockerfile re-exports them as env vars so
 * the running process can tell the update checker what it is. A plain
 * `docker build`, or `npm run dev`, leaves them at "dev": update checks then
 * have nothing to compare against, and the Updates tab says exactly that
 * instead of guessing.
 */

/** Build version/revision of a build that wasn't stamped by CI. */
export const UNKNOWN_BUILD = 'dev';

export function currentVersion(): string {
  return process.env.STAYUP_BUILD_VERSION?.trim() || UNKNOWN_BUILD;
}

export function currentRevision(): string {
  return process.env.STAYUP_BUILD_REVISION?.trim() || UNKNOWN_BUILD;
}
