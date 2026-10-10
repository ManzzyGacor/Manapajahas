import { tiktok } from "../../lib/scrape/tiktok.js";
import axios from 'axios';
import { logCustom } from "../../lib/logger.js";
import { extractLink, downloadToBuffer } from "../../lib/utils.js";

const APIBOTCAHX_KEY = "Varesa"; 
const API_URL_FALLBACK = "https://api.botcahx.eu.org/api/dowloader/tiktok";

// Fungsi untuk mengirim pesan biasa
async function sendMessageWithQuote(sock, remoteJid, message, text) {
  await sock.sendMessage(remoteJid, { text }, { quoted: message });
}

function isTikTokUrl(url) {
  return /tiktok\.com/i.test(url);
}

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command } = messageInfo;

  const validLink = extractLink(content);
  let finalVideoUrl = null;
  let caption = "";

  try {
    // ------------------------------------------------------------------
    // PERUBAHAN TAMPILAN: Pesan saat pengguna tidak memasukkan link
    // ------------------------------------------------------------------
    if (!content.trim() || content.trim() === "") {
      const usageMessage = `*T I K T O K  D O W N L O A D E R* 🎵\n\n⚠️ _Format penggunaan salah!_ Silakan sertakan link TikTok yang ingin diunduh.\n\n*💡 Contoh Penggunaan:*\n> ${prefix}${command} https://vt.tiktok.com/ZSxxxxxxx/`;
      
      return sendMessageWithQuote(sock, remoteJid, message, usageMessage);
    }

    // ------------------------------------------------------------------
    // PERUBAHAN TAMPILAN: Pesan saat link bukan dari TikTok
    // ------------------------------------------------------------------
    if (!isTikTokUrl(validLink)) {
      const invalidUrlMessage = `❌ *URL TIDAK VALID*\n\nPastikan link yang Anda masukkan benar-benar berasal dari *TikTok*.`;
      
      return sendMessageWithQuote(sock, remoteJid, message, invalidUrlMessage);
    }

    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });
    
    try {
        const response = await tiktok(validLink);
        if (response && response.no_watermark) {
            finalVideoUrl = response.no_watermark;
            caption = response.title || "✅ TikTok Video";
        } else {
            throw new Error("Scraper utama tidak memberikan URL video tanpa watermark.");
        }
    } catch (scrapeError) {
        console.error("Kesalahan di scraper utama (tiktok.js):", scrapeError.message);
        
        try {
             await sock.sendMessage(remoteJid, {
                react: { text: "🔄", key: message.key },
            });
            
            const fallbackApiUrl = `${API_URL_FALLBACK}?url=${validLink}&apikey=${APIBOTCAHX_KEY}`;
            const { data } = await axios.get(fallbackApiUrl);

            if (data.status && data.result && data.result.video && data.result.video.length > 0) {
                finalVideoUrl = data.result.video[0];
                caption = data.result.title ? `[FALLBACK] ${data.result.title}` : " ✅ TikTok Video ";
            } else {
                throw new Error("Fallback API tidak memberikan hasil yang valid.");
            }
        } catch (fallbackError) {
            console.error("Kesalahan di Fallback API Botcahx:", fallbackError.message);
            throw new Error(`Semua server download gagal. (Scraper: ${scrapeError.message}, Fallback: ${fallbackError.message})`);
        }
    }

    if (finalVideoUrl) {
        const videoBuffer = await downloadToBuffer(finalVideoUrl, "mp4");

        // Kirim video murni
        await sock.sendMessage(
            remoteJid,
            {
                video: videoBuffer,
                caption: caption,
            },
            { quoted: message }
        );
        
        await sock.sendMessage(remoteJid, { react: { text: "", key: message.key } });

    } else {
        throw new Error("Gagal mendapatkan URL video yang dapat diunduh dari semua sumber.");
    }
    
  } catch (error) {
    console.error("Kesalahan saat memproses perintah TikTok:", error);
    logCustom("info", content, `ERROR-COMMAND-${command}.txt`);

    // PERUBAHAN TAMPILAN: Pesan error
    const errorMessage = `❌ *TERJADI KESALAHAN*\n\nMaaf, sistem tidak dapat memproses permintaan Anda saat ini.\n\n_Detail:_ ${error.message || error}`;
    
    await sendMessageWithQuote(sock, remoteJid, message, errorMessage);
    await sock.sendMessage(remoteJid, { react: { text: "", key: message.key } });
  }
}

export default {
  handle,
  Commands: ["tt", "tiktok"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1,
};