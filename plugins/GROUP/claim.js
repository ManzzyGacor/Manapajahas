
import { findUser, updateUser, addUser } from "../../lib/users.js";
import { formatRemainingTime } from "../../lib/utils.js";
import config from "../../config.js";

// --- Konstanta Visual ---
const THUMBNAIL_CLAIM_URL = "https://autoresbot.com/tmp_files/19dde1d0-76b8-4dac-947b-c47ae9c3493e.jpg"; // Ganti dengan link gambar koin atau peti
const SOURCE_URL = config.web_url; // link kartu pratinjau -> website Varesa

async function handle(sock, messageInfo) {
  const { remoteJid, message, sender, pushName } = messageInfo;

  const CLAIM_COOLDOWN_MINUTES = 480; // 4 jam (240 menit)
  const MIN_CLAIM = 5; // Ubah ini untuk hasil random yang lebih besar
  const MAX_CLAIM = 10; // Ubah ini untuk hasil random yang lebih besar

  // Random Money dan Limit
  const MoneyClaim =
    Math.floor(Math.random() * (MAX_CLAIM - MIN_CLAIM + 1)) + MIN_CLAIM;
  const LimitClaim =
    Math.floor(Math.random() * (MAX_CLAIM - MIN_CLAIM + 1)) + MIN_CLAIM;


  // Ambil data user
  const dataUsers = await findUser(sender);
  if (dataUsers) {
    const [docId, userData] = dataUsers;
    const currentTime = Date.now();
    const CLAIM_COOLDOWN = CLAIM_COOLDOWN_MINUTES * 60 * 1000;

    // --- Cooldown Check ---
    if (
      userData.lastClaim &&
      currentTime - userData.lastClaim < CLAIM_COOLDOWN
    ) {
      const remainingTime = Math.floor(
        (CLAIM_COOLDOWN - (currentTime - userData.lastClaim)) / 1000
      );
      const formattedTime = formatRemainingTime(remainingTime);
      
      const cooldownText = `
╭───〔 ⏳ *COOLDOWN* 〕───✧
│
│ ❌ *Hai, ${pushName}!*
│ 
│ Kamu sudah mengklaim hadiah hari ini.
│ 
│ Harap tunggu:
│ ⏱️ *${formattedTime}*
│ lagi sebelum bisa klaim kembali.
│
╰──────────────✧
      `.trim();
      
      return await sock.sendMessage(
        remoteJid,
        {
          text: cooldownText,
        },
        { quoted: message }
      );
    }

    // --- Sukses Claim ---
    await updateUser(sender, {
      money: userData.money + MoneyClaim,
      limit: userData.limit + LimitClaim,
      lastClaim: currentTime,
    });

    const successText = `
╭───〔 ✅ *CLAIM SUKSES* 〕───✧
│
│ 🎉 *Selamat, ${pushName}!*
│
│ Kamu berhasil mendapatkan hadiah harian:
│ 
│ 💰 *Money:* +${MoneyClaim.toLocaleString()}
│ ⚡ *Limit:* +${LimitClaim}
│
╰──────────────✧
    `.trim();

    return await sock.sendMessage(
        remoteJid,
        {
            text: successText,
            contextInfo: {
                externalAdReply: {
                    title: "🎁 HADIAH RANDOM",
                    body: `Claim berikutnya dalam ${CLAIM_COOLDOWN_MINUTES / 60} jam.`,
                    thumbnailUrl: THUMBNAIL_CLAIM_URL,
                    sourceUrl: SOURCE_URL,
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        },
        { quoted: message }
    );
  } else {
    // Jika user belum terdaftar, gunakan logika addUser jika ada.
    // Karena di file aslinya hanya return, kita biarkan saja.
    return;
  }
}

export default {
  handle,
  Commands: ["claim"],
  OnlyPremium: false,
  OnlyOwner: false,
};