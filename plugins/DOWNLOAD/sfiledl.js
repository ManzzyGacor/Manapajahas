import axios from "axios";

import mess from "../../strings.js";
import { logCustom } from "../../lib/logger.js";
import { downloadToBuffer } from "../../lib/utils.js";

const APIBOTCAHX_KEY = "Varesa"; 
const API_URL = `https://api.botcahx.eu.org/api/dowloader/sfilemobi`;

async function sendMessageWithQuote(sock, remoteJid, message, text) {
  await sock.sendMessage(remoteJid, { text }, { quoted: message });
}

function isSfileMobiUrl(url) {
  return /sfile\.mobi/i.test(url);
}

async function handle(sock, messageInfo) {
  const { remoteJid, message, prefix, command, fullText } = messageInfo;
  let response = {}; 
  
  // LOGIKA PARSING ARGUMEN DARI GDrive.js
  const argText = fullText.slice(prefix.length + command.length).trim();
  const args = argText ? argText.split(/\s+/) : [];
  const sfileUrl = args[0] || '';

  try {
    if (!sfileUrl || !isSfileMobiUrl(sfileUrl)) {
      return sendMessageWithQuote(
        sock,
        remoteJid,
        message,
        `_⚠️ Format Penggunaan Salah!_ \n\n_Perintah ini hanya menerima link dari *sfile.mobi*._\n\n_💬 Contoh:_ _*${
          prefix + command
        } https://sfile.mobi/P0D2WxqDwA7*_`
      );
    }

    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });

    const apiUrlWithParams = `${API_URL}?url=${encodeURIComponent(
      sfileUrl
    )}&apikey=${APIBOTCAHX_KEY}`;

    const res = await axios.get(apiUrlWithParams, { timeout: 30000 });
    response = res.data; // Simpan respons untuk penanganan error 413
    
    if (!response.status || !response.result || !response.result.fileName) {
      throw new Error(
        response.message || "API gagal merespon atau data file tidak ditemukan pada link tersebut."
      );
    }
    
    const { fileName, fileSize, downloadLink } = response.result;
    
    const infoCaption = `
*✅ SFILE.MOBI DITEMUKAN!*

*📁 Nama File:* ${fileName || 'Tidak Diketahui'}
*📏 Ukuran:* ${fileSize || 'Tidak Diketahui'}
*🔗 Sumber:* ${sfileUrl}

_⏳ Mohon tunggu, bot sedang mencoba mengunduh dan mengirim file ini._
    `.trim();

    await sendMessageWithQuote(sock, remoteJid, message, infoCaption);
    await sock.sendMessage(remoteJid, { react: { text: "⬇️", key: message.key } });

    if (!downloadLink) {
        throw new Error("Tautan download langsung (downloadLink) tidak tersedia.");
    }

    const fileBuffer = await downloadToBuffer(downloadLink);

    await sock.sendMessage(
        remoteJid,
        { 
            document: fileBuffer, 
            fileName: fileName,
            caption: mess.general.success + "\n\n_File berhasil dikirim!_"
        },
        { quoted: message }
    );

    await sock.sendMessage(remoteJid, { react: { text: "✅", key: message.key } });

  } catch (error) {
    console.error("Kesalahan saat memproses Sfile.mobi Downloader:", error);
    logCustom("info", sfileUrl, `ERROR-COMMAND-${command}.txt`);

    await sock.sendMessage(remoteJid, {
        react: { text: "❌", key: message.key },
    });

    let errorMessage = `❌ Maaf, terjadi kesalahan saat memproses permintaan Anda.\n\n*Detail Kesalahan:* ${
      error.message || "Kesalahan tidak diketahui"
    }`;
    
    const result = response?.result;

    if (error.message.includes('Tautan download langsung tidak tersedia')) {
        errorMessage = `❌ *Gagal Mengunduh:*\n\nAPI tidak menyediakan tautan download langsung.`;
    } else if (error.message.includes('413') || (error.message.includes('timed out') && result?.fileSize)) { 
        // Asumsi error timeout pada file besar juga merupakan indikasi batas
        errorMessage = `⚠️ *File Terlalu Besar (Gagal Dikirim)!*\n\nBot gagal mengirim file. Mungkin ukurannya melebihi batas maksimum pengiriman WhatsApp atau batas server.\n\n*Nama File:* ${result?.fileName || 'Tidak Diketahui'}\n*Ukuran:* ${result?.fileSize || 'Tidak Diketahui'}\n\n*Solusi:* Silakan unduh file secara manual menggunakan tautan ini:\n\`\`\`${result?.downloadLink || sfileUrl}\`\`\``;
    } else if (error.message.includes('timed out')) {
        errorMessage = `❌ *Gagal Mengunduh:*\n\nProses pengunduhan memakan waktu terlalu lama (Timeout). File mungkin terlalu besar atau koneksi tidak stabil.`;
    } else if (error.message.includes('parameter url')) {
        // Penanganan spesifik untuk error API yang terdeteksi
        errorMessage = `❌ *Gagal:* API melaporkan *'masukan parameter url'*. Pastikan format URL Sfile.mobi sudah benar.`;
    }

    await sendMessageWithQuote(sock, remoteJid, message, errorMessage);
  }
}

export default {
  handle,
  Commands: ["sfiledl"], 
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1,
};