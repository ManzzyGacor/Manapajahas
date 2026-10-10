// plugins/sewa.js
import config from "../../config.js";
import { getBotIdentity, renderBotText } from "../../lib/bot-scope.js";

// Ajakan bikin bot sendiri di Varesa. Dulu mengarah ke sewa.manzzy.web.id
// (situs lama) — sekarang ke web dashboard Varesa yang sama dengan tempat
// user mendaftar, pairing nomor, dan upgrade paket.
// Hanya untuk BOT UTAMA; bot milik user menampilkan teks sewanya sendiri.
const TEXT_PROMO = (pushName) => `
👋 *Halo Kak ${pushName || ""}!*
Ingin grup WhatsApp kamu lebih hidup, seru, dan terkelola otomatis?

✨ *Bikin Bot WhatsApp Sendiri di Varesa!* ✨

🟢 Daftar gratis, masukkan nomor, pairing — bot langsung aktif 24/7.
⚙️ Atur nama bot, owner, menu, pesan otomatis & sambutan grup langsung dari dashboard.
🚀 Ratusan fitur: moderasi anti-link, game, stiker, downloader, cek MLBB, dan lainnya.

💎 *Paket per bot:* Free • Core • Prime • Zenith
_Satu akun bisa punya beberapa bot, tiap bot bisa beda paket. Harga terbaru & perbandingan paket ada di website._

🌐 *Daftar / upgrade di:*
${config.web_url}/dashboard
`.trim();

// Teks bawaan bot milik user: nama & kontak owner BOT ITU, tanpa data
// operator. Owner paket berbayar bisa menggantinya di dashboard (sewaText).
const TEXT_SEWA_BOT = `
👋 *Halo Kak {pushname}!*
Mau grup kamu dijaga & diramaikan *{botname}*? 🤖

✨ *Sewa {botname} untuk grup kamu:*
• Moderasi grup: anti-link, sambutan member, dll
• Game, stiker, downloader & ratusan fitur lainnya
• Aktif 24 jam

💬 *Cara sewa:* chat owner bot ini untuk harga & masa sewa:
{ownerlink}

_Lihat semua fitur: ketik *{prefix}menu*_
`.trim();

/**
 * Handler untuk command sewa
 */
async function handle(sock, messageInfo) {
    const { remoteJid, message, pushName, prefix, isJadibot, sessionConfig } = messageInfo;

    let fullResponse;
    if (isJadibot) {
        // sewaText sudah dikosongkan applyTierCaps untuk bot Free, jadi
        // bot Free selalu memakai teks bawaan per bot.
        const identitas = getBotIdentity(messageInfo);
        const custom = String(sessionConfig?.sewaText || "").trim();
        fullResponse = renderBotText(custom || TEXT_SEWA_BOT, {
            botname: identitas.name,
            owner: identitas.owner,
            ownerlink: identitas.ownerLink,
            prefix: prefix || ".",
            pushname: pushName || "Kak",
            weburl: config.web_url,
        });
    } else {
        // Ambil teks promosi
        fullResponse = TEXT_PROMO(pushName);
    }

    // Kirim pesan teks murni (Text Only tanpa banner/thumbnail)
    await sock.sendMessage(
        remoteJid,
        {
            text: fullResponse
        },
        { quoted: message }
    );
}

// --- ESM Export Default ---
export default {
    handle,
    Commands: ["sewa", "pricelist"],
    OnlyPremium: false,
    OnlyOwner: false,
};
