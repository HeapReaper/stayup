// Validation for a monitor's content assertion, kept in step with its
// evaluator in worker/internal/checkers/assert.go. Anything this accepts, the
// Go checker must be able to evaluate — the whole point of validating here is
// that a typo surfaces in the form instead of silently failing every check.
export const ASSERTION_TYPES = ['Contains', 'Regex', 'JsonPath'] as const;
export type AssertionType = (typeof ASSERTION_TYPES)[number];

// RE2 (Go's regexp) has no backtracking, so these three constructs simply
// don't exist there — JavaScript accepts them happily, which would let a
// pattern pass this form and then fail on every check. Rejecting them here is
// the only place the difference can be explained to whoever typed it.
const RE2_UNSUPPORTED: { pattern: RegExp; label: string }[] = [
  { pattern: /\(\?=|\(\?!/, label: 'lookahead ((?= or (?!)' },
  { pattern: /\(\?<=|\(\?<!/, label: 'lookbehind ((?<= or (?<!)' },
  { pattern: /\\[1-9]/, label: 'backreferences (\\1)' },
];

/** Returns null when `pattern` is a valid RE2 pattern, or the reason it isn't. */
export function validateRegex(pattern: string): string | null {
  for (const { pattern: unsupported, label } of RE2_UNSUPPORTED) {
    if (unsupported.test(pattern)) {
      return `The workers use RE2, which does not support ${label}`;
    }
  }

  try {
    new RegExp(pattern);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid regular expression';
  }
}

/**
 * Validates the dotted/bracketed JSONPath subset the workers implement: a
 * leading `$`, `.key`, `["key"]` and `[0]`. Deliberately not the full spec —
 * see the matching comment on evalJSONPath() in assert.go for why.
 *
 * Returns null when the path is usable, or the reason it isn't.
 */
export function validateJsonPath(path: string): string | null {
  let rest = path.trim().replace(/^\$/, '');
  let steps = 0;

  while (rest.length > 0) {
    if (rest.startsWith('.')) {
      rest = rest.slice(1);
      const end = firstIndexOfAny(rest, ['.', '[']);
      const key = rest.slice(0, end);
      if (!key) return 'Empty key in JSON path';
      rest = rest.slice(end);
    } else if (rest.startsWith('[')) {
      const end = rest.indexOf(']');
      if (end === -1) return 'Unclosed [ in JSON path';
      const inner = rest.slice(1, end).trim();
      rest = rest.slice(end + 1);

      const unquoted = inner.replace(/^["']|["']$/g, '');
      if (unquoted !== inner) {
        if (!unquoted) return 'Empty key in JSON path';
      } else if (!/^\d+$/.test(inner)) {
        return `Invalid array index "${inner}" in JSON path`;
      }
    } else {
      // A path that starts with a bare key ("status" rather than "$.status")
      // is a common enough slip to just accept, same as the Go side.
      const end = firstIndexOfAny(rest, ['.', '[']);
      if (!rest.slice(0, end)) return 'Empty key in JSON path';
      rest = rest.slice(end);
    }
    steps += 1;
  }

  if (steps === 0) return 'Give a path into the response, e.g. $.status';
  return null;
}

function firstIndexOfAny(value: string, needles: string[]): number {
  const found = needles.map((n) => value.indexOf(n)).filter((i) => i !== -1);
  return found.length > 0 ? Math.min(...found) : value.length;
}
