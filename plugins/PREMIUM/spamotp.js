import axios from "axios";
import { reply } from "../../lib/utils.js";

async function handle(sock, messageInfo) {
  const { m, remoteJid, message, content, prefix, command } = messageInfo;

  // 1. Validasi Input Kosong
  if (!content) {
    const usage = `_⚠️ Format Penggunaan:_\n\n_💬 Contoh:_ _*${prefix + command} 628968282720*_`;
    return await reply(m, usage);
  }

  // 2. Pembersih Nomor (Hanya mengambil angka dan ubah 0 jadi 62)
  let targetNumber = content.replace(/[^0-9]/g, "");
  if (targetNumber.startsWith("0")) {
    targetNumber = "62" + targetNumber.slice(1);
  }

  if (targetNumber.length < 10) {
    return await reply(m, `_⚠️ Nomor telepon tidak valid! Pastikan kamu memasukkan nomor target yang benar._`);
  }

  // Indikator Loading
  await sock.sendMessage(remoteJid, { react: { text: "⏰", key: message.key } });

  try {
    // 3. Eksekusi API Jerexd dengan metode POST
    const apiUrl = `https://api.jerexd.my.id/api/tools/spamotp?apikey=VaresaMD`;
    const payload = {
      nomor: targetNumber
    };
    
    // Waktu tunggu di-set lebih lama (45 detik) karena proses spam memakan waktu
    const { data } = await axios.post(apiUrl, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 45000 
    });

    // 4. Validasi Respon API
    if (data && data.status && data.statusCode === 200) {
       await sock.sendMessage(remoteJid, { react: { text: "✅", key: message.key } });
       
       const res = data.result;
       
       // Susun pesan hasil secara rapi tanpa membuat teks terlalu panjang
       let successMessage = `✅ *SPAM OTP SELESAI*\n\n`;
       successMessage += `🎯 *Target:* ${res.target}\n`;
       successMessage += `🚀 *Endpoints:* ${res.total_endpoints} | *Loop:* ${res.loop_count}x\n`;
       successMessage += `📈 *Sukses:* ${res.success} | 📉 *Gagal:* ${res.failed}\n`;
       successMessage += `📊 *Tingkat Keberhasilan:* ${res.success_rate}\n`;
       successMessage += `⏱️ *Waktu Eksekusi:* ${res.time_elapsed_seconds} detik\n\n`;
       successMessage += `_Catatan: Gunakan fitur ini dengan bijak._`;
       
       await reply(m, successMessage);
    } else {
       throw new Error("API merespon tetapi data tidak sesuai ekspektasi.");
    }

  } catch (error) {
    console.error("Error Spam OTP:", error);
    
    // Indikator Error
    await sock.sendMessage(remoteJid, { react: { text: "❌", key: message.key } });
    await reply(m, `_❌ Terjadi kesalahan saat mengirim Spam OTP._\n\nERROR: ${error.response?.data?.message || error.message || error}`);
  }
}

export default {
  handle,
  Commands: ["spamotp"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 5, // Sesuai permintaan, mengurangi 1 limit user
};