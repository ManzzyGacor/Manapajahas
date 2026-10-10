/**
 * lib/bot-scope.js
 *
 * Data premium, bonus limit & sewa grup yang berlaku PER BOT.
 *
 * Kenapa ada: premium (users.json → premium), limit (users.json → limit) dan
 * sewa grup (database/sewa.json) itu GLOBAL — dipakai semua bot di server.
 * Kalau owner bot user boleh menulis ke sana, siapa pun yang bikin bot
 * (gratis) bisa memberi dirinya premium/limit di bot utama dan di bot milik
 * pelanggan lain. Jadi owner bot menulis ke "ruang" milik bot-nya sendiri
 * di file ini, dan efeknya hanya terasa di bot itu.
 *
 * Bentuk file database/bot-scope.json:
 *   { "<nomorBot>": {
 *       "premium":    { "<nomorUser>": "<ISO kedaluwarsa>" },
 *       "limitBonus": { "<nomorUser>": <bilangan bulat ≥ 0> },
 *       "sewa":       { "<idGrup@g.us>": { "expired": <ms>, "linkGrub": "...", "addedBy": "<nomorUser>" } }
 *   } }
 *
 * Aturan keamanan (file ini bisa diedit tangan / rusak):
 * - Semua kunci divalidasi ketat (nomor = 5–20 digit, grup = "angka@g.us").
 *   Kunci lain — terutama "__proto__"/"constructor" — dibuang, jadi tidak
 *   bisa mencemari prototype Object di seluruh proses.
 * - Objek di memori dibuat dengan Object.create(null) dan setiap pembacaan
 *   memakai hasOwnProperty.
 * - Jumlah entri dibatasi per bot supaya file tidak bisa dibuat membengkak.
 * - Tulis ke file lewat file sementara + rename (atomik) dan di-debounce,
 *   jadi file tidak pernah setengah tertulis walau proses mati mendadak.
 *
 * API sinkron (cache di memori, dibaca dari disk sekali saja) supaya bisa
 * dipanggil di jalur pesan tanpa await dan tanpa balapan baca-tulis.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import config from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "../database/bot-scope.json");

// ── Batas ──────────────────────────────────────────────────────
export const BATAS = Object.freeze({
  maxBots: 5000, // jumlah bot yang punya data di file ini
  maxPremiumPerBot: 5000,
  maxLimitUsersPerBot: 5000,
  maxSewaPerBot: 2000,
  minHari: 1,
  maxHari: 3650,
  minLimit: 1,
  maxLimit: 100000, // per sekali .addlimit
  maxLimitTotal: 10000000, // total bonus seorang user di satu bot
  maxLinkLen: 200,
});

const HARI_MS = 24 * 60 * 60 * 1000;
const JEDA_TULIS_MS = 400;

// ── Validasi kunci ─────────────────────────────────────────────
const RE_NOMOR = /^\d{5,20}$/;
const RE_GRUP = /^[0-9-]{5,60}@g\.us$/;

export function isValidBotKey(v) {
  return RE_NOMOR.test(String(v ?? ""));
}
export function isValidUserKey(v) {
  return RE_NOMOR.test(String(v ?? ""));
}
export function isValidGroupId(v) {
  return RE_GRUP.test(String(v ?? ""));
}

function own(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function kosong() {
  return Object.create(null);
}

function ruangKosong() {
  const r = kosong();
  r.premium = kosong();
  r.limitBonus = kosong();
  r.sewa = kosong();
  return r;
}

/**
 * Ubah masukan nomor jadi kunci user: "08xx" → "628xx", JID/LID → digitnya.
 * Mengembalikan null kalau bukan nomor yang masuk akal.
 */
export function normalizeUserNumber(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  // "628xx:12@s.whatsapp.net" / "123@lid" → bagian sebelum ":" / "@".
  if (s.includes("@")) s = s.split("@")[0];
  if (s.includes(":")) s = s.split(":")[0];
  s = s.replace(/\D/g, "");
  if (s.startsWith("0")) s = `62${s.slice(1)}`;
  return isValidUserKey(s) ? s : null;
}

// ── Pembersihan data dari disk ─────────────────────────────────
function bersihkanPremium(src) {
  const out = kosong();
  if (!src || typeof src !== "object" || Array.isArray(src)) return out;
  let n = 0;
  for (const user of Object.keys(src)) {
    if (n >= BATAS.maxPremiumPerBot) break;
    if (!isValidUserKey(user)) continue;
    const t = Date.parse(src[user]);
    if (!Number.isFinite(t)) continue;
    out[user] = new Date(t).toISOString();
    n++;
  }
  return out;
}

function bersihkanLimit(src) {
  const out = kosong();
  if (!src || typeof src !== "object" || Array.isArray(src)) return out;
  let n = 0;
  for (const user of Object.keys(src)) {
    if (n >= BATAS.maxLimitUsersPerBot) break;
    if (!isValidUserKey(user)) continue;
    const v = src[user];
    if (!Number.isInteger(v) || v <= 0) continue;
    out[user] = Math.min(v, BATAS.maxLimitTotal);
    n++;
  }
  return out;
}

function bersihkanSatuSewa(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const expired = Number(v.expired);
  if (!Number.isFinite(expired) || expired <= 0) return null;
  const linkGrub =
    typeof v.linkGrub === "string" ? v.linkGrub.slice(0, BATAS.maxLinkLen) : "";
  const addedBy = isValidUserKey(v.addedBy) ? String(v.addedBy) : "";
  const e = kosong();
  e.expired = Math.floor(expired);
  e.linkGrub = linkGrub;
  e.addedBy = addedBy;
  return e;
}

function bersihkanSewa(src) {
  const out = kosong();
  if (!src || typeof src !== "object" || Array.isArray(src)) return out;
  let n = 0;
  for (const gid of Object.keys(src)) {
    if (n >= BATAS.maxSewaPerBot) break;
    if (!isValidGroupId(gid)) continue;
    const e = bersihkanSatuSewa(src[gid]);
    if (!e) continue;
    out[gid] = e;
    n++;
  }
  return out;
}

function bersihkanStore(parsed) {
  const out = kosong();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
  let n = 0;
  for (const bot of Object.keys(parsed)) {
    if (n >= BATAS.maxBots) break;
    if (!isValidBotKey(bot)) continue;
    const src = parsed[bot];
    if (!src || typeof src !== "object" || Array.isArray(src)) continue;
    const r = ruangKosong();
    r.premium = bersihkanPremium(src.premium);
    r.limitBonus = bersihkanLimit(src.limitBonus);
    r.sewa = bersihkanSewa(src.sewa);
    out[bot] = r;
    n++;
  }
  return out;
}

// ── Cache & penyimpanan ────────────────────────────────────────
let store = null;
let kotor = false;
let timerTulis = null;

function muat() {
  if (store) return store;
  let parsed = {};
  try {
    if (fs.existsSync(FILE)) {
      const raw = fs.readFileSync(FILE, "utf8");
      parsed = raw.trim() ? JSON.parse(raw) : {};
    }
  } catch (err) {
    // File rusak: simpan salinannya untuk diperiksa lalu mulai dari kosong.
    // Tanpa disalin, tulisan berikutnya akan menimpa data yang mungkin
    // masih bisa diselamatkan manual.
    console.error("[bot-scope] bot-scope.json rusak, dipakai data kosong:", err.message);
    try {
      fs.copyFileSync(FILE, `${FILE}.rusak-${Date.now()}`);
    } catch {
      /* tidak apa-apa */
    }
    parsed = {};
  }
  store = bersihkanStore(parsed);
  return store;
}

// Tulis SINKRON (tapi di-debounce): file ini kecil, dan tulis sinkron
// menghindari balapan antara dua penulisan async yang selesai tidak
// berurutan (versi lama bisa menimpa versi baru di disk).
function tulisSinkron() {
  if (!store) return;
  const tmp = `${FILE}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  // JSON.stringify bisa membaca objek tanpa prototype dengan normal.
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, FILE);
}

function jadwalkanTulis() {
  kotor = true;
  if (timerTulis) return;
  timerTulis = setTimeout(() => {
    timerTulis = null;
    flushBotScope();
  }, JEDA_TULIS_MS);
  // Timer tulis tidak boleh menahan proses tetap hidup (mis. saat tes);
  // perubahan terakhir tetap ditulis lewat handler "exit" di bawah.
  if (typeof timerTulis.unref === "function") timerTulis.unref();
}

/** Tulis sekarang juga (dipakai saat proses berhenti & di tes). */
export function flushBotScope() {
  if (timerTulis) {
    clearTimeout(timerTulis);
    timerTulis = null;
  }
  if (!kotor) return;
  try {
    tulisSinkron();
    kotor = false;
  } catch (err) {
    console.error("[bot-scope] gagal menyimpan:", err.message);
  }
}

// Perubahan terakhir jangan hilang saat proses dimatikan (PM2 restart).
process.once("exit", flushBotScope);

/**
 * Baca ulang dari disk (mis. file diganti manual). Perubahan di memori yang
 * belum tertulis disimpan dulu supaya tidak hilang diam-diam.
 */
export function reloadBotScope() {
  flushBotScope();
  store = null;
  return muat();
}

function ruang(bot, buat = false) {
  const s = muat();
  const k = String(bot ?? "");
  if (!isValidBotKey(k)) return null;
  if (own(s, k)) return s[k];
  if (!buat) return null;
  if (Object.keys(s).length >= BATAS.maxBots) return null;
  s[k] = ruangKosong();
  return s[k];
}

// Hapus ruang bot yang sudah kosong supaya file tidak berisi sampah.
function rapikan(bot) {
  const s = muat();
  const k = String(bot);
  if (!own(s, k)) return;
  const r = s[k];
  if (
    !Object.keys(r.premium).length &&
    !Object.keys(r.limitBonus).length &&
    !Object.keys(r.sewa).length
  ) {
    delete s[k];
  }
}

// ── Premium per bot ────────────────────────────────────────────
/** ISO kedaluwarsa premium user di bot ini (masih aktif), atau null. */
export function getBotPremium(bot, user) {
  const r = ruang(bot);
  const u = String(user ?? "");
  if (!r || !isValidUserKey(u) || !own(r.premium, u)) return null;
  const t = Date.parse(r.premium[u]);
  return Number.isFinite(t) && t > Date.now() ? r.premium[u] : null;
}

export function isBotPremium(bot, user) {
  return getBotPremium(bot, user) !== null;
}

/** Cepat: apakah bot ini punya data premium sama sekali? */
export function hasBotPremiumEntries(bot) {
  const r = ruang(bot);
  return !!r && Object.keys(r.premium).length > 0;
}

// Buang premium yang sudah lewat supaya kuota 5000 tidak habis oleh data basi.
function buangPremiumKedaluwarsa(r) {
  const now = Date.now();
  for (const u of Object.keys(r.premium)) {
    const t = Date.parse(r.premium[u]);
    if (!Number.isFinite(t) || t <= now) delete r.premium[u];
  }
}

/**
 * Tambah/perpanjang premium user di bot ini. Kalau masih aktif, hari baru
 * ditambahkan dari tanggal kedaluwarsa lama (bukan dari hari ini), maksimal
 * 3650 hari dari sekarang.
 * @returns {{ ok: true, expiredAt: string } | { ok: false, error: string }}
 */
export function addBotPremium(bot, user, days) {
  const u = String(user ?? "");
  const d = Number(days);
  if (!isValidBotKey(bot)) return { ok: false, error: "bot" };
  if (!isValidUserKey(u)) return { ok: false, error: "user" };
  if (!Number.isInteger(d) || d < BATAS.minHari || d > BATAS.maxHari) {
    return { ok: false, error: "days" };
  }
  const r = ruang(bot, true);
  if (!r) return { ok: false, error: "full" };
  buangPremiumKedaluwarsa(r);
  const now = Date.now();
  const lama = own(r.premium, u) ? Date.parse(r.premium[u]) : NaN;
  if (!own(r.premium, u) && Object.keys(r.premium).length >= BATAS.maxPremiumPerBot) {
    rapikan(bot);
    return { ok: false, error: "full" };
  }
  const dasar = Number.isFinite(lama) && lama > now ? lama : now;
  const akhir = Math.min(dasar + d * HARI_MS, now + BATAS.maxHari * HARI_MS);
  r.premium[u] = new Date(akhir).toISOString();
  jadwalkanTulis();
  return { ok: true, expiredAt: r.premium[u] };
}

/** Hapus premium user di bot ini. true kalau tadinya ada (aktif). */
export function delBotPremium(bot, user) {
  const r = ruang(bot);
  const u = String(user ?? "");
  if (!r || !isValidUserKey(u) || !own(r.premium, u)) return false;
  const masihAktif = getBotPremium(bot, u) !== null;
  delete r.premium[u];
  rapikan(bot);
  jadwalkanTulis();
  return masihAktif;
}

/** Daftar premium aktif di bot ini, urut dari yang paling cepat habis. */
export function listBotPremium(bot) {
  const r = ruang(bot);
  if (!r) return [];
  const now = Date.now();
  return Object.keys(r.premium)
    .map((user) => ({ user, expiredAt: r.premium[user], t: Date.parse(r.premium[user]) }))
    .filter((x) => Number.isFinite(x.t) && x.t > now)
    .sort((a, b) => a.t - b.t)
    .map(({ user, expiredAt }) => ({ user, expiredAt }));
}

// ── Bonus limit per bot ────────────────────────────────────────
export function getLimitBonus(bot, user) {
  const r = ruang(bot);
  const u = String(user ?? "");
  if (!r || !isValidUserKey(u) || !own(r.limitBonus, u)) return 0;
  const v = r.limitBonus[u];
  return Number.isInteger(v) && v > 0 ? v : 0;
}

/**
 * Tambah bonus limit user di bot ini.
 * @returns {{ ok: true, total: number } | { ok: false, error: string }}
 */
export function addLimitBonus(bot, user, n) {
  const u = String(user ?? "");
  const jumlah = Number(n);
  if (!isValidBotKey(bot)) return { ok: false, error: "bot" };
  if (!isValidUserKey(u)) return { ok: false, error: "user" };
  if (!Number.isInteger(jumlah) || jumlah < BATAS.minLimit || jumlah > BATAS.maxLimit) {
    return { ok: false, error: "amount" };
  }
  const r = ruang(bot, true);
  if (!r) return { ok: false, error: "full" };
  if (!own(r.limitBonus, u) && Object.keys(r.limitBonus).length >= BATAS.maxLimitUsersPerBot) {
    rapikan(bot);
    return { ok: false, error: "full" };
  }
  const total = Math.min(getLimitBonus(bot, u) + jumlah, BATAS.maxLimitTotal);
  r.limitBonus[u] = total;
  jadwalkanTulis();
  return { ok: true, total };
}

/**
 * Pakai bonus limit dulu (sebelum limit global). Mengembalikan berapa yang
 * berhasil ditutup bonus (0..n); sisanya dipotong dari limit global.
 */
export function useLimitBonus(bot, user, n) {
  const butuh = Math.max(0, Math.floor(Number(n) || 0));
  if (!butuh) return 0;
  const punya = getLimitBonus(bot, user);
  if (!punya) return 0;
  const pakai = Math.min(punya, butuh);
  const r = ruang(bot);
  const u = String(user);
  const sisa = punya - pakai;
  if (sisa > 0) r.limitBonus[u] = sisa;
  else delete r.limitBonus[u];
  rapikan(bot);
  jadwalkanTulis();
  return pakai;
}

// ── Sewa grup per bot ──────────────────────────────────────────
export function getBotSewa(bot, groupId) {
  const r = ruang(bot);
  const g = String(groupId ?? "");
  if (!r || !isValidGroupId(g) || !own(r.sewa, g)) return null;
  const e = r.sewa[g];
  return { expired: e.expired, linkGrub: e.linkGrub, addedBy: e.addedBy };
}

/**
 * Simpan/ganti sewa grup di bot ini.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function addBotSewa(bot, groupId, data = {}) {
  const g = String(groupId ?? "");
  if (!isValidBotKey(bot)) return { ok: false, error: "bot" };
  if (!isValidGroupId(g)) return { ok: false, error: "group" };
  const e = bersihkanSatuSewa(data);
  if (!e) return { ok: false, error: "data" };
  const r = ruang(bot, true);
  if (!r) return { ok: false, error: "full" };
  if (!own(r.sewa, g) && Object.keys(r.sewa).length >= BATAS.maxSewaPerBot) {
    rapikan(bot);
    return { ok: false, error: "full" };
  }
  r.sewa[g] = e;
  jadwalkanTulis();
  return { ok: true };
}

export function delBotSewa(bot, groupId) {
  const r = ruang(bot);
  const g = String(groupId ?? "");
  if (!r || !isValidGroupId(g) || !own(r.sewa, g)) return false;
  delete r.sewa[g];
  rapikan(bot);
  jadwalkanTulis();
  return true;
}

/** Semua sewa grup bot ini, urut dari yang paling cepat habis. */
export function listBotSewa(bot) {
  const r = ruang(bot);
  if (!r) return [];
  return Object.keys(r.sewa)
    .map((groupId) => ({ groupId, ...r.sewa[groupId] }))
    .sort((a, b) => a.expired - b.expired);
}

// ── Versi "salah satu ID" ──────────────────────────────────────
// Satu orang bisa muncul sebagai nomor HP (628xx@s.whatsapp.net) atau LID
// (xxx@lid) tergantung grup & versi WhatsApp. autoresbot.js mengumpulkan
// semua ID-nya (messageInfo.userKeys); data per bot dicocokkan ke mana saja.
function daftarKunci(users) {
  const arr = Array.isArray(users) ? users : [users];
  return [...new Set(arr.map((u) => String(u ?? "")).filter(isValidUserKey))];
}

/** Apakah bot ini punya data per bot apa pun (premium/limit/sewa)? */
export function hasBotScope(bot) {
  return ruang(bot) !== null;
}

/**
 * Apakah bot ini punya data per USER (premium/bonus limit)? Dipakai
 * autoresbot.js untuk memutuskan perlu tidaknya mencari alias pengirim —
 * bot yang hanya punya data sewa tidak perlu biaya pencarian itu.
 */
export function hasBotUserData(bot) {
  const r = ruang(bot);
  return !!r && (Object.keys(r.premium).length > 0 || Object.keys(r.limitBonus).length > 0);
}

export function getBotPremiumAny(bot, users) {
  let terbaik = null;
  for (const u of daftarKunci(users)) {
    const iso = getBotPremium(bot, u);
    if (iso && (!terbaik || Date.parse(iso) > Date.parse(terbaik))) terbaik = iso;
  }
  return terbaik;
}

export function getLimitBonusAny(bot, users) {
  return daftarKunci(users).reduce((n, u) => n + getLimitBonus(bot, u), 0);
}

/** Pakai bonus dari ID mana saja milik orang ini; mengembalikan yang tertutup. */
export function useLimitBonusAny(bot, users, n) {
  const butuh = Math.max(0, Math.floor(Number(n) || 0));
  let sisa = butuh;
  for (const u of daftarKunci(users)) {
    if (!sisa) break;
    sisa -= useLimitBonus(bot, u, sisa);
  }
  return butuh - sisa;
}

// ── Target perintah (.addprem / .addlimit / .delprem) ──────────
function digitJid(jid) {
  return String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

/**
 * Cari orang yang dituju: mention → nomor / username yang ditulis
 * (findUserFn disuntikkan pemanggil supaya modul ini tidak bergantung ke
 * users.js) → pesan yang dibalas. Mention berbentuk LID dicoba diubah ke
 * nomor HP lewat lidMapping Baileys.
 *
 * Pesan yang dibalas sengaja paling akhir dan hanya dipakai kalau tidak
 * ada target yang diketik: owner sering mengetik ".addprem 628xx 30" sambil
 * kebetulan membalas pesan orang lain, dan dulu premium/limit malah jatuh
 * ke orang yang dibalas, bukan nomor yang ditulis.
 *
 * Nomor yang diketik harus 8–15 digit (format nomor telepon internasional),
 * jadi teks asal-asalan atau ID grup tidak bisa jadi kunci data.
 *
 * @returns {Promise<null | { number: string, keys: string[], jid: string }>}
 *   number = kunci utama, keys = semua ID orang itu (HP & LID), jid = untuk mention.
 */
export async function resolveTargetUser(sock, messageInfo = {}, arg = "", findUserFn = null) {
  const teks = String(arg || "").trim();
  let jid = "";
  const mentions = Array.isArray(messageInfo.mentionedJid) ? messageInfo.mentionedJid : [];
  if (mentions.length && typeof mentions[0] === "string") {
    jid = mentions[0];
  } else if (!teks && messageInfo.isQuoted && typeof messageInfo.quotedMessage?.sender === "string") {
    jid = messageInfo.quotedMessage.sender;
  }

  if (jid) {
    if (jid.endsWith("@g.us") || jid.endsWith("@newsletter") || jid.endsWith("@broadcast")) {
      return null;
    }
    const keys = [];
    let mentionJid = jid;
    if (jid.endsWith("@lid")) {
      try {
        const pn = await sock?.signalRepository?.lidMapping?.getPNForLID?.(jid);
        const nomor = digitJid(pn);
        if (isValidUserKey(nomor)) {
          keys.push(nomor);
          mentionJid = `${nomor}@s.whatsapp.net`;
        }
      } catch {
        /* LID tidak bisa dipetakan: pakai LID-nya saja */
      }
    }
    const d = digitJid(jid);
    if (isValidUserKey(d) && !keys.includes(d)) keys.push(d);
    if (!keys.length) return null;
    return { number: keys[0], keys, jid: mentionJid };
  }

  if (!teks) return null;

  // Nomor yang diketik: boleh pakai +, spasi, strip, atau "@628xx".
  if (/^[@+]?[\d\s-]+$/.test(teks)) {
    let d = teks.replace(/\D/g, "");
    if (d.startsWith("0")) d = `62${d.slice(1)}`;
    if (d.length < 8 || d.length > 15) return null;
    return { number: d, keys: [d], jid: `${d}@s.whatsapp.net` };
  }

  // Username yang terdaftar di bot (users.json).
  if (typeof findUserFn === "function" && /^[\w.-]{2,40}$/.test(teks)) {
    try {
      const hasil = await findUserFn(teks.toLowerCase());
      const aliases = Array.isArray(hasil?.[1]?.aliases) ? hasil[1].aliases : [];
      const hp = aliases.find((a) => String(a).endsWith("@s.whatsapp.net"));
      const keys = [...new Set([hp, ...aliases].filter(Boolean).map(digitJid))].filter(isValidUserKey);
      if (keys.length) {
        return { number: keys[0], keys, jid: hp || `${keys[0]}@s.whatsapp.net` };
      }
    } catch {
      /* anggap tidak ketemu */
    }
  }
  return null;
}

/**
 * Teks tambahan untuk tampilan "Sisa Limit" di plugin: " (+N bonus bot ini)"
 * kalau pengirim punya bonus limit dari owner bot ini, selain itu "".
 */
export function bonusLimitText(messageInfo = {}) {
  if (!messageInfo?.isJadibot || !isValidBotKey(messageInfo?.botNumber)) return "";
  const keys =
    Array.isArray(messageInfo.userKeys) && messageInfo.userKeys.length
      ? messageInfo.userKeys
      : [digitJid(messageInfo.sender)];
  const n = getLimitBonusAny(messageInfo.botNumber, keys);
  return n > 0 ? ` (+${n} bonus bot ini)` : "";
}

// ── Siapa boleh menulis ke mana ────────────────────────────────
/**
 * Tentukan ruang data untuk perintah premium/limit/sewa:
 * - owner utama (operator)          → { mode: "global" } (perilaku lama)
 * - owner bot di bot milik user     → { mode: "bot", bot } (hanya bot ini)
 * - selain itu (mis. "owner" dashboard yang menempel di bot utama) → null,
 *   perintah harus ditolak. Tanpa ini, nomor bot utama yang pernah diklaim
 *   di dashboard bisa membuat owner-nya menulis data global.
 */
export function scopeFor(messageInfo = {}) {
  if (messageInfo?.isMainOwner) return { mode: "global" };
  if (messageInfo?.isJadibot && messageInfo?.isBotOwner && isValidBotKey(messageInfo?.botNumber)) {
    return { mode: "bot", bot: String(messageInfo.botNumber) };
  }
  return null;
}

// ── Pembersihan ────────────────────────────────────────────────
/**
 * Hapus semua data per bot milik nomor ini. Dipanggil saat bot dihapus dari
 * dashboard, supaya nomor yang nanti dipakai orang lain tidak mewarisi
 * premium/limit/sewa pemilik lama.
 */
export function purgeBot(number) {
  const s = muat();
  const k = String(number ?? "").replace(/\D/g, "");
  if (!isValidBotKey(k) || !own(s, k)) return false;
  delete s[k];
  jadwalkanTulis();
  return true;
}

/** Kosongkan seluruh data per bot (dipakai .reset owner utama). */
export function resetAllBotScope() {
  store = kosong();
  jadwalkanTulis();
  flushBotScope();
}

// ── Identitas bot (nama & kontak owner) ────────────────────────
/**
 * Nama & kontak owner yang ditampilkan bot ini. Bot milik user TIDAK boleh
 * menampilkan nomor operator: nama = nama bot di dashboard (paket berbayar)
 * → nama bawaan; kontak = owner pertama di dashboard → nomor bot sendiri.
 */
export function getBotIdentity(messageInfo = {}) {
  const { sessionConfig = {}, isJadibot, botNumber } = messageInfo || {};
  const namaDashboard = String(sessionConfig?.botName || "").trim();
  if (isJadibot) {
    const owners = Array.isArray(sessionConfig?.owners) ? sessionConfig.owners : [];
    const owner = String(owners[0] || botNumber || "").replace(/\D/g, "");
    return {
      isUserBot: true,
      name: namaDashboard || config.bot_name,
      owner,
      ownerLink: owner ? `https://wa.me/${owner}` : "",
    };
  }
  const owner = String((config.owner_number || [])[0] || "").replace(/\D/g, "");
  return {
    isUserBot: false,
    name: namaDashboard || config.bot_name,
    owner,
    ownerLink: owner ? `https://wa.me/${owner}` : "",
  };
}

/** Tanggal untuk balasan bot, selalu WIB (server bisa di zona lain). */
export function formatTanggalWIB(waktu) {
  const d = new Date(waktu);
  if (Number.isNaN(d.getTime())) return "-";
  try {
    return (
      d.toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }) + " WIB"
    );
  } catch {
    return d.toISOString();
  }
}

// ── Teks sewa/premium yang bisa diedit di dashboard ────────────
export const MAX_TEKS_EDIT = 1500;
const RE_PLACEHOLDER = /\{(botname|ownerlink|owner|prefix|pushname|weburl)\}/gi;

/**
 * Isi placeholder {botname} {owner} {ownerlink} {prefix} {pushname} {weburl}.
 * Diganti sekali jalan (bukan replace berantai) supaya nama/pushname yang
 * kebetulan berisi "{owner}" tidak ikut diganti lagi.
 */
export function renderBotText(template, vars = {}) {
  const peta = {
    botname: vars.botname ?? "",
    owner: vars.owner ?? "",
    ownerlink: vars.ownerlink ?? "",
    prefix: vars.prefix ?? ".",
    pushname: vars.pushname ?? "",
    weburl: vars.weburl ?? config.web_url,
  };
  return String(template ?? "")
    .slice(0, MAX_TEKS_EDIT)
    .replace(RE_PLACEHOLDER, (_, k) => String(peta[k.toLowerCase()] ?? ""));
}

export default {
  BATAS,
  normalizeUserNumber,
  isValidBotKey,
  isValidUserKey,
  isValidGroupId,
  isBotPremium,
  getBotPremium,
  hasBotPremiumEntries,
  addBotPremium,
  delBotPremium,
  listBotPremium,
  getLimitBonus,
  addLimitBonus,
  useLimitBonus,
  getBotSewa,
  addBotSewa,
  delBotSewa,
  listBotSewa,
  hasBotScope,
  hasBotUserData,
  getBotPremiumAny,
  getLimitBonusAny,
  useLimitBonusAny,
  bonusLimitText,
  scopeFor,
  resolveTargetUser,
  purgeBot,
  resetAllBotScope,
  reloadBotScope,
  flushBotScope,
  getBotIdentity,
  formatTanggalWIB,
  renderBotText,
  MAX_TEKS_EDIT,
};
