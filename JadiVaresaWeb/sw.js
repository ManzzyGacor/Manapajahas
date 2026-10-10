/* sw.js — Service Worker Varesa
 *
 * Sengaja dibuat konservatif.
 *
 * Yang TIDAK pernah disentuh : semua /api/*, SSE (event stream), file
 *                              unggahan /uploads/* (banner bisa puluhan MB
 *                              dan diganti admin kapan saja), request Range
 *                              (video), dan domain lain.
 * Halaman HTML               : network-first. Selalu ambil versi terbaru dari
 *                              server; salinan cache hanya dipakai saat
 *                              offline supaya tidak muncul layar dinosaurus.
 * CSS & JS                   : network-first juga — kalau HTML baru bertemu
 *                              JS lama hasilnya halaman rusak, jadi cache
 *                              hanya cadangan saat offline.
 * Gambar, ikon, font lokal   : cache dulu, diperbarui diam-diam di belakang.
 *
 * Alasannya: men-cache halaman atau API secara agresif adalah penyebab paling
 * umum masalah "sudah deploy tapi tampilan/harga lama terus muncul", dan untuk
 * dashboard yang datanya berubah tiap detik itu justru berbahaya — user bisa
 * melihat status bot atau saldo yang sudah basi.
 */

// Naikkan versi ini tiap rilis besar: cache lama otomatis dibuang saat activate.
const VERSION = "vrs-v3";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;

// Aset inti yang disimpan sejak instalasi. URL harus sama persis dengan yang
// dipakai halaman (termasuk ?v=...), karena cache dicocokkan per-URL.
const PRECACHE = [
  "/assets/varesa.css?v=31",
  "/landing.css?v=32",
  "/landing.js?v=32",
  "/assets/logo-mark.svg",
  "/assets/logo.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/favicon-32.png",
];

// Halaman publik yang disimpan untuk cadangan offline.
const PAGES = ["/", "/status", "/login"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE)
        // Satu file gagal tidak boleh menggagalkan seluruh instalasi.
        .then((cache) => Promise.allSettled(PRECACHE.map((u) => cache.add(u)))),
      caches.open(PAGE_CACHE)
        .then((cache) => Promise.allSettled(PAGES.map((u) => cache.add(u)))),
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      // Buang semua cache versi lama, termasuk "jv-v1-*" dari nama sebelumnya.
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

const isOk = (res) => res && res.status === 200 && res.type === "basic";

// Network-first: coba jaringan, simpan salinan, jatuh ke cache saat offline.
async function networkFirst(req, cacheName, cacheKey) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (isOk(res)) cache.put(cacheKey || req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const cached = await cache.match(cacheKey || req, { ignoreSearch: !cacheKey });
    if (cached) return cached;
    throw err;
  }
}

// Halaman: kunci cache = path tanpa query, supaya /invoice?order_id=... tidak
// menumpuk ratusan salinan. Offline & halaman belum pernah dibuka → pesan
// offline singkat (bukan beranda, supaya URL dan isinya tidak membingungkan).
async function pageNetworkFirst(req, url) {
  const key = url.origin + url.pathname;
  try {
    return await networkFirst(req, PAGE_CACHE, key);
  } catch (err) {
    return new Response(
      "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
      "<title>Offline — Varesa</title><body style='margin:0;min-height:100vh;display:grid;place-items:center;" +
      "background:#08090a;color:#edeef0;font-family:system-ui,sans-serif;text-align:center;padding:24px'>" +
      "<div><h1 style='font-size:20px;margin:0 0 8px'>Kamu sedang offline</h1>" +
      "<p style='color:#a3a7ae;margin:0'>Sambungkan internet lalu muat ulang halaman ini.</p></div>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

// Cache dulu, perbarui di belakang (gambar, ikon, font).
async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (isOk(res)) cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => cached);
  if (cached) {
    event.waitUntil(network.then(() => {}, () => {}));
    return cached;
  }
  return network;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Domain lain (Google Fonts, CDN, Google Sign-In) dibiarkan apa adanya.
  if (url.origin !== self.location.origin) return;

  // JANGAN sentuh API, event stream, unggahan, atau request sebagian (video).
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/uploads/") ||
    url.pathname === "/sw.js" ||
    req.headers.get("accept")?.includes("text/event-stream") ||
    req.headers.has("range")
  ) {
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(pageNetworkFirst(req, url));
    return;
  }

  if (/\.(?:css|js|mjs|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(req, STATIC_CACHE));
    return;
  }

  if (/\.(?:png|jpe?g|gif|webp|svg|ico|woff2?|ttf)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, req));
  }
  // Selain itu: biarkan browser menanganinya seperti biasa.
});

/* ── Notifikasi ────────────────────────────────────────────────
 * Halaman mengirim pesan ke sini lewat postMessage saat ada kejadian
 * penting (bot terputus, pembayaran lunas, dsb). Service worker yang
 * menampilkan notifikasinya, supaya tetap muncul walau tab sedang
 * tidak aktif.
 */
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "notify") return;

  event.waitUntil(
    self.registration.showNotification(data.title || "Varesa", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192-maskable.png",
      tag: data.tag || "vrs-general",
      renotify: !!data.renotify,
      data: { url: data.url || "/dashboard" },
      vibrate: [80, 40, 80],
    })
  );
});

// Klik notifikasi: fokuskan tab yang sudah terbuka, jangan buka tab baru.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const c of list) {
          if (c.url.includes(target) && "focus" in c) return c.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
      })
  );
});
