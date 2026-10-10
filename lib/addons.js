/**
 * lib/addons.js
 *
 * Sumber tunggal untuk data add-on. Dipisah dari webserver.js supaya plugin
 * bot (mis. MLBB) bisa memakainya tanpa mengimpor webserver.js — impor
 * sirkular antar modul pernah jadi penyebab crash saat startup di project ini.
 */

import mongoose from "mongoose";

const addonSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  type: { type: String, required: true }, // mlbb_unlimited
  botNumber: { type: String, default: "" },
  expiredAt: { type: String, required: true },
  createdAt: { type: String, default: () => new Date().toISOString() },
});
addonSchema.index({ userId: 1, type: 1 });

// mongoose.model() melempar error kalau nama model didaftarkan dua kali.
// Pola ini membuat modul aman diimpor dari mana saja.
export const Addon = mongoose.models.Addon || mongoose.model("Addon", addonSchema);

export const ADDON_CATALOG = {
  mlbb_unlimited: {
    name: "Unlimited Access",
    desc: "Bot bebas dari semua batasan: jeda anti-spam, limit harian cek MLBB, dan potongan limit di seluruh perintah.",
    options: [
      { days: 1, price: 5000 },
      { days: 2, price: 10000 },
      { days: 5, price: 20000 },
    ],
  },
};

// Cache hasil pengecekan add-on. hasActiveAddon() dipanggil untuk SETIAP
// pesan masuk; tanpa cache itu berarti satu query MongoDB per pesan.
// TTL pendek (30 detik) sudah cukup: add-on berlaku harian, jadi telat
// aktif maksimal setengah menit tidak masalah.
const addonCache = new Map(); // key -> { at, active }
const ADDON_TTL_MS = 30 * 1000;

export function invalidateAddonCache(key) {
  if (!key) return addonCache.clear();
  // BUG SEBELUMNYA: kunci cache berbentuk "<key>:<type>", tapi yang dihapus
  // cuma "<key>" — jadi invalidasi tidak pernah berpengaruh dan add-on yang
  // baru dibeli baru terasa setelah TTL habis.
  const prefix = `${key}:`;
  for (const k of addonCache.keys()) {
    if (k === `${key}` || k.startsWith(prefix)) addonCache.delete(k);
  }
}

/**
 * Apakah ada add-on aktif untuk kunci ini (bisa userId atau nomor bot)?
 * Dipakai plugin untuk memutuskan melewati cooldown dan limit.
 */
export async function hasActiveAddon(key, type) {
  if (!key) return false;

  const cacheKey = `${key}:${type}`;
  const hit = addonCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ADDON_TTL_MS) return hit.active;

  // Database belum/tidak tersambung: jangan menunggu buffer Mongoose
  // (~10 detik) di jalur pesan. Anggap tidak aktif untuk sementara.
  // Sengaja tidak di-cache: begitu database tersambung lagi, pesan
  // berikutnya langsung membaca status yang benar.
  if (mongoose.connection.readyState !== 1) return false;

  try {
    const found = await Addon.findOne({
      type,
      expiredAt: { $gt: new Date().toISOString() },
      $or: [{ userId: String(key) }, { botNumber: String(key) }],
    }).lean();

    const active = !!found;
    addonCache.set(cacheKey, { at: Date.now(), active });
    return active;
  } catch (err) {
    // Kalau database bermasalah, jangan bikin plugin error — anggap saja
    // add-on tidak aktif, cooldown normal tetap berlaku.
    console.error("[addons] gagal cek add-on:", err.message);
    return false;
  }
}

export default { Addon, ADDON_CATALOG, hasActiveAddon, invalidateAddonCache };
