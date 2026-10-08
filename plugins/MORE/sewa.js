// plugins/sewa.js
import config from "../../config.js";

// Ajakan bikin bot sendiri di Varesa. Dulu mengarah ke sewa.manzzy.web.id
// (situs lama) — sekarang ke web dashboard Varesa yang sama dengan tempat
// user mendaftar, pairing nomor, dan upgrade paket.
const TEXT_PROMO = (pushName) => `
👋 *Halo Kak ${pushName || ""}!*
Ingin grup WhatsApp kamu lebih hidup, seru, dan terkelola otomatis?

✨ *Bikin Bot WhatsApp Sendiri di Varesa!* ✨

🟢 Daftar gratis, masukkan nomor, pairing — bot langsung aktif 24/7.
⚙️ Atur nama bot, owner, menu, pesan otomatis & sambutan grup langsung dari dashboard.
🚀 Ratusan fitur: moderasi anti-link, game, stiker, downloader, cek MLBB, dan lainnya.

💎 *Paket:* Free • Core • Prime • Zenith
_Harga terbaru & perbandingan paket ada di website._

🌐 *Daftar / upgrade di:*
${config.web_url}/dashboard
`.trim();

/**
 * Handler untuk command sewa
 */
async function handle(sock, messageInfo) {
    const { remoteJid, message, pushName } = messageInfo;

    // Ambil teks promosi
    const fullResponse = TEXT_PROMO(pushName);

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