import axios from "axios";
import { logCustom } from "../../lib/logger.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, isQuoted, prefix, command } = messageInfo;

  try {
    // Ambil URL dari argumen atau dari pesan yang dikutip (reply)
    const targetUrl = content && content.trim() !== "" ? content : isQuoted?.text ?? null;

    // Validasi input URL
    if (!targetUrl || !targetUrl.includes("http")) {
      return await sock.sendMessage(
        remoteJid,
        {
          text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${
            prefix + command
          } https://sfl.gl/ntCx0RF*_`,
        },
        { quoted: message }
      );
    }

    // Tampilkan reaksi loading
    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });

    // Panggil API bypass SFL menggunakan axios
    const apiUrl = `https://api.ikyyxd.my.id/tools/skiplink/sfl?url=${encodeURIComponent(targetUrl.trim())}`;
    
    const { data: response } = await axios.get(apiUrl, { timeout: 20000 });

    // Validasi struktur JSON dari respons API
    if (!response || !response.status || !response.result || !response.result.destinationUrl) {
      throw new Error(response?.message || "Gagal melakukan bypass tautan.");
    }

    const { originalUrl, destinationUrl, message: apiMessage } = response.result;

    // Format pesan hasil bypass
    const responseText = `╭───「 🔓 *BYPASS SUCCESS* 」
│
│ 🔗 *Original:* ${originalUrl}
│ ✅ *Destination:* ${destinationUrl}
│ 💬 *Status:* ${apiMessage}
│
╰────────────────────────⳹
_🔥 ©Varesa | Created by Manzzy_`;

    // Kirim hasil ke pengguna
    await sock.sendMessage(
      remoteJid,
      {
        text: responseText,
        linkPreview: {
          canonicalUrl: destinationUrl,
          matchedText: destinationUrl,
          title: "Hasil Bypass SafeFile / SFL",
          description: destinationUrl,
        }
      },
      { quoted: message }
    );

    // Reaksi sukses
    await sock.sendMessage(remoteJid, {
      react: { text: "✅", key: message.key },
    });

  } catch (error) {
    console.error("Error Command BypassFL:", error);
    logCustom("info", content, `ERROR-COMMAND-${command}.txt`);

    // Reaksi error
    await sock.sendMessage(remoteJid, {
      react: { text: "❌", key: message.key },
    });

    await sock.sendMessage(
      remoteJid,
      {
        text: `Maaf, terjadi kesalahan saat memproses tautan.\n\n*Error:* ${error.message || "Gagal terhubung ke server API"}`,
      },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["bypassfl", "sfl"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1,
};