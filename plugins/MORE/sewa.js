// plugins/sewa.js

// plugins/sewa.js

const TEXT_PROMO = (pushName) => `
👋 *Halo Kak ${pushName}!*
Ingin membuat grup WhatsApp kamu lebih hidup, seru, dan terkelola otomatis?

✨ *Gunakan Bot WhatsApp Varesa MD Sekarang!* ✨

🟢 Transaksi 24/7 Otomatis!
bot bakal langsung masuk ke grub setelah pembayaran berhasil.

Nikmati berbagai fitur canggih mulai dari moderasi anti-link, game interaktif, stiker maker, hingga cek statistik game favoritmu secara instan 24 jam nonstop!

🚀 *Yuk sewa bot untuk grupmu melalui website resmi kami:*
🌐 https://sewa.manzzy.web.id
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