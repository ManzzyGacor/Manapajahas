/**
 * lib/bot-prefix.js — prefix & alias command PER BOT.
 *
 * Bot A boleh memakai `!`, bot B memakai `.`. Setelan disimpan di config bot
 * (jadibot.json) sebagai `prefix`, dan dibaca di jalur pesan lewat
 * getJadibotCache() — jadi tidak perlu membaca file per pesan.
 *
 * Bentuk dukungan lain yang ikut dihormati:
 *   - `config.prefix` (config.js)       — berlaku untuk bot utama & sebagai
 *     bawaan bot yang belum mengatur sendiri.
 *   - `config.status_prefix`            — kalau false, command TANPA prefix
 *     juga diterima (perilaku lama dipertahankan).
 *
 * Modul ini sengaja hanya bergantung pada modul bawaan Node, supaya bisa
 * diuji tanpa node_modules (lihat tools/prefix-check.js). Prefix bawaan
 * dibaca dari global.configPrefix yang dipasang config.js.
 */

// Beberapa simbol yang aman dipakai di awal pesan dan tidak terpakai untuk
// hal lain di WhatsApp. Daftar ini hanya untuk memandu penggunaan; setelan
// bot tetap divalidasi (bukan dibatasi) terhadap daftar ini.
export const PREFIX_SIMBOL = [".", "!", "#", "/", ",", "-", "?", "*", "&", "%"];

// Nama perintah yang TIDAK boleh dialihkan oleh alias buatan bot.
export const ALIAS_DILINDUNGI = new Set([
  "menu", "allmenu", "help", "jadibot", "owner", "ping", "stop", "start", "delete",
  "prefix", "alias",
]);

const DEFAULT_PREFIX = ".";

// Prefix bawaan dari config.js (dipasang sebagai global saat config dimuat).
// Dibaca melalui fungsi supaya nilai yang lebih baru selalu terambil dan
// modul ini tidak perlu mengimpor config.js (lihat catatan di atas).
function configPrefix() {
  return Array.isArray(globalThis.configPrefix) ? globalThis.configPrefix : [];
}

/** Normalisasi daftar prefix dari nilai apa pun. Mengembalikan [] kalau kosong. */
export function normalkanPrefix(nilai) {
  const arr = Array.isArray(nilai) ? nilai : typeof nilai === "string" ? [nilai] : [];
  const out = [];
  for (const raw of arr) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    // Hanya simbol tunggal non-alfanumerik: mencegah bot "mengaku" prefix
    // berupa huruf sehingga obrolan biasa ikut diproses sebagai command.
    if (s.length > 2) continue;
    if (/^[a-zA-Z0-9]/.test(s)) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, 5);
}

/** Sanitasi nama command dari input pengguna (dipakai .alias). */
export function normalkanPerintah(nama) {
  const s = String(nama ?? "")
    .toLowerCase()
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9_+.-]/g, "")
    .slice(0, 30);
  return s || "";
}

/** Sanitasi nama alias: sama seperti command, tapi tidak boleh titik-titik saja. */
export function normalkanAlias(nama) {
  const s = normalkanPerintah(nama);
  return /[a-z0-9]/.test(s) ? s : "";
}

/**
 * Daftar prefix yang berlaku untuk satu nomor bot.
 * - Bot user yang mengatur sendiri → setelannya sendiri.
 * - Bot utama / bot tanpa setelan → config.prefix (bawaan).
 */
export function prefixUntukBot(nomor, { getJadibotCache } = {}) {
  if (nomor && typeof getJadibotCache === "function") {
    try {
      const cfg = getJadibotCache()?.[String(nomor)]?.config;
      const punya = normalkanPrefix(cfg?.prefix);
      if (punya.length) return punya;
    } catch { /* jatuh ke bawaan */ }
  }
  const bawaan = normalkanPrefix(configPrefix());
  return bawaan.length ? bawaan : [DEFAULT_PREFIX];
}

/** Prefix pertama (dipakai untuk tampilan menu & contoh perintah). */
export function prefixTampilan(daftar) {
  const d = normalkanPrefix(daftar);
  return d.length ? d[0] : ((normalkanPrefix(configPrefix())[0]) || DEFAULT_PREFIX);
}

/**
 * Ubah alias menjadi command aslinya.
 * `peta` = { alias: command }, sudah dalam huruf kecil.
 * Command yang dilindungi tidak pernah dialihkan.
 */
export function terapkanAlias(command, peta) {
  const c = String(command || "").toLowerCase();
  if (!c || !peta || typeof peta !== "object") return c;
  if (ALIAS_DILINDUNGI.has(c)) return c;
  const tujuan = peta[c];
  return typeof tujuan === "string" && tujuan ? tujuan.toLowerCase() : c;
}

/** Peta alias milik satu bot dari config (dibersihkan dari entri rusak). */
export function petaAliasDariConfig(cfg) {
  const src = cfg && typeof cfg.alias === "object" && cfg.alias ? cfg.alias : {};
  const out = {};
  for (const [alias, tujuan] of Object.entries(src)) {
    const a = normalkanAlias(alias);
    const t = normalkanPerintah(
      typeof tujuan === "object" && tujuan ? tujuan.cmd : tujuan
    );
    if (!a || !t) continue;
    out[a] = t;
    if (Object.keys(out).length >= 100) break;
  }
  return out;
}

/**
 * Ekstrak prefix, command, dan sisa teks dari isi pesan.
 * Mengembalikan { prefix, command, sisa, prefixDipakai }.
 * `command` bernilai "" kalau pesannya bukan command.
 */
export function uraikanPesan(content, daftarPrefix, { statusPrefix = true } = {}) {
  const teks = String(content || "").trim();
  const daftar = normalkanPrefix(daftarPrefix);
  const dipakai = daftar.find((p) => teks.startsWith(p));

  if (dipakai) {
    const sesudah = teks.slice(dipakai.length).trim();
    const command = (sesudah.split(/\s+/)[0] || "").toLowerCase();
    return { prefix: dipakai, command, sisa: sesudah.slice(command.length).trim(), prefixDipakai: true };
  }

  // Tanpa prefix: hanya diterima kalau status_prefix dimatikan.
  if (statusPrefix === false) {
    const potong = teks.split(/\s+/);
    const command = (potong[0] || "").toLowerCase();
    return { prefix: "", command, sisa: potong.slice(1).join(" ").trim(), prefixDipakai: false };
  }
  return { prefix: "", command: "", sisa: "", prefixDipakai: false };
}

export default {
  PREFIX_SIMBOL, ALIAS_DILINDUNGI,
  normalkanPrefix, normalkanPerintah, normalkanAlias,
  prefixUntukBot, prefixTampilan, terapkanAlias, petaAliasDariConfig, uraikanPesan,
};