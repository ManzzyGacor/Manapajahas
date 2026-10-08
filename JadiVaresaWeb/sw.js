/* sw.js — Service Worker JadiVaresa
 *
 * Sengaja dibuat konservatif.
 *
 * Yang di-cache : HANYA aset statis (CSS, JS, ikon, font).
 * Yang TIDAK    : semua /api/*, semua halaman HTML, dan SSE.
 *
 * Alasannya: men-cache halaman atau API adalah penyebab paling umum
 * masalah "sudah deploy tapi tampilan/harga lama terus muncul", dan untuk
 * dashboard yang datanya berubah tiap detik itu justru berbahaya —
 * user bisa melihat status bot atau saldo yang sudah basi.
 */

const VERSION = "jv-v1";
const STATIC_CACHE = `${VERSION}-static`;

// Hanya aset yang benar-benar statis.
const PRECACHE = [
  "/style.css",
  "/landing.css",
  "/app.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      // Satu file gagal tidak boleh menggagalkan seluruh instalasi.
      .then((cache) => Promise.allSettled(PRECACHE.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Domain lain (Google Fonts, CDN) dibiarkan apa adanya.
  if (url.origin !== self.location.origin) return;

  // JANGAN sentuh API, event stream, atau halaman HTML.
  if (
    url.pathname.startsWith("/api/") ||
    req.headers.get("accept")?.includes("text/event-stream") ||
    req.mode === "navigate"
  ) {
    return;
  }

  // Aset statis: pakai cache dulu, lalu perbarui diam-diam di belakang.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
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
    self.registration.showNotification(data.title || "JadiVaresa", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192-maskable.png",
      tag: data.tag || "jv-general",
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
