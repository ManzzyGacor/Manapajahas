// plugins/premium.js

// --- Konstanta Data ---
const THUMBNAIL_URL = "https://autoresbot.com/tmp_files/f1d90ac1-89d5-4303-a4d9-46991586bd06.jpg"; 
const SOURCE_URL = "https://sewa.manzzy.web.id/premium.html"; // Redirect langsung ke web buy premium

// Masukkan ID Saluran WhatsApp kamu di sini (Contoh format: 1203633... atau dengan @newsletter)
const CHANNEL_JID = "120363425345196924@newsletter"; 
const CHANNEL_NAME = "📢 VaresaMD Official Channel";

const HARGA_PREMIUM = `
╭───「 👑 *PRICING LIST* 」
│
│ 🌟 *1 Hari*   : Rp 1.000
│ 🌟 *7 Hari*   : Rp 7.000
│ 🌟 *30 Hari*  : Rp 30.000
│
╰────────────────────────⳹`.trim();

const TEXT_GREETING = (pushName) => `
👋 *Halo Kak ${pushName}!*
Mau nikmatin bot tanpa batas dan akses fitur dewa? Yuk, upgrade status kamu ke *PREMIUM USER* sekarang juga! 🚀

🔥 *KEUNTUNGAN USER PREMIUM:*
│ ▹ ♾️ **Unlimited Limit** (Bebas pakai fitur tanpa takut habis)
│ ▹ ⚡ **Akses Fitur Khusus** (Cek & Ban Akun MLBB, dll)
│ ▹ 🚀 **Prioritas Bot Lebih Cepat** (Tanpa antre)
│ ▹ 🔓 **Bebas Akses Fitur Premium Lainnya**
`.trim();

/**
 * Handler untuk command premium
 */
async function handle(sock, messageInfo) {
    const { remoteJid, message, pushName } = messageInfo;

    const fullResponse = `
${TEXT_GREETING(pushName)}

${HARGA_PREMIUM}

🛒 *CARA PEMBELIAN OTOMATIS:*
1️⃣ Kunjungi website: \`https://sewa.manzzy.web.id/premium.html\`
2️⃣ Masukkan nomor WhatsApp kamu.
3️⃣ Pilih durasi paket, lalu bayar otomatis! Status premium langsung aktif saat itu juga. ✨
`.trim();

    // Kirim pesan dengan gaya External Ad Reply (Gambar Besar) & Newsletter Forward (Saluran)
    await sock.sendMessage(
        remoteJid,
        {
            text: fullResponse,
            contextInfo: {
                // Konfigurasi Saluran WhatsApp (Channel)
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: CHANNEL_JID,
                    newsletterName: CHANNEL_NAME,
                    serverMessageId: 1
                },
                // Tampilan Banner & Link Website Buy Premium
                externalAdReply: {
                    title: "👑 KLIK DI SINI UNTUK BELI PREMIUM", 
                    body: "Website otomatis: Isi nomor, pilih durasi, bayar!", 
                    thumbnailUrl: THUMBNAIL_URL,
                    sourceUrl: SOURCE_URL,
                    mediaType: 1,
                    renderLargerThumbnail: true 
                }
            }
        },
        { quoted: message }
    );
}

// --- ESM Export Default ---
export default {
    handle,
    Commands: ["premium", "buypremium", "buyprem"],
    OnlyPremium: false,
    OnlyOwner: false,
};