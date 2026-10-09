/**
 * lib/tier-guard.js
 *
 * Pembatas akses fitur berdasarkan paket (tier) bot.
 * Tier dibaca dari config bot per-sesi (disimpan lewat dashboard web),
 * yang sudah di-inject ke messageInfo.sessionConfig oleh autoresbot.js.
 */
import config from "../config.js";

export const TIER_LABEL = {
  free: "Free",
  basic: "Core",
  plus: "Prime",
  booster: "Zenith",
};

const TIER_RANK = { free: 0, basic: 1, plus: 2, booster: 3 };

// Batas per paket — HARUS sama dengan lib/webserver.js
// (OWNER_LIMIT_BY_TIER, AUTOREPLY_QUOTA, CUSTOMCMD_QUOTA) dan app.js.
export const TIER_CAPS = {
  free:    { owners: 0, autoReply: 0,   customCommands: 0,  customize: false, menuImage: false },
  basic:   { owners: 1, autoReply: 10,  customCommands: 0,  customize: true,  menuImage: false },
  plus:    { owners: 3, autoReply: 30,  customCommands: 15, customize: true,  menuImage: false },
  booster: { owners: 5, autoReply: 100, customCommands: 50, customize: true,  menuImage: true  },
};

/**
 * Terapkan batas paket ke config bot SAAT DIBACA bot.
 *
 * Kenapa perlu: config di jadibot.json bisa basi. Tier dibaca live dari
 * database (getBotConfig), tapi isi config lama tidak selalu ikut
 * dibersihkan — mis. perintah kustom tidak dihapus saat paket habis,
 * atau admin menurunkan paket lewat panel. Tanpa ini, bot yang paketnya
 * sudah turun ke Free tetap menjalankan fitur berbayar.
 *
 * Mengembalikan objek baru; config asli tidak diubah.
 */
export function applyTierCaps(cfg = {}) {
  const tier = TIER_CAPS[cfg.tier] ? cfg.tier : "free";
  const caps = TIER_CAPS[tier];
  const out = { ...cfg, tier };

  const owners = String(cfg.ownerNumber || "")
    .split(",")
    .map((n) => n.replace(/\D/g, ""))
    // Nomor lokal "08xx" disamakan ke format internasional "628xx",
    // karena WhatsApp selalu mengirim pengirim dalam format 62.
    .map((n) => (n.startsWith("0") ? `62${n.slice(1)}` : n))
    // Minimal 8 digit: mencegah entri pendek (mis. "62") yang dulu
    // dicocokkan dengan .includes() dan membuat SEMUA orang jadi owner.
    .filter((n) => n.length >= 8)
    .slice(0, caps.owners);
  out.ownerNumber = owners.join(",");
  out.owners = owners;

  if (!caps.customize) {
    out.botName = "";
    out.watermark = "";
    out.footer = "";
    out.customMenu = "";
  }
  if (!caps.menuImage) out.menuImage = "";

  out.autoReply = Array.isArray(cfg.autoReply) ? cfg.autoReply.slice(0, caps.autoReply) : [];
  out.customCommands = Array.isArray(cfg.customCommands)
    ? cfg.customCommands
        .slice(0, caps.customCommands)
        // Gambar di perintah kustom khusus Zenith (sama seperti di server).
        .map((c) => (caps.menuImage ? c : { ...c, image: "" }))
    : [];
  return out;
}

/** Link upgrade paket di web dashboard. */
export function upgradeUrl() {
  return `${config.web_url}/dashboard`;
}

const channelContext = {
  forwardingScore: 999,
  isForwarded: true,
  forwardedNewsletterMessageInfo: {
    newsletterJid: "120363425345196924@newsletter",
    newsletterName: "VARESA OFFICIAL",
    serverMessageId: -1,
  },
};

/** Ambil tier aktif dari messageInfo. Default 'free' kalau belum diset. */
export function getTier(messageInfo) {
  return messageInfo?.sessionConfig?.tier || "free";
}

/**
 * Cek apakah tier bot memenuhi minimal yang dibutuhkan.
 * @returns {boolean}
 */
export function hasTier(messageInfo, minimumTier = "booster") {
  const current = TIER_RANK[getTier(messageInfo)] ?? 0;
  const needed = TIER_RANK[minimumTier] ?? 0;
  return current >= needed;
}

/**
 * Guard untuk dipakai di awal handle() sebuah plugin.
 * Kalau tier kurang, dia kirim notifikasi lalu balikin `true` (artinya:
 * plugin harus berhenti / `return`). Kalau cukup, balikin `false`.
 *
 * Contoh pakai:
 *   if (await guardTier(sock, messageInfo, 'booster', 'Cek MLBB')) return;
 */
export async function guardTier(sock, messageInfo, minimumTier = "booster", featureName = "Fitur ini") {
  if (hasTier(messageInfo, minimumTier)) return false;

  const { remoteJid, message } = messageInfo;
  const currentLabel = TIER_LABEL[getTier(messageInfo)] || "Free";
  const neededLabel = TIER_LABEL[minimumTier] || "Zenith";

  const text =
    `🔒 *AKSES TERKUNCI*\n\n` +
    `Bot ini berada di akses *${currentLabel}*.\n` +
    `Upgrade ke *${neededLabel}* untuk mendapatkan akses ${featureName}.\n\n` +
    `🌐 Upgrade di: ${upgradeUrl()}`;

  try {
    await sock.sendMessage(remoteJid, { text, contextInfo: channelContext }, { quoted: message });
  } catch (err) {
    console.error("[tier-guard] gagal kirim notifikasi:", err.message);
  }
  return true;
}

export default { getTier, hasTier, guardTier, applyTierCaps, upgradeUrl, TIER_CAPS, TIER_LABEL };
