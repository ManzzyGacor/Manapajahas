import axios from "axios";
import { logCustom } from "../../lib/logger.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, isQuoted, prefix, command } = messageInfo;

  try {
    // Ambil teks dari argumen atau dari pesan yang dikutip (reply)
    const text = content && content.trim() !== "" ? content : isQuoted?.text ?? null;

    // Validasi input
    if (!text) {
      return await sock.sendMessage(
        remoteJid,
        {
          text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${
            prefix + command
          } hidup itu seperti roda*_`,
        },
        { quoted: message }
      );
    }

    // Tampilkan reaksi loading
    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });

    // Panggil API Iqw dengan responseType arraybuffer karena ini endpoint canvas gambar
    const apiUrl = `https://api.ikyyxd.my.id/canvas/iqw?text=${encodeURIComponent(text.trim())}`;
    
    const response = await axios.get(apiUrl, { 
      responseType: "arraybuffer",
      timeout: 30000 
    });

    const imageBuffer = response.data;

    if (!imageBuffer || imageBuffer.length < 100) {
      throw new Error("Gagal memuat gambar dari API (respon kosong/invalid).");
    }

    // Kirim buffer gambar langsung ke pengguna
    await sock.sendMessage(
      remoteJid,
      {
        image: imageBuffer,
        caption: "_Nih hasil IQW-nya! ✨_",
      },
      { quoted: message }
    );

    // Reaksi sukses
    await sock.sendMessage(remoteJid, {
      react: { text: "✅", key: message.key },
    });

  } catch (error) {
    console.error("Error Command Iqw:", error);
    logCustom("info", content, `ERROR-COMMAND-${command}.txt`);

    // Reaksi error
    await sock.sendMessage(remoteJid, {
      react: { text: "❌", key: message.key },
    });

    await sock.sendMessage(
      remoteJid,
      {
        text: `Maaf, terjadi kesalahan saat memproses permintaan Anda.\n\n*Error:* ${error.message || "Kesalahan server API"}`,
      },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["iqw"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1,
};