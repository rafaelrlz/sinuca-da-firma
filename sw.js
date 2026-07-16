"use strict";

const CACHE_VERSION = "sinuca-public-v4";
const PUBLIC_SHELL = [
  "/",
  "/index.html",
  "/bolao",
  "/bolao.html",
  "/styles.css",
  "/bolao.css",
  "/league-schedule.js",
  "/expansion-domain.js",
  "/betting-domain.js",
  "/app.js",
  "/bolao.js",
  "/manifest.webmanifest",
  "/assets/icons/icon.svg",
  "/assets/visual/hero-salao-desktop.jpg",
  "/assets/visual/hero-salao-mobile.jpg"
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(PUBLIC_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, fallbackUrl = null) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }
    return Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || network || new Response(JSON.stringify({ offline: true }), {
    status: 503,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== "GET") return;
  // APIs nunca entram no Cache Storage: cookies administrativos não aparecem
  // no objeto Request de forma confiável para decidir se uma resposta é pública.
  if (url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/"));
    return;
  }
  if (["script", "style", "worker", "manifest"].includes(request.destination)) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
