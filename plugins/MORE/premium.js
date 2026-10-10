// plugins/premium.js

import config from "../../config.js";
import { getBotIdentity, renderBotText } from "../../lib/bot-scope.js";

// --- Konstanta Data ---
const THUMBNAIL_URL = "https://autoresbot.com/tmp_files/f1d90ac1-89d5-4303-a4d9-46991586bd06.jpg"; 
// Pembelian sekarang lewat dashboard Varesa (paket bot & add-on), bukan
// lagi halaman premium di situs lama.
const SOURCE_URL = `${config.web_url}/dashboard`;

// Masukkan ID Saluran WhatsApp kamu di sini (Contoh format: 1203633... atau dengan @newsletter)
const CHANNEL_JID = "120363425345196924@newsletter"; 
const CHANNEL_NAME = "📢 Varesa Official Channel";

const TEXT_GREETING = (pushName) => `
👋 *Halo Kak ${pushName || ""}!*
Mau pakai bot tanpa batas dan buka fitur dewa? Begini caranya di Varesa 🚀

🔥 *PILIHAN UPGRADE:*
│ ▹ ♾️ *Add-on Unlimited Access* — semua pengguna bot ini bebas limit, tanpa jeda anti-spam & limit harian cek MLBB.
│ ▹ 💎 *Paket Core / Prime / Zenith* — nama bot & owner sendiri, bebas iklan, pesan otomatis, perintah kustom, menu bergambar, akses MLBB (Zenith).

📌 _Paket berlaku per bot, bukan per akun. Punya beberapa bot? Tiap bot bisa beda paket._
`.trim();

// Teks bawaan bot milik user: premium dijual owner BOT ITU (lewat .addprem,
// berlaku di bot itu saja), jadi yang ditampilkan nama & kontak owner bot,
// bukan promo/nomor operator. Owner paket berbayar bisa menggantinya di
// dashboard (premiumText).
const TEXT_PREMIUM_BOT = `
👋 *Halo Kak {pushname}!*
Mau jadi pengguna *Premium* di *{botname}*? 💎

✨ *Keuntungan Premium:*
• Bebas limit untuk fitur yang memakai limit
• Bisa pakai fitur khusus Premium

🛒 *Cara beli:* chat owner bot ini untuk harga & masa aktif:
{ownerlink}

_Premium dari owner bot ini berlaku di {botname} saja. Cek status kamu: *{prefix}cekpremium*_
`.trim();

/**
 * Handler untuk command premium
 */
async function handle(sock, messageInfo) {
    const { remoteJid, message, pushName, prefix, isJadibot, sessionConfig } = messageInfo;

    if (isJadibot) {
        // premiumText sudah dikosongkan applyTierCaps untuk bot Free.
        const identitas = getBotIdentity(messageInfo);
        const custom = String(sessionConfig?.premiumText || "").trim();
        const teks = renderBotText(custom || TEXT_PREMIUM_BOT, {
            botname: identitas.name,
            owner: identitas.owner,
            ownerlink: identitas.ownerLink,
            prefix: prefix || ".",
            pushname: pushName || "Kak",
            weburl: config.web_url,
        });
        await sock.sendMessage(remoteJid, { text: teks }, { quoted: message });
        return;
    }

    const fullResponse = `
${TEXT_GREETING(pushName)}

🛒 *CARA PEMBELIAN OTOMATIS:*
1️⃣ Buka dashboard: ${SOURCE_URL}
2️⃣ Login, pilih bot yang mau di-upgrade, lalu pilih paket atau add-on-nya.
3️⃣ Bayar via QRIS — langsung aktif otomatis. ✨

_Bukan pemilik bot ini? Paket bot ini diatur pemiliknya — minta dia upgrade atau mengaktifkan add-on Unlimited Access._
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
                    title: "👑 UPGRADE DI DASHBOARD VARESA", 
                    body: "Pilih paket / add-on, bayar QRIS, langsung aktif!", 
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
