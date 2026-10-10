/**
 * lib/api-gateway.js — Bot API: kirim pesan WhatsApp dari aplikasi sendiri.
 *
 *   POST /api/v1/text   header x-varesa-token  body { number, text }
 *   POST /api/v1/image  header x-varesa-token  body { number, url, caption }
 *   GET  /api/v1/me     header x-varesa-token
 *
 * Token (`vrs_` + 32 hex) disimpan di config bot itu sendiri (jadibot.json,
 * field `apiToken`), jadi satu token = satu nomor bot. Token dibuat/diganti
 * dari dashboard lewat /api/bot/api-token oleh pemilik bot.
 *
 * Pengaman yang dipasang:
 *  - Kuota harian per BOT (bukan per token) sesuai paket pemilik — ganti
 *    token tidak me-reset kuota.
 *  - Rate limit 1 pesan/detik (burst 3) per bot: WhatsApp cepat memblokir
 *    nomor yang mengirim beruntun, dan itu merugikan pelanggan sendiri.
 *  - URL gambar diunduh oleh server KITA dengan pemeriksaan alamat, supaya
 *    endpoint ini tidak bisa dipakai menembak jaringan internal (SSRF).
 *  - Dicatat ke log command live (tanpa isi pesan / nomor tujuan).
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import net from "net";
import http from "http";
import https from "https";
import dnsCb from "dns";
import dns from "dns/promises";
import { listJadibot, updateBotConfig, getBotConfig } from "./jadibot.js";
import { sessions } from "./cache.js";
import { logCommand, maskNumber, jakartaDayKey, nextJakartaMidnight } from "./monitor.js";

export const API_QUOTA = { free: 50, basic: 1000, plus: 5000, booster: 20000 };
const TIER_LABEL = { free: "Free", basic: "Core", plus: "Prime", booster: "Zenith" };
const TOKEN_RE = /^vrs_[a-f0-9]{32}$/;
const MAX_TEXT = 4096;
const MAX_CAPTION = 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const RATE_PER_SEC = 1;
const RATE_BURST = 3;
const SEND_TIMEOUT_MS = 30000;
const CREATOR = "Varesa";

const RUNTIME_DIR = path.join(process.cwd(), "database", "runtime");
const USAGE_FILE = path.join(RUNTIME_DIR, "api-usage.json");

class GatewayError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (res, status, message) => res.status(status).json({ creator: CREATOR, status: false, message });

function normTier(t) {
  return Object.prototype.hasOwnProperty.call(API_QUOTA, t) ? t : "free";
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new GatewayError(504, message)), ms);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

/* ------------------------------------------------------------------
   Indeks token -> nomor bot
   ------------------------------------------------------------------ */
let tokenIndex = new Map();
let lastRebuild = 0;

export async function rebuildTokenIndex() {
  const jadibots = (await listJadibot()) || {};
  const next = new Map();
  for (const [number, bot] of Object.entries(jadibots)) {
    const t = bot?.config?.apiToken;
    if (typeof t === "string" && TOKEN_RE.test(t)) next.set(t, number);
  }
  tokenIndex = next;
  lastRebuild = Date.now();
  return next.size;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function resolveToken(token) {
  if (!TOKEN_RE.test(token)) return null;
  let number = tokenIndex.get(token);
  // Indeks bisa ketinggalan kalau jadibot.json diubah di luar modul ini;
  // bangun ulang, tapi paling sering tiap 10 detik supaya token acak dari
  // penyerang tidak bisa memaksa pemindaian terus-menerus.
  if (!number && Date.now() - lastRebuild > 10000) {
    await rebuildTokenIndex();
    number = tokenIndex.get(token);
  }
  if (!number) return null;
  // Selalu dicocokkan ulang ke sumber kebenaran: token yang sudah diganti
  // atau bot yang sudah dihapus langsung tidak berlaku.
  const stored = (await listJadibot())?.[number]?.config?.apiToken;
  if (typeof stored !== "string" || !safeEqual(stored, token)) {
    tokenIndex.delete(token);
    return null;
  }
  return number;
}

function newToken() {
  return `vrs_${crypto.randomBytes(16).toString("hex")}`;
}

/* ------------------------------------------------------------------
   Kuota harian (disimpan ke file supaya restart tidak me-reset kuota)
   ------------------------------------------------------------------ */
const usage = { day: jakartaDayKey(), counts: {} };
let usageDirty = false;
let usageTimer = null;

function loadUsage() {
  try {
    if (!fs.existsSync(USAGE_FILE)) return;
    const s = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
    if (s?.day === usage.day && s.counts && typeof s.counts === "object") {
      for (const [k, v] of Object.entries(s.counts)) {
        if (/^\d{5,20}$/.test(k) && Number(v) > 0) usage.counts[k] = Math.floor(Number(v));
      }
    }
  } catch (err) {
    console.error("[api] gagal memuat api-usage.json:", err.message);
  }
}

export function flushApiUsage() {
  if (!usageDirty) return;
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    const tmp = `${USAGE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(usage));
    fs.renameSync(tmp, USAGE_FILE);
    usageDirty = false;
  } catch (err) {
    console.error("[api] gagal menyimpan api-usage.json:", err.message);
  }
}

function rollUsage() {
  const day = jakartaDayKey();
  if (day !== usage.day) {
    usage.day = day;
    usage.counts = {};
    usageDirty = true;
  }
}

function usedToday(number) {
  rollUsage();
  return usage.counts[number] || 0;
}

function addUsage(number, delta) {
  rollUsage();
  usage.counts[number] = Math.max(0, (usage.counts[number] || 0) + delta);
  usageDirty = true;
}

function quotaInfo(number, tier) {
  return { used: usedToday(number), limit: API_QUOTA[tier], resetAt: nextJakartaMidnight().iso };
}

/* ------------------------------------------------------------------
   Rate limit: token bucket per bot
   ------------------------------------------------------------------ */
const buckets = new Map(); // number -> { tokens, at }

function takeRate(number) {
  const now = Date.now();
  const b = buckets.get(number) || { tokens: RATE_BURST, at: now };
  b.tokens = Math.min(RATE_BURST, b.tokens + ((now - b.at) / 1000) * RATE_PER_SEC);
  b.at = now;
  buckets.set(number, b);
  if (b.tokens < 1) return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - b.tokens) / RATE_PER_SEC)) };
  b.tokens -= 1;
  return { ok: true };
}

function refundRate(number) {
  const b = buckets.get(number);
  if (b) b.tokens = Math.min(RATE_BURST, b.tokens + 1);
}

/* ------------------------------------------------------------------
   Validasi input
   ------------------------------------------------------------------ */
function normalizeTarget(input) {
  let n = String(input ?? "").trim().replace(/@s\.whatsapp\.net$/i, "");
  if (!n) throw new GatewayError(422, "Nomor tujuan (number) wajib diisi.");
  if (!/^\+?[\d\s-]+$/.test(n)) {
    throw new GatewayError(422, "Nomor tujuan hanya boleh angka, format internasional (mis. 6281234567890).");
  }
  n = n.replace(/\D/g, "");
  // Kebiasaan menulis 08xx di Indonesia: ubah ke format internasional.
  if (n.startsWith("0")) n = `62${n.slice(1)}`;
  if (n.length < 8 || n.length > 15) throw new GatewayError(422, "Nomor tujuan harus 8–15 digit.");
  return n;
}

const PRIVATE_V4 = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

function v4ToInt(ip) {
  return ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}

// IPv6 -> 8 angka 16-bit. Mendukung "::" dan IPv4 tertanam di ujung
// ("::ffff:1.2.3.4"). null kalau bukan IPv6 yang valid.
function expandV6(ip) {
  let s = ip.toLowerCase().split("%")[0];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    if (!net.isIPv4(v4[1])) return null;
    const n = v4ToInt(v4[1]);
    s = s.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const parts = [...head, ...Array(Math.max(0, fill)).fill("0"), ...tail];
  if (parts.length !== 8) return null;
  const nums = parts.map((h) => parseInt(h, 16));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? nums : null;
}

const v4FromGroups = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");

// Alamat yang TIDAK boleh dijangkau lewat /api/v1/image (SSRF).
// IPv6 dicek dalam bentuk angka, bukan regex teks: URL WHATWG mengubah
// "[::ffff:127.0.0.1]" menjadi "::ffff:7f00:1" yang dulu lolos dari regex.
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const x = v4ToInt(ip);
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (x & mask) === (v4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const g = expandV6(ip);
    if (!g) return true;
    const zeros = (n) => g.slice(0, n).every((x) => x === 0);
    if (zeros(5) && g[5] === 0xffff) return isPrivateAddress(v4FromGroups(g[6], g[7])); // ::ffff:a.b.c.d
    if (zeros(6)) return true;                                                          // ::, ::1, ::a.b.c.d (usang)
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateAddress(v4FromGroups(g[6], g[7])); // NAT64
    if (g[0] === 0x2002) return isPrivateAddress(v4FromGroups(g[1], g[2]));             // 6to4
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast
    return false;
  }
  return true; // bukan IP yang dikenali -> anggap tidak aman
}

// Pemeriksaan URL sebelum dihubungi: skema, kredensial, dan host berupa IP
// literal. Nama domain diperiksa lagi SAAT TERSAMBUNG lewat guardedLookup,
// jadi DNS yang berganti alamat di antara cek & koneksi (DNS rebinding)
// tetap tertangkap.
async function assertPublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new GatewayError(422, "URL gambar tidak valid."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new GatewayError(422, "URL gambar harus diawali http:// atau https://.");
  }
  if (url.username || url.password) throw new GatewayError(422, "URL gambar tidak boleh berisi kredensial.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new GatewayError(422, "URL gambar tidak boleh mengarah ke jaringan internal.");
    return url;
  }
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
      throw new GatewayError(422, "URL gambar tidak boleh mengarah ke jaringan internal.");
    }
  } catch (err) {
    if (err instanceof GatewayError) throw err;
    throw new GatewayError(422, "Domain URL gambar tidak ditemukan.");
  }
  return url;
}

// lookup yang dipakai socket saat benar-benar menyambung: alamat yang
// dipakai koneksi = alamat yang diperiksa. Mendukung bentuk { all: true }
// yang dipakai Node 20 (autoSelectFamily).
function guardedLookup(hostname, options, callback) {
  dnsCb.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      const e = new Error("Alamat internal diblokir");
      e.code = "EPRIVATE";
      return callback(e);
    }
    return Array.isArray(address) ? callback(null, address) : callback(null, address, family);
  });
}

function requestOnce(url, deadline) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.get(url, {
      lookup: guardedLookup,
      headers: { "user-agent": "VaresaBot/1.0 (+https://varesa.mom)", accept: "image/*" },
      timeout: Math.max(1000, deadline - Date.now()),
    }, resolve);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

// Satu server hanya mengunduh beberapa gambar sekaligus. Tanpa batas ini,
// banyak request /api/v1/image yang lambat bisa menumpuk puluhan buffer
// 10 MB di memori -> RSS lewat batas PM2 -> SEMUA bot ikut restart.
const MAX_PARALLEL_DOWNLOADS = 3;
const DOWNLOAD_DEADLINE_MS = 20000; // total semua redirect, bukan per hop
let activeDownloads = 0;

// Gambar diunduh sendiri (bukan diserahkan ke Baileys) supaya setiap
// redirect ikut diperiksa dan ukurannya dibatasi.
async function downloadImage(raw) {
  if (activeDownloads >= MAX_PARALLEL_DOWNLOADS) {
    throw new GatewayError(429, "Server sedang memproses banyak gambar. Coba lagi beberapa detik lagi.");
  }
  activeDownloads++;
  try {
    return await downloadImageInner(raw);
  } finally {
    activeDownloads--;
  }
}

async function downloadImageInner(raw) {
  const deadline = Date.now() + DOWNLOAD_DEADLINE_MS;
  let current = raw;
  for (let hop = 0; hop < 4; hop++) {
    const url = await assertPublicUrl(current);
    let r;
    try {
      r = await requestOnce(url, deadline);
    } catch {
      // Pesan sengaja seragam: jangan jadi "oracle" untuk memetakan host/port.
      throw new GatewayError(422, "Gagal mengunduh gambar dari URL tersebut.");
    }
    const status = r.statusCode || 0;
    if (status >= 300 && status < 400 && r.headers.location) {
      r.resume();
      current = new URL(r.headers.location, url).href;
      continue;
    }
    if (status < 200 || status >= 300) {
      r.resume();
      throw new GatewayError(422, "Gagal mengunduh gambar dari URL tersebut.");
    }
    const type = String(r.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (!/^image\/(jpeg|jpg|png|webp|gif)$/.test(type)) {
      r.resume();
      throw new GatewayError(422, "URL harus mengarah ke gambar JPG, PNG, WEBP, atau GIF.");
    }
    if (Number(r.headers["content-length"]) > MAX_IMAGE_BYTES) {
      r.destroy();
      throw new GatewayError(422, "Ukuran gambar maksimal 10 MB.");
    }
    const chunks = [];
    let total = 0;
    try {
      for await (const chunk of r) {
        if (Date.now() > deadline) throw new GatewayError(422, "Gagal mengunduh gambar: terlalu lama.");
        total += chunk.length;
        if (total > MAX_IMAGE_BYTES) throw new GatewayError(422, "Ukuran gambar maksimal 10 MB.");
        chunks.push(chunk);
      }
    } catch (err) {
      r.destroy();
      if (err instanceof GatewayError) throw err;
      throw new GatewayError(422, "Gagal mengunduh gambar dari URL tersebut.");
    }
    if (!total) throw new GatewayError(422, "Gambar kosong.");
    // Chunk dari modul http sudah Buffer -> cukup satu kali concat.
    return { buffer: Buffer.concat(chunks, total), mimetype: type === "image/jpg" ? "image/jpeg" : type };
  }
  throw new GatewayError(422, "Terlalu banyak redirect pada URL gambar.");
}

// Cache hasil cek nomor terdaftar di WhatsApp (mengurangi query ke WA).
const waCache = new Map();
const WA_CACHE_MS = 10 * 60 * 1000;

async function checkRegistered(sock, jid) {
  const hit = waCache.get(jid);
  if (hit && Date.now() - hit.at < WA_CACHE_MS) return hit.value;
  if (typeof sock.onWhatsApp !== "function") return { exists: null };
  let value = { exists: null };
  try {
    const res = await withTimeout(sock.onWhatsApp(jid), 5000, "timeout");
    // Baileys hanya mengembalikan nomor yang TERDAFTAR; array kosong
    // berarti nomornya tidak memakai WhatsApp.
    if (Array.isArray(res)) {
      const found = res.find((r) => r?.exists);
      value = found ? { exists: true, jid: found.jid || jid } : { exists: false };
    }
  } catch {
    return { exists: null }; // tidak pasti -> jangan ditolak, coba kirim saja
  }
  if (waCache.size > 5000) waCache.clear();
  waCache.set(jid, { at: Date.now(), value });
  return value;
}

/* ------------------------------------------------------------------
   Middleware & handler
   ------------------------------------------------------------------ */
async function authToken(req, res, next) {
  try {
    let token = String(req.headers["x-varesa-token"] || "").trim();
    if (!token) {
      const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ""));
      if (m) token = m[1];
    }
    if (!token) return fail(res, 401, "Token API wajib dikirim lewat header x-varesa-token.");
    const number = await resolveToken(token);
    if (!number) return fail(res, 401, "Token API tidak valid atau sudah diganti.");
    const cfg = await getBotConfig(number);
    req.apiBot = { number, tier: normTier(cfg.tier) };
    next();
  } catch (err) {
    console.error("[api] auth gagal:", err.message);
    return fail(res, 500, "Terjadi kesalahan di server.");
  }
}

function setQuotaHeaders(res, number, tier) {
  const q = quotaInfo(number, tier);
  res.setHeader("X-RateLimit-Limit", String(q.limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, q.limit - q.used)));
  res.setHeader("X-RateLimit-Reset", q.resetAt);
}

function messageResult(sent, jid) {
  const ts = sent?.messageTimestamp;
  const n = Number(typeof ts === "object" && ts !== null ? ts.toString() : ts);
  return {
    key: {
      remoteJid: sent?.key?.remoteJid || jid,
      fromMe: true,
      id: sent?.key?.id || "",
    },
    messageTimestamp: Number.isFinite(n) && n > 0 ? n : Math.floor(Date.now() / 1000),
    status: "SENT",
  };
}

/**
 * Alur bersama /v1/text dan /v1/image:
 * validasi -> bot online -> rate limit -> kuota -> cek nomor -> kirim.
 */
async function sendVia(req, res, kind, buildContent) {
  const { number: bot, tier } = req.apiBot;
  const started = Date.now();
  let reserved = false;
  let attempted = false;
  try {
    const target = normalizeTarget(req.body?.number);
    const prepared = await buildContent.validate(req.body || {});

    const sock = sessions.get(`session-${bot}`);
    if (!sock?.user) throw new GatewayError(409, "Bot sedang offline. Jalankan bot dari dashboard dulu.");

    const rate = takeRate(bot);
    if (!rate.ok) {
      res.setHeader("Retry-After", String(rate.retryAfter));
      throw new GatewayError(429, "Terlalu cepat. Maksimal 1 pesan per detik.");
    }

    const limit = API_QUOTA[tier];
    if (usedToday(bot) >= limit) {
      refundRate(bot);
      throw new GatewayError(429, `Kuota harian paket ${TIER_LABEL[tier]} habis (${limit} pesan). Reset pukul 00:00 WIB.`);
    }
    // Kuota dipesan SEBELUM mengirim supaya request paralel tidak bisa
    // melewati batas; dikembalikan kalau pengiriman gagal.
    addUsage(bot, 1);
    reserved = true;

    let jid = `${target}@s.whatsapp.net`;
    const reg = await checkRegistered(sock, jid);
    if (reg.exists === false) throw new GatewayError(422, "Nomor tujuan tidak terdaftar di WhatsApp.");
    if (reg.jid) jid = reg.jid;

    const content = await buildContent.make(prepared);
    attempted = true;
    const sent = await withTimeout(sock.sendMessage(jid, content), SEND_TIMEOUT_MS, "WhatsApp tidak merespons. Coba lagi sebentar.");
    logCommand({ bot, command: `api.${kind}`, isGroup: false, ok: true, ms: Date.now() - started, plugin: "api" });
    setQuotaHeaders(res, bot, tier);
    return res.json({ creator: CREATOR, status: true, data: messageResult(sent, jid) });
  } catch (err) {
    if (reserved) addUsage(bot, -1);
    if (attempted) {
      logCommand({ bot, command: `api.${kind}`, isGroup: false, ok: false, ms: Date.now() - started, plugin: "api" });
    }
    if (err instanceof GatewayError) return fail(res, err.status, err.message);
    console.error(`[api] gagal kirim ${kind} via ${bot}:`, err?.message || err);
    return fail(res, 500, "Gagal mengirim pesan lewat WhatsApp.");
  }
}

const TEXT_CONTENT = {
  async validate(body) {
    if (typeof body.text !== "string" || !body.text.trim()) throw new GatewayError(422, "Teks (text) wajib diisi.");
    if (body.text.length > MAX_TEXT) throw new GatewayError(422, `Teks maksimal ${MAX_TEXT} karakter.`);
    return { text: body.text };
  },
  async make(p) {
    return { text: p.text };
  },
};

const IMAGE_CONTENT = {
  async validate(body) {
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) throw new GatewayError(422, "URL gambar (url) wajib diisi.");
    if (url.length > 2048) throw new GatewayError(422, "URL gambar terlalu panjang.");
    if (body.caption !== undefined && typeof body.caption !== "string") {
      throw new GatewayError(422, "Caption harus berupa teks.");
    }
    const caption = body.caption || "";
    if (caption.length > MAX_CAPTION) throw new GatewayError(422, `Caption maksimal ${MAX_CAPTION} karakter.`);
    await assertPublicUrl(url);
    return { url, caption };
  },
  async make(p) {
    const img = await downloadImage(p.url);
    return { image: img.buffer, mimetype: img.mimetype, ...(p.caption ? { caption: p.caption } : {}) };
  },
};

/**
 * Pasang semua route Bot API ke `app`.
 * `assertBotOwner` disuntikkan dari webserver.js (butuh model User).
 */
export function mountApiGateway(app, { assertBotOwner }) {
  loadUsage();
  usageTimer = setInterval(flushApiUsage, 60000);
  usageTimer.unref?.();
  process.once("exit", flushApiUsage);
  rebuildTokenIndex().catch((err) => console.error("[api] gagal membangun indeks token:", err.message));

  // ── Kelola token (dashboard) ──────────────────────────────────
  async function ownerContext(req, number) {
    if (!/^\d{5,20}$/.test(number)) return { ok: false, status: 400, message: "Nomor bot tidak valid." };
    // Dicek terdaftar DULU: assertBotOwner bisa mengklaim nomor yatim, dan
    // endpoint token tidak boleh jadi jalan pintas untuk mengklaim nomor
    // yang belum pernah dijalankan.
    const jadibots = (await listJadibot()) || {};
    if (!jadibots[number]) return { ok: false, status: 404, message: "Bot belum terdaftar. Jalankan (Start) bot dulu." };
    const userId = req.body?.userId || req.query?.userId || req.headers["x-user-id"];
    const own = await assertBotOwner(userId, number);
    if (!own.ok) return { ok: false, status: 403, message: own.message };
    return { ok: true };
  }

  app.get("/api/bot/api-token/:number", async (req, res) => {
    try {
      const number = String(req.params.number || "").replace(/\D/g, "");
      const ctx = await ownerContext(req, number);
      if (!ctx.ok) return res.status(ctx.status).json({ success: false, message: ctx.message });
      const cfg = await getBotConfig(number);
      const tier = normTier(cfg.tier);
      const q = quotaInfo(number, tier);
      res.json({
        success: true,
        token: typeof cfg.apiToken === "string" && TOKEN_RE.test(cfg.apiToken) ? cfg.apiToken : "",
        usage: { today: q.used, limit: q.limit, resetAt: q.resetAt },
        tier,
        rate: { perSecond: RATE_PER_SEC, burst: RATE_BURST },
      });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  // Buat / ganti token. Body { number, userId, revoke?: true } — revoke
  // mengosongkan token sehingga API untuk bot ini mati total.
  app.post("/api/bot/api-token", async (req, res) => {
    try {
      const number = String(req.body?.number || "").replace(/\D/g, "");
      const ctx = await ownerContext(req, number);
      if (!ctx.ok) return res.status(ctx.status).json({ success: false, message: ctx.message });
      const token = req.body?.revoke === true ? "" : newToken();
      await updateBotConfig(number, { apiToken: token });
      await rebuildTokenIndex();
      res.json({ success: true, token });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  // ── Endpoint publik ber-token ─────────────────────────────────
  app.get("/api/v1/me", authToken, (req, res) => {
    const { number, tier } = req.apiBot;
    const sock = sessions.get(`session-${number}`);
    setQuotaHeaders(res, number, tier);
    res.json({
      creator: CREATOR,
      status: true,
      data: { bot: maskNumber(number), online: !!sock?.user, tier, quota: quotaInfo(number, tier) },
    });
  });

  app.post("/api/v1/text", authToken, (req, res) => sendVia(req, res, "text", TEXT_CONTENT));
  app.post("/api/v1/image", authToken, (req, res) => sendVia(req, res, "image", IMAGE_CONTENT));

  // Path /api/v1 lain dijawab dengan bentuk error yang sama, bukan HTML.
  app.all(/^\/api\/v1(\/.*)?$/, (req, res) => fail(res, 404, "Endpoint tidak ditemukan. Lihat dokumentasi API di dashboard."));
}

export default { mountApiGateway, rebuildTokenIndex, flushApiUsage, isPrivateAddress, API_QUOTA };
