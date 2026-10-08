/**
 * lib/tier-enforcer.js
 *
 * Penegakan kuota grup untuk bot paket Free.
 *
 * Aturan Free:
 *   - 1 grup  -> boleh berapa pun jumlah membernya (termasuk > 30)
 *   - 2 grup  -> setiap grup HARUS di bawah 15 member
 *   - 3 grup+ -> melanggar
 *
 * Melanggar => bot dimatikan dan sesi WhatsApp dihapus permanen.
 *
 * Catatan: pelanggaran tidak langsung dieksekusi. Bot mengirim peringatan
 * lebih dulu dan memberi tenggang (GRACE_MS) supaya user sempat keluar dari
 * grup berlebih. Ini disengaja: menghapus sesi tidak bisa di-undo, dan sekali
 * terhapus user harus pairing ulang dari nol.
 */

import path from "path";
import { getBotConfig, updateJadibot, deleteJadibot, isJadibot } from "./jadibot.js";
import config from "../config.js";
import { sessions } from "./cache.js";
import { deleteFolderRecursive } from "./utils.js";
import { getGroupsCached, invalidateGroups } from "./bot-stats.js";

const MAX_MEMBERS_SINGLE_GROUP = Infinity; // 1 grup: bebas
const MAX_MEMBERS_MULTI_GROUP = 15;        // 2 grup: masing-masing < 15
const MAX_GROUPS = 2;

const GRACE_MS = 10 * 60 * 1000; // 10 menit tenggang sebelum eksekusi
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // periksa tiap 5 menit

// number -> timestamp peringatan pertama
const warned = new Map();

/**
 * Periksa apakah susunan grup melanggar kuota Free.
 * @returns {{violation: boolean, reason: string, groups: number}}
 */
export function evaluateGroups(groupList) {
  const count = groupList.length;

  if (count === 0) return { violation: false, reason: "", groups: 0 };

  if (count === 1) {
    const g = groupList[0];
    if (g.size > MAX_MEMBERS_SINGLE_GROUP) {
      return { violation: true, reason: `1 grup dengan ${g.size} member melebihi batas.`, groups: count };
    }
    return { violation: false, reason: "", groups: count };
  }

  if (count === 2) {
    const tooBig = groupList.filter(g => g.size >= MAX_MEMBERS_MULTI_GROUP);
    if (tooBig.length) {
      return {
        violation: true,
        groups: count,
        reason: `Paket Free hanya boleh 2 grup bila masing-masing di bawah ${MAX_MEMBERS_MULTI_GROUP} member. ` +
                `Grup berikut melebihi: ${tooBig.map(g => `${g.subject} (${g.size})`).join(", ")}.`
      };
    }
    return { violation: false, reason: "", groups: count };
  }

  return {
    violation: true,
    groups: count,
    reason: `Bot tergabung di ${count} grup. Paket Free maksimal ${MAX_GROUPS} grup.`
  };
}

/* fetchGroups lokal dihapus — sekarang memakai getGroupsCached() bersama,
   supaya tidak ada dua jalur yang sama-sama memanggil WhatsApp. */

/** Matikan bot dan hapus sesi WhatsApp secara permanen. */
async function killSession(number, sock) {
  try {
    if (sock) {
      try { await sock.logout(); } catch { /* sudah terputus */ }
    }
    sessions.delete(`session-${number}`);
    deleteFolderRecursive(path.join(process.cwd(), `session-${number}`));
    await updateJadibot(number, "stop");
    await deleteJadibot(number);
    warned.delete(number);
    console.log(`[tier-enforcer] Sesi ${number} dihapus karena melanggar kuota grup Free.`);
  } catch (err) {
    console.error(`[tier-enforcer] Gagal menghapus sesi ${number}:`, err.message);
  }
}

async function notifyAll(sock, groupList, text) {
  for (const g of groupList) {
    try { await sock.sendMessage(g.id, { text }); } catch { /* lanjut */ }
  }
}

/**
 * Periksa satu sesi bot dan tegakkan aturan bila perlu.
 */
export async function enforceForSession(number, sock) {
  try {
    if (!sock?.user) return;

    // Kuota Free hanya untuk bot milik user. BUG SEBELUMNYA: bot utama
    // operator (folder "session", tidak terdaftar di jadibot.json) dibaca
    // sebagai paket Free juga — kalau ikut lebih dari 2 grup, sesinya
    // diperingatkan lalu di-LOGOUT dan dihapus oleh pemeriksaan ini.
    if (!(await isJadibot(number))) return;

    const botConfig = await getBotConfig(number);
    const tier = botConfig?.tier || "free";
    if (tier !== "free") { warned.delete(number); return; } // paket berbayar bebas kuota

    const groups = await getGroupsCached(number, sock);
    const result = evaluateGroups(groups);

    if (!result.violation) { warned.delete(number); return; }

    const firstWarn = warned.get(number);
    const now = Date.now();

    if (!firstWarn) {
      warned.set(number, now);
      const menit = Math.round(GRACE_MS / 60000);
      await notifyAll(sock, groups,
        `⚠️ *PERINGATAN KUOTA PAKET FREE*\n\n` +
        `${result.reason}\n\n` +
        `*Ketentuan paket Free:*\n` +
        `• 1 grup (jumlah member bebas), ATAU\n` +
        `• 2 grup dengan masing-masing di bawah ${MAX_MEMBERS_MULTI_GROUP} member\n\n` +
        `Bot akan *dimatikan dan sesinya dihapus permanen* dalam *${menit} menit* ` +
        `jika tidak diperbaiki. Keluarkan bot dari grup berlebih, atau upgrade paket.\n\n` +
        `🌐 Upgrade di: ${config.web_url}/dashboard`
      );
      console.log(`[tier-enforcer] Peringatan dikirim ke ${number}: ${result.reason}`);
      return;
    }

    if (now - firstWarn >= GRACE_MS) {
      await notifyAll(sock, groups,
        `🛑 *SESI BOT DIHENTIKAN*\n\n` +
        `${result.reason}\n\n` +
        `Sesi WhatsApp bot ini telah dihapus karena melebihi kuota paket Free. ` +
        `Silakan pairing ulang di ${config.web_url}/dashboard, atau upgrade paket agar tidak dibatasi.`
      );
      await killSession(number, sock);
    }
  } catch (err) {
    console.error(`[tier-enforcer] Error memeriksa ${number}:`, err.message);
  }
}

/** Periksa seluruh sesi aktif. */
export async function enforceAllSessions() {
  for (const [key, sock] of sessions.entries()) {
    // Hanya sesi jadibot ("session-628xx"); bot utama ("session") dilewati.
    if (!key.startsWith("session-")) continue;
    const number = key.replace("session-", "");
    await enforceForSession(number, sock);
  }
}

let timer = null;
/** Jalankan pemeriksaan berkala. Panggil sekali saat server start. */
export function startTierEnforcer() {
  if (timer) return;
  timer = setInterval(enforceAllSessions, CHECK_INTERVAL_MS);
  console.log(`[✔] Tier enforcer aktif (cek tiap ${CHECK_INTERVAL_MS / 60000} menit).`);
}

export default { evaluateGroups, enforceForSession, enforceAllSessions, startTierEnforcer };
