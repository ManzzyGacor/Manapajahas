import axios from "axios";
import { reply } from "../../lib/utils.js";
import config from "../../config.js";

async function handle(sock, messageInfo) {
  const { m, remoteJid, message, content, prefix, command } = messageInfo;

  // 1. Validasi Input Kosong
  if (!content) {
    const usage = `_⚠️ Format Penggunaan:_\n\n_💬 Contoh:_ _*${prefix + command} 089682148180*_`;
    return await reply(m, usage);
  }

  // 2. Pembersih Nomor (Hanya mengambil angka dan ubah 0 jadi 62)
  let targetNumber = content.replace(/[^0-9]/g, "");
  if (targetNumber.startsWith("0")) {
    targetNumber = "62" + targetNumber.slice(1);
  }

  if (targetNumber.length < 10) {
    return await reply(m, `_⚠️ Nomor telepon tidak valid! Pastikan kamu memasukkan nomor yang benar._`);
  }

  // Indikator Loading
  await sock.sendMessage(remoteJid, { react: { text: "⏰", key: message.key } });

  try {
    // 3. Eksekusi API Jerexd dengan metode POST
    const apiUrl = `https://api.jerexd.my.id/api/whatsapp/checkban?apikey=${config.JEREXD_APIKEY}`;
    const payload = {
      number: targetNumber
    };
    
    const { data } = await axios.post(apiUrl, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 15000 
    });

    // 4. Validasi Respon API
    if (data && data.status && data.statusCode === 200) {
       await sock.sendMessage(remoteJid, { react: { text: "✅", key: message.key } });
       
       const res = data.result;
       const details = res.details || {};
       
       // Susun pesan hasil secara rapi
       let successMessage = `🔍 *CEK NOMOR WHATSAPP*\n\n`;
       successMessage += `📞 *Nomor:* ${res.formatted_number || res.number}\n`;
       successMessage += `📶 *Provider:* ${details.provider || "-"}\n`;
       successMessage += `🌍 *Negara:* ${details.country_code || "-"}\n\n`;
       successMessage += `📱 *Terdaftar WA:* ${res.registered ? "✅ Ya" : "❌ Tidak"}\n`;
       successMessage += `🚫 *Status Banned:* ${res.banned ? "⚠️ Ya (Terbanned)" : "✅ Aman (Tidak dibanned)"}\n`;
       successMessage += `📌 *Status:* ${res.status}\n`;
       successMessage += `📝 *Pesan:* ${res.status_message}\n\n`;
       successMessage += `🔗 *Link Chat:* ${res.wa_link}\n`;
       
       await reply(m, successMessage);
    } else {
       throw new Error("API merespon tetapi data tidak sesuai ekspektasi.");
    }

  } catch (error) {
    console.error("Error Cek WA:", error);
    
    // Indikator Error
    await sock.sendMessage(remoteJid, { react: { text: "❌", key: message.key } });
    await reply(m, `_❌ Terjadi kesalahan saat mengecek nomor WA._\n\nERROR: ${error.response?.data?.message || error.message || error}`);
  }
}

export default {
  handle,
  Commands: ["cekwa", "checkwa"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1, // Mengurangi 1 limit user
};