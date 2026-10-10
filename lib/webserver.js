import express from "express";
import config from "../config.js";
import path from "path";
import cors from "cors";
import mongoose from "mongoose";
import fs from "fs";
import { connectToWhatsApp, eventBus } from "./connection.js";
import { updateJadibot, getJadibot, deleteJadibot, listJadibot, updateBotConfig, getBotConfig, setTierResolver, invalidateTier } from "./jadibot.js";
import { sessions } from "./cache.js";
import { deleteFolderRecursive } from "./utils.js";
import { startTierEnforcer } from "./tier-enforcer.js";
import { setWelcome, setLeft, setTemplateWelcome, deleteMessage } from "./participants.js";
import { getStats, setGroupCount, getGroupsCached, listStats } from "./bot-stats.js";
import {
  configureMonitor, startMonitor, getLiveSnapshot, getCapacity, getPerf, getMonitorSummary,
  invalidateLiveCache, checkStartCapacity
} from "./monitor.js";
import { getSiteSettings, updateSiteSettings, getBotLimits, SettingsError } from "./site-settings.js";
import { mountApiGateway } from "./api-gateway.js";
import { getPluginCategory } from "./handler.js";
import { Addon, ADDON_CATALOG, hasActiveAddon, invalidateAddonCache } from "./addons.js";
import {
  createQris, checkQrisStatus, cancelQris,
  verifyWebhookSignature, mapStatus, INVOICE_TTL_MS
} from "./payment.js";
import { OAuth2Client } from 'google-auth-library';

const app = express();
// Pterodactyl menyuntikkan nomor port lewat SERVER_PORT, bukan PORT.
// Kalau ini tidak dibaca, server nyala di port lain sementara panel/CF
// Tunnel mengarah ke port alokasi (mis. 4526), jadi web terlihat mati.
const PORT = process.env.SERVER_PORT || process.env.PORT || 4526;
const PORT_SOURCE = process.env.SERVER_PORT ? "SERVER_PORT" : (process.env.PORT ? "PORT" : "default");

// Diberitahukan di log supaya ketahuan kalau port aplikasi dan tujuan
// Cloudflare Tunnel tidak sama — itu penyebab 502 yang sulit dilacak.
console.log(`[i] Port web: ${PORT} (dari ${PORT_SOURCE}). Pastikan Cloudflare Tunnel juga menunjuk ke localhost:${PORT}`);
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || "141130713954-udk7re4el6sugi4n39t9lus71rur76mg.apps.googleusercontent.com");

// PENTING: kredensial database sebaiknya lewat environment variable (.env),
// bukan ditulis langsung di source code. Nilai di bawah cuma fallback
// supaya tidak langsung crash kalau .env belum diisi.
const MONGO_URI = process.env.MONGO_URI || "";
if (!MONGO_URI) {
  console.error("⛔ MONGO_URI belum diisi di .env — login, pembayaran & dashboard tidak akan berfungsi.");
}

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 })
  .then(() => console.log("[✔] Berhasil terhubung ke MongoDB Atlas"))
  .catch(err => {
    // err.name saja sudah cukup untuk tahu jenis masalahnya, tanpa perlu
    // menelusuri dump topology yang panjang.
    console.error(`❌ Koneksi MongoDB gagal (${err.name}): ${err.message}`);
    if (err.name === "MongoServerSelectionError") {
      console.error(
        "   -> Server tidak terjangkau sama sekali. Cek: (1) IP server ini sudah " +
        "di-whitelist di Atlas Network Access, (2) cluster tidak sedang di-pause, " +
        "(3) tidak ada firewall yang memblokir port 27017 keluar."
      );
    }
    if (err.name === "MongoServerError" && /auth/i.test(err.message)) {
      console.error("   -> Username/password database salah atau sudah diganti.");
    }
  });

mongoose.connection.on("disconnected", () => console.warn("[!] Koneksi MongoDB terputus."));
// Migrasi paket akun -> paket bot dijalankan setiap kali tersambung (awal
// maupun sambung ulang). Aman diulang: akun yang sudah dimigrasi dilewati,
// jadi biayanya cuma satu query kecil. Event "connected" dipakai (bukan
// .then di atas) supaya migrasi sudah berjalan sebelum resolver tier
// sempat membaca dokumen Bot.
mongoose.connection.on("connected", () => { runLegacyMigration(); });
mongoose.connection.on("reconnected", () => console.log("[✔] MongoDB tersambung kembali."));

// Schema Database SaaS
const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  email: { type: String, default: "" },
  username: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  tier: { type: String, default: 'free' },
  tierExpiredAt: { type: String, default: "" },
  balance: { type: Number, default: 0 },
  avatar: String,
  avatarUrl: { type: String, default: "" },
  // Nomor bot yang pernah disimpan confignya oleh akun ini. Dipakai supaya
  // saat tier expired, downgrade-nya bisa diteruskan ke config bot yang
  // sedang berjalan juga (bukan cuma akun-nya doang).
  botNumbers: { type: [String], default: [] },

  // --- Paket per bot (lihat model Bot di bawah) ---
  // `tier`/`tierExpiredAt` di atas sekarang LEGACY: hanya dibaca sekali oleh
  // migrasi. Paket yang belum punya bot (bot berbayar dihapus, atau order
  // lama tanpa nomor bot) disimpan di sini dan otomatis dipasang ke bot
  // berikutnya yang ditambahkan user.
  pendingTier: { type: String, default: "" },
  pendingTierExpiredAt: { type: String, default: "" },
  legacyMigrated: { type: Boolean, default: false },

  // --- Referral & kredit ---
  refCode: { type: String, default: "", index: true },  // kode milik user ini
  referredBy: { type: String, default: "" },            // id user yang mengajak
  refRewarded: { type: Boolean, default: false },       // sudah pernah menghasilkan hadiah?
  credit: { type: Number, default: 0 },                 // saldo kredit (rupiah)
  createdAt: { type: String, default: () => new Date().toISOString() }
});
const User = mongoose.model('User', userSchema);

// Password TIDAK PERNAH boleh ikut terkirim ke browser. Dulu beberapa
// endpoint mengembalikan dokumen User mentah, sehingga field password ikut
// tersimpan di localStorage dan terlihat di DevTools / panel admin.
function toPublicUser(user) {
  if (!user) return user;
  const obj = typeof user.toObject === "function" ? user.toObject() : { ...user };
  delete obj.password;
  delete obj.legacyMigrated; // urusan internal migrasi, tidak perlu di browser
  return obj;
}

// ==========================================
// PAKET PER BOT
// ==========================================
// Keputusan owner (Okt 2026): paket Core/Prime/Zenith melekat ke BOT (nomor
// WhatsApp), bukan ke akun. Satu akun boleh punya beberapa bot dan tiap bot
// bisa beda paket — bot Free dan bot berbayar bisa jalan berdampingan.
// Pembayaran selalu untuk SATU bot tertentu.
//
// Kenapa koleksi sendiri (bukan field di User): paket, label, dan masa
// aktif sekarang milik nomor bot. Kalau tetap ditumpuk di dokumen User,
// setiap bot tambahan berarti array bersarang yang susah di-query dan
// gampang tidak sinkron. User.botNumbers TETAP dipertahankan (disinkronkan
// dengan Bot.ownerId) karena masih dipakai kode lama (referral, kepemilikan).
const botSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true }, // angka saja
  ownerId: { type: String, default: "", index: true },    // User.id pemilik
  label: { type: String, default: "" },                    // nama tampilan di dashboard (<=32)
  tier: { type: String, default: "free" },                 // free|basic|plus|booster
  tierExpiredAt: { type: String, default: "" },            // ISO; "" untuk free / permanen
  createdAt: { type: String, default: () => new Date().toISOString() }
});
const Bot = mongoose.models.Bot || mongoose.model('Bot', botSchema);

// Nama tampilan paket. Kunci database sengaja TETAP basic/plus/booster —
// mengganti kuncinya akan memutus data user yang sudah bayar, invoice lama,
// dan config bot yang sudah tersimpan. Yang berganti hanya labelnya.
const TIER_LABEL = { free: "Free", basic: "Core", plus: "Prime", booster: "Zenith" };
const TIER_RANK = { free: 0, basic: 1, plus: 2, booster: 3 };
const DAY_MS = 86400000;
const isPaidTier = (t) => t === "basic" || t === "plus" || t === "booster";

// Paket yang BENAR-BENAR berlaku sekarang. Masa aktif dicek di sini, saat
// itu juga — tidak menunggu job kedaluwarsa yang jalan tiap 10 menit.
// tierExpiredAt kosong pada paket berbayar = permanen (diberi admin).
function effectiveTier(doc) {
  const tier = doc?.tier;
  if (!isPaidTier(tier)) return "free";
  if (doc.tierExpiredAt) {
    const exp = new Date(doc.tierExpiredAt);
    if (!isNaN(exp) && exp <= new Date()) return "free";
  }
  return tier;
}

function daysLeftOf(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / DAY_MS));
}

// Kedaluwarsa sebagai angka untuk dibandingkan; "" (permanen) = tak hingga.
function expiryMs(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return isNaN(t) ? 0 : t;
}

// Ringkasan paket satu bot — bentuk yang sama dipakai dashboard, admin,
// /api/bot/config, dan invoice supaya tidak ada dua cara menghitung.
function botPackage(doc) {
  const tier = effectiveTier(doc);
  const tierExpiredAt = tier === "free" ? "" : (doc?.tierExpiredAt || "");
  return { tier, tierName: TIER_LABEL[tier], tierExpiredAt, daysLeft: daysLeftOf(tierExpiredAt) };
}

// Paket tertunda milik user (belum terpasang ke bot mana pun). null kalau
// tidak ada atau sudah lewat masa aktifnya — sisa waktu tetap berjalan
// selama tertunda, sama seperti kalau masih terpasang di bot.
function pendingOf(user) {
  const tier = user?.pendingTier;
  if (!isPaidTier(tier)) return null;
  const expiredAt = user.pendingTierExpiredAt || "";
  if (expiredAt && expiryMs(expiredAt) <= Date.now()) return null;
  return { tier, tierName: TIER_LABEL[tier], expiredAt, daysLeft: daysLeftOf(expiredAt) };
}

// Paket tertinggi yang aktif di antara bot-bot user. HANYA untuk tampilan
// dan kompatibilitas (`user.tier` lama di dashboard/admin) — hak akses
// selalu dari paket bot itu sendiri.
function topPackage(bots) {
  let top = botPackage(null);
  for (const b of bots || []) {
    const p = botPackage(b);
    if (TIER_RANK[p.tier] > TIER_RANK[top.tier] ||
        (p.tier === top.tier && p.tier !== "free" && expiryMs(p.tierExpiredAt) > expiryMs(top.tierExpiredAt))) {
      top = p;
    }
  }
  return top;
}

// Nilai rupiah sisa paket (untuk memilih paket mana yang disimpan saat
// dua paket berebut satu slot "tertunda"). Permanen = tak hingga.
function packageValue({ tier, expiredAt }, pricing) {
  if (!isPaidTier(tier)) return 0;
  if (!expiredAt) return Infinity;
  const days = Math.max(0, (expiryMs(expiredAt) - Date.now()) / DAY_MS);
  return days * ((pricing?.[tier] || 0) / 30);
}

// Pastikan dokumen Bot untuk nomor ini ada. Dokumen yang SUDAH ada tidak
// pernah ditimpa (paket & pemiliknya tetap) — kecuali belum punya pemilik,
// maka dicatat ke `ownerId`. Dipakai migrasi & data lama yang belum punya
// dokumen Bot.
async function ensureBotDoc(number, ownerId = "") {
  let doc;
  try {
    doc = await Bot.findOneAndUpdate(
      { number },
      { $setOnInsert: { ownerId, label: "", tier: "free", tierExpiredAt: "", createdAt: new Date().toISOString() } },
      { upsert: true, returnDocument: "after" }
    ).lean();
  } catch (err) {
    // Dua upsert bersamaan untuk nomor yang sama: salah satunya kena
    // duplicate key — cukup baca dokumen yang menang.
    if (err?.code !== 11000) throw err;
    doc = await Bot.findOne({ number }).lean();
  }
  if (doc && !doc.ownerId && ownerId) {
    const r = await Bot.updateOne({ number, ownerId: { $in: ["", null] } }, { $set: { ownerId } });
    if (r.modifiedCount) doc.ownerId = ownerId;
  }
  return doc;
}

// Semua bot milik user, urut dari yang paling lama. Nomor lama di
// user.botNumbers yang belum punya dokumen Bot (data sebelum migrasi)
// sekalian dibuatkan, supaya hitungan batas & daftar bot selalu lengkap.
async function botsOfUser(user) {
  const docs = await Bot.find({ ownerId: user.id }).sort({ createdAt: 1 }).lean();
  const have = new Set(docs.map((d) => d.number));
  for (const raw of user.botNumbers || []) {
    const number = normalizeBotNumber(raw);
    if (!number || have.has(number)) continue;
    const doc = await ensureBotDoc(number, user.id);
    if (doc?.ownerId === user.id) { docs.push(doc); have.add(number); }
  }
  return docs;
}

// Bentuk user untuk browser: tanpa password, dengan `tier` = paket
// TERTINGGI yang aktif di antara bot-botnya (kompatibilitas tampilan lama)
// dan `bots` = daftar ringan paket tiap bot.
async function decorateUser(user) {
  const obj = toPublicUser(user);
  if (!obj?.id) return obj;
  try {
    const bots = await botsOfUser(obj);
    const top = topPackage(bots);
    obj.tier = top.tier;
    obj.tierExpiredAt = top.tierExpiredAt;
    obj.bots = bots.map((b) => {
      const p = botPackage(b);
      return { number: b.number, tier: p.tier, tierExpiredAt: p.tierExpiredAt };
    });
    obj.pending = pendingOf(obj);
  } catch (err) {
    console.error("[user] gagal membaca paket bot:", err.message);
  }
  return obj;
}

// Paket tiap pemilik (untuk tabel admin & leaderboard) dalam SATU query.
async function botsByOwner(ownerIds) {
  const map = new Map();
  if (!ownerIds.length) return map;
  const docs = await Bot.find({ ownerId: { $in: ownerIds } }).select("number ownerId tier tierExpiredAt").lean();
  for (const d of docs) {
    if (!map.has(d.ownerId)) map.set(d.ownerId, []);
    map.get(d.ownerId).push(d);
  }
  return map;
}

// ── Migrasi paket akun -> paket bot ────────────────────────────
// Model lama: 1 akun = 1 bot, paket di User.tier. Untuk setiap akun yang
// belum dimigrasi:
//   1. buat dokumen Bot untuk setiap nomornya (botNumbers + entri
//      jadibot.json dengan config.ownerId akun itu) — paket bot yang sudah
//      ada tidak ditimpa;
//   2. paket berbayar yang masih aktif dipindah ke bot PERTAMA (persis,
//      karena dulu memang cuma satu bot) — hanya kalau bot itu masih Free;
//      akun tanpa bot mendapat paket tertunda;
//   3. tandai legacyMigrated supaya tidak diproses dua kali.
// Aman dijalankan setiap boot: akun yang sudah ditandai dilewati.
async function migrateLegacyTiers() {
  const users = await User.find({ legacyMigrated: { $ne: true } }).lean();
  const summary = { users: users.length, bots: 0, moved: 0, pending: 0 };
  if (!users.length) return summary;

  // Nomor dari jadibot.json per pemilik (config.ownerId).
  const byOwner = new Map();
  const jadibots = await listJadibot();
  for (const [key, entry] of Object.entries(jadibots || {})) {
    const ownerId = entry?.config?.ownerId;
    const number = normalizeBotNumber(key);
    if (typeof ownerId !== "string" || !ownerId || !number) continue;
    if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
    byOwner.get(ownerId).push(number);
  }
  const mainNumber = String(config.phone_number_bot || "").replace(/\D/g, "");

  for (const user of users) {
    try {
      const numbers = [...new Set([
        ...(user.botNumbers || []).map(normalizeBotNumber),
        ...(byOwner.get(user.id) || [])
      ])].filter((n) => n && n !== mainNumber);

      const owned = [];
      for (const number of numbers) {
        const doc = await ensureBotDoc(number, user.id);
        if (doc?.ownerId !== user.id) continue;
        // Nama bot yang dulu diisi di dashboard (config.botName) dipakai
        // sebagai label, supaya daftar "Bot saya" tidak penuh "Bot tanpa nama".
        const oldName = String(jadibots?.[number]?.config?.botName || "")
          .replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 32);
        if (!doc.label && oldName) {
          await Bot.updateOne({ number, label: { $in: ["", null] } }, { $set: { label: oldName } });
          doc.label = oldName;
        }
        owned.push(doc);
      }
      summary.bots += owned.length;
      if (owned.length) {
        await User.updateOne({ id: user.id }, { $addToSet: { botNumbers: { $each: owned.map((d) => d.number) } } });
      }

      const legacyTier = user.tier;
      const legacyExp = user.tierExpiredAt || "";
      const masihAktif = isPaidTier(legacyTier) && (!legacyExp || expiryMs(legacyExp) > Date.now());
      if (masihAktif) {
        const first = owned[0];
        if (first) {
          if (effectiveTier(first) === "free") {
            await Bot.updateOne({ number: first.number }, { $set: { tier: legacyTier, tierExpiredAt: legacyExp } });
            await updateBotConfig(first.number, { tier: legacyTier });
            invalidateTier(first.number);
            summary.moved++;
          }
        } else if (!pendingOf(user)) {
          await User.updateOne({ id: user.id }, { $set: { pendingTier: legacyTier, pendingTierExpiredAt: legacyExp } });
          summary.pending++;
        }
      }
      await User.updateOne({ id: user.id }, { $set: { legacyMigrated: true } });
    } catch (err) {
      // Akun ini dicoba lagi di boot berikutnya (belum ditandai).
      console.error(`[migrasi] gagal untuk akun ${user.id}:`, err.message);
    }
  }

  invalidateTier();
  console.log(
    `[migrasi] ${summary.users} akun, ${summary.bots} bot, ${summary.moved + summary.pending} paket dipindah` +
    (summary.pending ? ` (${summary.pending} jadi paket tertunda karena akunnya belum punya bot)` : "")
  );
  return summary;
}

let migrationRun = null;
function runLegacyMigration() {
  if (migrationRun) return migrationRun;
  migrationRun = migrateLegacyTiers()
    .catch((err) => console.error("[migrasi] gagal:", err.message))
    .finally(() => { migrationRun = null; });
  return migrationRun;
}

// Pembaca tier menunggu migrasi yang sedang jalan (maks 5 detik) supaya
// bot berbayar tidak sempat dibaca "Free" lalu ter-cache 30 detik tepat
// sesudah server tersambung ke database.
async function waitForMigration() {
  if (!migrationRun) return;
  await Promise.race([migrationRun, new Promise((r) => setTimeout(r, 5000).unref?.())]);
}

// lib/monitor.js tidak boleh mengimpor webserver.js (impor sirkular), jadi
// hal yang butuh database & statistik bot disuntikkan dari sini.
configureMonitor({
  // countDocuments dijalankan monitor paling sering tiap 60 detik dan HANYA
  // saat DB tersambung — tidak pernah menahan respons /api/public/live.
  countUsers: () => User.countDocuments({}),
  isDbUp: () => mongoose.connection.readyState === 1,
  listBotStats: listStats,
});

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Object, required: true }
});
const Setting = mongoose.model('Setting', settingSchema);

const promoSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true },
  discount: { type: Number, required: true }, // Persentase diskon
  maxUses: { type: Number, default: 100 },
  usedCount: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true }
});
const Promo = mongoose.model('Promo', promoSchema);

// Invoice / transaksi pembayaran (Pakasir)
const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  username: { type: String, default: "" },
  email: { type: String, default: "" },
  kind: { type: String, default: "tier" },     // tier | addon
  tier: { type: String, default: "" },         // basic | plus | booster (untuk kind=tier)
  addonType: { type: String, default: "" },    // mlbb_unlimited (untuk kind=addon)
  addonDays: { type: Number, default: 0 },
  botNumber: { type: String, default: "" },    // nomor bot tujuan paket / add-on
  appliedTo: { type: String, default: "" },    // paket: "bot" | "pending" (diisi saat lunas)
  months: { type: Number, default: 1 },
  subtotal: { type: Number, required: true },  // harga sebelum diskon
  discount: { type: Number, default: 0 },      // nominal potongan
  promoCode: { type: String, default: "" },
  amount: { type: Number, required: true },    // yang dikirim ke Pakasir
  fee: { type: Number, default: 0 },
  totalPayment: { type: Number, default: 0 },
  paymentMethod: { type: String, default: "qris" },
  paymentNumber: { type: String, default: "" }, // qr_string dari gateway
  qrUrl: { type: String, default: "" },         // gambar QRIS siap pakai
  checkoutUrl: { type: String, default: "" },
  gatewayTrxId: { type: String, default: "" },  // transaction_id di AutoGopay
  status: { type: String, default: "pending" }, // pending | completed | cancelled | expired
  creditUsed: { type: Number, default: 0 },   // kredit referral yang dipakai
  refDiscount: { type: Number, default: 0 },  // potongan karena pakai kode referral
  bonusDays: { type: Number, default: 0 },   // hari bonus dari prorata paket lama
  proration: { type: String, default: "" },  // baru | perpanjangan | upgrade prorata | downgrade prorata
  expiredAt: { type: String, default: "" },
  completedAt: { type: String, default: "" },
  createdAt: { type: String, default: () => new Date().toISOString() }
});
const Order = mongoose.model('Order', orderSchema);

// Model & katalog add-on tinggal di lib/addons.js supaya plugin bot bisa
// ikut memakainya tanpa mengimpor webserver.js (menghindari impor sirkular).

// Catatan perubahan yang dilakukan admin. Tanpa ini, perubahan tier atau
// harga tidak meninggalkan jejak sama sekali — dan saat ada sengketa
// pembayaran, tidak ada bukti siapa mengubah apa.
const auditSchema = new mongoose.Schema({
  at: { type: String, default: () => new Date().toISOString() },
  adminId: { type: String, default: "" },
  adminName: { type: String, default: "" },
  action: { type: String, required: true },
  target: { type: String, default: "" },
  detail: { type: String, default: "" }
});
auditSchema.index({ at: -1 });
const AuditLog = mongoose.model('AuditLog', auditSchema);

async function writeAudit(req, action, target, detail) {
  try {
    const adminId = req.headers['x-user-id'] || "";
    const admin = adminId ? await User.findOne({ id: adminId }).lean() : null;
    await AuditLog.create({
      adminId,
      adminName: admin?.username || "(tidak diketahui)",
      action, target: String(target || ""), detail: String(detail || "")
    });
  } catch (err) {
    console.error("[audit] gagal mencatat:", err.message);
  }
}

// Catatan referral yang sudah menghasilkan hadiah.
const referralSchema = new mongoose.Schema({
  referrerId: { type: String, required: true, index: true },
  referredId: { type: String, required: true, unique: true },
  orderId: { type: String, default: "" },
  rewardCredit: { type: Number, default: 0 },
  at: { type: String, default: () => new Date().toISOString() }
});
const Referral = mongoose.model('Referral', referralSchema);

app.use(cors());
// `verify` menyimpan body MENTAH sebelum di-parse. Verifikasi signature
// webhook harus memakai ini, bukan hasil stringify ulang.
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); }
}));

// Kunci berawalan "$" dibuang dari body JSON sebelum sampai ke handler.
// Tanpa ini, body seperti {"userId": {"$ne": "x"}} langsung jadi operator
// query MongoDB (NoSQL injection): User.findOne({ id: { $ne: "x" } })
// mengembalikan user PERTAMA di koleksi — sering kali akun admin — dan
// semua pengecekan kepemilikan bot (stop/hapus bot orang, ambil token API
// bot orang) ikut lolos. Tidak ada data sah yang memakai kunci "$".
// (Query string aman: Express 5 memakai parser "simple" tanpa objek.)
function stripMongoOperators(value, depth = 0) {
  if (depth > 20 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    value.forEach((v) => stripMongoOperators(v, depth + 1));
    return value;
  }
  for (const key of Object.keys(value)) {
    if (key.startsWith("$")) delete value[key];
    else stripMongoOperators(value[key], depth + 1);
  }
  return value;
}
app.use((req, _res, next) => {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) stripMongoOperators(req.body);
  next();
});

const WEB_DIR = path.join(process.cwd(), "JadiVaresaWeb");

// URL bersih tanpa akhiran .html untuk halaman utama.
const CLEAN_ROUTES = { "/login": "login.html", "/dashboard": "dashboard.html", "/admin": "admin.html", "/invoice": "invoice.html", "/status": "status.html" };
Object.entries(CLEAN_ROUTES).forEach(([route, file]) => {
  app.get(route, (req, res) => res.sendFile(path.join(WEB_DIR, file)));
});

// Tautan/bookmark lama yang masih pakai .html tetap jalan, dialihkan permanen
// ke URL bersih supaya tidak ada link mati.
const LEGACY_REDIRECTS = { "/login.html": "/login", "/dashboard.html": "/dashboard", "/admin.html": "/admin", "/invoice.html": "/invoice", "/index.html": "/" };
Object.entries(LEGACY_REDIRECTS).forEach(([oldPath, newPath]) => {
  app.get(oldPath, (req, res) => {
    // BUG SEBELUMNYA: redirect ke `newPath` mentah membuang query string.
    // Akibatnya /invoice.html?order_id=XXX -> /invoice (order_id HILANG),
    // lalu invoice.html langsung mental balik ke dashboard karena
    // mengira tidak ada order_id di URL. Sekarang query string dibawa serta.
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(301, newPath + qs);
  });
});

// Health check: untuk memastikan apakah 502 berasal dari aplikasi yang mati
// atau dari tunnel/port yang salah arah. Buka /healthz — kalau ini membalas,
// aplikasinya hidup dan masalahnya ada di tunnel/proxy.
app.get("/healthz", (req, res) => {
  res.json({
    ok: true,
    port: PORT,
    mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    sessions: sessions.size,
    sseClients: sseClients.length,
    uptimeSec: Math.round(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    // Ringkasan beban & kapasitas: cukup untuk tahu apakah "web lambat"
    // karena server memang penuh.
    ...getMonitorSummary()
  });
});

// File unggahan admin (banner) disajikan apa adanya; nosniff mencegah
// browser menebak-nebak tipe file (mis. menjalankan file sebagai HTML).
app.use("/uploads", (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

app.use(express.static(WEB_DIR));

// ==========================================
// SSE & LIVE MONITOR
// ==========================================
// BUG SEBELUMNYA: semua event (termasuk PAIRING CODE) dikirim ke SELURUH
// client yang terhubung. Siapa pun yang membuka dashboard bisa melihat
// pairing code milik orang lain dan membajak sesi WhatsApp-nya.
// Sekarang tiap client mendaftarkan nomor bot miliknya, dan event khusus
// bot hanya dikirim ke pemiliknya. Statistik server tetap ke semua.
let sseClients = []; // { res, number, at }

const MAX_SSE_CLIENTS = 200;       // batas total koneksi terbuka
const MAX_SSE_PER_NUMBER = 3;      // batas per nomor bot (mis. 3 tab terbuka)

app.get("/api/bot/events", (req, res) => {
  const number = (req.query.number || "").toString();

  // Tanpa nomor bot, koneksi ini tidak menerima apa pun selain statistik
  // server. Di log tunnel terlihat banyak stream /api/bot/events tanpa
  // ?number= — itu koneksi sia-sia yang tetap memakan slot stream
  // Cloudflare. Ditolak halus supaya browser tidak terus mencoba.
  if (!number) return res.status(204).end();

  // Tolak kalau sudah terlalu banyak koneksi terbuka. Tanpa batas ini, setiap
  // tab/refresh menambah stream yang ditahan selamanya; Cloudflare Tunnel
  // punya batas stream per koneksi, dan kalau habis SEMUA request lain ikut
  // gagal -> 502 di seluruh situs.
  if (sseClients.length >= MAX_SSE_CLIENTS) {
    return res.status(503).end();
  }
  if (number) {
    const sameNumber = sseClients.filter(c => c.number === number);
    // Tutup yang paling lama supaya tab baru tetap dapat tempat.
    while (sameNumber.length >= MAX_SSE_PER_NUMBER) {
      const oldest = sameNumber.shift();
      try { oldest.res.end(); } catch {}
      sseClients = sseClients.filter(c => c !== oldest);
    }
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Cegah proxy (nginx / Cloudflare) menahan buffer stream ini.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // Komentar pembuka: memaksa stream terkirim sekarang, bukan menunggu
  // data pertama.
  res.write(": connected\n\n");

  const client = { res, number, at: Date.now(), lastActivity: Date.now(), owner: false };
  sseClients.push(client);
  // Cuplikan pesan & nama pengirim di bot_stats hanya untuk pemilik bot
  // (atau admin). Diverifikasi sekali di latar belakang; sampai terbukti,
  // stream tetap jalan tapi cuplikannya dikosongkan.
  isOwnerOrAdmin(String(req.query.userId || ""), number).then((ok) => { client.owner = ok; });

  const cleanup = () => {
    clearInterval(ping);
    clearInterval(idleCheck);
    sseClients = sseClients.filter(c => c !== client);
  };

  // Ping tiap 20 detik. Cloudflare memutus stream yang diam; tanpa ping,
  // koneksi di-cancel lalu browser reconnect terus-menerus (inilah
  // "stream canceled by remote" yang muncul di log tunnel).
  const ping = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { cleanup(); }
  }, 20000);

  // Tutup paksa stream yang menganggur.
  //
  // Alasannya penting: di Pterodactyl UDP/QUIC biasanya diblokir, jadi
  // cloudflared memakai HTTP/2 — yang membatasi jumlah stream bersamaan
  // per koneksi. SSE menahan satu stream selamanya. Kalau banyak tab
  // dibiarkan terbuka, kuota stream habis dan SEMUA request lain ikut
  // gagal (502 di seluruh situs) walaupun aplikasinya sehat.
  //
  // Stream yang 10 menit tidak menerima event apa pun ditutup; browser
  // akan menyambung lagi sendiri saat memang dibutuhkan.
  const IDLE_LIMIT_MS = 10 * 60 * 1000;
  const idleCheck = setInterval(() => {
    if (Date.now() - client.lastActivity > IDLE_LIMIT_MS) {
      try { res.write("event: idle_close\ndata: {}\n\n"); res.end(); } catch {}
      cleanup();
    }
  }, 60000);

  req.on("close", cleanup);
  req.on("error", cleanup);
  res.on("error", cleanup);
});

// Kirim ke semua client (dipakai untuk statistik server yang memang umum).
function broadcastEvent(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const dead = [];
  sseClients.forEach(c => {
    try { c.res.write(payload); } catch { dead.push(c); }
  });
  // Buang koneksi yang sudah mati; kalau dibiarkan, daftarnya menumpuk
  // dan tiap siaran menulis ke socket yang tidak ada lagi.
  if (dead.length) sseClients = sseClients.filter(c => !dead.includes(c));
}

// Kirim hanya ke client yang memantau nomor bot tertentu.
function emitToBot(number, event, data) {
  if (!number) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const dead = [];
  sseClients
    .filter(c => c.number === String(number))
    .forEach(c => {
      try { c.res.write(payload); c.lastActivity = Date.now(); } catch { dead.push(c); }
    });
  if (dead.length) sseClients = sseClients.filter(c => !dead.includes(c));
}

eventBus.on("pairing", (data) => emitToBot(data?.number, "pairing", data));
// connection.js selalu menyertakan `number` di tiap bot_log, jadi log bisa
// diarahkan ketat ke pemiliknya saja — tidak ada lagi yang disiarkan umum.
eventBus.on("bot_log", (data) => emitToBot(data?.number, "bot_log", data));

setInterval(() => {
  // Tidak ada yang memantau -> tidak perlu menghitung apa pun.
  // Sebelumnya statistik tetap dihitung & disiarkan tiap 5 detik walau
  // dashboard tidak sedang dibuka siapa pun.
  if (sseClients.length === 0) return;

  // Angka diambil dari lib/monitor.js (CPU & RAM jatah CONTAINER, bukan
  // mesin induk). Rumus lama memakai os.loadavg() x 10 yang tidak ada
  // hubungannya dengan persen CPU, dan RAM mesin induk Pterodactyl.
  const perf = getPerf();
  const cap = getCapacity();
  const uptimeSec = process.uptime();
  const d = Math.floor(uptimeSec / (3600 * 24));
  const h = Math.floor((uptimeSec % (3600 * 24)) / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);

  // ram/cpu tetap string ber-1-desimal & uptime tetap format lama supaya
  // dashboard versi lama tetap jalan; field lain tambahan.
  broadcastEvent("server_stats", {
    ram: perf.ramPercent.toFixed(1),
    cpu: perf.cpuPercent.toFixed(1),
    uptime: `${d}h ${h}j ${m}m`,
    ramUsedMB: perf.ramUsedMB,
    ramLimitMB: perf.ramLimitMB,
    processMB: perf.processMB,
    lagMs: perf.lagMs,
    msgPerSec: perf.msgPerSec,
    capacity: { max: cap.max, used: cap.used, remaining: cap.remaining, status: cap.status }
  });

  // Kirim statistik hidup ke masing-masing pemilik bot (bukan ke semua).
  const watched = new Set(sseClients.map(c => c.number).filter(Boolean));
  watched.forEach((number) => {
    const s = getStats(number);
    const sock = sessions.get(`session-${number}`);
    const base = {
      online: !!sock?.user,
      messages: s?.messages || 0,
      commands: s?.commands || 0,
      groupMessages: s?.groupMessages || 0,
      privateMessages: s?.privateMessages || 0,
      groups: s?.groups || 0,
      lastActivity: s?.lastActivity || null
    };
    const recent = (s?.recent || []).slice(0, 8);
    const full = `event: bot_stats\ndata: ${JSON.stringify({ ...base, recent })}\n\n`;
    const masked = `event: bot_stats\ndata: ${JSON.stringify({ ...base, recent: maskRecent(recent) })}\n\n`;
    sseClients
      .filter(c => c.number === number)
      .forEach(c => {
        try { c.res.write(c.owner ? full : masked); c.lastActivity = Date.now(); } catch {}
      });
  });
}, 5000);

// Cek kepemilikan TANPA efek samping — beda dengan assertBotOwner yang
// bisa mengklaim bot "yatim". Dipakai untuk data yang cuma DIBACA
// (cuplikan pesan di statistik bot). Saat DB putus hasilnya false: lebih
// baik cuplikan tidak tampil daripada bocor ke orang lain.
async function isOwnerOrAdmin(userId, number) {
  if (typeof userId !== "string" || !userId || !number) return false;
  if (mongoose.connection.readyState !== 1) return false;
  try {
    const user = await User.findOne({ id: userId }).select("role botNumbers").lean();
    if (!user) return false;
    if (user.role === "admin" || (user.botNumbers || []).includes(String(number))) return true;
    if (await Bot.exists({ number: String(number), ownerId: userId })) return true;
    const jadibots = await listJadibot();
    return jadibots[number]?.config?.ownerId === userId;
  } catch {
    return false;
  }
}

// Nomor bot itu semi-publik (orang memang chat ke bot), jadi siapa pun
// bisa membuka statistik/stream nomor mana pun. Nama pengirim & cuplikan
// pesan dikosongkan untuk yang bukan pemilik; angka & waktu tetap ada.
function maskRecent(list) {
  return (list || []).map(r => ({ at: r.at, isGroup: r.isGroup, command: r.command || null, from: "", preview: "" }));
}

// Jumlah grup di-refresh terpisah tiap 60 detik. groupFetchAllParticipating()
// cukup berat untuk dipanggil tiap 5 detik, sementara jumlah grup jarang
// berubah — jadi tidak perlu seagresif statistik pesan.
setInterval(async () => {
  if (sessions.size === 0) return;
  for (const [key, sock] of sessions.entries()) {
    if (!sock?.user) continue;
    const number = key.replace("session-", "");
    // getGroupsCached sekaligus memperbarui cache + jumlah grup.
    await getGroupsCached(number, sock, { force: true });
  }
}, 60000);

// ==========================================
// API: AUTH & PROFIL
// ==========================================
app.post("/api/auth/google", async (req, res) => {
  try {
    const { credential } = req.body;
    // Database putus: jawab langsung. Tanpa ini User.findOne menunggu buffer
    // Mongoose ~10 detik lalu gagal sebagai "Autentikasi gagal." (401), dan
    // login.html tidak bisa membedakannya dari token Google yang ditolak.
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, code: "DB_DOWN", message: "Database belum tersambung. Coba lagi sebentar lagi." });
    }
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: "141130713954-udk7re4el6sugi4n39t9lus71rur76mg.apps.googleusercontent.com",
    });
    const payload = ticket.getPayload();
    const userid = payload['sub'];
    const email = (payload['email'] || "").toLowerCase();
    const usernameStr = payload['name']; // Mengambil nama asli Google tanpa di-lowercase

    // Validasi admin HANYA dari email Google, sesuai permintaan.
    const isAdmin = (email === "manzz92us@gmail.com");
    const assignRole = isAdmin ? "admin" : "user";
    const assignTier = isAdmin ? "booster" : "free";

    let user = await User.findOne({ id: userid });
    if (!user) {
      // Akun baru langsung ditandai sudah dimigrasi: paketnya per bot sejak
      // awal, jadi `tier` akun (legacy) tidak boleh ikut dipindah ke bot.
      user = await User.create({
        id: userid, email: email, username: usernameStr, password: "oauth_google",
        role: assignRole, tier: assignTier, avatar: payload['picture'], legacyMigrated: true
      });
    } else {
      if (isAdmin && user.role !== "admin") {
        await User.updateOne({ id: userid }, { $set: { role: "admin", tier: "booster", username: usernameStr } });
        user.role = "admin"; user.tier = "booster"; user.username = usernameStr;
      }
    }

    res.json({ success: true, user: await decorateUser(user) });
  } catch (error) { res.status(401).json({ success: false, message: "Autentikasi gagal." }); }
});

// Login username/password DIMATIKAN. Endpoint lama ini tidak pernah
// memeriksa password: cukup mengirim username yang sudah ada (terlihat di
// leaderboard publik) untuk mendapatkan id akunnya — dan id itulah satu-
// satunya "kunci" semua endpoint dashboard (bot, pembayaran, token API).
// Halaman login hanya memakai Google (/api/auth/google), jadi tidak ada
// fitur yang hilang. Dijawab 410 supaya klien lama tahu alasannya.
app.post("/api/auth/login", (req, res) => {
  res.status(410).json({ success: false, message: "Login dengan username sudah tidak tersedia. Silakan masuk dengan Google." });
});

app.post("/api/user/profile", async (req, res) => {
  try {
    const { id, username, avatarUrl } = req.body;
    if (!id) return res.status(400).json({ success: false, message: "ID user diperlukan." });

    // Whitelist: role/tier/balance TIDAK boleh diubah lewat endpoint ini.
    const update = {};
    if (username !== undefined) {
      const name = String(username).trim().slice(0, 40);
      if (!name) return res.status(400).json({ success: false, message: "Username tidak boleh kosong." });
      update.username = name;
    }
    if (avatarUrl !== undefined) {
      const url = String(avatarUrl).trim();
      // Cegah javascript:/data: URI yang bisa dipakai buat XSS di <img>.
      if (url && !/^https?:\/\//i.test(url)) {
        return res.status(400).json({ success: false, message: "URL foto harus diawali http:// atau https://" });
      }
      update.avatarUrl = url.slice(0, 300);
    }

    await User.updateOne({ id }, { $set: update });
    const user = await User.findOne({ id }).select("-password").lean();
    res.json({ success: true, message: "Profil diperbarui.", user: await decorateUser(user) });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// `user.tier` di sini = paket TERTINGGI yang aktif di antara bot-bot user
// (kompatibilitas tampilan lama); `user.bots` = daftar ringan paket per
// bot. Hak akses fitur selalu dari paket bot yang dipilih, bukan dari ini.
app.get("/api/user/me/:id", async (req, res) => {
  try {
    const user = await User.findOne({ id: req.params.id }).select("-password").lean();
    if (!user) return res.status(404).json({ success: false, message: "User tidak ditemukan." });
    res.json({ success: true, user: await decorateUser(user) });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// ==========================================
// API: BOT CONTROL & CONFIG
// ==========================================
// ── Sumber tier untuk bot ──────────────────────────────────────
// Dipasang ke jadibot.js supaya setiap kali bot membaca config-nya, tier
// diambil dari dokumen Bot di database — bukan dari salinan di
// jadibot.json yang bisa ketinggalan. Paket sekarang milik BOT, bukan
// akun pemiliknya, jadi tidak perlu lagi mencari pemilik lebih dulu.
// Tidak ada dokumen Bot (bot utama server, bot yatim) = Free; config.tier
// lama di file sengaja TIDAK dipakai sebagai cadangan, supaya salinan basi
// tidak bisa membuka fitur berbayar.
setTierResolver(async (number) => {
  await waitForMigration();
  const bot = await Bot.findOne({ number: String(number) }).select("tier tierExpiredAt").lean();
  return effectiveTier(bot);
});

// ── Kepemilikan bot ────────────────────────────────────────────
// Satu akun boleh punya BEBERAPA bot (dibatasi pengaturan situs `limits`;
// lihat claimBotNumber). Pemeriksaan pemilik di sini juga menutup lubang
// lama: dulu start/stop/delete sama sekali tidak memeriksa siapa pemilik nomor,
// jadi siapa pun yang tahu nomor bot orang lain bisa mematikan sesinya.
// Nomor bot dinormalkan & divalidasi di SATU tempat. Nomor dipakai sebagai
// kunci jadibot.json dan nama folder sesi (session-<nomor>), jadi teks bebas
// di sini berbahaya: "__proto__" mencemari prototype Object (seluruh API
// error sampai restart) dan "x/../.." membuat hapus-sesi menghapus folder
// di luar project. Hanya angka 8–15 digit (format nomor WhatsApp).
function normalizeBotNumber(value) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const digits = String(value).replace(/\D/g, "");
  return /^\d{8,15}$/.test(digits) ? digits : "";
}

// Klaim nomor dijalankan berurutan PER AKUN. Tanpa ini, dua klik "Tambah
// bot" bersamaan (nomor berbeda) sama-sama lolos cek batas karena keduanya
// menghitung jumlah bot sebelum yang lain sempat tercatat.
const claimLocks = new Map(); // userId -> ekor antrean
function withUserLock(userId, fn) {
  const prev = claimLocks.get(userId) || Promise.resolve();
  const run = prev.then(fn);
  const tail = run.catch(() => {});
  claimLocks.set(userId, tail);
  tail.then(() => { if (claimLocks.get(userId) === tail) claimLocks.delete(userId); });
  return run;
}

function botLimitMessage(code, limits) {
  if (code === "BOT_LIMIT") {
    return `Maksimal ${limits.maxBots} bot per akun. Hapus bot yang tidak dipakai dulu untuk menambah bot baru.`;
  }
  if (limits.maxFree <= 0) {
    return "Bot baru belum bisa memakai paket Free saat ini. Hubungi admin untuk menambah bot.";
  }
  return `Akun gratis cuma boleh ${limits.maxFree} bot Free. Upgrade bot Free kamu dulu (atau hapus) untuk menambah bot baru.`;
}

async function claimBotNumber(userId, rawNumber) {
  // ID user & nomor selalu teks. Objek/array di sini berarti request
  // rekayasa (lihat stripMongoOperators) — tolak tanpa menyentuh database.
  const number = normalizeBotNumber(rawNumber);
  if (!number) return { ok: false, message: "Nomor bot tidak valid. Pakai format 628xxxxxxxxxx." };
  if (typeof userId !== "string" || !userId) {
    return { ok: false, message: "Silakan login ulang." };
  }
  // Nomor bot utama server (config.js / BOT_NUMBER) tidak boleh diklaim
  // sebagai bot user: sesinya sudah jalan dari folder "session", dan klaim
  // akan membuat dua sesi untuk satu nomor yang saling memutus.
  const mainNumber = String(config.phone_number_bot || "").replace(/\D/g, "");
  if (mainNumber && number === mainNumber) {
    return { ok: false, message: "Nomor ini dipakai bot utama server dan tidak bisa didaftarkan sebagai bot." };
  }
  return withUserLock(userId, () => claimBotNumberLocked(userId, number));
}

// SATU AKUN BOLEH BEBERAPA BOT (paket per bot). Aturannya:
//   - nomor milik akun lain -> ditolak;
//   - sudah punya maxBotsPerUser bot -> BOT_LIMIT;
//   - bot baru akan jadi Free padahal jatah bot Free sudah habis ->
//     BOT_LIMIT_FREE (kecuali ada paket tertunda: bot baru langsung
//     memakainya, jadi bukan bot Free);
//   - admin bebas dari kedua batas.
// Batas diatur admin lewat pengaturan situs (limits).
async function claimBotNumberLocked(userId, number) {
  const user = await User.findOne({ id: userId });
  if (!user) return { ok: false, message: "Silakan login ulang." };

  const existing = await Bot.findOne({ number }).lean();

  // Sudah nomornya sendiri: pastikan pencatatan lengkap, lalu lanjut.
  if (existing?.ownerId === userId || (!existing?.ownerId && (user.botNumbers || []).includes(number))) {
    if (!existing?.ownerId) await ensureBotDoc(number, userId);
    await User.updateOne({ id: userId }, { $addToSet: { botNumbers: number } });
    await updateBotConfig(number, { ownerId: userId });
    return { ok: true, user };
  }

  // Nomor sudah dipakai akun lain: tolak. Dokumen Bot adalah sumber utama;
  // botNumbers dicek juga untuk data lama yang belum punya dokumen Bot.
  if (existing?.ownerId) return { ok: false, message: "Nomor ini sudah terdaftar di akun lain." };
  const taken = await User.findOne({ botNumbers: number, id: { $ne: userId } }).select("id").lean();
  if (taken) return { ok: false, message: "Nomor ini sudah terdaftar di akun lain." };

  const isAdmin = user.role === "admin";
  const bots = await botsOfUser(user);
  const cfg = getBotLimits();
  const limits = {
    maxBots: cfg.maxBotsPerUser,
    maxFree: cfg.maxFreeBotsPerUser,
    used: bots.length,
    freeUsed: bots.filter((b) => effectiveTier(b) === "free").length,
  };
  const pending = pendingOf(user);
  // Nomor yatim yang sudah diberi paket oleh admin tidak dihitung Free.
  const incomingTier = effectiveTier(existing);
  const willBeFree = incomingTier === "free" && !pending;

  if (!isAdmin) {
    if (limits.used >= limits.maxBots) {
      return { ok: false, code: "BOT_LIMIT", message: botLimitMessage("BOT_LIMIT", limits), limits };
    }
    if (willBeFree && limits.freeUsed >= limits.maxFree) {
      return { ok: false, code: "BOT_LIMIT_FREE", message: botLimitMessage("BOT_LIMIT_FREE", limits), limits };
    }
  }

  // Paket tertunda "diambil" dulu secara atomik (cocokkan nilai lamanya),
  // supaya satu paket tidak mungkin terpasang ke dua bot sekaligus.
  let applied = null;
  if (pending && incomingTier === "free") {
    const took = await User.updateOne(
      { id: userId, pendingTier: pending.tier, pendingTierExpiredAt: pending.expiredAt },
      { $set: { pendingTier: "", pendingTierExpiredAt: "" } }
    );
    if (took.modifiedCount === 1) applied = pending;
  }

  // Catat pemilik. Filter hanya cocok dengan dokumen tanpa pemilik (atau
  // belum ada sama sekali), jadi kalau akun lain menang balapan, upsert
  // kena duplicate key dan klaim ini ditolak.
  let doc = null;
  try {
    doc = await Bot.findOneAndUpdate(
      { number, ownerId: { $in: ["", null] } },
      {
        $set: { ownerId: userId },
        $setOnInsert: { label: "", tier: "free", tierExpiredAt: "", createdAt: new Date().toISOString() }
      },
      { upsert: true, returnDocument: "after" }
    ).lean();
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
  if (!doc) {
    if (applied) {
      await User.updateOne({ id: userId }, { $set: { pendingTier: applied.tier, pendingTierExpiredAt: applied.expiredAt } });
    }
    return { ok: false, message: "Nomor ini sudah terdaftar di akun lain." };
  }

  if (applied) {
    await Bot.updateOne({ number }, { $set: { tier: applied.tier, tierExpiredAt: applied.expiredAt } });
    console.log(`[paket] Paket tertunda ${applied.tier} milik ${user.username} dipasang ke bot ${number}`);
  }

  await User.updateOne({ id: userId }, { $addToSet: { botNumbers: number } });

  // Pemilik juga dicatat di config bot itu sendiri (dipakai cek kepemilikan
  // cadangan & tampilan lama), plus salinan tier untuk bot yang membaca file.
  await updateBotConfig(number, { ownerId: userId, tier: applied ? applied.tier : effectiveTier(doc) });
  invalidateTier(number);

  return { ok: true, user, pendingApplied: applied };
}

// Pastikan nomor ini benar-benar milik user yang meminta.
// Hasil { ok, user, number } — `number` sudah dinormalkan; pemanggil WAJIB
// memakai nomor dari hasil ini, bukan nilai mentah dari request.
async function assertBotOwner(userId, rawNumber) {
  if (!userId || typeof userId !== "string") return { ok: false, message: "Silakan login ulang." };
  const number = normalizeBotNumber(rawNumber);
  if (!number) return { ok: false, message: "Nomor bot tidak valid." };
  const user = await User.findOne({ id: userId });
  if (!user) return { ok: false, message: "Silakan login ulang." };
  if (user.role === "admin") return { ok: true, user, number }; // admin boleh menangani semua
  if ((user.botNumbers || []).includes(number)) return { ok: true, user, number };

  // Dokumen Bot juga bukti kepemilikan (botNumbers bisa tertinggal), dan
  // sebaliknya: bot yang tercatat milik akun lain langsung ditolak.
  const botDoc = await Bot.findOne({ number }).select("ownerId").lean();
  if (botDoc?.ownerId === user.id) {
    await User.updateOne({ id: user.id }, { $addToSet: { botNumbers: number } });
    return { ok: true, user, number };
  }
  if (botDoc?.ownerId) return { ok: false, message: "Nomor ini bukan milik akun kamu." };

  // Pemulihan otomatis untuk bot "yatim": bot yang tersambung sebelum
  // pencatatan kepemilikan ada, sehingga botNumbers kosong. Dulu user
  // seperti ini ditolak dan tidak bisa menyimpan config sama sekali.
  //
  // Aturannya SAMA PERSIS dengan menekan Start (claimBotNumber): ditolak
  // kalau nomornya milik akun lain atau batas bot akun sudah penuh. Jadi
  // ini tidak membuka celah baru — klaim yang sama sudah bisa dilakukan
  // lewat tombol Start.
  const jadibots = await listJadibot();
  const ownerId = jadibots[number]?.config?.ownerId;
  if (ownerId && ownerId !== user.id) {
    return { ok: false, message: "Nomor ini bukan milik akun kamu." };
  }
  const claim = await claimBotNumber(user.id, number);
  if (!claim.ok) return { ok: false, message: claim.message };
  console.log(`[kepemilikan] Bot ${number} dipulihkan ke ${user.username}`);
  return { ok: true, user: await User.findOne({ id: user.id }), number };
}

// Nomor yang sedang dalam proses start (belum muncul di `sessions`).
// Dilepas saat sesinya sudah terdaftar, atau paling lama 90 detik.
const startingNow = new Map(); // nomor -> timer
function releaseStartSlot(number) {
  const t = startingNow.get(number);
  if (t) clearInterval(t);
  startingNow.delete(number);
}
function reserveStartSlot(number) {
  releaseStartSlot(number);
  const since = Date.now();
  const timer = setInterval(() => {
    if (sessions.has(`session-${number}`) || Date.now() - since > 90000) releaseStartSlot(number);
  }, 2000);
  timer.unref?.();
  startingNow.set(number, timer);
}

app.post("/api/bot/start", async (req, res) => {
  try {
    const { number, userId } = req.body || {};
    if (!number) return res.status(400).json({ success: false, message: "Nomor diperlukan." });
    const cleanNum = normalizeBotNumber(number);
    if (!cleanNum) return res.status(400).json({ success: false, message: "Nomor tidak valid. Pakai format 628xxxxxxxxxx (8–15 digit)." });

    // Penjaga kapasitas: sesi BARU ditolak kalau server sudah penuh, supaya
    // satu bot tambahan tidak membuat RAM jebol dan SEMUA bot ikut mati
    // (PM2 me-restart proses saat melewati max_memory_restart).
    // Restart bot yang sesinya masih hidup tetap boleh (tidak menambah
    // beban), dan admin selalu boleh (untuk penanganan darurat).
    // Dicek SEBELUM klaim nomor supaya penolakan tidak meninggalkan jejak.
    // Logika keputusannya ada di lib/monitor.js (checkStartCapacity) supaya
    // bisa diuji terpisah; query role admin hanya jalan saat server penuh.
    // Slot yang sedang "dipesan" start lain yang belum punya sesi juga
    // dihitung terpakai. Tanpa ini, 5 klik Start bersamaan saat sisa slot 1
    // semuanya lolos, karena sesi baru masuk ke `sessions` belakangan.
    const hasSession = sessions.has(`session-${cleanNum}`) || startingNow.has(cleanNum);
    const capNow = getCapacity();
    const capacity = {
      ...capNow,
      used: capNow.used + startingNow.size,
      remaining: Math.max(0, capNow.remaining - startingNow.size),
    };
    const guard = await checkStartCapacity({
      hasSession,
      capacity,
      isAdmin: async () => {
        const requesterId = userId || req.headers["x-user-id"];
        if (!requesterId) return false;
        const requester = await User.findOne({ id: String(requesterId) }).select("role").lean();
        return requester?.role === "admin";
      }
    });
    if (!guard.allowed) {
      return res.status(503).json({
        success: false,
        code: "SERVER_FULL",
        message: "Server penuh — kapasitas bot sedang habis. Coba lagi beberapa saat lagi atau hubungi admin.",
        capacity: guard.capacity
      });
    }

    // Pesan slot SEKARANG (sinkron, sebelum await berikutnya) supaya request
    // lain yang datang sesudahnya sudah melihat slot ini terpakai.
    if (!hasSession) reserveStartSlot(cleanNum);

    const claim = await claimBotNumber(userId, cleanNum);
    if (!claim.ok) {
      releaseStartSlot(cleanNum);
      return res.status(403).json({ success: false, code: claim.code, message: claim.message, ...(claim.limits ? { limits: claim.limits } : {}) });
    }

    await updateJadibot(cleanNum, "connecting");
    // emitToBot, bukan broadcastEvent: log ini milik satu bot saja.
    emitToBot(cleanNum, "bot_log", { number: cleanNum, message: `Inisialisasi sesi WhatsApp untuk ${cleanNum}...` });

    connectToWhatsApp(`session-${cleanNum}`);
    const applied = claim.pendingApplied;
    res.json({
      success: true,
      message: applied
        ? `Koneksi dimulai. Paket ${applied.tierName} yang tersimpan sudah dipasang ke bot ini.`
        : "Koneksi dimulai.",
      ...(applied ? { pendingApplied: applied } : {})
    });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.post("/api/bot/stop", async (req, res) => {
  try {
    // Dashboard user mengirim userId di body; panel admin mengirimnya
    // lewat header x-user-id. Keduanya harus diterima.
    const userId = req.body.userId || req.headers['x-user-id'];
    const own = await assertBotOwner(userId, req.body.number);
    if (!own.ok) return res.status(403).json({ success: false, message: own.message });
    const number = own.number;

    const sock = sessions.get(`session-${number}`);
    if (sock) { await sock.ws.close(); sessions.delete(`session-${number}`); }
    await updateJadibot(number, "stop");
    emitToBot(number, "bot_log", { number, message: `Bot dihentikan.` });
    res.json({ success: true, message: `Bot dihentikan.` });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Simpan paket aktif bot yang akan dihapus ke paket tertunda pemiliknya.
// Kalau pemilik sudah punya paket tertunda, yang disimpan adalah yang sisa
// NILAINYA lebih besar (hari x harga per hari); seri -> yang lebih lama.
async function stashPackageOnDelete(number) {
  const bot = await Bot.findOne({ number }).lean();
  if (!bot?.ownerId) return null;
  const pkg = botPackage(bot);
  if (pkg.tier === "free") return null;
  const owner = await User.findOne({ id: bot.ownerId }).lean();
  if (!owner) return null;

  let pricing = lastPricing || DEFAULT_PRICING;
  try { pricing = await getPricing(); } catch { /* pakai harga terakhir */ }

  let keep = { tier: pkg.tier, expiredAt: pkg.tierExpiredAt };
  const current = pendingOf(owner);
  if (current) {
    const vNew = packageValue(keep, pricing);
    const vOld = packageValue(current, pricing);
    if (vOld > vNew || (vOld === vNew && expiryMs(current.expiredAt) >= expiryMs(keep.expiredAt))) {
      keep = { tier: current.tier, expiredAt: current.expiredAt };
    }
  }
  await User.updateOne({ id: owner.id }, { $set: { pendingTier: keep.tier, pendingTierExpiredAt: keep.expiredAt } });

  const pending = pendingOf({ pendingTier: keep.tier, pendingTierExpiredAt: keep.expiredAt });
  const sisa = pending.daysLeft == null ? "tanpa batas waktu" : `sisa ${pending.daysLeft} hari`;
  console.log(`[paket] Bot ${number} dihapus; paket ${keep.tier} disimpan sebagai paket tertunda ${owner.username}`);
  return {
    pending,
    message: `Paket ${pending.tierName} (${sisa}) disimpan dan otomatis dipasang ke bot berikutnya yang kamu tambahkan.`
  };
}

app.post("/api/bot/delete", async (req, res) => {
  try {
    const userId = req.body.userId || req.headers['x-user-id'];
    const own = await assertBotOwner(userId, req.body.number);
    if (!own.ok) return res.status(403).json({ success: false, message: own.message });
    const number = own.number; // sudah angka saja -> path di bawah tidak bisa keluar folder

    // Paket berbayar yang masih aktif TIDAK hangus saat bot dihapus: dipindah
    // ke paket tertunda pemiliknya dan otomatis terpasang ke bot berikutnya.
    // Dijalankan PALING AWAL — kalau gagal (DB putus), bot tidak jadi
    // dihapus, daripada paket yang sudah dibayar hilang.
    const saved = await stashPackageOnDelete(number);

    const sock = sessions.get(`session-${number}`);
    if (sock) { try { await sock.logout(); } catch {} sessions.delete(`session-${number}`); }
    deleteFolderRecursive(path.join(process.cwd(), `session-${number}`));
    await deleteJadibot(number);

    // Lepaskan nomor dari PEMILIK ASLINYA. Kalau yang menghapus adalah
    // admin, pemiliknya bukan admin itu sendiri — jadi dicari berdasarkan
    // nomornya, bukan berdasarkan siapa yang menekan tombol.
    await Bot.deleteOne({ number });
    await User.updateMany({ botNumbers: number }, { $pull: { botNumbers: number } });
    invalidateTier(number);

    res.json({
      success: true,
      message: saved
        ? `Sesi dihapus. ${saved.message}`
        : "Sesi dihapus. Kamu bisa daftarkan nomor lain sekarang.",
      pending: saved?.pending || null
    });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.get("/api/bot/config/:number", async (req, res) => {
  try {
    // Hanya pemilik bot (atau admin). Dulu endpoint ini terbuka untuk siapa
    // saja yang tahu nomor bot, dan ikut mengirim ownerId — padahal id user
    // itulah "kunci login" di model x-user-id. Dari situ orang lain bisa
    // mengambil token Bot API & mengendalikan akun pemilik.
    const own = await assertBotOwner(req.query.userId || req.headers["x-user-id"], req.params.number);
    if (!own.ok) return res.status(403).json({ success: false, message: own.message });
    // apiToken & ownerId tetap tidak dikirim: token hanya lewat
    // /api/bot/api-token/:number, ownerId tidak dibutuhkan form dashboard.
    const { apiToken, ownerId, ...data } = await getBotConfig(own.number); // eslint-disable-line no-unused-vars
    // Paket dibaca langsung dari dokumen Bot (bukan cache 30 detik) supaya
    // dashboard langsung melihat hasil pembayaran/perubahan admin.
    const bot = await Bot.findOne({ number: own.number }).lean();
    Object.assign(data, botPackage(bot), { label: bot?.label || "" });
    res.json({ success: true, data });
  }
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// ==========================================
// API: DAFTAR BOT MILIK USER (paket per bot)
// ==========================================
function botRuntimeStatus(number, entry) {
  const sock = sessions.get(`session-${number}`);
  if (sock?.user) return "online";
  if (startingNow.has(number) || sock || entry?.status === "connecting") return "connecting";
  if (entry?.status === "stop") return "stop";
  return "offline";
}

// Semua bot milik user + batas akun + paket tertunda, dalam satu respons
// untuk kartu "Bot saya" di dashboard. Pemilik melihat nomor lengkap
// bot-botnya sendiri (endpoint ini hanya mengembalikan bot milik userId).
app.get("/api/bots/mine", async (req, res) => {
  try {
    const userId = req.query.userId || req.headers["x-user-id"];
    if (typeof userId !== "string" || !userId) return res.status(401).json({ success: false, message: "Silakan login ulang." });
    const user = await User.findOne({ id: userId }).lean();
    if (!user) return res.status(404).json({ success: false, message: "User tidak ditemukan." });

    const docs = await botsOfUser(user);
    const jadibots = await listJadibot();
    const bots = docs.map((b) => {
      const s = getStats(b.number);
      return {
        number: b.number,
        label: b.label || "",
        ...botPackage(b),
        status: botRuntimeStatus(b.number, hasOwnKey(jadibots, b.number) ? jadibots[b.number] : null),
        groups: s?.groups || 0,
        messages: s?.messages || 0,
        commands: s?.commands || 0,
        createdAt: b.createdAt || ""
      };
    });

    const cfg = getBotLimits();
    const cap = getCapacity();
    res.json({
      success: true,
      limits: {
        maxBots: cfg.maxBotsPerUser,
        maxFree: cfg.maxFreeBotsPerUser,
        used: bots.length,
        freeUsed: bots.filter((b) => b.tier === "free").length,
        // Admin tidak terkena batas (untuk penanganan darurat).
        bypass: user.role === "admin"
      },
      pending: pendingOf(user),
      // Sisa kapasitas server untuk teks "Tambah bot" (angka sama dengan
      // /api/public/live, tanpa perlu request kedua).
      capacity: { max: cap.max, remaining: cap.remaining, status: cap.status },
      bots
    });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Hasil hasOwnProperty untuk objek jadibot.json (kunci selalu nomor).
function hasOwnKey(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

// Label bot = nama tampilan di dashboard saja (tidak mengubah nama bot di
// WhatsApp). Teks polos maks. 32 karakter; karakter kontrol & tanda < >
// dibuang supaya aman ditampilkan di mana pun.
app.post("/api/bots/label", async (req, res) => {
  try {
    const { number, label } = req.body || {};
    const userId = req.body?.userId || req.headers["x-user-id"];
    if (label !== undefined && label !== null && typeof label !== "string") {
      return res.status(400).json({ success: false, message: "Label harus berupa teks." });
    }
    const own = await assertBotOwner(userId, number);
    if (!own.ok) return res.status(403).json({ success: false, message: own.message });

    const clean = String(label || "")
      .replace(/[\u0000-\u001F\u007F<>]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 32);

    // Data lama tanpa dokumen Bot: dibuatkan dulu atas nama pemiliknya.
    let bot = await Bot.findOne({ number: own.number }).lean();
    if (!bot) {
      const ownerId = own.user.role === "admin"
        ? ((await User.findOne({ botNumbers: own.number }).select("id").lean())?.id || "")
        : own.user.id;
      bot = await ensureBotDoc(own.number, ownerId);
    }
    await Bot.updateOne({ number: own.number }, { $set: { label: clean } });
    res.json({ success: true, label: clean });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// ── Identitas & tier dari database ─────────────────────────────
// BUG KEAMANAN SEBELUMNYA: tier diambil dari body request (`tier` yang
// dikirim browser). User Free cukup mengubahnya jadi "booster" lewat
// DevTools untuk membuka semua fitur Zenith tanpa membayar. Semua
// pengecekan tier di server bisa dilewati dengan satu baris.
//
// Sekarang tier SELALU dibaca dari database, dan setiap endpoint yang
// mengubah bot juga memastikan bot itu milik si peminta.
async function resolveBotRequest(req) {
  const number = normalizeBotNumber(req.body.number);
  const userId = req.body.userId || req.headers["x-user-id"];
  if (!number) return { ok: false, status: 400, message: "Nomor bot tidak valid." };

  const own = await assertBotOwner(userId, number);
  if (!own.ok) return { ok: false, status: 403, message: own.message };

  // Paket yang berlaku adalah paket BOT ini (bukan paket akun). Admin yang
  // mengelola bot orang lain otomatis memakai paket bot itu juga. Dibaca
  // langsung (bukan cache) supaya batas fitur sesuai pembayaran terbaru.
  const bot = await Bot.findOne({ number }).select("tier tierExpiredAt").lean();
  return { ok: true, number, userId, user: own.user, tier: effectiveTier(bot) };
}

// Batas jumlah nomor owner per paket.
// Free tidak dapat kustomisasi owner sama sekali.
const OWNER_LIMIT_BY_TIER = { free: 0, basic: 1, plus: 3, booster: 5 };
// Kuota aturan pesan otomatis per paket. Harus sinkron dengan app.js.
const AUTOREPLY_QUOTA = { free: 0, basic: 10, plus: 30, booster: 100 };

// Perintah kustom: fitur Prime ke atas. Zenith boleh menyertakan gambar.
// Disimpan di config PER NOMOR BOT, jadi perintah buatan satu user tidak
// pernah muncul di bot user lain — isolasinya otomatis, bukan diatur
// terpisah.
const CUSTOMCMD_QUOTA = { free: 0, basic: 0, plus: 15, booster: 50 };

app.post("/api/bot/config", async (req, res) => {
  try {
    const { ownerNumber, botName, customMenu, menuImage, autoReply, customCommands, watermark, footer, modePublik } = req.body;

    const ctx = await resolveBotRequest(req);
    if (!ctx.ok) return res.status(ctx.status).json({ success: false, message: ctx.message });
    const { number, userId, tier } = ctx;

    // `...configData` dari body sengaja DIHAPUS: dulu field apa pun yang
    // dikirim browser ikut tersimpan ke config bot tanpa disaring.
    let owners = ownerNumber ? ownerNumber.split(',').map(n => n.trim()).filter(Boolean) : [];

    // (Kepemilikan nomor kini ditetapkan saat /api/bot/start lewat
    // claimBotNumber. Dulu di sini ada $addToSet yang, kalau dipanggil
    // admin, malah memasukkan nomor bot korban ke akun admin.)

    const maxOwners = OWNER_LIMIT_BY_TIER[tier] ?? 0;
    if (owners.length > maxOwners) {
      return res.status(400).json({
        success: false,
        message: `Paket ${tier.toUpperCase()} maksimal ${maxOwners} nomor owner. Kurangi jumlah nomor atau upgrade paket.`
      });
    }

    // Server-side enforcement (defense in depth): Free tier tidak boleh
    // menyimpan kustomisasi apapun selain mode publik/grup, walau request
    // dikirim langsung lewat API (bukan lewat UI dashboard yang sudah dikunci).
    const isFree = tier === 'free';
    // BUG KEHILANGAN DATA SEBELUMNYA: endpoint ini dipakai untuk SEMUA
    // penyimpanan (config, menu, pesan otomatis, perintah kustom), tapi
    // ownerNumber/watermark/footer/modePublik SELALU ditulis. Setiap kali
    // user menyimpan menu atau pesan otomatis, nomor owner & watermark-nya
    // ikut terhapus jadi kosong.
    //
    // Sekarang sebuah field hanya ditulis kalau MEMANG dikirim di request.
    const configUpdate = { tier };
    const dikirim = (k) => Object.prototype.hasOwnProperty.call(req.body, k);

    if (dikirim("modePublik")) configUpdate.modePublik = !!modePublik;
    if (dikirim("ownerNumber")) configUpdate.ownerNumber = isFree ? '' : owners.join(',');
    if (dikirim("watermark")) configUpdate.watermark = isFree ? '' : String(watermark || '').slice(0, 100);
    if (dikirim("footer")) configUpdate.footer = isFree ? '' : String(footer || '').slice(0, 100);

    // Nama bot custom: dibuka mulai paket Core. Free tetap memakai nama
    // bawaan dari config.js.
    if (botName !== undefined) {
      configUpdate.botName = isFree ? '' : String(botName).trim().slice(0, 32);
    }
    // Hanya sentuh customMenu/menuImage kalau memang dikirim di request ini
    // (mis. simpan dari panel "Config" biasa TIDAK mengirim field ini),
    // supaya menu kustom yang sudah tersimpan tidak ke-timpa jadi kosong.
    if (customMenu !== undefined) configUpdate.customMenu = isFree ? '' : customMenu;
    if (menuImage !== undefined) configUpdate.menuImage = (tier === 'booster') ? menuImage : '';

    // Perintah kustom: divalidasi ulang di server, bukan cuma di browser.
    if (customCommands !== undefined) {
      const quota = CUSTOMCMD_QUOTA[tier] ?? 0;
      if (quota === 0) {
        configUpdate.customCommands = [];
      } else {
        const list = Array.isArray(customCommands) ? customCommands : [];
        if (list.length > quota) {
          return res.status(400).json({
            success: false,
            message: `Paket ${tier.toUpperCase()} maksimal ${quota} perintah kustom.`
          });
        }
        configUpdate.customCommands = list
          .filter(c => c && typeof c.cmd === "string" && typeof c.response === "string")
          .map(c => ({
            // Prefix dibuang di sini supaya tersimpan seragam; bot yang
            // menambahkan prefix saat mencocokkan.
            cmd: c.cmd.trim().replace(/^[./!#]/, "").toLowerCase().slice(0, 30),
            response: c.response.trim().slice(0, 2000),
            image: tier === "booster" ? String(c.image || "").trim().slice(0, 300) : "",
            showInMenu: c.showInMenu !== false
          }))
          .filter(c => c.cmd && c.response);
      }
    }

    // Pesan otomatis: kuota per paket, divalidasi ulang di server.
    if (autoReply !== undefined) {
      if (isFree) {
        configUpdate.autoReply = [];
      } else {
        const quota = AUTOREPLY_QUOTA[tier] ?? 0;
        const list = Array.isArray(autoReply) ? autoReply : [];
        if (list.length > quota) {
          return res.status(400).json({
            success: false,
            message: `Paket ${tier.toUpperCase()} maksimal ${quota} aturan pesan otomatis.`
          });
        }
        configUpdate.autoReply = list
          .filter(r => r && typeof r.keyword === 'string' && typeof r.reply === 'string')
          .map(r => ({
            keyword: r.keyword.trim().slice(0, 100),
            reply: r.reply.trim().slice(0, 2000),
            match: ['contains', 'exact', 'startsWith'].includes(r.match) ? r.match : 'contains'
          }))
          .filter(r => r.keyword && r.reply);
      }
    }

    await updateBotConfig(number, configUpdate);
    res.json({ success: true, message: "Konfigurasi tersimpan." });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Sambutan anggota (welcome/leave) — khusus paket berbayar (Core/Prime/Zenith).
// Diterapkan ke SEMUA grup yang sedang diikuti bot ini, karena dashboard
// bekerja per-nomor-bot, bukan per-grup.
app.post("/api/bot/welcome", async (req, res) => {
  try {
    const { enabled, welcomeText, leaveText, mode, mediaUrl } = req.body;
    const ctx = await resolveBotRequest(req);
    if (!ctx.ok) return res.status(ctx.status).json({ success: false, message: ctx.message });
    const { number, tier } = ctx;
    if (tier === 'free') {
      return res.status(403).json({ success: false, message: "Sambutan Anggota khusus paket berbayar. Upgrade dulu, ya." });
    }

    const sock = sessions.get(`session-${number}`);
    if (!sock?.user) {
      return res.status(400).json({ success: false, message: "Bot sedang tidak aktif. Jalankan (Start) dulu." });
    }

    // Mode "custom" (foto/GIF sendiri) khusus Booster, sama seperti menu bot.
    const safeMode = (mode === 'custom' && tier !== 'booster') ? 'image' : (mode || 'image');
    const safeMedia = (safeMode === 'custom') ? (mediaUrl || '') : null;

    const groupIds = (await getGroupsCached(number, sock)).map(g => g.id);

    if (enabled === false) {
      // setWelcome/setLeft dengan teks kosong justru jatuh ke pesan default
      // (lihat participants.js), jadi mematikan sambutan harus lewat
      // deleteMessage supaya kuncinya benar-benar hilang.
      for (const gid of groupIds) {
        await deleteMessage(gid, "add");
        await deleteMessage(gid, "remove");
      }
      return res.json({ success: true, message: "Sambutan anggota dimatikan di semua grup." });
    }

    for (const gid of groupIds) {
      await setWelcome(gid, welcomeText);
      await setLeft(gid, leaveText);
      await setTemplateWelcome(gid, safeMode, safeMedia);
    }

    res.json({ success: true, message: `Sambutan diterapkan ke ${groupIds.length} grup.` });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Siaran pesan ke semua grup — khusus paket berbayar (Core ke atas). Core/Prime/Zenith
// selama ini nyaris tidak beda dari Free di level bot, jadi ini nilai jual
// yang nyata: sekali klik, kirim pengumuman ke semua grup bot dijalankan.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.post("/api/bot/broadcast", async (req, res) => {
  try {
    const { message } = req.body;
    const ctx = await resolveBotRequest(req);
    if (!ctx.ok) return res.status(ctx.status).json({ success: false, message: ctx.message });
    const { number, tier } = ctx;
    if (tier === 'free') {
      return res.status(403).json({ success: false, message: "Siaran Pesan khusus paket berbayar. Upgrade dulu, ya." });
    }
    const text = (message || "").trim();
    if (!text) return res.status(400).json({ success: false, message: "Pesan tidak boleh kosong." });
    if (text.length > 1000) return res.status(400).json({ success: false, message: "Pesan maksimal 1000 karakter." });

    const sock = sessions.get(`session-${number}`);
    if (!sock?.user) {
      return res.status(400).json({ success: false, message: "Bot sedang tidak aktif. Jalankan (Start) dulu." });
    }

    let groupIds = (await getGroupsCached(number, sock)).map(g => g.id);
    if (!groupIds.length) return res.json({ success: true, message: "Bot belum tergabung di grup manapun.", sent: 0 });

    // Dibatasi biar request HTTP tidak menggantung lama (jeda 1.5 detik/grup).
    // Kalau bot ikut lebih dari ini, kirim bertahap beberapa kali.
    const MAX_BROADCAST_GROUPS = 60;
    const capped = groupIds.length > MAX_BROADCAST_GROUPS;
    groupIds = groupIds.slice(0, MAX_BROADCAST_GROUPS);

    let sent = 0;
    for (const gid of groupIds) {
      try {
        await sock.sendMessage(gid, { text });
        sent++;
      } catch (err) {
        console.error(`Gagal broadcast ke ${gid}:`, err.message);
      }
      // Jeda antar grup supaya tidak terdeteksi sebagai spam oleh WhatsApp.
      await sleep(1500);
    }

    res.json({
      success: true,
      message: `Terkirim ke ${sent} dari ${groupIds.length} grup.` + (capped ? ` (dibatasi ${MAX_BROADCAST_GROUPS} grup per pengiriman)` : ""),
      sent, total: groupIds.length
    });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// ==========================================
// API: PEMBAYARAN (AUTOGOPAY — QRIS)
// ==========================================
// Kredensial dibaca dari environment (lihat lib/payment.js).

// Biaya admin: FLAT, bukan persen.
// Biaya memproses satu transaksi hampir sama besar untuk nominal berapa
// pun, jadi persen akan membuat pembeli paket mahal mensubsidi pembeli
// add-on murah. Flat mencerminkan ongkos yang sebenarnya terjadi.
// Nilainya juga dipilih supaya total tetap bulat (7.500 + 200 = 7.700).
const ADMIN_FEE = Number(process.env.ADMIN_FEE ?? 200);

// (TIER_LABEL, TIER_RANK & DAY_MS didefinisikan di bagian "PAKET PER BOT".)

// Ambil harga resmi dari database. Harga TIDAK PERNAH diambil dari client,
// supaya user tidak bisa mengarang nominal lewat DevTools.
const DEFAULT_PRICING = { basic: 7500, plus: 15000, booster: 25000 };
let lastPricing = null; // harga terakhir yang berhasil dibaca dari database

async function getPricing() {
  let pricing = await Setting.findOne({ key: 'pricing' });
  if (!pricing) {
    pricing = await Setting.create({ key: 'pricing', value: { ...DEFAULT_PRICING } });
  }
  // Data lama bisa tersimpan sebagai string (input number mengirim teks),
  // jadi selalu dinormalkan ke angka sebelum dipakai menghitung.
  const v = pricing.value || {};
  lastPricing = {
    basic: Number(v.basic) || 0,
    plus: Number(v.plus) || 0,
    booster: Number(v.booster) || 0
  };
  return { ...lastPricing };
}

// ── Aturan satu invoice per user ───────────────────────────────
// Cari invoice pending milik user. Yang sudah lewat 5 menit otomatis
// dibatalkan lebih dulu, supaya user tidak terkunci oleh invoice basi.
async function findBlockingOrder(userId) {
  const pendings = await Order.find({ userId, status: "pending" });
  for (const o of pendings) {
    const age = Date.now() - new Date(o.createdAt).getTime();
    if (age > INVOICE_TTL_MS) {
      await expireOrder(o, "expired");
    } else {
      return o;
    }
  }
  return null;
}

// Tutup invoice: batalkan di gateway lalu tandai di database.
async function expireOrder(order, status = "cancelled") {
  if (order.gatewayTrxId) await cancelQris(order.gatewayTrxId);
  await Order.updateOne({ orderId: order.orderId }, { $set: { status } });
  console.log(`[payment] Invoice ${order.orderId} -> ${status}`);
}

// Pembuatan invoice + QRIS, dipakai pembelian paket MAUPUN add-on.
async function createOrderWithQris({ userId, user, amount, subtotal, discount, fee = 0, promoCode, extra = {} }) {
  const qris = await createQris(amount);
  const orderId = generateOrderId();

  // Batas waktu kita sendiri (5 menit), lebih ketat dari gateway (15 menit).
  const expiredAt = new Date(Date.now() + INVOICE_TTL_MS).toISOString();

  const order = await Order.create({
    orderId, userId, username: user.username, email: user.email,
    subtotal, discount, promoCode: promoCode || "",
    amount, fee, totalPayment: amount,
    paymentMethod: "qris",
    paymentNumber: qris.qrString,
    qrUrl: qris.qrUrl,
    checkoutUrl: qris.checkoutUrl,
    gatewayTrxId: qris.transactionId,
    status: "pending",
    expiredAt,
    ...extra
  });

  // Pembatalan otomatis 5 menit. Timer ini hilang kalau server restart,
  // karena itu findBlockingOrder() juga memeriksa umur invoice — jadi
  // invoice basi tetap tertutup walau timernya lenyap.
  setTimeout(async () => {
    try {
      const fresh = await Order.findOne({ orderId });
      if (fresh?.status === "pending") await expireOrder(fresh, "expired");
    } catch (err) {
      console.error("[payment] auto-cancel gagal:", err.message);
    }
  }, INVOICE_TTL_MS).unref();

  return order;
}

function generateOrderId() {
  const d = new Date();
  const stamp = `${d.getFullYear().toString().slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `INV${stamp}${rand}`;
}

// Bot tujuan pembelian paket. Wajib diisi dan harus milik pembeli —
// tanpa pengecekan ini orang bisa "membelikan" paket ke bot acak lalu
// meminta refund, atau sebaliknya mengira paketnya masuk ke bot lain.
async function resolvePaymentBot(user, rawNumber) {
  if (rawNumber === undefined || rawNumber === null || rawNumber === "") {
    return { ok: false, status: 400, code: "BOT_REQUIRED", message: "Pilih bot yang mau di-upgrade." };
  }
  const number = normalizeBotNumber(rawNumber);
  if (!number) return { ok: false, status: 400, code: "BOT_REQUIRED", message: "Nomor bot tidak valid. Pilih bot yang mau di-upgrade." };

  const bot = await Bot.findOne({ number }).lean();
  if (user.role === "admin") {
    if (bot || (await getJadibot(number))) return { ok: true, number };
    return { ok: false, status: 404, message: "Bot tidak ditemukan." };
  }
  if (bot?.ownerId === user.id) return { ok: true, number };
  // Data lama: nomor ada di botNumbers tapi dokumen Bot belum dibuat.
  if (!bot?.ownerId && (user.botNumbers || []).includes(number)) {
    await ensureBotDoc(number, user.id);
    return { ok: true, number };
  }
  return { ok: false, status: 403, message: "Bot ini bukan milik akun kamu. Pilih salah satu bot kamu." };
}

// Buat invoice + transaksi QRIS di Pakasir
app.post("/api/payment/create", async (req, res) => {
  try {
    const { userId, tier, months = 1, promoCode = "", botNumber } = req.body;
    if (!userId) return res.status(401).json({ success: false, message: "Silakan login ulang." });
    // "free" bukan paket yang bisa dibeli (harganya 0) — tolak di sini
    // dengan pesan yang jelas, bukan "Harga paket belum diatur".
    if (!isPaidTier(tier)) return res.status(400).json({ success: false, message: "Paket tidak dikenal." });

    const user = await User.findOne({ id: userId });
    if (!user) return res.status(404).json({ success: false, message: "User tidak ditemukan." });

    // Paket PER BOT: pembayaran selalu untuk satu bot tertentu milik user
    // (admin boleh membelikan bot siapa pun).
    const target = await resolvePaymentBot(user, botNumber);
    if (!target.ok) return res.status(target.status).json({ success: false, code: target.code, message: target.message });

    const qty = Math.max(1, Math.min(12, parseInt(months) || 1));
    const pricing = await getPricing();
    const subtotal = (pricing[tier] || 0) * qty;
    if (subtotal <= 0) return res.status(400).json({ success: false, message: "Harga paket belum diatur." });

    // Validasi voucher di server (bukan di browser).
    let discount = 0, appliedPromo = "";
    if (promoCode) {
      const promo = await Promo.findOne({ code: String(promoCode).toUpperCase() });
      if (!promo || !promo.isActive) return res.status(400).json({ success: false, message: "Kode voucher tidak valid." });
      if (promo.usedCount >= promo.maxUses) return res.status(400).json({ success: false, message: "Kuota kode voucher sudah habis." });
      discount = Math.floor(subtotal * (promo.discount / 100));
      appliedPromo = promo.code;
    }

    // Potongan referral untuk pembelian PERTAMA orang yang diajak.
    let refDiscount = 0;
    if (user.referredBy && !user.refRewarded) {
      const pernah = await Order.countDocuments({ userId, status: "completed" });
      if (pernah === 0) refDiscount = Math.floor(subtotal * (REF_DISCOUNT_PERCENT / 100));
    }

    // Kredit hasil mengajak teman boleh dipakai, tapi tidak boleh membuat
    // tagihan jadi nol — minimal tetap ada biaya admin yang dibayar.
    const kreditTersedia = Math.max(0, user.credit || 0);
    const sebelumKredit = Math.max(1, subtotal - discount - refDiscount);
    const creditUsed = Math.min(kreditTersedia, Math.max(0, sebelumKredit - 1));

    // Diskon dipotong dulu, fee ditambahkan terakhir — jadi voucher tidak
    // ikut memotong biaya admin yang memang harus dibayar apa adanya.
    const fee = ADMIN_FEE;
    const amount = Math.max(1, sebelumKredit - creditUsed) + fee;

    // Satu user hanya boleh punya satu invoice berjalan.
    const blocking = await findBlockingOrder(userId);
    if (blocking) {
      return res.status(409).json({
        success: false,
        code: "PENDING_EXISTS",
        message: "Masih ada invoice yang belum dibayar. Batalkan dulu sebelum membuat yang baru.",
        orderId: blocking.orderId
      });
    }

    const order = await createOrderWithQris({
      userId, user, amount, subtotal, discount, fee, promoCode: appliedPromo,
      extra: { kind: "tier", tier, months: qty, creditUsed, refDiscount, botNumber: target.number }
    });

    res.json({ success: true, order });
  } catch (error) {
    console.error("payment/create error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Aktifkan paket setelah pembayaran terkonfirmasi. Idempotent: kalau order
// sudah completed, tidak menambah durasi dua kali.

/**
 * Hitung masa aktif baru dengan PRORATA.
 *
 * Masalah yang diselesaikan:
 *  - Kalau masa lama diabaikan (perilaku lama), user yang upgrade
 *    Core -> Zenith KEHILANGAN sisa hari Core yang sudah dibayar.
 *  - Kalau masa lama sekadar diteruskan, muncul celah abuse: user Core
 *    dengan sisa 11 bulan beli Zenith 1 bulan, lalu menikmati Zenith
 *    selama 12 bulan — padahal hanya bayar sebulan Zenith.
 *
 * Solusinya: sisa waktu paket lama dikonversi jadi UANG, lalu uang itu
 * dibelikan hari di harga paket baru. Jadi nilainya adil dua arah dan
 * tidak bisa dimanfaatkan.
 *
 *   sisa_nilai  = sisa_hari x (harga_lama / 30)
 *   hari_bonus  = sisa_nilai / (harga_baru / 30)
 *
 * Contoh: Core (Rp 7.500) sisa 20 hari = Rp 5.000.
 * Dibelikan Zenith (Rp 25.000/bln = Rp 833/hari) -> 6 hari bonus.
 * Beli Zenith 1 bulan jadi 30 + 6 = 36 hari.
 */
function computeNewExpiry({ currentTier, currentExpiredAt, newTier, months, pricing }) {
  const now = new Date();
  const currentExp = currentExpiredAt ? new Date(currentExpiredAt) : null;
  const stillActive = currentExp && !isNaN(currentExp) && currentExp > now;

  const purchasedDays = (months || 1) * 30;
  let bonusDays = 0;
  let note = "baru";

  if (stillActive && currentTier && currentTier !== "free") {
    const remainingDays = (currentExp - now) / DAY_MS;

    if (currentTier === newTier) {
      // Paket sama: cukup ditumpuk, tidak perlu konversi.
      bonusDays = remainingDays;
      note = "perpanjangan";
    } else {
      const oldPerDay = (pricing[currentTier] || 0) / 30;
      const newPerDay = (pricing[newTier] || 0) / 30;
      if (newPerDay > 0) {
        bonusDays = (remainingDays * oldPerDay) / newPerDay;
        note = oldPerDay < newPerDay ? "upgrade prorata" : "downgrade prorata";
      }
    }
  }

  const totalDays = purchasedDays + bonusDays;
  const newExp = new Date(now.getTime() + totalDays * DAY_MS);
  return { newExp, bonusDays: Math.round(bonusDays * 10) / 10, note };
}

// Router aktivasi: order paket dan order add-on punya efek berbeda.
//
// Webhook dan polling halaman invoice bisa datang hampir bersamaan untuk
// order yang sama. Keduanya melihat status "pending", lalu masa aktif
// bertambah dua kali dan kredit terpotong dua kali. Aktivasi per order
// karena itu diantrekan di proses ini, dan status dibaca ulang dari
// database di dalam antrean.
const activatingOrders = new Map(); // orderId -> Promise
function activateAnyOrder(order, completedAt) {
  const key = order.orderId;
  const running = activatingOrders.get(key);
  if (running) return running;
  const job = activateAnyOrderOnce(order, completedAt).finally(() => activatingOrders.delete(key));
  activatingOrders.set(key, job);
  return job;
}

async function activateAnyOrderOnce(orderIn, completedAt) {
  const order = (await Order.findOne({ orderId: orderIn.orderId })) || orderIn;
  if (order.status === "completed") return order;

  const hasil = order.kind === "addon"
    ? await activateAddon(order, completedAt)
    : await activateOrder(order, completedAt);

  // Hadiah referral cair di sini — setelah pembayaran benar-benar lunas,
  // bukan saat mendaftar.
  await prosesHadiahReferral(order);

  // Kredit yang dipakai baru dipotong setelah transaksi sukses.
  if (order.creditUsed > 0) {
    await User.updateOne({ id: order.userId }, { $inc: { credit: -order.creditUsed } });
  }
  return hasil;
}

// Pasang paket ke SATU bot: dokumen Bot (sumber kebenaran), salinan tier di
// config bot (dibaca bot & tampilan lama), lalu cache tier dibuang supaya
// langsung berlaku — tidak menunggu 30 detik.
async function setBotPackage(number, tier, tierExpiredAt) {
  const t = isPaidTier(tier) ? tier : "free";
  const exp = t === "free" ? "" : (tierExpiredAt || "");
  await Bot.updateOne({ number }, { $set: { tier: t, tierExpiredAt: exp } });
  await updateBotConfig(number, { tier: t });
  invalidateTier(number);
}

// Bot tujuan order paket yang SUDAH LUNAS:
//   - order baru: Order.botNumber (dicek kepemilikannya saat dibuat);
//   - order lama tanpa botNumber (dibuat sebelum paket per bot, lunas
//     sesudahnya): bot pertama pembeli;
//   - bot sudah dihapus / berpindah tangan: jadi paket tertunda pembeli,
//     supaya uangnya tidak "dihadiahkan" ke pemilik baru nomor itu.
async function orderTargetBot(order, buyer) {
  let number = normalizeBotNumber(order.botNumber);
  if (!number) {
    const bots = await botsOfUser(buyer);
    number = bots[0]?.number || "";
  }
  if (!number) return null;
  let bot = await Bot.findOne({ number }).lean();
  if (!bot && (buyer.botNumbers || []).includes(number)) bot = await ensureBotDoc(number, buyer.id);
  if (!bot) return null;
  if (bot.ownerId === buyer.id || buyer.role === "admin") return bot;
  return null;
}

async function activateOrder(order, completedAt) {
  if (order.status === "completed") return order;

  const user = await User.findOne({ id: order.userId }).lean();
  if (!user) return order;

  const pricing = await getPricing();
  const bot = await orderTargetBot(order, user);

  // Prorata dihitung dari paket yang SEKARANG melekat ke tujuan (bot, atau
  // paket tertunda kalau tidak ada bot) — rumusnya sama seperti dulu.
  const current = bot
    ? { tier: effectiveTier(bot), expiredAt: bot.tierExpiredAt }
    : (pendingOf(user) ? { tier: user.pendingTier, expiredAt: user.pendingTierExpiredAt } : { tier: "free", expiredAt: "" });
  const { newExp, bonusDays, note } = computeNewExpiry({
    currentTier: current.tier,
    currentExpiredAt: current.expiredAt,
    newTier: order.tier,
    months: order.months,
    pricing,
  });

  // BUG LAMA (sebelum paket per bot): hanya tier di akun yang dinaikkan,
  // sementara config bot tetap "free" sampai user menekan Simpan Config.
  // setBotPackage memperbarui dokumen Bot, config bot, dan cache sekaligus.
  if (bot) {
    await setBotPackage(bot.number, order.tier, newExp.toISOString());
  } else {
    await User.updateOne({ id: user.id }, { $set: { pendingTier: order.tier, pendingTierExpiredAt: newExp.toISOString() } });
  }

  await Order.updateOne({ orderId: order.orderId }, {
    $set: {
      status: "completed",
      completedAt: completedAt || new Date().toISOString(),
      bonusDays,
      proration: note,
      appliedTo: bot ? "bot" : "pending",
      // Order lama tanpa botNumber: catat bot yang akhirnya menerima paket,
      // supaya invoice menampilkan tujuan yang benar.
      ...(bot && !order.botNumber ? { botNumber: bot.number } : {})
    }
  });
  if (order.promoCode) await Promo.updateOne({ code: order.promoCode }, { $inc: { usedCount: 1 } });

  const tujuan = bot ? `bot ${bot.number}` : "paket tertunda";
  console.log(`[✔] Order ${order.orderId} lunas. ${user.username}: ${tujuan} ${current.tier} -> ${order.tier} (${note}, bonus ${bonusDays} hari) s/d ${newExp.toISOString()}`);
  return await Order.findOne({ orderId: order.orderId });
}

// Verifikasi status langsung ke gateway. Ini sumber kebenaran; webhook
// hanya dipakai sebagai pemicu, tidak pernah dipercaya sendirian.
async function verifyWithGateway(order) {
  if (!order.gatewayTrxId) return "";
  return mapStatus(await checkQrisStatus(order.gatewayTrxId));
}

// Info bot tujuan untuk halaman invoice ("Paket untuk bot 6285xxxx026").
// order.botNumber sudah ikut di objek order; ini menambahkan label & paket
// bot saat ini supaya invoice tidak perlu request kedua.
async function invoiceBotInfo(order) {
  const number = normalizeBotNumber(order?.botNumber);
  if (!number) return null;
  const bot = await Bot.findOne({ number }).lean();
  return { number, label: bot?.label || "", ...botPackage(bot) };
}

// Dipanggil berkala oleh halaman invoice
app.get("/api/payment/status/:orderId", async (req, res) => {
  try {
    let order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ success: false, message: "Invoice tidak ditemukan." });

    if (order.status === "pending") {
      // Lewat batas 5 menit -> tutup, tidak perlu tanya gateway lagi.
      if (order.expiredAt && new Date(order.expiredAt) < new Date()) {
        await expireOrder(order, "expired");
        order = await Order.findOne({ orderId: order.orderId });
      } else {
        const status = await verifyWithGateway(order);
        if (status === "completed") {
          order = await activateAnyOrder(order, new Date().toISOString());
        } else if (status === "expired" || status === "cancelled") {
          await Order.updateOne({ orderId: order.orderId }, { $set: { status } });
          order = await Order.findOne({ orderId: order.orderId });
        }
      }
    }
    res.json({ success: true, order, botNumber: order?.botNumber || "", bot: await invoiceBotInfo(order) });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Webhook AutoGopay.
//
// express.json() dipasang dengan `verify` (lihat bagian middleware) supaya
// body MENTAH tersimpan di req.rawBody. Signature HARUS dihitung dari body
// mentah — kalau dari hasil JSON.stringify ulang, urutan kunci bisa berubah
// dan verifikasi selalu gagal.
app.post("/api/payment/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-signature"];
    const raw = req.rawBody || JSON.stringify(req.body || {});

    if (!verifyWebhookSignature(raw, signature)) {
      console.warn("[Webhook] signature tidak valid — permintaan ditolak.");
      return res.status(401).json({ success: false });
    }

    const trx = req.body?.transaction;
    if (!trx?.order_id) return res.status(400).json({ success: false });

    console.log("[Webhook AutoGopay]", trx.order_id, trx.amount, trx.status);

    // Gateway memakai order_id miliknya sendiri, jadi dicocokkan lewat
    // transaction_id yang kita simpan saat pembuatan invoice.
    const order = await Order.findOne({
      $or: [{ gatewayTrxId: trx.transaction_id }, { orderId: trx.order_id }]
    });

    if (!order) {
      console.warn("[Webhook] invoice tidak dikenal:", trx.order_id);
      return res.status(404).json({ success: false });
    }
    if (Number(trx.amount) !== order.amount) {
      console.warn("[Webhook] nominal tidak cocok:", trx.amount, "vs", order.amount);
      return res.status(400).json({ success: false });
    }
    // Sudah pernah diproses (webhook bisa terkirim lebih dari sekali).
    if (order.status === "completed") return res.json({ success: true });

    if (String(trx.status).toUpperCase() === "PAID") {
      // Tetap konfirmasi ulang ke gateway sebelum mengaktifkan.
      const confirmed = await verifyWithGateway(order);
      if (confirmed === "completed") {
        await activateAnyOrder(order, trx.paid_at || new Date().toISOString());
      } else {
        console.warn("[Webhook] PAID tapi gateway belum settlement:", trx.order_id);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error("webhook error:", error.message);
    res.status(500).json({ success: false });
  }
});

app.post("/api/payment/cancel", async (req, res) => {
  try {
    const { orderId, userId } = req.body;
    const order = await Order.findOne({ orderId });
    if (!order) return res.status(404).json({ success: false, message: "Invoice tidak ditemukan." });
    if (order.userId !== userId) return res.status(403).json({ success: false, message: "Bukan invoice kamu." });
    if (order.status === "completed") return res.status(400).json({ success: false, message: "Invoice sudah lunas." });

    await expireOrder(order, "cancelled");
    res.json({ success: true, message: "Invoice dibatalkan." });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Riwayat invoice milik user
app.get("/api/payment/orders/:userId", async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.params.userId }).sort({ createdAt: -1 }).limit(30);
    res.json({ success: true, orders });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Validasi voucher sebelum bayar (untuk preview total di modal Order Detail)
app.post("/api/payment/check-promo", async (req, res) => {
  try {
    const { code, tier, months = 1 } = req.body;
    const promo = await Promo.findOne({ code: String(code || "").toUpperCase() });
    if (!promo || !promo.isActive) return res.json({ success: false, message: "Kode voucher tidak valid." });
    if (promo.usedCount >= promo.maxUses) return res.json({ success: false, message: "Kuota kode voucher sudah habis." });

    const pricing = await getPricing();
    const qty = Math.max(1, Math.min(12, parseInt(months) || 1));
    const subtotal = (pricing[tier] || 0) * qty;
    const discount = Math.floor(subtotal * (promo.discount / 100));
    res.json({ success: true, code: promo.code, percent: promo.discount, discount, subtotal, fee: ADMIN_FEE, total: subtotal - discount + ADMIN_FEE });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Harga publik untuk modal Order Detail
app.get("/api/pricing", async (req, res) => {
  try {
    // Halaman depan memanggil ini untuk kartu harga. Saat MongoDB putus,
    // query Mongoose tertahan ±10 detik lalu gagal — kartu harga ikut
    // kosong. Untuk TAMPILAN cukup pakai harga terakhir yang diketahui
    // (atau harga bawaan). Pembuatan invoice tetap membaca database.
    //
    // `source` memberi tahu halaman dari mana angkanya: "database" (harga
    // resmi), "cache" (harga resmi terakhir yang diketahui, DB sedang
    // putus) atau "default" (harga bawaan — belum pernah terbaca dari DB,
    // jadi halaman sebaiknya memberi label/menyembunyikannya, bukan
    // menampilkannya seolah harga resmi).
    const fallback = () => res.json({
      success: true,
      pricing: { ...(lastPricing || DEFAULT_PRICING) },
      fee: ADMIN_FEE,
      cached: true,
      source: lastPricing ? "cache" : "default"
    });
    if (mongoose.connection.readyState !== 1) return fallback();
    let pricing;
    try { pricing = await getPricing(); }
    catch (err) {
      console.error("[pricing] gagal membaca harga:", err.message);
      return fallback();
    }
    res.json({ success: true, pricing, fee: ADMIN_FEE, source: "database" });
  }
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// ==========================================
// LEADERBOARD PELANGGAN SETIA
// ==========================================
// Diperingkat dari total bulan berlangganan yang benar-benar dibayar
// (order berstatus completed), bukan dari nominal — supaya yang dihargai
// adalah lamanya bertahan, bukan siapa yang paling banyak uangnya.
const TIER_WEIGHT = { basic: 1, plus: 2, booster: 3 };

app.get("/api/leaderboard", async (req, res) => {
  try {
    const rows = await Order.aggregate([
      { $match: { status: 'completed' } },
      { $group: {
          _id: '$userId',
          totalMonths: { $sum: '$months' },
          orders: { $sum: 1 },
          firstPaidAt: { $min: '$createdAt' },
          lastPaidAt: { $max: '$createdAt' }
      } },
      { $sort: { totalMonths: -1, firstPaidAt: 1 } },
      { $limit: 10 }
    ]);

    const ids = rows.map(r => r._id);
    const users = await User.find({ id: { $in: ids } }).select("id username avatarUrl").lean();
    const byId = Object.fromEntries(users.map(u => [u.id, u]));
    // Paket sekarang per bot: yang ditampilkan paket TERTINGGI yang aktif
    // di antara bot-bot user itu.
    const paket = await botsByOwner(ids);

    const board = rows.map((r, i) => {
      const u = byId[r._id] || {};
      return {
        rank: i + 1,
        username: u.username || 'Pengguna',
        avatarUrl: u.avatarUrl || '',
        tier: topPackage(paket.get(r._id)).tier,
        totalMonths: r.totalMonths,
        orders: r.orders,
        since: r.firstPaidAt || null
      };
    });

    res.json({ success: true, board });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// ==========================================
// BACKUP & RESTORE CONFIG BOT
// ==========================================
// Supaya user tidak kehilangan setelan saat ganti nomor atau terjadi
// masalah. Hanya berisi config bot — tidak ada kredensial sesi WhatsApp
// di dalamnya, jadi file ini aman dibagikan/disimpan.
app.get("/api/bot/backup/:number", async (req, res) => {
  try {
    const own = await assertBotOwner(req.query.userId, req.params.number);
    if (!own.ok) return res.status(403).json({ success: false, message: own.message });

    const cfg = await getBotConfig(own.number) || {};
    res.json({
      success: true,
      backup: {
        versi: 1,
        dibuat: new Date().toISOString(),
        // Nomor sengaja TIDAK disertakan, supaya file ini bisa dipulihkan
        // ke nomor bot yang berbeda.
        config: {
          botName: cfg.botName || "",
          ownerNumber: cfg.ownerNumber || "",
          watermark: cfg.watermark || "",
          footer: cfg.footer || "",
          modePublik: cfg.modePublik ?? true,
          customMenu: cfg.customMenu || "",
          menuImage: cfg.menuImage || "",
          autoReply: cfg.autoReply || [],
          customCommands: cfg.customCommands || []
        }
      }
    });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.post("/api/bot/restore", async (req, res) => {
  try {
    const { backup } = req.body;
    const ctx = await resolveBotRequest(req);
    if (!ctx.ok) return res.status(ctx.status).json({ success: false, message: ctx.message });
    const { number, tier } = ctx;

    const cfg = backup?.config;
    if (!cfg || typeof cfg !== "object") {
      return res.status(400).json({ success: false, message: "File backup tidak dikenali." });
    }

    // Pulihkan lewat jalur yang sama dengan penyimpanan biasa, supaya
    // batasan paket tetap berlaku. Backup dari akun Zenith yang dipulihkan
    // ke akun Free tidak boleh membuka fitur berbayar.
    const isFree = tier === "free";
    const ownerLimit = OWNER_LIMIT_BY_TIER[tier] ?? 0;
    const owners = String(cfg.ownerNumber || "").split(",").map(n => n.trim()).filter(Boolean).slice(0, ownerLimit);

    await updateBotConfig(number, {
      modePublik: cfg.modePublik ?? true,
      botName: isFree ? "" : String(cfg.botName || "").slice(0, 32),
      ownerNumber: owners.join(","),
      watermark: isFree ? "" : String(cfg.watermark || "").slice(0, 100),
      footer: isFree ? "" : String(cfg.footer || "").slice(0, 100),
      customMenu: isFree ? "" : String(cfg.customMenu || ""),
      menuImage: tier === "booster" ? String(cfg.menuImage || "") : "",
      autoReply: isFree ? [] : (cfg.autoReply || []).slice(0, AUTOREPLY_QUOTA[tier] ?? 0),
      customCommands: (cfg.customCommands || []).slice(0, CUSTOMCMD_QUOTA[tier] ?? 0),
      tier
    });

    res.json({ success: true, message: "Setelan berhasil dipulihkan (disesuaikan dengan paket kamu)." });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// ==========================================
// STATUS PUBLIK
// ==========================================
// Halaman status terbuka untuk umum. Tujuannya mengurangi pertanyaan
// "bot saya mati ya?" yang masuk ke WhatsApp pribadi.
// Sengaja TIDAK memuat nomor bot siapa pun — hanya angka agregat.
app.get("/api/status", async (req, res) => {
  try {
    const botAktif = Array.from(sessions.values()).filter(s => s?.user).length;
    const mongoOk = mongoose.connection.readyState === 1;
    const mem = process.memoryUsage();

    res.json({
      success: true,
      status: mongoOk ? "operational" : "degraded",
      layanan: {
        web: "operational",
        database: mongoOk ? "operational" : "down",
        bot: botAktif > 0 ? "operational" : "idle"
      },
      botAktif,
      uptimeSec: Math.round(process.uptime()),
      memoryMB: Math.round(mem.rss / 1048576),
      // Ringkasan kapasitas & beban (detail lengkap ada di /api/public/live).
      ...getMonitorSummary(),
      waktu: new Date().toISOString()
    });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});


// ==========================================
// LIVE MONITOR, FITUR & PENGATURAN SITUS (PUBLIK)
// ==========================================
// Dipolling tiap ±3 detik oleh halaman depan & status. Bagian yang mahal
// sudah di-cache 2 detik di lib/monitor.js, jadi banyak tab yang terbuka
// tidak menambah beban berarti. Nomor bot DISENSOR, tanpa isi pesan dan
// tanpa nomor pengirim.
const wantHistory = (q) => q === "1" || q === "true";

app.get("/api/public/live", async (req, res) => {
  try {
    const data = await getLiveSnapshot({ since: req.query.since, history: wantHistory(req.query.history), admin: false });
    res.setHeader("Cache-Control", "no-cache");
    res.json(data);
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Nama, deskripsi & ikon kategori (= nama folder di plugins/). Kategori
// yang tidak terdaftar di sini tetap tampil dengan nama foldernya.
const FEATURE_CATEGORIES = {
  ADMIN: { name: "Admin Grup", desc: "Kelola grup: kick, promote, antilink, welcome, absen & peringatan", icon: "shield" },
  AI: { name: "AI", desc: "Tanya jawab AI, bikin gambar, dan voice note AI", icon: "sparkles" },
  ANIME: { name: "Anime", desc: "Cari info & rekomendasi anime", icon: "star" },
  BERITA: { name: "Berita", desc: "Kabar terbaru dari berbagai portal berita", icon: "info" },
  DOWNLOAD: { name: "Downloader", desc: "Unduh video/audio dari TikTok, IG, YouTube, Spotify & lainnya", icon: "download" },
  EDITOR: { name: "Editor Foto", desc: "Blur, grayscale, putar, perjelas & efek foto lainnya", icon: "image" },
  GAMES: { name: "Game", desc: "Tebak-tebakan, family100, blackjack, catur & game seru grup", icon: "gamepad" },
  GROUP: { name: "Grup", desc: "Absen, info grup, cek premium & fitur anggota grup", icon: "users" },
  INFORMATION: { name: "Informasi", desc: "Info gempa, KBBI, arti nama, cek akun game & lainnya", icon: "info" },
  ISLAMI: { name: "Islami", desc: "Jadwal sholat, surah, hadist, doa & zikir harian", icon: "star" },
  KERANG_AJAIB: { name: "Kerang Ajaib", desc: "Hiburan: cek ganteng/cantik, kapankah, bisakah & lainnya", icon: "sparkles" },
  MAKER: { name: "Maker & Stiker", desc: "Bikin stiker brat, attp, quote chat & gambar lucu", icon: "wand" },
  MLBB: { name: "Mobile Legends", desc: "Cek akun, bind & data Mobile Legends", icon: "gamepad" },
  MORE: { name: "Utilitas Bot", desc: "Runtime, sewa bot, premium & pengaturan tampilan", icon: "robot" },
  OWNER: { name: "Owner", desc: "Kendali penuh untuk pemilik bot", icon: "shield" },
  PREMIUM: { name: "Premium", desc: "Fitur eksklusif untuk pengguna premium", icon: "star" },
  RANDOM: { name: "Random", desc: "Gambar, meme & teks acak buat seru-seruan", icon: "image" },
  STORE: { name: "Toko", desc: "List produk & proses order untuk grup jualan", icon: "store" },
  TEXTPRO: { name: "Text Pro", desc: "Ubah teks jadi logo & efek tulisan keren", icon: "wand" },
  TOOLS: { name: "Tools", desc: "Cek IP/DNS/host, HD-kan foto, emoji mix & alat praktis lain", icon: "tools" },
  LAINNYA: { name: "Umum", desc: "Menu utama & kontak owner bot", icon: "robot" },
};
// Command yang tidak dipromosikan di halaman publik.
const HIDDEN_FEATURES = new Set(["spamotp"]);

let featuresCache = { len: -1, at: 0, value: null };

function buildFeatures() {
  const plugins = Array.isArray(global.plugins) ? global.plugins : [];
  const cats = new Map();
  const all = new Set();

  for (const plugin of plugins) {
    const cmds = (Array.isArray(plugin?.Commands) ? plugin.Commands : [])
      .filter((c) => typeof c === "string")
      .map((c) => c.trim().toLowerCase())
      .filter((c) => c && c.length <= 40 && !HIDDEN_FEATURES.has(c));
    if (!cmds.length) continue;

    const raw = getPluginCategory(plugin);
    const key = String(raw).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "LAINNYA";
    if (!cats.has(key)) cats.set(key, { key, raw, all: new Set(), primary: new Set() });
    const entry = cats.get(key);
    cmds.forEach((c) => { entry.all.add(c); all.add(c); });
    // Nama utama = command pertama, kecuali kalau itu singkatan 1-2 huruf
    // (mis. "tt") — pakai yang paling deskriptif ("tiktok").
    const primary = cmds[0].length <= 2 ? cmds.reduce((a, b) => (b.length > a.length ? b : a)) : cmds[0];
    entry.primary.add(primary);
  }

  const categories = [...cats.values()].map((e) => {
    const info = FEATURE_CATEGORIES[e.key] || {
      name: e.raw.charAt(0) + e.raw.slice(1).toLowerCase(), desc: "", icon: "sparkles"
    };
    return {
      key: e.key,
      name: info.name,
      desc: info.desc,
      icon: info.icon,
      count: e.all.size,
      commands: [...e.primary].sort().slice(0, 40),
      allCommands: [...e.all].sort()
    };
  // Kategori OWNER (perintah khusus pemilik/operator) ditaruh paling akhir:
  // jumlahnya terbanyak, tapi bukan yang ingin dilihat calon pengguna dulu.
  }).sort((a, b) => (a.key === "OWNER") - (b.key === "OWNER") || b.count - a.count || a.name.localeCompare(b.name));

  // Dua bentuk dari satu kali hitung: /api/public/features (ringkas, maks.
  // 40 command utama per kategori untuk kartu) dan /api/public/commands
  // (SEMUA nama command termasuk alias, untuk modal "Daftar lengkap
  // command" & pencarian — dulu ±260 command tidak pernah muncul di sana).
  return {
    features: {
      success: true, total: all.size,
      categories: categories.map(({ allCommands, ...c }) => c) // eslint-disable-line no-unused-vars
    },
    commands: {
      success: true, total: all.size,
      categories: categories.map(({ key, name, icon, allCommands }) => ({
        key, name, icon, count: allCommands.length, commands: allCommands
      }))
    }
  };
}

// Cache bersama kedua endpoint. Plugin dimuat di latar belakang saat
// start; selama masih kosong jangan di-cache supaya halaman tidak terjebak
// menampilkan "0 fitur".
function getFeatureCache() {
  const len = Array.isArray(global.plugins) ? global.plugins.length : 0;
  if (featuresCache.len !== len || Date.now() - featuresCache.at > 10 * 60 * 1000) {
    featuresCache = { len, at: Date.now(), value: buildFeatures() };
  }
  return { len, value: featuresCache.value };
}

app.get("/api/public/features", (req, res) => {
  try {
    const { len, value } = getFeatureCache();
    res.setHeader("Cache-Control", len ? "public, max-age=300" : "no-cache");
    res.json(value.features);
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Daftar LENGKAP command per kategori (nama saja). Murah: memakai cache
// yang sama dengan /api/public/features.
app.get("/api/public/commands", (req, res) => {
  try {
    const { len, value } = getFeatureCache();
    res.setHeader("Cache-Control", len ? "public, max-age=300" : "no-cache");
    res.json(value.commands);
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Pengaturan tampilan (banner, pengumuman, sosial). Dibaca dari file,
// jadi tetap jalan walau MongoDB putus.
app.get("/api/site/settings", (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-cache");
    res.json({ success: true, settings: getSiteSettings() });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// ==========================================
// REFERRAL
// ==========================================
//
// CARA MENCEGAH ABUSE — ini bagian terpentingnya.
//
// Kesalahan paling umum: memberi hadiah saat orang MENDAFTAR. Itu gratis
// dilakukan, jadi satu orang bisa bikin 50 akun Google dan panen hadiah
// tanpa mengeluarkan apa pun.
//
// Di sini hadiah baru cair saat orang yang diajak MELAKUKAN PEMBAYARAN
// PERTAMA yang benar-benar lunas. Artinya untuk memanen hadiah, pelaku
// harus membayar dengan uang sungguhan lebih dulu — dan hadiahnya selalu
// lebih kecil dari yang dia bayar, jadi tidak ada untungnya sama sekali.
// Sistem ini membiayai dirinya sendiri.
//
// Lapisan lain:
//  - Tidak bisa mengajak diri sendiri.
//  - Satu akun hanya boleh diajak SATU kali seumur hidup (unique index).
//  - Yang diajak harus benar-benar baru: tidak boleh punya transaksi lunas
//    sebelumnya.
//  - Nomor bot yang sama tidak bisa dipakai untuk memanen berkali-kali.
//  - Ada batas hadiah per bulan.
//  - Hadiah berupa KREDIT yang hanya bisa dipakai membeli paket di sini —
//    tidak bisa dicairkan jadi uang.
//
// Catatan: saya sengaja TIDAK memblokir berdasarkan alamat IP. Di
// Indonesia banyak pengguna berbagi IP operator seluler yang sama, jadi
// pemblokiran IP akan lebih sering menghukum orang tak bersalah daripada
// menangkap pelaku.

const REF_REWARD_PERCENT = 20;      // hadiah pengajak, dari pembayaran pertama
const REF_DISCOUNT_PERCENT = 10;    // potongan untuk yang diajak
const REF_MAX_PER_MONTH = 20;       // batas hadiah per pengajak per bulan
const REF_MAX_REWARD = 10000;       // batas rupiah per satu hadiah

// Kode referral dibuat sekali lalu disimpan, supaya tidak berubah-ubah.
async function ensureRefCode(user) {
  if (user.refCode) return user.refCode;

  const dasar = (user.username || "VR").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6) || "VR";
  let kode = "";
  for (let i = 0; i < 6; i++) {
    kode = `${dasar}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    if (!(await User.findOne({ refCode: kode }))) break;
  }
  await User.updateOne({ id: user.id }, { $set: { refCode: kode } });
  return kode;
}

app.get("/api/referral/me/:userId", async (req, res) => {
  try {
    const user = await User.findOne({ id: req.params.userId });
    if (!user) return res.status(404).json({ success: false, message: "User tidak ditemukan." });

    const kode = await ensureRefCode(user);
    const daftar = await Referral.find({ referrerId: user.id }).sort({ at: -1 }).limit(50).lean();
    const totalKredit = daftar.reduce((a, r) => a + (r.rewardCredit || 0), 0);

    res.json({
      success: true,
      code: kode,
      link: `https://varesa.mom/login?ref=${kode}`,
      credit: user.credit || 0,
      totalReferral: daftar.length,
      totalKredit,
      rewardPercent: REF_REWARD_PERCENT,
      discountPercent: REF_DISCOUNT_PERCENT,
      riwayat: daftar.map(r => ({ at: r.at, kredit: r.rewardCredit }))
    });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Dipakai saat user memasukkan kode orang lain (sekali seumur hidup).
app.post("/api/referral/claim", async (req, res) => {
  try {
    const { userId, code } = req.body;
    const user = await User.findOne({ id: userId });
    if (!user) return res.status(404).json({ success: false, message: "Silakan login ulang." });
    if (user.referredBy) return res.status(400).json({ success: false, message: "Kamu sudah pernah memakai kode referral." });

    const pengajak = await User.findOne({ refCode: String(code || "").toUpperCase().trim() });
    if (!pengajak) return res.status(400).json({ success: false, message: "Kode referral tidak ditemukan." });
    if (pengajak.id === user.id) return res.status(400).json({ success: false, message: "Tidak bisa memakai kode sendiri." });

    // Yang diajak harus benar-benar baru.
    const pernahBayar = await Order.findOne({ userId: user.id, status: "completed" });
    if (pernahBayar) {
      return res.status(400).json({ success: false, message: "Kode referral hanya bisa dipakai sebelum transaksi pertama." });
    }

    await User.updateOne({ id: user.id }, { $set: { referredBy: pengajak.id } });
    res.json({
      success: true,
      message: `Kode diterima. Kamu dapat potongan ${REF_DISCOUNT_PERCENT}% untuk pembelian pertama.`,
      discountPercent: REF_DISCOUNT_PERCENT
    });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Dipanggil saat sebuah order LUNAS. Di sinilah hadiah benar-benar cair.
async function prosesHadiahReferral(order) {
  try {
    const user = await User.findOne({ id: order.userId });
    if (!user?.referredBy || user.refRewarded) return;

    // Hanya pembayaran PERTAMA yang menghasilkan hadiah.
    const jumlahLunas = await Order.countDocuments({ userId: user.id, status: "completed" });
    if (jumlahLunas > 1) return;

    const pengajak = await User.findOne({ id: user.referredBy });
    if (!pengajak || pengajak.id === user.id) return;

    // Batas per bulan.
    const awalBulan = new Date();
    awalBulan.setDate(1); awalBulan.setHours(0, 0, 0, 0);
    const bulanIni = await Referral.countDocuments({
      referrerId: pengajak.id, at: { $gte: awalBulan.toISOString() }
    });
    if (bulanIni >= REF_MAX_PER_MONTH) {
      console.log(`[referral] ${pengajak.username} sudah mencapai batas ${REF_MAX_PER_MONTH} per bulan.`);
      return;
    }

    // Nomor bot yang sama tidak boleh dipanen berulang kali.
    const nomorSama = (user.botNumbers || []).some(n => (pengajak.botNumbers || []).includes(n));
    if (nomorSama) {
      console.warn(`[referral] Ditolak: ${user.username} & ${pengajak.username} memakai nomor bot yang sama.`);
      return;
    }

    const kredit = Math.min(REF_MAX_REWARD, Math.floor(order.amount * (REF_REWARD_PERCENT / 100)));

    // unique index pada referredId memastikan ini tidak bisa dobel walau
    // dipanggil dua kali oleh webhook dan polling sekaligus.
    await Referral.create({
      referrerId: pengajak.id, referredId: user.id,
      orderId: order.orderId, rewardCredit: kredit
    });

    await User.updateOne({ id: pengajak.id }, { $inc: { credit: kredit } });
    await User.updateOne({ id: user.id }, { $set: { refRewarded: true } });

    console.log(`[referral] ${pengajak.username} dapat kredit Rp ${kredit} dari ${user.username}`);
  } catch (err) {
    if (err.code !== 11000) console.error("[referral] gagal:", err.message);
  }
}

// ==========================================
// ADD-ONS
// ==========================================
// Katalog & harga add-on ada di lib/addons.js. Harga selalu dibaca di
// server; client tidak pernah menentukan nominal sendiri.

app.get("/api/addons/catalog", (req, res) => {
  res.json({ success: true, catalog: ADDON_CATALOG, fee: ADMIN_FEE });
});

// Add-on aktif milik user + sisa waktunya.
app.get("/api/addons/mine/:userId", async (req, res) => {
  try {
    const now = new Date().toISOString();
    const rows = await Addon.find({ userId: req.params.userId, expiredAt: { $gt: now } }).lean();
    res.json({
      success: true,
      addons: rows.map(a => ({
        type: a.type,
        name: ADDON_CATALOG[a.type]?.name || a.type,
        botNumber: a.botNumber,
        expiredAt: a.expiredAt
      }))
    });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Cek voucher untuk add-on (dipakai modal sebelum bayar).
app.post("/api/addons/check-promo", async (req, res) => {
  try {
    const { code, type, days } = req.body;
    const opt = ADDON_CATALOG[type]?.options.find(o => o.days === Number(days));
    if (!opt) return res.json({ success: false, message: "Pilihan add-on tidak dikenal." });

    const promo = await Promo.findOne({ code: String(code || "").toUpperCase() });
    if (!promo || !promo.isActive) return res.json({ success: false, message: "Kode voucher tidak valid." });
    if (promo.usedCount >= promo.maxUses) return res.json({ success: false, message: "Kuota kode voucher sudah habis." });

    const discount = Math.floor(opt.price * (promo.discount / 100));
    res.json({ success: true, code: promo.code, percent: promo.discount, discount, subtotal: opt.price, fee: ADMIN_FEE, total: opt.price - discount + ADMIN_FEE });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Beli add-on: membuat invoice QRIS lewat gateway, sama seperti paket.
app.post("/api/addons/create", async (req, res) => {
  try {
    const { userId, type, days, botNumber = "", promoCode = "" } = req.body;
    if (!userId) return res.status(401).json({ success: false, message: "Silakan login ulang." });

    const catalog = ADDON_CATALOG[type];
    const opt = catalog?.options.find(o => o.days === Number(days));
    if (!opt) return res.status(400).json({ success: false, message: "Pilihan add-on tidak dikenal." });

    const user = await User.findOne({ id: userId });
    if (!user) return res.status(404).json({ success: false, message: "User tidak ditemukan." });

    const subtotal = opt.price;
    let discount = 0, appliedPromo = "";
    if (promoCode) {
      const promo = await Promo.findOne({ code: String(promoCode).toUpperCase() });
      if (!promo || !promo.isActive) return res.status(400).json({ success: false, message: "Kode voucher tidak valid." });
      if (promo.usedCount >= promo.maxUses) return res.status(400).json({ success: false, message: "Kuota kode voucher sudah habis." });
      discount = Math.floor(subtotal * (promo.discount / 100));
      appliedPromo = promo.code;
    }

    const fee = ADMIN_FEE;
    const amount = Math.max(1, subtotal - discount) + fee;

    // Aturan yang sama: satu invoice berjalan per user.
    const blocking = await findBlockingOrder(userId);
    if (blocking) {
      return res.status(409).json({
        success: false,
        code: "PENDING_EXISTS",
        message: "Masih ada invoice yang belum dibayar. Batalkan dulu sebelum membuat yang baru.",
        orderId: blocking.orderId
      });
    }

    const order = await createOrderWithQris({
      userId, user, amount, subtotal, discount, fee, promoCode: appliedPromo,
      extra: {
        kind: "addon", addonType: type, addonDays: opt.days, months: 0,
        ...(botNumber ? { botNumber } : {})
      }
    });

    res.json({ success: true, order });
  } catch (error) {
    console.error("addons/create error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Aktifkan add-on setelah lunas. Idempotent seperti activateOrder.
async function activateAddon(order, completedAt) {
  if (order.status === "completed") return order;

  const now = new Date();
  const existing = await Addon.findOne({ userId: order.userId, type: order.addonType });
  const currentExp = existing?.expiredAt ? new Date(existing.expiredAt) : null;

  // Add-on sejenis ditumpuk, bukan direset — kalau beli lagi saat masih
  // aktif, sisanya tidak hangus.
  const base = (currentExp && currentExp > now) ? currentExp : now;
  const newExp = new Date(base.getTime() + (order.addonDays || 0) * DAY_MS);

  if (existing) {
    await Addon.updateOne({ _id: existing._id }, { $set: { expiredAt: newExp.toISOString(), botNumber: order.botNumber || existing.botNumber } });
  } else {
    await Addon.create({ userId: order.userId, type: order.addonType, botNumber: order.botNumber || "", expiredAt: newExp.toISOString() });
  }

  await Order.updateOne({ orderId: order.orderId }, {
    $set: { status: "completed", completedAt: completedAt || new Date().toISOString() }
  });
  if (order.promoCode) await Promo.updateOne({ code: order.promoCode }, { $inc: { usedCount: 1 } });

  // Cache add-on dibersihkan supaya pembelian langsung terasa, tidak
  // menunggu TTL 30 detik.
  invalidateAddonCache(order.userId);
  if (order.botNumber) invalidateAddonCache(order.botNumber);

  console.log(`[✔] Add-on ${order.addonType} aktif untuk ${order.username} s/d ${newExp.toISOString()}`);
  return await Order.findOne({ orderId: order.orderId });
}

// Dipakai plugin MLBB (lewat nomor bot) untuk melewati cooldown.
app.get("/api/addons/active", async (req, res) => {
  try {
    const { type = "mlbb_unlimited", botNumber = "", userId = "" } = req.query;
    const key = botNumber || userId;
    if (!key) return res.json({ success: true, active: false });
    res.json({ success: true, active: await hasActiveAddon(key, type) });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// ==========================================
// API: ADMIN DASHBOARD (KHUSUS MANZZY)
// ==========================================
// Guard: cek role admin di server, bukan cuma di browser.
// Frontend wajib kirim header 'x-user-id' berisi id user yang sedang login.
async function requireAdmin(req, res, next) {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const user = await User.findOne({ id: userId });
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, message: "Akses ditolak. Khusus admin." });
    }
    next();
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
}

app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
  try {
    // .lean() melewati pembuatan dokumen Mongoose penuh — jauh lebih ringan
    // untuk data yang cuma dibaca lalu dikirim sebagai JSON.
    const rawUsers = await User.find({}).select("-password -legacyMigrated").sort({ createdAt: -1 }).limit(200).lean();
    // Paket sekarang per bot: tiap baris user diberi jumlah bot & paket
    // tertinggi yang aktif. `tier`/`tierExpiredAt` ikut diisi dari situ
    // supaya tabel lama tetap menampilkan angka yang benar.
    const paketUser = await botsByOwner(rawUsers.map(u => u.id));
    const users = rawUsers.map(u => {
      const bots = paketUser.get(u.id) || [];
      const nomor = new Set([...bots.map(b => b.number), ...(u.botNumbers || [])]);
      const top = topPackage(bots);
      return { ...u, tier: top.tier, tierExpiredAt: top.tierExpiredAt, botsCount: nomor.size, topTier: top.tier, pending: pendingOf(u) };
    });
    const activeSessions = Array.from(sessions.keys()).map(s => s.replace('session-', ''));

    // Pakai getPricing() yang sama dengan /api/pricing (bukan baca Setting
    // langsung di sini), supaya admin & dashboard user selalu lihat angka
    // yang identik — sebelumnya ada dua jalur baca harga yang terpisah.
    const pricingValue = await getPricing();

    const promos = await Promo.find({}).sort({ createdAt: -1 }).lean();
    const bots = await getBotNodeList();
    const orders = await Order.find({}).sort({ createdAt: -1 }).limit(50).lean();

    // Dulu SELURUH order lunas ditarik ke memori hanya untuk dijumlahkan —
    // makin banyak transaksi, makin lambat. Sekarang dijumlah di database.
    const revAgg = await Order.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const revenue = revAgg[0]?.total || 0;

    res.json({ success: true, data: { users, activeSessionsCount: activeSessions.length, pricing: pricingValue, promos, bots, orders, revenue } });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Endpoint ringan khusus daftar node bot (dipakai admin.html untuk auto-refresh
// tiap beberapa detik tanpa perlu ambil ulang users/pricing/promo tiap kali).
app.get("/api/admin/bots", requireAdmin, async (req, res) => {
  try {
    const bots = await getBotNodeList();
    res.json({ success: true, data: { bots, onlineCount: bots.filter(b => b.isOnline).length, totalCount: bots.length } });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Gabungkan data bot dari jadibot.json (OBJECT keyed by nomor:
// { "628xxx": { status, config } }), dokumen Bot di MongoDB (paket, label,
// pemilik), dan koneksi WA yang benar-benar aktif (Map `sessions`).
// Bot yang punya dokumen Bot tapi sesinya sudah dihapus tetap tampil
// (status "stop") supaya admin tetap bisa mengatur paketnya.
async function getBotNodeList() {
  // "Online" = sesi yang sudah login ke WhatsApp (sock.user), sama dengan
  // botRuntimeStatus() & adminBotRow(). Sesi yang masih menunggu pairing
  // juga ada di Map `sessions`; kalau ikut dihitung, bot yang belum pernah
  // tersambung tampil ONLINE di admin padahal dashboard bilang "menyambung".
  const onlineNumbers = new Set(
    Array.from(sessions.entries()).filter(([, sock]) => sock?.user).map(([key]) => key.replace('session-', ''))
  );
  let jadibots = {};
  try {
    jadibots = await listJadibot();
  } catch (error) {
    console.error("Gagal mengambil listJadibot():", error.message);
    jadibots = {};
  }

  const dbUp = mongoose.connection.readyState === 1;
  let docs = [];
  if (dbUp) {
    try { docs = await Bot.find({}).lean(); }
    catch (error) { console.error("Gagal mengambil daftar Bot:", error.message); }
  }
  const byNumber = new Map(docs.map(d => [d.number, d]));
  const ownerIds = new Set(docs.map(d => d.ownerId).filter(Boolean));
  for (const entry of Object.values(jadibots || {})) {
    if (typeof entry?.config?.ownerId === "string" && entry.config.ownerId) ownerIds.add(entry.config.ownerId);
  }
  let ownerName = new Map();
  if (dbUp && ownerIds.size) {
    try {
      const owners = await User.find({ id: { $in: [...ownerIds] } }).select("id username").lean();
      ownerName = new Map(owners.map(u => [u.id, u.username]));
    } catch { /* nama pemilik opsional */ }
  }

  const numbers = new Set([...Object.keys(jadibots || {}), ...byNumber.keys()]);
  const rows = await Promise.all([...numbers].map(async (number) => {
    const bot = hasOwnKey(jadibots, number) ? jadibots[number] : null;
    const doc = byNumber.get(number);
    // DB putus: paket diambil lewat getBotConfig (nilai terakhir di cache)
    // daripada menampilkan semua bot sebagai Free.
    const pkg = doc || dbUp ? botPackage(doc) : botPackage({ tier: (await getBotConfig(number)).tier });
    const ownerId = doc?.ownerId || bot?.config?.ownerId || "";
    return {
      number,
      label: doc?.label || "",
      status: bot?.status || 'stop',
      ...pkg,
      ownerId,
      ownerName: ownerName.get(ownerId) || "",
      ownerNumber: bot?.config?.ownerNumber || '',
      isOnline: onlineNumbers.has(number)
    };
  }));
  return rows.sort((a, b) => Number(b.isOnline) - Number(a.isOnline));
}

// Baris tabel admin untuk SATU bot (respons /api/admin/bot-tier).
async function adminBotRow(number) {
  const doc = await Bot.findOne({ number }).lean();
  const owner = doc?.ownerId ? await User.findOne({ id: doc.ownerId }).select("username").lean() : null;
  return {
    number,
    label: doc?.label || "",
    ...botPackage(doc),
    ownerId: doc?.ownerId || "",
    ownerName: owner?.username || "",
    isOnline: !!sessions.get(`session-${number}`)?.user
  };
}

// Atur paket SATU bot dari panel admin. `days` = masa aktif baru dihitung
// dari sekarang (bukan ditambahkan); tier "free" mengosongkan masa aktif.
app.post("/api/admin/bot-tier", requireAdmin, async (req, res) => {
  try {
    const { tier } = req.body || {};
    const number = normalizeBotNumber(req.body?.number);
    if (!number) return res.status(400).json({ success: false, message: "Nomor bot tidak valid." });
    if (!TIER_LABEL[tier]) return res.status(400).json({ success: false, message: "Paket tidak dikenal." });

    let expiredAt = "";
    if (tier !== "free") {
      const days = Number(req.body?.days);
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        return res.status(400).json({ success: false, message: "Masa aktif harus 1–3650 hari." });
      }
      expiredAt = new Date(Date.now() + days * DAY_MS).toISOString();
    }

    // Bot harus dikenal: punya dokumen Bot, tercatat di akun user, atau ada
    // di jadibot.json. Dokumen dibuat kalau belum ada (data lama).
    let doc = await Bot.findOne({ number }).lean();
    if (!doc) {
      const pemilik = await User.findOne({ botNumbers: number }).select("id").lean();
      const entry = await getJadibot(number);
      if (!pemilik && !entry) return res.status(404).json({ success: false, message: "Bot tidak ditemukan." });
      const ownerId = pemilik?.id || (typeof entry?.config?.ownerId === "string" ? entry.config.ownerId : "");
      doc = await ensureBotDoc(number, ownerId);
    }

    const sebelum = botPackage(doc);
    await setBotPackage(number, tier, expiredAt);

    await writeAudit(req, "ubah-paket-bot", number,
      `${sebelum.tier} -> ${tier}${tier === "free" ? "" : ` (${req.body.days} hari, s/d ${expiredAt.slice(0, 10)})`}`);
    res.json({
      success: true,
      message: `Paket bot ${number} sekarang ${TIER_LABEL[tier]}.`,
      bot: await adminBotRow(number)
    });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.post("/api/admin/update-tier", requireAdmin, async (req, res) => {
  try {
    const { userId, newTier } = req.body;
    if (typeof userId !== "string" || !userId) return res.status(400).json({ success: false, message: "User tidak valid." });
    if (!TIER_LABEL[newTier]) return res.status(400).json({ success: false, message: "Paket tidak dikenal." });
    const sebelum = await User.findOne({ id: userId }).lean();
    if (!sebelum) return res.status(404).json({ success: false, message: "User tidak ditemukan." });

    // KOMPATIBILITAS: paket sekarang per bot. Endpoint lama (per akun) ini
    // menerapkan paket ke SEMUA bot milik user, PERMANEN (tanpa tanggal
    // kedaluwarsa) seperti perilaku lamanya. Panel admin sebaiknya memakai
    // /api/admin/bot-tier. User tanpa bot mendapat paket tertunda.
    const bots = await botsOfUser(sebelum);
    for (const b of bots) await setBotPackage(b.number, newTier, "");
    if (!bots.length) {
      await User.updateOne({ id: userId }, {
        $set: newTier === "free"
          ? { pendingTier: "", pendingTierExpiredAt: "" }
          : { pendingTier: newTier, pendingTierExpiredAt: "" }
      });
    }
    // Field lama ikut diisi supaya data yang dibaca kode/tampilan lama tetap konsisten.
    await User.updateOne({ id: userId }, { $set: { tier: newTier, tierExpiredAt: "" } });

    await writeAudit(req, "ubah-tier", sebelum.username || userId,
                     `${topPackage(bots).tier} -> ${newTier} (${bots.length ? `${bots.length} bot` : "paket tertunda"})`);
    res.json({
      success: true,
      message: bots.length
        ? `Paket ${TIER_LABEL[newTier]} diterapkan ke ${bots.length} bot milik user ini.`
        : `User ini belum punya bot — paket ${TIER_LABEL[newTier]} disimpan untuk bot pertamanya.`
    });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.post("/api/admin/update-pricing", requireAdmin, async (req, res) => {
  try {
    // Simpan sebagai angka, bukan string yang dikirim input number.
    const clean = {};
    for (const tier of ['basic', 'plus', 'booster']) {
      const n = Math.round(Number(req.body[tier]));
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ success: false, message: `Harga ${tier} harus berupa angka.` });
      }
      clean[tier] = n;
    }
    await Setting.updateOne({ key: 'pricing' }, { $set: { value: clean } }, { upsert: true });
    lastPricing = { ...clean };
    await writeAudit(req, "ubah-harga", "pricing", JSON.stringify(clean));
    res.json({ success: true, message: "Harga paket berhasil diperbarui.", pricing: clean });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Hapus semua bot milik user paket Free sekaligus. Berguna untuk
// membebaskan server dari bot gratis yang tidak terpakai.
app.post("/api/admin/delete-free-bots", requireAdmin, async (req, res) => {
  try {
    // Paket dibaca dari dokumen Bot. Tanpa database, bot berbayar tidak bisa
    // dibedakan dari bot Free — jadi lebih baik menolak daripada ikut
    // menghapus bot yang sudah dibayar.
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, message: "Database belum tersambung. Coba lagi sebentar lagi." });
    }
    const jadibots = await listJadibot();
    const docs = await Bot.find({}).lean();
    const byNumber = new Map(docs.map(d => [d.number, d]));
    const numbers = new Set([
      ...Object.keys(jadibots).map(normalizeBotNumber).filter(Boolean),
      ...docs.map(d => d.number)
    ]);
    const dihapus = [];

    for (const number of numbers) {
      if (effectiveTier(byNumber.get(number)) !== "free") continue;

      const sock = sessions.get(`session-${number}`);
      if (sock) { try { await sock.logout(); } catch {} sessions.delete(`session-${number}`); }
      deleteFolderRecursive(path.join(process.cwd(), `session-${number}`));
      await deleteJadibot(number);
      await Bot.deleteOne({ number });
      await User.updateMany({ botNumbers: number }, { $pull: { botNumbers: number } });
      invalidateTier(number);
      dihapus.push(number);
    }

    await writeAudit(req, "hapus-bot-free", `${dihapus.length} bot`, dihapus.join(", "));
    res.json({ success: true, message: `${dihapus.length} bot user Free dihapus.`, dihapus });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Perbaiki data: jalankan migrasi untuk akun yang tertinggal, buatkan
// dokumen Bot untuk nomor lama di botNumbers, lalu samakan pemilik & salinan
// tier di config setiap bot dengan dokumen Bot (sumber kebenaran).
app.post("/api/admin/sync-tiers", requireAdmin, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, message: "Database belum tersambung. Coba lagi sebentar lagi." });
    }
    await runLegacyMigration();

    const users = await User.find({ botNumbers: { $exists: true, $ne: [] } }).lean();
    for (const u of users) await botsOfUser(u);

    const docs = await Bot.find({}).lean();
    let diperbaiki = 0;
    for (const b of docs) {
      await updateBotConfig(b.number, { ...(b.ownerId ? { ownerId: b.ownerId } : {}), tier: effectiveTier(b) });
      if (b.ownerId) await User.updateOne({ id: b.ownerId }, { $addToSet: { botNumbers: b.number } });
      invalidateTier(b.number);
      diperbaiki++;
    }

    const pemilik = new Set(docs.map(b => b.ownerId).filter(Boolean)).size;
    await writeAudit(req, "sinkron-tier", `${diperbaiki} bot`, `${pemilik} akun`);
    res.json({ success: true, message: `${diperbaiki} bot dari ${pemilik} akun disinkronkan.` });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.get("/api/admin/audit", requireAdmin, async (req, res) => {
  try {
    const logs = await AuditLog.find({}).sort({ at: -1 }).limit(100).lean();
    res.json({ success: true, logs });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.post("/api/admin/add-promo", requireAdmin, async (req, res) => {
    try {
      const { code, discount, maxUses } = req.body;
      await Promo.create({ code, discount, maxUses });
      res.json({ success: true, message: "Promo code ditambahkan." });
    } catch (error) { res.status(500).json({ success: false, message: "Kode promo sudah ada atau terjadi kesalahan." }); }
});


// ==========================================
// ADMIN: LIVE MONITOR & PENGATURAN SITUS
// ==========================================
// Sama seperti /api/public/live, plus nomor bot lengkap di log, rincian
// perhitungan kapasitas, dan tabel per bot.
app.get("/api/admin/live", requireAdmin, async (req, res) => {
  try {
    const data = await getLiveSnapshot({ since: req.query.since, history: wantHistory(req.query.history), admin: true });
    res.setHeader("Cache-Control", "no-store");
    res.json(data);
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.get("/api/admin/site-settings", requireAdmin, (req, res) => {
  try { res.json({ success: true, settings: getSiteSettings({ admin: true }) }); }
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.post("/api/admin/site-settings", requireAdmin, async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const settings = updateSiteSettings(body);
    invalidateLiveCache(); // nama server & batas kapasitas langsung berlaku
    // Tidak di-await: pengaturan ini disimpan di file justru supaya tetap
    // jalan saat MongoDB lambat; jangan sampai respons ikut menunggu log.
    writeAudit(req, "ubah-pengaturan-situs", "site-settings", Object.keys(body).join(", ").slice(0, 200));
    res.json({ success: true, settings });
  } catch (error) {
    if (error instanceof SettingsError) return res.status(400).json({ success: false, message: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

// Unggah media banner (BODY MENTAH, bukan JSON/multipart — tidak perlu
// dependensi tambahan). Nama & ekstensi file ditentukan server dari tipe
// MIME, bukan dari nama file kiriman, supaya tidak ada yang bisa
// menyelundupkan file .html/.js ke folder publik.
const SITE_MEDIA_TYPES = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/webm": "webm"
};
const SITE_MEDIA_DIR = path.join(WEB_DIR, "uploads", "site");
const rawSiteMedia = express.raw({ type: Object.keys(SITE_MEDIA_TYPES), limit: "25mb" });

// Cek "magic bytes": isi file harus benar-benar sesuai tipe yang diaku.
function mediaMatchesType(buf, type) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return false;
  const hex = (start, end) => buf.subarray(start, end).toString("hex");
  const ascii = (start, end) => buf.subarray(start, end).toString("latin1");
  switch (type) {
    case "image/png": return hex(0, 8) === "89504e470d0a1a0a";
    case "image/jpeg": return hex(0, 3) === "ffd8ff";
    case "image/gif": return ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a";
    case "image/webp": return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case "video/mp4": return ascii(4, 8) === "ftyp";
    case "video/webm": return hex(0, 4) === "1a45dfa3";
    default: return false;
  }
}

function siteMediaType(req) {
  return String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
}

app.post("/api/admin/site-media", requireAdmin, (req, res, next) => {
  if (!SITE_MEDIA_TYPES[siteMediaType(req)]) {
    return res.status(415).json({ success: false, message: "Tipe file tidak didukung. Pakai PNG, JPG, WEBP, GIF, MP4, atau WEBM." });
  }
  rawSiteMedia(req, res, (err) => {
    if (err) {
      const tooBig = err.type === "entity.too.large" || err.status === 413;
      return res.status(tooBig ? 413 : 400).json({ success: false, message: tooBig ? "Ukuran file maksimal 25 MB." : "Gagal membaca file." });
    }
    next();
  });
}, async (req, res) => {
  try {
    const type = siteMediaType(req);
    const ext = SITE_MEDIA_TYPES[type];
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) {
      return res.status(400).json({ success: false, message: "File kosong." });
    }
    if (!mediaMatchesType(buf, type)) {
      return res.status(415).json({ success: false, message: "Isi file tidak sesuai dengan tipenya." });
    }

    let original = String(req.headers["x-file-name"] || "");
    try { original = decodeURIComponent(original); } catch {}
    const safe = path.basename(original).replace(/\.[^.]*$/, "")
      .normalize("NFKD").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
      .slice(0, 40) || "media";
    const name = `${Date.now()}-${safe}.${ext}`;

    await fs.promises.mkdir(SITE_MEDIA_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(SITE_MEDIA_DIR, name), buf);
    writeAudit(req, "unggah-media-situs", name, `${type}, ${Math.round(buf.length / 1024)} KB`);

    res.json({
      success: true,
      url: `/uploads/site/${name}`,
      type: type.startsWith("video/") ? "video" : "image",
      size: buf.length
    });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Statistik asli per sesi bot. Sebelumnya endpoint ini mengembalikan angka
// hardcoded (1248, 142, dst) yang sama untuk semua orang — terlihat seperti
// data padahal bukan.
app.get("/api/bot/stats/:number", async (req, res) => {
  try {
    const number = req.params.number;
    const sock = sessions.get(`session-${number}`);
    const s = getStats(number);
    // Cuplikan pesan hanya untuk pemilik/admin (lihat maskRecent).
    const owner = s?.recent?.length
      ? await isOwnerOrAdmin(String(req.query.userId || req.headers["x-user-id"] || ""), number)
      : false;

    // Jumlah grup diambil langsung dari sesi kalau bot sedang aktif.
    let groups = s?.groups ?? 0;
    if (sock?.user) {
      groups = (await getGroupsCached(number, sock)).length;
    }

    if (!s) {
      return res.json({
        success: true,
        data: { online: !!sock?.user, messages: 0, commands: 0, groupMessages: 0, privateMessages: 0, groups, uptimeMs: 0, lastActivity: null, recent: [] }
      });
    }

    res.json({
      success: true,
      data: {
        online: !!sock?.user,
        messages: s.messages,
        commands: s.commands,
        groupMessages: s.groupMessages,
        privateMessages: s.privateMessages,
        groups,
        uptimeMs: s.uptimeMs,
        lastActivity: s.lastActivity,
        recent: owner ? s.recent : maskRecent(s.recent)
      }
    });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// ==========================================
// PENEGAKAN KEDALUWARSA TIER
// ==========================================
// Sebelumnya tierExpiredAt cuma dicatat waktu bayar, tidak pernah dicek
// ulang — jadi siapapun yang pernah bayar, paketnya nempel selamanya
// sampai admin turunkan manual. Ini yang menegakkannya otomatis.
const TIER_EXPIRY_CHECK_MS = 10 * 60 * 1000; // tiap 10 menit

async function enforceTierExpiry() {
  try {
    // Saat DB putus query Mongoose tertahan ~10 detik lalu gagal; cukup
    // lewati putaran ini — putaran berikutnya (10 menit) mencoba lagi.
    if (mongoose.connection.readyState !== 1) return;
    await waitForMigration();
    const now = new Date().toISOString();
    // ISO string bisa dibandingkan leksikografis sebagai tanggal karena
    // formatnya seragam (new Date().toISOString() selalu sama presisinya).
    // Paket sekarang per BOT, jadi yang diperiksa dokumen Bot.
    const expired = await Bot.find({ tier: { $ne: 'free' }, tierExpiredAt: { $ne: '', $lt: now } }).lean();
    let turun = 0;

    for (const bot of expired) {
      // Syarat tierExpiredAt yang sama: kalau bot baru saja diperpanjang
      // (pembayaran masuk di antara find & update), jangan ikut diturunkan.
      const r = await Bot.updateOne(
        { number: bot.number, tier: bot.tier, tierExpiredAt: bot.tierExpiredAt },
        { $set: { tier: 'free', tierExpiredAt: '' } }
      );
      if (!r.modifiedCount) continue;
      invalidateTier(bot.number);
      turun++;

      // Teruskan downgrade ke config bot yang sedang berjalan juga, supaya
      // fitur berbayar (owner number, custom menu, MLBB, dst) langsung
      // terkunci di bot-nya — persis seperti downgrade per akun dulu.
      try {
        await updateBotConfig(bot.number, {
          tier: 'free', ownerNumber: '', watermark: '', footer: '',
          customMenu: '', menuImage: '', autoReply: []
        });
      } catch (err) {
        console.error(`[tier-expiry] Gagal downgrade config bot ${bot.number}:`, err.message);
      }
    }
    if (turun) console.log(`[tier-expiry] ${turun} bot diturunkan ke Free karena masa aktif paketnya habis.`);

    // Paket tertunda yang sudah lewat masa aktifnya dibersihkan (sudah
    // tidak bernilai; pendingOf() memang sudah mengabaikannya).
    await User.updateMany(
      { pendingTier: { $nin: ['', 'free'] }, pendingTierExpiredAt: { $ne: '', $lt: now } },
      { $set: { pendingTier: '', pendingTierExpiredAt: '' } }
    );
  } catch (err) {
    console.error("[tier-expiry] Gagal cek kedaluwarsa:", err.message);
  }
}

function startTierExpiryEnforcer() {
  enforceTierExpiry(); // langsung cek sekali saat server baru nyala
  setInterval(enforceTierExpiry, TIER_EXPIRY_CHECK_MS);
  console.log(`[✔] Tier expiry enforcer aktif (cek tiap ${TIER_EXPIRY_CHECK_MS / 60000} menit).`);
}

// ==========================================
// BOT API GATEWAY (/api/v1/*)
// ==========================================
// Logika lengkapnya ada di lib/api-gateway.js; kepemilikan bot memakai
// assertBotOwner yang sama dengan endpoint dashboard lain.
mountApiGateway(app, { assertBotOwner });

// ==========================================
// PENANGANAN ERROR (HARUS PALING AKHIR)
// ==========================================
// Route /api yang tidak ada dijawab JSON, bukan halaman HTML "Cannot GET".
app.use("/api", (req, res) => {
  res.status(404).json({ success: false, message: "Endpoint tidak ditemukan." });
});

// JSON rusak / body kebesaran dari express.json() juga dijawab JSON.
// Tanpa ini Express mengirim halaman HTML berisi stack trace.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  const message =
    err.type === "entity.parse.failed" ? "Format JSON tidak valid." :
    err.type === "entity.too.large" ? "Ukuran data terlalu besar." :
    status >= 500 ? "Terjadi kesalahan di server." : (err.message || "Permintaan tidak valid.");
  if (status >= 500) console.error("[web] error tak tertangani:", err?.stack || err);
  if (req.path.startsWith("/api/v1")) {
    // Kontrak Bot API: input yang tidak bisa dibaca = 422, sama seperti
    // input yang salah isi, supaya klien cukup menangani satu kode.
    const v1Status = err.type === "entity.parse.failed" ? 422 : status;
    return res.status(v1Status).json({ creator: "Varesa", status: false, message });
  }
  res.status(status).json({ success: false, message });
});

// KHUSUS PENGUJIAN: akses ke fungsi internal tanpa mengubah perilaku apa
// pun. Tidak dipakai kode aplikasi.
export const __test = {
  activateAnyOrder, computeNewExpiry, migrateLegacyTiers, enforceTierExpiry,
  effectiveTier, botPackage, pendingOf, Bot, User, Order
};

export function startWebServer() {
  // Sampler performa dimulai bersama web server supaya grafik 10 menit
  // terakhir sudah terisi saat halaman pertama kali dibuka.
  startMonitor();

  // 0.0.0.0 wajib di Pterodactyl: kalau hanya listen di localhost,
  // CF Tunnel dan port-forward panel tidak bisa menjangkaunya.
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[✔] Web server Varesa (${process.env.WEB_HOST || "varesa.mom"}) aktif di port ${PORT}`);
  });

  // Tanpa handler ini, kegagalan bind melempar error yang tidak tertangkap
  // dan prosesnya mati diam-diam — persis gejala "restart lalu langsung
  // down", karena tunnel tidak pernah menemukan backend.
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `\n⛔ PORT ${PORT} MASIH DIPAKAI PROSES LAIN.\n` +
        `   Biasanya proses lama belum benar-benar mati saat restart.\n` +
        `   Perbaiki: pm2 delete all  lalu  pm2 start ecosystem.config.cjs\n` +
        `   Cek siapa yang memakai: lsof -i :${PORT}  atau  ss -ltnp | grep ${PORT}\n`
      );
    } else if (err.code === "EACCES") {
      console.error(`⛔ Tidak punya izin membuka port ${PORT}.`);
    } else {
      console.error(`⛔ Web server gagal listen di port ${PORT}:`, err.message);
    }
    // Keluar dengan kode error supaya PM2 tahu ini gagal dan mencoba lagi
    // dengan jeda, bukan restart beruntun tanpa henti.
    process.exit(1);
  });

  // Tunnel Cloudflare menahan koneksi cukup lama; nilai bawaan Node
  // (headers 60s / keepAlive 5s) membuat stream SSE cepat diputus.
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 125000;

  startTierEnforcer();
  startTierExpiryEnforcer();

  return server;
}