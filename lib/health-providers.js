/**
 * lib/health-providers.js — daftar API pihak ketiga yang dipakai bot, beserta
 * cara mengecek apakah layanannya masih hidup.
 *
 * Kenapa terpusat di sini, bukan di tiap plugin:
 *  - Satu API (mis. autoresbot) dipakai puluhan plugin. Kalau deklarasinya
 *    ditulis di tiap file, satu perubahan endpoint harus diedit puluhan kali
 *    dan gampang ketinggalan.
 *  - Plugin TIDAK perlu diubah sama sekali: lib/health.js membaca file plugin,
 *    mencocokkan alamat API yang muncul di dalamnya dengan daftar ini, lalu
 *    menempelkan pengecekan yang sesuai ke semua command plugin itu.
 *
 * Aturan penyusunan `expect`: isinya status yang berarti "aplikasinya HIDUP",
 * bukan "permintaannya berhasil". API dengan parameter contoh wajar menjawab
 * 400/401/403/404 (kunci belum diisi, parameter kosong) — itu tetap sehat.
 * Yang dianggap MATI adalah: koneksi gagal/timeout/DNS, 5xx, atau halaman
 * gangguan Cloudflare. Tanpa aturan ini, bot akan menonaktifkan puluhan fitur
 * sekaligus hanya karena kunci API belum diisi.
 *
 * Kunci API diambil dari config lewat placeholder {APIKEY}, {APIBOTCAHX},
 * {JEREXD_APIKEY}, {ANABOT_APIKEY} — tidak ada kunci tertulis di file ini.
 */

import fs from "fs";
import path from "path";

// Penanda halaman gangguan/proxy, bukan jawaban aplikasi.
const GANGGUAN = "just a moment|attention required|error 1015|error 1020|cf-error|cloudflare ray|bad gateway|service unavailable|internal server error|<title>5\\d\\d";

const PROBE_HEADERS = { accept: "*/*" };

export const PROVIDERS = [
  {
    id: "autoresbot",
    label: "Autoresbot API",
    host: "api.autoresbot.com",
    probe: {
      url: "https://api.autoresbot.com/api/maker/iqc?apikey={APIKEY}&text=halo",
      expect: [200, 400, 401, 403, 404],
      bodyPatternFail: GANGGUAN,
      headers: PROBE_HEADERS,
    },
  },
  {
    id: "botcahx",
    label: "Botcahx API",
    host: "api.botcahx.eu.org",
    probe: {
      url: "https://api.botcahx.eu.org/api/stalk/genshin?apikey={APIBOTCAHX}&id=1",
      expect: [200, 400, 401, 403, 404, 405],
      bodyPatternFail: GANGGUAN,
      headers: PROBE_HEADERS,
    },
  },
  {
    id: "jerexd",
    label: "Jerexd API",
    host: "api.jerexd.my.id",
    probe: {
      url: "https://api.jerexd.my.id/api/whatsapp/checkban?apikey={JEREXD_APIKEY}",
      expect: [200, 400, 401, 403, 404],
      bodyPatternFail: GANGGUAN,
      headers: PROBE_HEADERS,
    },
  },
  {
    id: "faa",
    label: "Faa API",
    host: "api-faa.my.id",
    // /faa/meme tanpa parameter: sehat = 200 (gambar) atau 429 (kuota).
    // Kalau layanannya mati, jawabannya 500/502 — itu yang bikin gagal.
    probe: {
      url: "https://api-faa.my.id/faa/meme",
      expect: [200, 429],
      bodyPatternFail: GANGGUAN,
      headers: PROBE_HEADERS,
    },
  },
  {
    id: "tikwm",
    label: "TikWM (TikTok)",
    host: "tikwm.com",
    // Satu-satunya sumber video TikTok di plugin .tiktok. Dicek dengan video
    // TikTok publik yang sudah terbukti bisa diurai ("code":0 = sukses).
    probe: {
      url: "https://tikwm.com/api/",
      method: "POST",
      body: "url=https%3A%2F%2Fwww.tiktok.com%2F%40tiktok%2Fvideo%2F7106594312292453675&hd=1",
      expect: [200],
      bodyPattern: "\"code\":0",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "accept": "*/*" },
    },
  },
  {
    id: "savetube",
    label: "SaveTube (YouTube)",
    host: "media.savetube.vip",
    probe: {
      url: "https://media.savetube.vip/api/random-cdn",
      expect: [200],
      bodyPattern: "cdn",
      headers: PROBE_HEADERS,
    },
  },
  {
    id: "checkton",
    label: "Checkton (MLBB)",
    host: "checkton.online",
    // Endpoint MLBB. Jawaban 422/401 (kunci belum diisi) tetap berarti
    // layanannya hidup; yang mematikan adalah 5xx / koneksi gagal.
    probe: {
      url: "https://checkton.online/backend/info",
      method: "POST",
      body: "{\"role_id\":\"1\",\"zone_id\":\"1\"}",
      expect: [200, 400, 401, 403, 404, 405, 422],
      bodyPatternFail: GANGGUAN,
      headers: { "content-type": "application/json", "accept": "*/*" },
    },
  },
  {
    id: "catbox",
    label: "Catbox (unggah gambar)",
    host: "catbox.moe",
    // 412 = permintaan tanpa berkas (normal untuk GET); yang penting server
    // menjawab, bukan 5xx.
    probe: {
      url: "https://catbox.moe/user/api.php",
      expect: [200, 400, 405, 412],
      bodyPatternFail: GANGGUAN,
      headers: PROBE_HEADERS,
    },
  },
  {
    id: "lrclib",
    label: "LRCLIB (lirik)",
    host: "lrclib.net",
    probe: {
      url: "https://lrclib.net/api/search?q=test",
      expect: [200],
      bodyPatternFail: GANGGUAN,
      headers: PROBE_HEADERS,
    },
  },
  {
    id: "cobalt",
    label: "Cobalt (unduhan)",
    host: "api.cobalt.tools",
    probe: {
      url: "https://api.cobalt.tools/",
      expect: [200, 400, 401, 403, 404, 405],
      bodyPatternFail: GANGGUAN,
      headers: PROBE_HEADERS,
    },
  },
];

/** Nama provider saja, untuk kemudahan impor. */
export const PROVIDER_IDS = PROVIDERS.map((p) => p.id);

/**
 * Cari provider yang dipakai sebuah berkas plugin berdasarkan alamat API yang
 * muncul di dalamnya. `source` = isi berkas plugin (teks).
 */
export function matchProviders(source) {
  const teks = String(source || "");
  const hasil = [];
  for (const p of PROVIDERS) {
    if (teks.includes(p.host)) hasil.push(p);
  }
  return hasil;
}

/**
 * Kumpulkan isi sebuah berkas plugin BESERTA modul lokal yang diimpornya
 * (satu-dua tingkat). Berguna untuk diagnosa/pemetaan (lihat
 * tools/health-probe.js --list) — mis. logika API .tiktok ada di
 * lib/scrape/tiktok.js, bukan di berkas plugin itu sendiri.
 *
 * BUKAN dasar penonaktifan otomatis: lihat catatan di syncFromPlugins()
 * soal kenapa modul bersama (lib/utils.js dll) tidak boleh ikut dihitung.
 * Hanya membaca berkas lokal (impor relatif), tidak mengunduh apa pun.
 */
export function collectSource(absFile, { maxFiles = 15, maxChars = 400000 } = {}) {
  const sudah = new Set();
  let hasil = "";

  const jelajah = (file) => {
    if (hasil.length > maxChars || sudah.size >= maxFiles) return;
    if (sudah.has(file)) return;
    sudah.add(file);
    let src = "";
    try { src = fs.readFileSync(file, "utf8"); } catch { return; }
    hasil += "\n" + src;

    // Ikuti impor relatif ("../../lib/foo.js", "./bar").
    const re = /from\s+["'](\.{1,2}\/[^"']+)["']/g;
    let m;
    while ((m = re.exec(src))) {
      const base = path.resolve(path.dirname(file), m[1]);
      for (const cand of [base, `${base}.js`, path.join(base, "index.js")]) {
        try { if (fs.statSync(cand).isFile()) { jelajah(cand); break; } } catch { /* lewati */ }
      }
    }
  };

  jelajah(absFile);
  return hasil;
}

export default { PROVIDERS, PROVIDER_IDS, matchProviders, collectSource };