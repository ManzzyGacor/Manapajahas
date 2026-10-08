import axios from "axios";
import { reply } from "../../lib/utils.js";

// --- KONFIGURASI CHANNEL PROMOSI ---
const MY_CHANNEL_LINK = "https://whatsapp.com/channel/0029VbCIEdlLNSZyA97fD222"; 

async function handle(sock, messageInfo) {
  const { m, remoteJid, message, content, prefix, command } = messageInfo;

  // 1. Validasi Input Kosong
  if (!content) {
    const usage = `_⚠️ Format Penggunaan:_\n\n_💬 Contoh:_ _*${prefix + command} https://whatsapp.com/channel/0029VbCIEdlLNSZyA97fD222/318 🔥❤️🤍*_`;
    return await reply(m, usage);
  }

  // 2. Pisahkan URL dan Emoji (Berdasarkan spasi pertama)
  const args = content.trim().split(" ");
  const url = args[0];
  const emojis = args.slice(1).join("").trim(); 

  // 3. Validasi URL Saluran WhatsApp (Pastikan merujuk ke postingan spesifik)
  if (!url.includes("whatsapp.com/channel/")) {
    return await reply(m, `_⚠️ URL tidak valid! Pastikan kamu memasukkan link postingan dari Saluran (Channel) WhatsApp._`);
  }

  // 4. Validasi Keberadaan Emoji
  if (!emojis) {
    return await reply(m, `_⚠️ Masukkan emoji untuk bereaksi._\n_Contoh: ${prefix + command} ${url} 🔥❤️_`);
  }

  // 5. Validasi Maksimal 4 Emoji & Format Pemisah Koma
  const emojiArray = [...emojis.replace(/\s+/g, "")];
  if (emojiArray.length > 4) {
    return await reply(m, `_⚠️ Maksimal hanya 4 emoji yang diizinkan._`);
  }
  
  // Gabungkan array emoji dengan koma sesuai format API baru
  const formattedEmojis = emojiArray.join(",");

  // Indikator Loading
  await sock.sendMessage(remoteJid, { react: { text: "⏰", key: message.key } });

  try {
    // 6. Eksekusi API Jerexd dengan metode POST
    const apiUrl = `https://api.jerexd.my.id/api/whatsapp/reactch?apikey=VaresaMD`;
    const payload = {
      url: url,
      reaction: formattedEmojis
    };
    
    const { data } = await axios.post(apiUrl, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000 
    });

    // Validasi Respon API berdasarkan struktur JSON terbaru
    if (data && data.status && data.statusCode === 200) {
       await sock.sendMessage(remoteJid, { react: { text: "✅", key: message.key } });
       
       // Pesan sukses yang rapi sesuai JSON + Promosi Channel
       const successMessage = `✅ _${data.result.message}_\n⏳ _Status: ${data.result.task.status}_\n\n📢 _Yuk mampir dan join ke channel owner bot:_ ${MY_CHANNEL_LINK}`;
       
       await reply(m, successMessage);
    } else {
       throw new Error("Gagal mengirim reaksi, respon API tidak sesuai.");
    }

  } catch (error) {
    console.error("Error React Channel:", error);
    
    // Indikator Error
    await sock.sendMessage(remoteJid, { react: { text: "❌", key: message.key } });
    await reply(m, `_❌ Terjadi kesalahan saat mengirim reaksi._\n\nERROR: ${error.response?.data?.message || error.message || error}`);
  }
}

export default {
  handle,
  Commands: ["reactch", "rch"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 5,
};