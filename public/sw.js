// public/sw.js

/**
 * @fileoverview Service Worker Kill Switch
 * @version 2.0.0
 *
 * This script is designed to run once and then remove itself.
 *
 * Its purpose is to fix a critical issue caused by a previous, faulty
 * service worker that was caching server-side source files and using an
 * incorrect "cache-first" strategy for navigation, causing `net::ERR_FAILED`
 * for the site's root URL.
 *
 * How it works:
 * 1. install: Calls `skipWaiting()` to ensure this new SW activates immediately,
 *    bypassing the standard lifecycle wait time.
 * 2. activate:
 *    a. Deletes ALL caches associated with this origin to purge corrupted data.
 *    b. Unregisters itself from the browser entirely.
 *    c. Finds all open client windows/tabs for this app and forces them to reload.
 *       This ensures users see the fixed site immediately after the SW is removed.
 *
 * This file has no fetch handler, as its only job is to clean up and then disappear.
 * The registration of this SW is gated by an environment variable in app/client.tsx.
 */

// A version comment helps ensure browsers see this as a new file.
// Version: 2024-05-21-killswitch

self.addEventListener('install', (event) => {
  // Force the waiting service worker to become the active service worker.
  console.log('[SW Kill Switch] Installing and skipping wait...');
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  console.log('[SW Kill Switch] Activating to clean up and unregister...');
  event.waitUntil(
    (async () => {
      // 1. Delete all caches.
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(cacheName => {
        console.log('[SW Kill Switch] Deleting cache:', cacheName);
        return caches.delete(cacheName);
      }));
      
      // 2. Unregister the service worker.
      try {
        await self.registration.unregister();
        console.log('[SW Kill Switch] Successfully unregistered itself.');
      } catch (err) {
        console.error('[SW Kill Switch] Failed to unregister:', err);
      }
      
      // 3. Force-reload all open client windows.
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach((client) => {
        if (client.url && 'navigate' in client) {
          console.log(`[SW Kill Switch] Reloading client: ${client.url}`);
          client.navigate(client.url);
        }
      });
    })()
  );
});

// No fetch listener. This SW's only job is to clean up.
