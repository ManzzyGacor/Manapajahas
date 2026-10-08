import { downloadQuotedMedia, downloadMedia } from "../../lib/utils.js";
import mess from "../../strings.js";

import fs from "fs";
import path from "path";
import axios from "axios";

import ApiAutoresbotModule from "api-autoresbot";
const ApiAutoresbot = ApiAutoresbotModule.default || ApiAutoresbotModule;

import config from "../../config.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message, type, isQuoted, content, prefix, command } =
    messageInfo;

  try {
    const mediaType = isQuoted ? isQuoted.type : type;
    if (mediaType === "image") {
      // Tampilkan reaksi "Loading"
      await sock.sendMessage(remoteJid, {
        react: { text: "⏰", key: message.key },
      });

      const media = isQuoted
        ? await downloadQuotedMedia(message)
        : await downloadMedia(message);

      const mediaPath = path.join("tmp", media);
      if (!fs.existsSync(mediaPath)) {
        throw new Error("File media tidak ditemukan setelah diunduh.");
      }

      const api = new ApiAutoresbot(config.APIKEY);
      
      // 1. Upload gambar untuk mendapatkan URL mentah
      const responseUpload = await api.tmpUpload(mediaPath);

      if (!responseUpload || responseUpload.code !== 200) {
        throw new Error("File upload gagal atau tidak ada URL.");
      }
      const imageUrl = responseUpload.data.url;

      let finalBuffer = null;
      let useFallback = false;

      // =======================================================
      // API 1: FAA REMOVEBG (Primary)
      // =======================================================
      try {
        console.log("[REMOVEBG] Mencoba API Utama (Faa)...");
        const faaApiUrl = `https://api-faa.my.id/faa/removebg?url=${encodeURIComponent(imageUrl)}`;
        
        // Panggil API Faa
        const { data: faaResponse } = await axios.get(faaApiUrl, { timeout: 15000 });

        // Validasi respon JSON (status: true dan ada url)
        if (faaResponse && faaResponse.status && faaResponse.url) {
           // Unduh hasil gambar dari URL yang diberikan
           const { data: imageBuffer } = await axios.get(faaResponse.url, { responseType: 'arraybuffer' });
           finalBuffer = Buffer.from(imageBuffer);
           console.log("[REMOVEBG] Sukses menggunakan API Faa.");
        } else {
           console.warn("[REMOVEBG] Respon Faa API tidak valid. Beralih ke fallback.");
           useFallback = true;
        }
      } catch (err) {
        console.error("[REMOVEBG] Faa API Gagal:", err.message);
        useFallback = true;
      }

      // =======================================================
      // API 2: AUTORESBOT (Fallback)
      // =======================================================
      if (useFallback || !finalBuffer) {
         console.log("[REMOVEBG] Menggunakan API Cadangan (Autoresbot)...");
         finalBuffer = await api.getBuffer("/api/tools/removebg", { url: imageUrl });
      }

      // Jika kedua API gagal
      if (!finalBuffer) {
          throw new Error("Gagal menghapus background dari kedua API.");
      }

      // Kirim hasilnya ke user
      await sock.sendMessage(
        remoteJid,
        {
          image: finalBuffer,
          caption: mess.general.success,
        },
        { quoted: message }
      );
      
      // Akhiri dengan reaksi sukses
      await sock.sendMessage(remoteJid, {
        react: { text: "✅", key: message.key },
      });

    } else {
      return await sock.sendMessage(
        remoteJid,
        {
          text: `⚠️ _Kirim/Balas gambar dengan caption *${prefix + command}*_`,
        },
        { quoted: message }
      );
    }
  } catch (error) {
    console.error("Error RemoveBG:", error);
    
    // Ganti reaksi menjadi error
    await sock.sendMessage(remoteJid, {
      react: { text: "❌", key: message.key },
    });
    
    await sock.sendMessage(
      remoteJid,
      { text: "❌ Maaf, terjadi kesalahan saat memproses gambar. Coba lagi nanti!" },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["rmbg", "removebg", "nobg"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1, // Jumlah limit yang akan dikurangi
};