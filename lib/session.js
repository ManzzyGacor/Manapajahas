// ==========================================
// SESI LOGIN WEB (cookie bertanda tangan)
// ==========================================
// Kenapa ada: dulu "bukti login" di dashboard hanyalah id user (dari
// localStorage) yang dikirim browser di body/query/header. Id itu bukan
// rahasia — terlihat di URL, log, bahkan pernah bocor lewat API — jadi siapa
// pun yang tahu id orang lain bisa mengaku sebagai dia. Sekarang server
// memberi token yang DITANDATANGANI (HMAC-SHA256) setelah login Google, dan
// setiap request yang mengaku sebagai user tertentu harus membawa token yang
// cocok.
//
// Bentuk token: v1.<uid>.<sv>.<exp>.<sig>
//   uid = User.id dalam base64url (id Google cuma angka, tapi data lama bisa
//         berisi titik/karakter lain — dikodekan supaya pemisah "." aman)
//   sv  = User.sessionVersion saat token dibuat. "Keluar dari semua
//         perangkat" cukup menaikkan angka ini: semua token lama langsung
//         tidak cocok lagi, tanpa perlu menyimpan daftar token di database.
//   exp = waktu kedaluwarsa (detik epoch)
//   sig = HMAC-SHA256(secret, "v1.<uid>.<sv>.<exp>") dalam base64url
//
// Modul ini murni (tanpa database/Express) supaya bisa diuji tanpa MongoDB.

import crypto from "crypto";
import fs from "fs";
import path from "path";

export const SESSION_COOKIE = "vrs_sid";
const DAY_MS = 86400000;
export const SESSION_TTL_MS = 30 * DAY_MS;      // masa berlaku token
export const SESSION_REFRESH_MS = 7 * DAY_MS;   // diperbarui kalau sisa < 7 hari
const VERSION = "v1";

// Lokasi rahasia otomatis. Folder database/runtime/ sudah di-.gitignore,
// jadi rahasia ini tidak pernah ikut ter-commit ke repo publik.
export const SECRET_FILE = path.join(process.cwd(), "database", "runtime", "session-secret");

let secret = null;

// Rahasia penanda tangan:
//   1. env SESSION_SECRET (dipakai apa adanya — operator yang memilih);
//   2. kalau kosong: file database/runtime/session-secret, dibuat sekali
//      (48 byte acak, izin 0600) lalu dipakai terus. Disimpan di file
//      supaya restart server tidak membuat semua user keluar.
export function getSessionSecret() {
  if (secret) return secret;
  const env = String(process.env.SESSION_SECRET || "").trim();
  if (env) {
    if (env.length < 32) {
      console.warn("[sesi] SESSION_SECRET kurang dari 32 karakter — sebaiknya pakai nilai acak yang lebih panjang.");
    }
    secret = Buffer.from(env, "utf8");
    return secret;
  }
  secret = loadOrCreateSecretFile(SECRET_FILE);
  return secret;
}

function loadOrCreateSecretFile(file) {
  try {
    const raw = fs.readFileSync(file, "utf8").trim();
    if (raw.length >= 64) return Buffer.from(raw, "hex");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fresh = crypto.randomBytes(48).toString("hex");
  try {
    // "wx": gagal kalau file sudah ada — dua proses yang start bersamaan
    // tidak saling menimpa; yang kalah cukup membaca milik pemenang.
    fs.writeFileSync(file, fresh + "\n", { mode: 0o600, flag: "wx" });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const raw = fs.readFileSync(file, "utf8").trim();
    if (raw.length >= 64) return Buffer.from(raw, "hex");
    // File ada tapi rusak/kosong: ganti dengan yang baru.
    fs.writeFileSync(file, fresh + "\n", { mode: 0o600 });
  }
  try { fs.chmodSync(file, 0o600); } catch { /* sistem file tanpa chmod (mis. Windows) */ }
  console.log("[sesi] Rahasia sesi baru dibuat di database/runtime/session-secret");
  return Buffer.from(fresh, "hex");
}

// KHUSUS PENGUJIAN: pakai rahasia tertentu (atau null untuk membaca ulang
// env/file pada panggilan berikutnya).
export function setSessionSecret(value) {
  secret = value == null ? null : Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function hmac(data) {
  return crypto.createHmac("sha256", getSessionSecret()).update(data).digest("base64url");
}

function nowMs(opts) {
  const n = opts && Number.isFinite(opts.now) ? opts.now : Date.now();
  return n;
}

// Buat token untuk user `uid` dengan versi sesi `sv`.
export function signSession(uid, sv = 0, opts = {}) {
  if (typeof uid !== "string" || !uid || uid.length > 256) throw new Error("uid sesi tidak valid");
  const version = Number.isInteger(sv) && sv >= 0 ? sv : 0;
  const ttl = Number.isFinite(opts.ttlMs) && opts.ttlMs > 0 ? opts.ttlMs : SESSION_TTL_MS;
  const exp = Math.floor((nowMs(opts) + ttl) / 1000);
  const body = `${VERSION}.${b64url(uid)}.${version}.${exp}`;
  return `${body}.${hmac(body)}`;
}

// Periksa token. Hasil { uid, sv, exp } (exp dalam ms) atau null kalau
// bentuknya salah, tanda tangannya tidak cocok, atau sudah kedaluwarsa.
// Pencocokan versi sesi (sv) dengan database dilakukan pemanggil.
export function verifySession(token, opts = {}) {
  if (typeof token !== "string" || token.length > 600) return null;
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) return null;
  const [, uidPart, svPart, expPart, sig] = parts;
  if (!/^[A-Za-z0-9_-]{1,400}$/.test(uidPart) || !/^\d{1,9}$/.test(svPart) || !/^\d{1,12}$/.test(expPart)) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(sig)) return null; // SHA-256 base64url = 43 karakter

  const expected = Buffer.from(hmac(`${VERSION}.${uidPart}.${svPart}.${expPart}`));
  const given = Buffer.from(sig);
  // Panjang sudah dipastikan sama (43) di atas; timingSafeEqual mencegah
  // penyerang menebak tanda tangan sedikit demi sedikit lewat selisih waktu.
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  const exp = Number(expPart) * 1000;
  if (!(exp > nowMs(opts))) return null;
  const uid = Buffer.from(uidPart, "base64url").toString("utf8");
  if (!uid || b64url(uid) !== uidPart) return null; // base64url tidak kanonik
  return { uid, sv: Number(svPart), exp };
}

// Token masih berlaku tapi sisanya < 7 hari: terbitkan ulang (sliding),
// supaya user yang rutin membuka dashboard tidak tiba-tiba harus login lagi.
export function shouldRefresh(payload, opts = {}) {
  return !!payload && payload.exp - nowMs(opts) < SESSION_REFRESH_MS;
}

// Header Cookie -> { nama: nilai }. Cookie rusak diabaikan, bukan error.
export function parseCookies(header) {
  const out = Object.create(null);
  if (typeof header !== "string" || !header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    let value = part.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!name || name in out) continue; // nama sama: yang pertama (paling spesifik) dipakai
    try { out[name] = decodeURIComponent(value); } catch { out[name] = value; }
  }
  return out;
}

export function readSessionToken(req) {
  return parseCookies(req?.headers?.cookie)[SESSION_COOKIE] || "";
}

// Nilai header Set-Cookie. HttpOnly: skrip di halaman (termasuk skrip
// sisipan XSS) tidak bisa membaca token. SameSite=Lax: cookie tidak ikut
// pada POST lintas situs (perlindungan CSRF), tapi tetap ikut saat user
// membuka tautan ke dashboard. Secure hanya di HTTPS supaya pengujian
// lewat http://localhost tetap bisa login.
export function buildSessionCookie(token, { secure = false, maxAgeMs = SESSION_TTL_MS } = {}) {
  const maxAge = Math.max(0, Math.floor(maxAgeMs / 1000));
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    `Expires=${new Date(Date.now() + maxAge * 1000).toUTCString()}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearSessionCookie({ secure = false } = {}) {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
