// ==========================================
// VOUCHER PAKET (kode tukar)
// ==========================================
// Admin membuat kode (satuan atau massal), user menukarnya di dashboard
// untuk memasang paket Core/Prime/Zenith beberapa hari ke salah satu
// botnya. Beda dengan Promo (potongan harga saat bayar): voucher langsung
// memberi masa aktif, tanpa pembayaran.
//
// Isi file ini sengaja tidak membutuhkan Express maupun koneksi database
// saat di-import: model Mongoose baru menyentuh database ketika dipakai,
// dan fungsi validasinya murni sehingga bisa diuji tanpa MongoDB.
// Penukaran (prorata, pemasangan ke bot) ada di lib/webserver.js supaya
// memakai jalur yang sama persis dengan order yang dibayar.

import crypto from "crypto";
import mongoose from "mongoose";

export const VOUCHER_TIERS = ["basic", "plus", "booster"];
export const VOUCHER_CODE_RE = /^[A-Z0-9-]{4,24}$/;
const DAY_MS = 86400000;

const voucherSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },   // HURUF BESAR, [A-Z0-9-]{4,24}
  tier: { type: String, required: true },                 // basic | plus | booster
  days: { type: Number, required: true },                 // 1–365
  maxUses: { type: Number, default: 1 },                  // 1–10000
  usedCount: { type: Number, default: 0 },
  expiresAt: { type: String, default: "" },               // ISO; "" = tanpa batas
  active: { type: Boolean, default: true },
  note: { type: String, default: "" },
  createdBy: { type: String, default: "" },
  createdAt: { type: String, default: () => new Date().toISOString() }
});
voucherSchema.index({ createdAt: -1 });

// Satu baris per (kode, user). Unique index inilah yang menjamin satu user
// cuma bisa menukar satu kode sekali — walau dua klik datang bersamaan.
const voucherUseSchema = new mongoose.Schema({
  code: { type: String, required: true },
  userId: { type: String, required: true },
  botNumber: { type: String, default: "" },
  at: { type: String, default: () => new Date().toISOString() }
});
voucherUseSchema.index({ code: 1, userId: 1 }, { unique: true });

export const Voucher = mongoose.models.Voucher || mongoose.model("Voucher", voucherSchema);
export const VoucherUse = mongoose.models.VoucherUse || mongoose.model("VoucherUse", voucherUseSchema);

// Index unik WAJIB sudah ada sebelum penukaran pertama; kalau belum,
// dua penukaran bersamaan oleh user yang sama bisa sama-sama masuk.
// init() mengembalikan janji pembuatan index yang sama (murah setelah
// pertama kali), jadi aman dipanggil di setiap penukaran.
let indexesReady = null;
export function ensureVoucherIndexes() {
  if (!indexesReady) {
    indexesReady = Promise.all([Voucher.init(), VoucherUse.init()]).catch((err) => {
      indexesReady = null; // dicoba lagi di penukaran berikutnya
      throw err;
    });
  }
  return indexesReady;
}

// Kode dari input user: spasi dibuang, huruf kecil jadi besar. "" kalau
// bentuknya tidak mungkin kode voucher (tidak perlu bertanya ke database).
export function normalizeVoucherCode(raw) {
  if (typeof raw !== "string") return "";
  const code = raw.replace(/\s+/g, "").toUpperCase();
  return VOUCHER_CODE_RE.test(code) ? code : "";
}

export function isValidVoucherCode(code) {
  return typeof code === "string" && VOUCHER_CODE_RE.test(code);
}

// Huruf/angka yang mudah tertukar (0/O, 1/I/L) tidak dipakai di kode acak
// supaya kode yang diketik ulang dari gambar/WhatsApp tidak salah.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateVoucherCode(prefix = "", length = 8) {
  const pre = String(prefix || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12);
  const sep = pre && !pre.endsWith("-") ? "-" : "";
  const n = Math.max(4, Math.min(24 - pre.length - sep.length, length));
  let rand = "";
  // crypto.randomInt, bukan Math.random: kode yang bisa ditebak = paket
  // gratis. randomInt juga sudah rata (tanpa bias modulo).
  for (let i = 0; i < n; i++) rand += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${pre}${sep}${rand}`;
}

// Tanggal akhir dari admin: "YYYY-MM-DD" = berlaku sampai akhir hari itu
// (WIB), atau tanggal ISO lengkap. "" = tanpa batas. null kalau tidak valid.
export function parseVoucherExpiry(raw) {
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T23:59:59+07:00`) : new Date(s);
  return isNaN(d) ? null : d.toISOString();
}

// Validasi body POST /api/admin/vouchers. Hasil { ok:true, value } atau
// { ok:false, message }. `value.codes` = kode yang diminta admin (satu),
// atau kosong kalau server harus membuat `count` kode acak.
export function parseVoucherCreate(body, now = Date.now()) {
  const b = body && typeof body === "object" ? body : {};
  if (!VOUCHER_TIERS.includes(b.tier)) return { ok: false, message: "Paket voucher harus Core, Prime, atau Zenith." };

  const days = Number(b.days);
  if (!Number.isInteger(days) || days < 1 || days > 365) return { ok: false, message: "Masa aktif voucher harus 1–365 hari." };

  const maxUses = b.maxUses === undefined || b.maxUses === "" ? 1 : Number(b.maxUses);
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10000) return { ok: false, message: "Batas pemakaian harus 1–10000." };

  const expiresAt = parseVoucherExpiry(b.expiresAt);
  if (expiresAt === null) return { ok: false, message: "Tanggal kedaluwarsa tidak valid." };
  if (expiresAt && new Date(expiresAt).getTime() <= now) return { ok: false, message: "Tanggal kedaluwarsa harus di masa depan." };

  if (b.note !== undefined && b.note !== null && typeof b.note !== "string") return { ok: false, message: "Catatan harus berupa teks." };
  const note = String(b.note || "").replace(/[\u0000-\u001F\u007F<>]/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 200);

  let codes = [];
  let count = 1;
  const hasCode = b.code !== undefined && b.code !== null && b.code !== "";
  if (hasCode) {
    const code = normalizeVoucherCode(typeof b.code === "string" ? b.code : "");
    if (!code) return { ok: false, message: "Kode voucher harus 4–24 karakter: huruf, angka, atau tanda minus." };
    if (b.count !== undefined && b.count !== null && b.count !== "" && Number(b.count) !== 1) {
      return { ok: false, message: "Kode khusus hanya untuk satu voucher. Kosongkan kode untuk membuat banyak sekaligus." };
    }
    codes = [code];
  } else {
    count = b.count === undefined || b.count === null || b.count === "" ? 1 : Number(b.count);
    if (!Number.isInteger(count) || count < 1 || count > 100) return { ok: false, message: "Jumlah voucher sekali buat 1–100." };
  }

  let prefix = "";
  if (!hasCode && b.prefix !== undefined && b.prefix !== null && b.prefix !== "") {
    if (typeof b.prefix !== "string" || !/^[A-Za-z0-9-]{1,12}$/.test(b.prefix.trim())) {
      return { ok: false, message: "Awalan kode maksimal 12 karakter: huruf, angka, atau tanda minus." };
    }
    prefix = b.prefix.trim().toUpperCase();
  }

  return { ok: true, value: { tier: b.tier, days, maxUses, expiresAt, note, codes, count, prefix } };
}

export function isVoucherExpired(v, now = Date.now()) {
  if (!v?.expiresAt) return false;
  const t = new Date(v.expiresAt).getTime();
  return !isNaN(t) && t <= now;
}

const TIER_LABEL = { basic: "Core", plus: "Prime", booster: "Zenith" };

// Bentuk voucher untuk panel admin.
export function voucherView(v, now = Date.now()) {
  const used = Number(v?.usedCount) || 0;
  const max = Number(v?.maxUses) || 0;
  const expired = isVoucherExpired(v, now);
  return {
    code: v.code,
    tier: v.tier,
    tierName: TIER_LABEL[v.tier] || v.tier,
    days: v.days,
    maxUses: max,
    usedCount: used,
    remaining: Math.max(0, max - used),
    expiresAt: v.expiresAt || "",
    expired,
    active: v.active !== false,
    // Satu kata untuk badge di tabel admin.
    status: v.active === false ? "nonaktif" : expired ? "kedaluwarsa" : used >= max ? "habis" : "aktif",
    note: v.note || "",
    createdBy: v.createdBy || "",
    createdAt: v.createdAt || ""
  };
}

// ── Penjaga tebak-tebakan kode ─────────────────────────────────
// Kode voucher = paket gratis, jadi menebak kode secara massal harus
// dihentikan: maks. 5 percobaan GAGAL per user dalam 10 menit. Disimpan di
// memori (satu proses); cukup untuk memperlambat penebak tanpa tabel baru.
export function createAttemptGuard({ max = 5, windowMs = 10 * 60 * 1000, maxKeys = 20000 } = {}) {
  const fails = new Map(); // key -> [waktu gagal...]
  const recent = (key, now) => (fails.get(key) || []).filter((t) => now - t < windowMs);
  return {
    // Sisa detik sampai boleh mencoba lagi; 0 = boleh sekarang.
    retryAfterSec(key, now = Date.now()) {
      const list = recent(key, now);
      if (list.length < max) return 0;
      return Math.max(1, Math.ceil((list[list.length - max] + windowMs - now) / 1000));
    },
    fail(key, now = Date.now()) {
      const list = recent(key, now);
      list.push(now);
      fails.delete(key);
      if (fails.size >= maxKeys) fails.delete(fails.keys().next().value);
      fails.set(key, list.slice(-max));
      return list.length;
    },
    // Batalkan satu percobaan yang sudah dicatat (percobaan dicatat di
    // muka supaya tebakan serentak ikut terhitung; yang ternyata berhasil
    // atau gagal karena hal lain dikembalikan lewat ini).
    refund(key) {
      const list = fails.get(key);
      if (!list) return;
      list.pop();
      if (!list.length) fails.delete(key);
    },
    reset(key) { fails.delete(key); },
    clear() { fails.clear(); }
  };
}

export const redeemGuard = createAttemptGuard();
export const VOUCHER_DAY_MS = DAY_MS;
