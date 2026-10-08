import axios from "axios";

import mess from "../../strings.js";
import { logCustom } from "../../lib/logger.js";
import { downloadToBuffer } from "../../lib/utils.js";

// --- KONFIGURASI API BARU ---
const API_URL = `https://api-faa.my.id/faa/igdl`;
// -----------------------

/**
 * Mengirim pesan dengan kutipan
 */
async function sendMessageWithQuote(sock, remoteJid, message, text) {
  await sock.sendMessage(remoteJid, { text }, { quoted: message });
}

/**
 * Memvalidasi apakah URL yang diberikan adalah URL Instagram yang valid
 */
function isIGUrl(url) {
  return /instagram\.com/i.test(url);
}

/**
 * Fungsi untuk mengirim media ke pengguna
 */
async function sendMedia(sock, remoteJid, message, mediaList, caption) {
  let successCount = 0;
  
  for (const media of mediaList) {
    const urlMedia = media.url;
    let mimeType;

    // Tentukan tipe media berdasarkan URL
    const urlExtension = urlMedia.split(/[#?]/)[0].split(".").pop();
    
    if (urlExtension && ["mp4", "mov", "webm"].includes(urlExtension.toLowerCase())) {
        mimeType = "video";
    } else if (urlExtension && ["jpg", "jpeg", "png", "webp"].includes(urlExtension.toLowerCase())) {
        mimeType = "image";
    } else if (media.type === 'video') { 
        mimeType = 'video';
    } else {
        mimeType = "image"; // Fallback default
    }
    
    try {
        const mediaBuffer = await downloadToBuffer(urlMedia); 
        
        // Gunakan caption dari IG jika ada, atau gunakan default
        const captionText = caption || mess.general.success;

        if (mimeType === "image") {
            await sock.sendMessage(
                remoteJid,
                { image: mediaBuffer, caption: captionText },
                { quoted: message }
            );
        } else {
            await sock.sendMessage(
                remoteJid,
                { video: mediaBuffer, caption: captionText },
                { quoted: message }
            );
        }
        successCount++;
    } catch (e) {
        console.error(`Gagal mengirim media dari URL ${urlMedia}:`, e);
    }
  }

  return successCount > 0;
}

/**
 * Fungsi utama untuk menangani permintaan unduhan media Instagram
 */
async function handle(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command } = messageInfo;

  try {
    // 1. Validasi Input
    if (!content?.trim() || !isIGUrl(content)) {
      return sendMessageWithQuote(
        sock,
        remoteJid,
        message,
        `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${
          prefix + command
        } https://www.instagram.com/p/ByxKbUSnubS/*_`
      );
    }

    // 2. Tampilkan Loading
    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });

    // 3. Panggil API Utama
    const apiUrlWithParams = `${API_URL}?url=${encodeURIComponent(content)}`;
    const { data: response } = await axios.get(apiUrlWithParams, { timeout: 15000 }); 

    // Validasi struktur JSON baru
    if (!response || !response.status || !response.result || !Array.isArray(response.result.url) || response.result.url.length === 0) {
      throw new Error("API tidak mengembalikan data yang valid atau media tidak ditemukan.");
    }

    console.log("[INSTAGRAM-DL] Sukses menggunakan API Utama.");
    
    // Mapping hasil ke dalam mediaList
    const mediaList = response.result.url.map(urlStr => ({
        url: urlStr, 
        source: 'API',
        type: response.result.metadata?.isVideo ? 'video' : 'image'
    }));

    // Ambil caption dari metadata (jika tersedia) digabung dengan pesan sukses standar
    const igCaption = response.result.metadata?.caption 
      ? `*Caption:* ${response.result.metadata.caption}\n\n${mess.general.success}` 
      : mess.general.success;

    // 4. Kirim Media
    const sentSuccessfully = await sendMedia(sock, remoteJid, message, mediaList, igCaption);

    if (sentSuccessfully) {
        // Akhiri dengan reaksi sukses
        await sock.sendMessage(remoteJid, {
          react: { text: "✅", key: message.key },
        });
    } else {
        throw new Error("Media berhasil diunduh dari API, tetapi gagal dikirim ke chat.");
    }
    
  } catch (error) {
    console.error("Kesalahan utama saat memproses Instagram:", error);
    logCustom("info", content, `ERROR-COMMAND-${command}.txt`);

    // Ganti reaksi menjadi error
    await sock.sendMessage(remoteJid, {
      react: { text: "❌", key: message.key },
    });

    // Kirim pesan kesalahan yang lebih deskriptif
    const errorMessage = `Maaf, terjadi kesalahan saat memproses permintaan Anda.\n\n*Detail Kesalahan:* ${
      error.message || "Kesalahan API atau server"
    }`;
    await sendMessageWithQuote(sock, remoteJid, message, errorMessage);
  }
}

export default {
  handle,
  Commands: ["ig", "instagram"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1, 
};