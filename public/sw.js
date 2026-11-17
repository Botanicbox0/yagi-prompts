/* TWINGS service worker — docs/TEMPLATES-IA.md §5 (PWA first), docs/PLATFORM-2.0.md §5.2–§5.3.
 *
 * Deliberately small. It makes the site installable, answers one thing when the network is gone
 * (a small offline page), and shows the completion push — and, registered on brand.twings.app too, the
 * project room notices (docs/BRAND-ROOMS-FEEDBACK.md §2.2). It never caches HTML, media or API
 * responses — the site's cache contract (private, no-store on every viewer-shaped page) is
 * enforced by the server, and a worker that kept copies of those pages would undo it on the device.
 */
const VERSION = 'twings-sw-v2';
const OFFLINE_URL = '/offline.html';
/** Where a push without a usable link lands: the reader's own renders (on twings.app, see `servedAt`). */
const FALLBACK_URL = '/renders';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.add(OFFLINE_URL))
      // An offline page that could not be stored must not cost the worker — and with it the push.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Navigations only: network first, the offline page when the network is not there.
  if (request.mode !== 'navigate') return;
  event.respondWith(
    fetch(request).catch(() => caches.open(VERSION).then((cache) => cache.match(OFFLINE_URL))),
  );
});

/**
 * twings.app and brand.twings.app serve this same file but not the same pages (lib/routing/surfaces.ts
 * `isBrandPath`), and a person's pushes reach every browser they subscribed in, on either host
 * (docs/BRAND-ROOMS-FEEDBACK.md §2.2). So in production a brand workspace path opens on the brand host and
 * anything else on twings.app. Every other host (local, previews) keeps each link on its own origin.
 */
const CONSUMER_HOSTS = ['twings.app', 'www.twings.app'];
const BRAND_HOST = 'brand.twings.app';
const BRAND_PATH = /^\/brand(?:\/(?:projects|members|invite|settings|library|studio|usage|creators|identity|rooms)(?:\/|$)|$)/;

/** An absolute URL on this site, or null — a push never carries the reader off the site. */
function inApp(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const url = new URL(raw, self.location.origin);
    return url.origin === self.location.origin ? url.href : null;
  } catch (error) {
    return null;
  }
}

/** A link of this site (from `inApp`), on the host that serves its path. */
function servedAt(href) {
  const url = new URL(href);
  const host = self.location.hostname;
  const brand = BRAND_PATH.test(url.pathname);
  if (brand && CONSUMER_HOSTS.includes(host)) return 'https://' + BRAND_HOST + url.pathname + url.search + url.hash;
  if (!brand && host === BRAND_HOST) return 'https://twings.app' + url.pathname + url.search + url.hash;
  return url.href;
}

/**
 * The server sends `{ title, body, url, tag, lang }` (lib/notify/push.ts). `tag` is per render, so
 * a resend replaces the notification instead of stacking a second one.
 */
self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = (event.data && event.data.json()) || {};
  } catch (error) {
    message = {};
  }
  const title = typeof message.title === 'string' && message.title ? message.title : 'TWINGS';
  const options = {
    body: typeof message.body === 'string' ? message.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url: inApp(message.url) || inApp(FALLBACK_URL) },
  };
  if (typeof message.tag === 'string' && message.tag) options.tag = message.tag;
  if (typeof message.lang === 'string' && message.lang) options.lang = message.lang;
  event.waitUntil(self.registration.showNotification(title, options));
});

/** A tap opens the link: a window already there is focused, an open app window is moved to it. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = servedAt(inApp(data.url) || inApp(FALLBACK_URL));
  // The other host's page: no window of this origin can be moved there, so it opens in a new one.
  if (new URL(url).origin !== self.location.origin) {
    event.waitUntil(self.clients.openWindow(url));
    return;
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const same = windows.find((client) => client.url === url);
      if (same) return same.focus();
      const open = windows.find((client) => typeof client.navigate === 'function');
      if (open) {
        try {
          await open.focus();
          return await open.navigate(url);
        } catch (error) {
          // An uncontrolled window cannot be navigated from here; a new one can still be opened.
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
