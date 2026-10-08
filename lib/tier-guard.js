/**
 * lib/tier-guard.js
 *
 * Pembatas akses fitur berdasarkan paket (tier) bot.
 * Tier dibaca dari config bot per-sesi (disimpan lewat dashboard web),
 * yang sudah di-inject ke messageInfo.sessionConfig oleh autoresbot.js.
 */

const TIER_LABEL = {
  free: "Free",
  basic: "Core",
  plus: "Prime",
  booster: "Zenith",
};

const TIER_RANK = { free: 0, basic: 1, plus: 2, booster: 3 };

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
    `🌐 Upgrade di: varesa.mom`;

  try {
    await sock.sendMessage(remoteJid, { text, contextInfo: channelContext }, { quoted: message });
  } catch (err) {
    console.error("[tier-guard] gagal kirim notifikasi:", err.message);
  }
  return true;
}

export default { getTier, hasTier, guardTier };
