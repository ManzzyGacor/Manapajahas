// ─── Import modul internal via path relatif ───────────
// .env WAJIB dimuat sebelum modul lain (lihat lib/env.js).
import "./lib/env.js";
// Folder & file database dibuat sebelum modul lain dievaluasi (lihat lib/bootstrap.js).
import "./lib/bootstrap.js";
import fs from "fs";
import "./lib/version.js";
import { checkAndInstallModules, clearDirectory } from "./lib/utils.js";
import { startWebServer } from "./lib/webserver.js";

console.log(`[✔] Start App ...`);

const [major] = process.versions.node.split(".").map(Number);

if (major < 20 || major >= 21) {
  console.error(`❌ Script ini hanya kompatibel dengan Node.js versi 20.x`);
  console.error(
    `ℹ️ Jika kamu menjalankan script ini melalui panel, buka menu *Startup*, lalu ubah *Docker Image* ke versi Node.js 20`
  );
  setTimeout(() => process.exit(1), 60_000);
} else {
  process.env.TZ = "Asia/Jakarta";

  // Catat sebab proses berakhir. Tanpa ini, 'web tiba-tiba mati' tidak
  // meninggalkan jejak apa pun di log dan mustahil didiagnosis.
  process.on("exit", (code) => console.log(`[exit] Proses berakhir dengan kode ${code}`));
  process.on("SIGTERM", () => { console.log("[exit] Menerima SIGTERM (dihentikan panel/PM2)."); process.exit(0); });
  process.on("SIGINT", () => { console.log("[exit] Menerima SIGINT."); process.exit(0); });

  // Laporan kesehatan berkala. Kalau angka memori terus naik sampai
  // mendekati batas container, berarti ada kebocoran memori dan itu
  // penyebab matinya (OOM-kill), bukan error kode.
  setInterval(() => {
    const m = process.memoryUsage();
    console.log(
      `[health] uptime=${Math.round(process.uptime())}s ` +
      `rss=${Math.round(m.rss / 1048576)}MB heap=${Math.round(m.heapUsed / 1048576)}MB`
    );
  }, 60000).unref();

  // Handler dipasang PALING AWAL. Sebelumnya dipasang setelah
  // `await start_app()`, sehingga error yang terjadi SAAT startup
  // (sebelum handler ada) langsung mematikan proses tanpa tercatat —
  // inilah gejala "baru nyala langsung mati".
  // PENYEBAB UTAMA 502 / "gampang mati":
  // sebelumnya SATU error dari SATU sesi bot (mis. Baileys timeout,
  // koneksi WA putus, promise gagal) langsung mematikan seluruh proses,
  // termasuk web server. PM2 lalu restart, dan selama restart itu
  // Cloudflare Tunnel tidak dapat backend -> 502.
  //
  // Sekarang error dicatat tapi proses tetap hidup. Hanya error yang
  // benar-benar tidak bisa dipulihkan (kehabisan memori) yang keluar,
  // karena setelah itu state-nya memang sudah tidak bisa dipercaya.
  process.on("uncaughtException", (err) => {
    console.error("❌ Uncaught Exception:", err?.stack || err);

    const fatal = ["ERR_WORKER_OUT_OF_MEMORY", "ENOMEM"];
    if (fatal.includes(err?.code) || /out of memory/i.test(err?.message || "")) {
      console.error("⛔ Error fatal (memori). Keluar agar PM2 me-restart bersih.");
      process.exit(1);
    }
  });

  process.on("unhandledRejection", (reason) => {
    // Sengaja TIDAK exit: promise yang gagal di satu sesi WhatsApp
    // tidak boleh menjatuhkan bot milik user lain.
    console.error("❌ Unhandled Rejection:", reason?.stack || reason);
  });

  try {
    clearDirectory("./tmp");
    console.log("[✔] Cache cleaned successfully.");

    await checkAndInstallModules([
      "follow-redirects",
      "jimp@1.6.0",
      "qrcode-reader",
      "wa-sticker-formatter",
      "api-autoresbot@1.0.6",
    ]);

    // Jalankan Dashboard Web Server JadiVaresa lebih dulu.
    startWebServer();

    // Bot dijalankan SETELAH web benar-benar siap, dan TIDAK di-await.
    //
    // Alasannya: Node satu thread. Membangkitkan sesi WhatsApp itu berat
    // (baca kredensial, kriptografi, koneksi socket). Kalau di-await di
    // sini, event loop sibuk dan Express TIDAK BISA menjawab Cloudflare
    // Tunnel -> tunnel menganggap origin mati -> 502, tepat sesudah
    // restart. Jeda 3 detik memberi web kesempatan melayani request
    // lebih dulu; sisanya berjalan di latar belakang.
    setTimeout(() => {
      import("./lib/startup.js")
        .then(({ start_app }) => start_app())
        .then(() => console.log("[✔] Bot selesai diinisialisasi."))
        .catch((botErr) =>
          console.error("⚠️ Bot gagal start (web tetap jalan):", botErr?.stack || botErr)
        );
    }, 3000);
  } catch (err) {
    // Hanya kegagalan sebelum web server nyala yang dianggap fatal.
    console.error("Error saat inisialisasi awal:", err?.stack || err);
    process.exit(1);
  }
}