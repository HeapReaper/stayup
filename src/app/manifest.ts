import type { MetadataRoute } from 'next';

/**
 * Web app manifest, making the dashboard installable on a phone — which is
 * where an on-call tool is actually read. The service worker that web push
 * already needs (public/sw.js) is the other half of the requirement, so this
 * file is the only thing that was missing.
 *
 * Deliberately *not* linked from the root layout: status pages are served by
 * this same app, on their own custom domains and with their own branding, and
 * advertising a manifest called "StayUp" whose start_url is /dashboard on a
 * customer-facing page is wrong twice over. The <link rel="manifest"> is
 * emitted from the dashboard layout's metadata instead.
 *
 * The icons are generated from public/logo.webp; PNG rather than WebP because
 * iOS ignores a WebP apple-touch-icon, and square because Chrome's
 * installability check rejects an icon that isn't.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'StayUp',
    short_name: 'StayUp',
    description: 'Uptime monitoring, incident management and status pages.',
    // Straight to the dashboard: signed out, the middleware sends it on to
    // /login anyway, so this is the right target in both states.
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    categories: ['productivity', 'utilities'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Padded into the 80% safe zone, so Android cropping it to a circle
      // doesn't clip the mark.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Incidents', url: '/dashboard/incidents' },
      { name: 'Monitors', url: '/dashboard/monitors' },
    ],
  };
}
