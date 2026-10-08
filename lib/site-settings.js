/**
 * lib/site-settings.js
 *
 * Pengaturan tampilan situs yang bisa diubah admin tanpa deploy ulang:
 * banner bergerak di hero, pengumuman, nama server, tautan sosial, dan
 * batas kapasitas bot.
 *
 * Sengaja disimpan di FILE (database/runtime/site-settings.json), bukan di
 * MongoDB: halaman depan harus tetap tampil benar walaupun database sedang
 * putus — justru saat itulah pengunjung paling sering membuka situs untuk
 * mengecek "bot-nya mati ya?". File dibaca sekali lalu di-cache di memori;
 * semua penulisan lewat modul ini sehingga cache selalu sinkron.
 *
 * Semua input divalidasi ketat di sini (bukan di browser): isi pengaturan
 * ini dirender di halaman publik, jadi URL `javascript:` atau teks liar
 * yang lolos akan langsung jadi celah XSS untuk semua pengunjung.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

const RUNTIME_DIR = path.join(process.cwd(), "database", "runtime");
const FILE = path.join(RUNTIME_DIR, "site-settings.json");

export const DEFAULT_BANNER_VIDEO =
  "https://raw.githubusercontent.com/ManzzyGacor/Urlmanzzy/main/file_1763982754350_735.mp4";

const MAX_BANNERS = 10;
const SOCIAL_KEYS = ["whatsapp", "channel", "instagram", "tiktok", "github"];

function defaults() {
  return {
    announcement: { enabled: false, text: "", link: "", linkLabel: "" },
    banners: [
      {
        id: "default", type: "video", src: DEFAULT_BANNER_VIDEO, poster: "",
        title: "", subtitle: "", link: "", linkLabel: "", active: true,
      },
    ],
    bannerIntervalMs: 6000,
    serverName: (process.env.SERVER_NAME || "Server 1").slice(0, 40),
    social: { whatsapp: "", channel: "", instagram: "", tiktok: "", github: "" },
    // 0 = otomatis (dihitung dari RAM & CPU oleh lib/monitor.js).
    capacity: { maxBots: 0, reservePercent: 15 },
  };
}

let cache = null;

/** Error validasi: pesannya aman ditampilkan langsung ke admin. */
export class SettingsError extends Error {
  constructor(message) {
    super(message);
    this.name = "SettingsError";
    this.status = 400;
  }
}

/* ------------------------------------------------------------------
   Pembersih nilai
   ------------------------------------------------------------------ */

// Karakter kontrol (selain spasi biasa) dibuang: tidak pernah dibutuhkan
// di teks banner, dan bisa merusak tampilan atau log.
function cleanText(value, max, field) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") {
    throw new SettingsError(`${field} harus berupa teks.`);
  }
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, max);
}

// Tautan yang boleh dipakai tombol/teks: http(s) atau path internal
// ("/dashboard"). "//evil.com" ditolak karena browser membacanya sebagai
// domain lain.
function cleanLink(value, field) {
  const v = cleanText(value, 500, field);
  if (!v) return "";
  if (/^https?:\/\/[^\s<>"']+$/i.test(v)) return v;
  if (/^\/(?!\/)[A-Za-z0-9\-._~/?#=&%+:@]*$/.test(v)) return v;
  throw new SettingsError(`${field} harus diawali http://, https://, atau / (halaman internal).`);
}

// Sumber media banner: URL http(s) atau file yang diunggah lewat panel
// admin (/uploads/...). Path ".." ditolak supaya tidak bisa menunjuk ke
// luar folder unggahan.
function cleanMediaUrl(value, field, { required = false } = {}) {
  const v = cleanText(value, 500, field);
  if (!v) {
    if (required) throw new SettingsError(`${field} wajib diisi.`);
    return "";
  }
  if (/^https?:\/\/[^\s<>"']+$/i.test(v)) return v;
  if (/^\/(uploads|assets)\/[A-Za-z0-9\-._/]+$/.test(v) && !v.includes("..")) return v;
  throw new SettingsError(`${field} harus berupa URL http(s) atau file dari /uploads/.`);
}

function cleanBool(value, fallback) {
  if (value === undefined) return fallback;
  return value === true || value === "true" || value === 1 || value === "1";
}

function cleanInt(value, min, max, field) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new SettingsError(`${field} harus berupa angka.`);
  const r = Math.round(n);
  if (r < min || r > max) throw new SettingsError(`${field} harus di antara ${min} dan ${max}.`);
  return r;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function cleanBanner(b, i) {
  if (!isPlainObject(b)) throw new SettingsError(`Banner #${i + 1} tidak valid.`);
  const label = `Banner #${i + 1}`;
  const type = String(b.type || "").toLowerCase();
  if (type !== "video" && type !== "image") {
    throw new SettingsError(`${label}: tipe harus "video" atau "image".`);
  }
  let id = String(b.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  if (!id) id = "b" + crypto.randomBytes(4).toString("hex");
  return {
    id,
    type,
    src: cleanMediaUrl(b.src, `${label}: sumber media`, { required: true }),
    poster: cleanMediaUrl(b.poster, `${label}: poster`),
    title: cleanText(b.title, 80, `${label}: judul`),
    subtitle: cleanText(b.subtitle, 160, `${label}: subjudul`),
    link: cleanLink(b.link, `${label}: tautan`),
    linkLabel: cleanText(b.linkLabel, 24, `${label}: label tautan`),
    active: cleanBool(b.active, true),
  };
}

function cleanSocial(key, value) {
  const v = cleanText(value, 300, `Sosial ${key}`);
  if (!v) return "";
  // Nomor WhatsApp polos dibuat jadi tautan wa.me supaya frontend cukup
  // memperlakukan semua nilai sosial sebagai URL.
  if (key === "whatsapp" && /^\+?[\d\s-]{8,20}$/.test(v)) {
    const digits = v.replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 15) return `https://wa.me/${digits}`;
  }
  if (/^https?:\/\/[^\s<>"']+$/i.test(v)) return v;
  throw new SettingsError(`Tautan ${key} harus diawali http:// atau https://.`);
}

/**
 * Validasi sebagian pengaturan (partial) lalu gabungkan ke `base`.
 * Objek digabung per kunci, array (banners) MENGGANTI seluruh daftar.
 * Kunci yang tidak dikenal diabaikan.
 */
export function mergeSettings(base, partial) {
  if (!isPlainObject(partial)) throw new SettingsError("Format pengaturan tidak valid.");
  const out = JSON.parse(JSON.stringify(base));

  if (partial.announcement !== undefined) {
    const a = partial.announcement;
    if (!isPlainObject(a)) throw new SettingsError("Pengumuman tidak valid.");
    const cur = out.announcement;
    if (a.enabled !== undefined) cur.enabled = cleanBool(a.enabled, false);
    if (a.text !== undefined) cur.text = cleanText(a.text, 200, "Teks pengumuman");
    if (a.link !== undefined) cur.link = cleanLink(a.link, "Tautan pengumuman");
    if (a.linkLabel !== undefined) cur.linkLabel = cleanText(a.linkLabel, 24, "Label tautan pengumuman");
    if (cur.enabled && !cur.text) throw new SettingsError("Teks pengumuman wajib diisi kalau pengumuman diaktifkan.");
  }

  if (partial.banners !== undefined) {
    if (!Array.isArray(partial.banners)) throw new SettingsError("Daftar banner harus berupa array.");
    if (partial.banners.length > MAX_BANNERS) {
      throw new SettingsError(`Maksimal ${MAX_BANNERS} banner.`);
    }
    const banners = partial.banners.map(cleanBanner);
    // ID ganda membuat carousel di frontend bingung; buat ulang yang bentrok.
    const seen = new Set();
    for (const b of banners) {
      while (seen.has(b.id)) b.id = "b" + crypto.randomBytes(4).toString("hex");
      seen.add(b.id);
    }
    out.banners = banners;
  }

  if (partial.bannerIntervalMs !== undefined) {
    out.bannerIntervalMs = cleanInt(partial.bannerIntervalMs, 3000, 30000, "Interval banner (ms)");
  }

  if (partial.serverName !== undefined) {
    const name = cleanText(partial.serverName, 40, "Nama server");
    out.serverName = name || defaults().serverName;
  }

  if (partial.social !== undefined) {
    if (!isPlainObject(partial.social)) throw new SettingsError("Tautan sosial tidak valid.");
    for (const key of SOCIAL_KEYS) {
      if (partial.social[key] !== undefined) out.social[key] = cleanSocial(key, partial.social[key]);
    }
  }

  if (partial.capacity !== undefined) {
    const c = partial.capacity;
    if (!isPlainObject(c)) throw new SettingsError("Pengaturan kapasitas tidak valid.");
    if (c.maxBots !== undefined) out.capacity.maxBots = cleanInt(c.maxBots, 0, 5000, "Maksimal bot");
    if (c.reservePercent !== undefined) out.capacity.reservePercent = cleanInt(c.reservePercent, 0, 50, "Cadangan RAM (%)");
  }

  return out;
}

/* ------------------------------------------------------------------
   Baca & tulis file
   ------------------------------------------------------------------ */

function load() {
  if (cache) return cache;
  const base = defaults();
  try {
    if (fs.existsSync(FILE)) {
      const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
      // Isi file tetap lewat validasi yang sama: file bisa diedit manual
      // lewat panel, dan nilai rusak tidak boleh sampai ke halaman publik.
      cache = mergeSettings(base, saved);
      return cache;
    }
  } catch (err) {
    console.error("[site-settings] file rusak/tidak valid, memakai bawaan:", err.message);
  }
  cache = base;
  return cache;
}

function save(settings) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  // Tulis ke file sementara lalu rename: kalau proses mati di tengah
  // penulisan, file lama tetap utuh (tidak setengah tertulis).
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf8");
  fs.renameSync(tmp, FILE);
}

/**
 * Ambil pengaturan (salinan, aman diubah pemanggil).
 * Versi publik tidak menyertakan `capacity` — itu urusan internal admin.
 */
export function getSiteSettings({ admin = false } = {}) {
  const s = JSON.parse(JSON.stringify(load()));
  if (!admin) delete s.capacity;
  return s;
}

/** Pengaturan kapasitas untuk lib/monitor.js (tanpa salinan, dipanggil sering). */
export function getCapacitySettings() {
  const c = load().capacity || {};
  return { maxBots: Number(c.maxBots) || 0, reservePercent: Number.isFinite(c.reservePercent) ? c.reservePercent : 15 };
}

export function getServerName() {
  return load().serverName || defaults().serverName;
}

/**
 * Validasi + gabungkan + simpan. Melempar SettingsError (status 400) kalau
 * input tidak valid; pengaturan lama tidak tersentuh sama sekali.
 */
export function updateSiteSettings(partial) {
  const next = mergeSettings(load(), partial);
  save(next);
  cache = next;
  return getSiteSettings({ admin: true });
}

// Untuk pengujian: buang cache supaya file dibaca ulang.
export function _resetSiteSettingsCache() {
  cache = null;
}

export default { getSiteSettings, updateSiteSettings, getCapacitySettings, getServerName, mergeSettings, SettingsError };
