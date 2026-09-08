// Shields-style SVG status badges for a status page's components.
//
// Rendered here rather than proxied from shields.io: the badge is for a
// self-hosted instance whose status is often not reachable from the public
// internet at all, and a monitoring tool that phones a third party to draw
// its own uptime figure is exactly the dependency people self-host to avoid.

/** The palette shields.io uses, so a StayUp badge sits next to others without clashing. */
const COLORS = {
  brightgreen: '#4c1',
  green: '#97ca00',
  yellow: '#dfb317',
  orange: '#fe7d37',
  red: '#e05d44',
  blue: '#007ec6',
  grey: '#9f9f9f',
} as const;

export type BadgeColor = keyof typeof COLORS;

/**
 * Per-character advance widths for 11px DejaVu Sans, the font shields.io
 * renders with, keyed by codepoint. Only a table gets the padding right:
 * an "i" is less than half the width of an "M", and guessing one average
 * width leaves badges either clipped or visibly loose.
 *
 * Anything outside the table (accents, CJK, emoji) falls back to the width of
 * "m", which errs towards a slightly too-wide badge rather than a clipped one.
 */
const CHAR_WIDTHS: Record<string, number> = {
  ' ': 3.6, '!': 4.4, '"': 5.7, '#': 8.9, $: 7, '%': 11.2, '&': 9.5, "'": 3.1,
  '(': 4.4, ')': 4.4, '*': 6.2, '+': 7.4, ',': 3.6, '-': 4.2, '.': 3.6, '/': 4.6,
  '0': 7, '1': 7, '2': 7, '3': 7, '4': 7, '5': 7, '6': 7, '7': 7, '8': 7, '9': 7,
  ':': 3.9, ';': 3.9, '<': 7.4, '=': 7.4, '>': 7.4, '?': 5.9, '@': 11.5,
  A: 8.1, B: 8.2, C: 8.3, D: 9, E: 7.6, F: 7, G: 9.2, H: 9.2, I: 3.6, J: 3.6,
  K: 8.1, L: 6.7, M: 10.6, N: 9.2, O: 9.6, P: 7.6, Q: 9.6, R: 8.5, S: 7.9,
  T: 7.8, U: 9, V: 8.1, W: 11.7, X: 8, Y: 7.8, Z: 8,
  '[': 4.4, '\\': 4.6, ']': 4.4, '^': 7.4, _: 5.6, '`': 5.6,
  a: 6.9, b: 7.3, c: 6, d: 7.3, e: 7, f: 4.1, g: 7.3, h: 7.3, i: 3.2, j: 3.2,
  k: 6.6, l: 3.2, m: 11, n: 7.3, o: 7.1, p: 7.3, q: 7.3, r: 5, s: 5.9, t: 4.6,
  u: 7.3, v: 6.8, w: 9.7, x: 6.8, y: 6.8, z: 5.9,
  '{': 7.1, '|': 4.1, '}': 7.1, '~': 7.4,
};

const FALLBACK_CHAR_WIDTH = CHAR_WIDTHS.m;

function textWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += CHAR_WIDTHS[char] ?? FALLBACK_CHAR_WIDTH;
  }
  return Math.ceil(width);
}

/** SVG is XML: every one of these has to be escaped or the badge won't parse. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface BadgeOptions {
  label: string;
  message: string;
  color: BadgeColor;
}

/**
 * Renders a two-part flat badge. Self-contained SVG with no external font or
 * stylesheet reference — a badge is embedded with a plain <img>, which loads
 * nothing else and applies none of the host page's CSS.
 */
export function renderBadge({ label, message, color }: BadgeOptions): string {
  const padding = 10;
  const labelWidth = textWidth(label) + padding * 2;
  const messageWidth = textWidth(message) + padding * 2;
  const totalWidth = labelWidth + messageWidth;

  // Text is placed at 10x scale and scaled back down, which is how shields
  // gets sub-pixel positioning to survive integer rounding.
  const labelCenter = (labelWidth / 2) * 10;
  const messageCenter = (labelWidth + messageWidth / 2) * 10;

  const safeLabel = escapeXml(label);
  const safeMessage = escapeXml(message);
  const accessibleText = escapeXml(`${label}: ${message}`);

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="20" role="img" aria-label="${accessibleText}">
  <title>${accessibleText}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${COLORS[color]}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${labelCenter}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelWidth - padding * 2) * 10}">${safeLabel}</text>
    <text x="${labelCenter}" y="140" transform="scale(.1)" textLength="${(labelWidth - padding * 2) * 10}">${safeLabel}</text>
    <text aria-hidden="true" x="${messageCenter}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(messageWidth - padding * 2) * 10}">${safeMessage}</text>
    <text x="${messageCenter}" y="140" transform="scale(.1)" textLength="${(messageWidth - padding * 2) * 10}">${safeMessage}</text>
  </g>
</svg>`;
}

/** Uptime percentage -> colour, on the usual "three nines is good" reading. */
export function uptimeColor(uptime: number): BadgeColor {
  if (uptime >= 99.9) return 'brightgreen';
  if (uptime >= 99) return 'green';
  if (uptime >= 95) return 'yellow';
  if (uptime >= 90) return 'orange';
  return 'red';
}
