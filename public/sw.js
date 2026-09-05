/* TWINGS service worker — docs/TEMPLATES-IA.md §5 (PWA first).
 *
 * Deliberately minimal. Its job is to make the site installable and to answer one thing when the
 * network is gone: a small offline page. It never caches HTML, media or API responses — the site's
 * cache contract (private, no-store on every viewer-shaped page) is enforced by the server, and a
 * worker that kept copies of those pages would undo it on the device.
 */
const VERSION = 'twings-sw-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.add(OFFLINE_URL)).then(() => self.skipWaiting()),
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
