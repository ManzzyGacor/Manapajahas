import axios from "axios";
// Import fungsi stiker sesuai struktur yang Anda tunjukkan
import { sendImageAsSticker } from "../../lib/exif.js";
import config from "../../config.js"; // Diperlukan untuk packname/author

/**
 * Handler untuk Brat Anime Generator
 * Mengirim hasilnya langsung sebagai Stiker
 */
async function handle(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command } = messageInfo;

  // 1. Ambil Teks Argumen
  // Kita asumsikan 'content' sudah berupa teks setelah command dihapus
  const text = content ? content.trim() : "";

  if (!text) {
    return sock.sendMessage(
        remoteJid, 
        { text: `⚠️ Contoh penggunaan: *${prefix}${command}* teksnya` }, 
        { quoted: message }
    );
  }

  // 2. Kirim Reaksi Loading
  await sock.sendMessage(remoteJid, { react: { text: '⏳', key: message.key } });

  const api = `https://api.elrayyxml.web.id/api/maker/bratanime?text=${encodeURIComponent(text)}`;

  let buffer;
  let finalImageUrl = api; // Asumsi default: API langsung mengembalikan gambar

  try {
    // 3. Fetch Data untuk menentukan apakah hasilnya JSON atau Gambar
    const response = await axios.get(api, { 
        responseType: 'arraybuffer' 
    });
    
    const contentType = response.headers['content-type'];

    if (contentType.includes("application/json")) {
      // Jika API mengembalikan JSON (mengandung URL di dalamnya)
      const jsonString = Buffer.from(response.data).toString('utf-8');
      const json = JSON.parse(jsonString);
      
      // Ambil URL dari JSON
      finalImageUrl = json.result || json.url || json.image;
      if (!finalImageUrl) throw new Error("API tidak memberikan URL gambar valid di dalam JSON.");

      // Download gambar dari URL hasil JSON ke Buffer
      const imgRes = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });
      buffer = imgRes.data;
      
    } else {
      // Jika API langsung mengembalikan gambar (bukan JSON), gunakan buffer dari response pertama
      buffer = response.data;
    }

    // 4. Kirim Hasil sebagai Stiker menggunakan fungsi kustom Anda
    const options = {
      packname: config.sticker_packname || "Varesa", // Ambil dari config jika ada
      author: config.sticker_author || "Brat Anime", 
    };
    
    if (buffer) {
      await sendImageAsSticker(
        sock, // Objek socket
        remoteJid, // Chat ID
        buffer, // Buffer gambar/video
        options, // Metadata stiker
        message // Pesan yang di-quoted (dipakai untuk mendapatkan key)
      );
    } else {
       throw new Error("Gagal mendapatkan buffer gambar.");
    }
    
    // Beri reaksi sukses
    await sock.sendMessage(remoteJid, { react: { text: '✅', key: message.key } });

  } catch (err) {
    console.error("Brat Anime Error:", err);
    await sock.sendMessage(
        remoteJid, 
        { text: `❌ Gagal membuat Brat Anime. Error: ${err.message}` }, 
        { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["animebrat", "bratanim", "bratanime"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 2
};