import fs from "fs";
import fsp from "fs/promises"; // fs.promises untuk operasi async
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

// Agar bisa pakai __dirname di ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pathJson = path.join(__dirname, "../database/jadibot.json");

async function fileExists(path) {
  try {
    await fsp.access(path);
    return true;
  } catch {
    return false;
  }
}

// ── Cache di memori ────────────────────────────────────────────
// BUG BERAT SEBELUMNYA: setiap panggilan listJadibot()/getBotConfig()
// membaca SELURUH file jadibot.json dari disk lalu mem-parse JSON-nya.
// getBotConfig() dipanggil di autoresbot.js untuk SETIAP pesan masuk,
// jadi bot di grup ramai melakukan ratusan pembacaan file per menit.
// Ini penyebab utama backend terasa berat.
//
// File ini hanya diubah lewat fungsi di modul ini, jadi cache aman:
// setiap tulis memperbarui cache sekaligus.
let cache = null;

async function readFromDisk() {
  if (!(await fileExists(pathJson))) {
    await fsp.writeFile(pathJson, JSON.stringify({}, null, 2), "utf8");
    return {};
  }
  const data = await fsp.readFile(pathJson, "utf8");
  try {
    return JSON.parse(data);
  } catch (err) {
    console.error("[jadibot] jadibot.json rusak, dipakai objek kosong:", err.message);
    return {};
  }
}

async function writeToDisk(data) {
  cache = data;
  await fsp.writeFile(pathJson, JSON.stringify(data, null, 2), "utf8");
}

async function listJadibot() {
  if (cache) return cache;
  cache = await readFromDisk();
  return cache;
}

// Paksa baca ulang dari disk (mis. kalau file diedit manual lewat panel).
async function reloadJadibot() {
  cache = await readFromDisk();
  return cache;
}

// Kunci jadibot.json SELALU nomor (angka saja). Kunci lain — terutama
// "__proto__"/"constructor" — bisa mencemari prototype Object di seluruh
// proses (semua API jadi error sampai restart) kalau ditulis lewat
// jadibots[number] = {...}. Jadi ditolak di pintu masuk modul ini,
// apa pun pemanggilnya.
function isSafeKey(number) {
  return /^\d{5,20}$/.test(String(number ?? ""));
}
function own(jadibots, number) {
  return isSafeKey(number) && Object.prototype.hasOwnProperty.call(jadibots, String(number));
}

async function deleteJadibot(number) {
  let jadibots = await listJadibot();
  if (own(jadibots, number)) {
    delete jadibots[number];
    await writeToDisk(jadibots);
    return true;
  } else {
    console.log("Number not found");
    return false;
  }
}

async function getJadibot(number) {
  let jadibots = await listJadibot();
  return own(jadibots, number) ? jadibots[number] : null;
}

async function updateJadibot(number, status) {
  if (!isSafeKey(number)) {
    console.warn(`[jadibot] updateJadibot ditolak: nomor tidak valid (${String(number).slice(0, 32)})`);
    return false;
  }
  let jadibots = await listJadibot();
  if (own(jadibots, number)) {
    jadibots[number].status = status;
  } else {
    jadibots[number] = { status: status };
  }
  await writeToDisk(jadibots);
  return true;
}

// --- TAMBAHAN UNTUK MULTI-TENANT CONFIG ---
async function updateBotConfig(number, configData) {
  if (!isSafeKey(number)) {
    console.warn(`[jadibot] updateBotConfig ditolak: nomor tidak valid (${String(number).slice(0, 32)})`);
    return false;
  }
  let jadibots = await listJadibot();
  if (!own(jadibots, number)) {
      jadibots[number] = { status: "offline" };
  }

  // Gabungkan config lama dengan yang baru
  jadibots[number].config = { ...jadibots[number].config, ...configData };
  await writeToDisk(jadibots);
  return true;
}

// ── Tier langsung dari database ────────────────────────────────
// MASALAH LAMA: tier disimpan di DUA tempat — User.tier di MongoDB dan
// config.tier di jadibot.json — dan bot hanya membaca yang kedua. Keduanya
// harus disinkronkan manual, dan setiap celah sinkronisasi membuat user
// yang sudah membayar tetap diperlakukan sebagai Free.
//
// Sekarang getBotConfig() mengambil tier langsung dari database. Sejak
// paket berlaku PER BOT (bukan per akun), sumbernya dokumen Bot milik
// nomor itu sendiri — satu akun bisa punya beberapa bot dengan paket
// berbeda. Satu sumber kebenaran, tidak ada lagi yang bisa tertinggal.
//
// jadibot.js tidak mengimpor model Bot/User secara langsung (itu akan
// membuat impor sirkular dengan webserver.js). webserver.js yang
// menyuntikkan fungsi pencarinya lewat setTierResolver().
let tierResolver = null;
const tierCache = new Map(); // number -> { at, tier }
const TIER_TTL_MS = 30 * 1000;

function setTierResolver(fn) {
  tierResolver = typeof fn === 'function' ? fn : null;
}

// Dipanggil saat tier berubah supaya langsung berlaku, tidak menunggu
// cache 30 detik habis.
function invalidateTier(number) {
  if (number) tierCache.delete(String(number));
  else tierCache.clear();
}

async function resolveTier(number, fallback) {
  if (!tierResolver) return fallback;
  const hit = tierCache.get(number);
  if (hit && Date.now() - hit.at < TIER_TTL_MS) return hit.tier;
  // Database sedang putus: pakai nilai terakhir yang diketahui tanpa
  // menunggu buffer Mongoose, supaya pesan tidak ikut tertahan.
  if (mongoose.connection.readyState !== 1) return hit?.tier || fallback || 'free';
  try {
    const tier = await tierResolver(number);
    // null = resolver tidak tahu (mis. belum terpasang); pakai nilai lama
    // di config. Resolver paket per bot selalu menjawab ("free" kalau
    // nomor tidak punya dokumen Bot).
    const final = tier || fallback || 'free';
    tierCache.set(number, { at: Date.now(), tier: final });
    return final;
  } catch (err) {
    console.error('[jadibot] gagal membaca tier dari database:', err.message);
    // Kegagalan juga di-cache. Saat MongoDB putus, query Mongoose menunggu
    // ~10 detik (buffer) sebelum gagal; tanpa cache ini SETIAP pesan masuk
    // ikut tertahan 10 detik dan bot terasa mati.
    const final = fallback || 'free';
    tierCache.set(number, { at: Date.now(), tier: final });
    return final;
  }
}

async function getBotConfig(number) {
  const jadibots = await listJadibot();
  const config = { ...((own(jadibots, number) && jadibots[number].config) || {}) };
  // Tier SELALU dari database (lewat cache 30 detik), bukan dari file.
  config.tier = await resolveTier(String(number), config.tier);
  return config;
}

// Apakah nomor ini sesi jadibot milik user (terdaftar lewat dashboard)?
// Bot utama milik operator (folder "session") tidak tercatat di
// jadibot.json. Dipakai untuk membedakan perilaku bot utama (sewa grup,
// mode self global) dari bot milik user.
async function isJadibot(number) {
  if (!number) return false;
  const jadibots = await listJadibot();
  return Object.prototype.hasOwnProperty.call(jadibots, String(number));
}

// Pastikan semua fungsi diekspor di sini
export { listJadibot, reloadJadibot, deleteJadibot, updateJadibot, getJadibot, updateBotConfig, getBotConfig, setTierResolver, invalidateTier, isJadibot };