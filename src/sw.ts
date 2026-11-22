/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

const SHARE_CACHE = 'cutprep-share';
const SHARE_KEY = 'shared-image';

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const shareTarget = new URL('./share-target', self.registration.scope).href;
const shareDone = new URL('./?shared=1', self.registration.scope).href;

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'POST' || request.url !== shareTarget) return;
  event.respondWith(
    (async () => {
      try {
        const form = await request.formData();
        const file = form.get('image');
        if (file instanceof File) {
          const cache = await caches.open(SHARE_CACHE);
          await cache.put(
            SHARE_KEY,
            new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } }),
          );
        }
      } catch {
        // fall through: the app opens without an image
      }
      return Response.redirect(shareDone, 303);
    })(),
  );
});
