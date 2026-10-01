// Obonto service worker — makes the app installable, keeps a copy of the
// page so it still opens offline, and shows push notifications.
//
// Deliberately small: no build step, no caching of API calls (Supabase data
// is always fetched live). Bump CACHE when this file's caching changes.

const CACHE = "obonto-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add("/")).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Page loads: network first (so a new deploy shows up right away), falling
// back to the cached page when offline. Built JS/CSS files have hashed
// names, so they're cached the first time they load. Everything else
// (Supabase, fonts, images) goes straight to the network.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("/", copy)).catch(() => {});
        return res;
      } catch (e) {
        return (await caches.match("/")) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    })());
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || "Obonto";
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192-v2.png",
      badge: "/icons/badge-96-v2.png",
      tag: data.id || data.tag,
      data: { url: data.url || "/" }
    });
    // Let any open copy of the app refresh its bell right away.
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    wins.forEach((w) => w.postMessage({ type: "obonto-notification" }));
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        // An open app switches tabs in place (no reload, keeps a running workout).
        w.postMessage({ type: "obonto-open", url: target });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
