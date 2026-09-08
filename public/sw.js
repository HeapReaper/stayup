// Service worker for the "Push" integration channel.
//
// The dashboard registers this file (navigator.serviceWorker.register('/sw.js')
// in src/app/(dashboard)/dashboard/integrations/integrations-client.tsx) as
// part of the "connect this browser" handshake, and it's what actually shows
// the notification: a web push wakes this worker up, with no page necessarily
// open. Both senders — src/lib/push.ts for test sends, the Go
// worker/internal/notify/push.go for real alerts — post the same payload,
// {"title": "...", "body": "..."}, so this file is the third place that shape
// is written down. Keep them in step.
//
// Plain ES5-ish JS on purpose: it's served as-is, never bundled or
// transpiled, and runs in the service worker global scope (no window, no DOM).

const NOTIFICATION_ICON = '/logo.webp';
const INCIDENTS_PATH = '/dashboard/incidents';

// Take over from a previous version of this worker immediately instead of
// waiting for every tab using it to close — otherwise a fixed service worker
// stays dormant until the browser is restarted.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  // A push with no data, or with a body that isn't the JSON we expect, still
  // has to show *something*: `userVisibleOnly: true` was part of the
  // subscription, and browsers punish a push that shows no notification (they
  // display a generic "site updated in the background" one, and can revoke
  // the subscription for repeat offenders).
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || 'StayUp';
  const options = {
    body: payload.body || 'You have a new notification.',
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_ICON,
    // Same tag = a new alert replaces the previous one rather than stacking
    // up; a monitor flapping shouldn't bury the notification tray.
    tag: 'stayup-alert',
    timestamp: Date.now(),
    data: { url: payload.url || INCIDENTS_PATH },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target = event.notification.data?.url || INCIDENTS_PATH;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Reuse a tab that already has this app open — focusing beats opening a
      // fourth copy of the dashboard.
      for (const client of clientList) {
        if (client.url.indexOf(self.location.origin) === 0 && 'focus' in client) {
          if ('navigate' in client) {
            return client.navigate(target).then((navigated) => (navigated ? navigated.focus() : client.focus()));
          }
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(target);
      }
      return undefined;
    }),
  );
});
