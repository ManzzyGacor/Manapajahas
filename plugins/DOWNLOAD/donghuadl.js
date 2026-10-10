import axios from "axios";

import mess from "../../strings.js";
import { logCustom } from "../../lib/logger.js";
import { downloadToBuffer } from "../../lib/utils.js";

const APIBOTCAHX_KEY = "Varesa"; 
const API_URL = `https://api.botcahx.eu.org/api/download/donghua`;

async function sendMessageWithQuote(sock, remoteJid, message, text) {
  await sock.sendMessage(remoteJid, { text }, { quoted: message });
}

function isDonghuaUrl(url) {
  return /donghua\.web\.id/i.test(url);
}

async function processAndSendResult(sock, remoteJid, message, result) {
    const { 
        title, 
        episodes, 
        release_date, 
        quality, 
        thumbnail, 
        download_link_mp4 
    } = result;

    const caption = `
*✅ DONGHUA DOWNLOADER SUKSES!*

*🎬 Judul:* ${title || 'Tidak Diketahui'}
*🏷️ Episode:* ${episodes || 'Tidak Diketahui'}
*🗓️ Rilis:* ${release_date || 'Tidak Diketahui'}
*✨ Kualitas:* ${quality || 'Tidak Diketahui'}
*🔗 Sumber:* Donghua Web ID

_Mohon tunggu sebentar, file video sedang diproses..._
    `.trim();

    try {
        const thumbnailBuffer = await downloadToBuffer(thumbnail);
        await sock.sendMessage(
            remoteJid,
            { image: thumbnailBuffer, caption: caption },
            { quoted: message }
        );
    } catch (e) {
        await sendMessageWithQuote(sock, remoteJid, message, caption);
    }

    if (download_link_mp4) {
        await sock.sendMessage(remoteJid, { react: { text: "⬇️", key: message.key } });

        try {
            const videoBuffer = await downloadToBuffer(download_link_mp4);
            
            await sock.sendMessage(
                remoteJid,
                { 
                    video: videoBuffer, 
                    caption: mess.general.success + "\n\n_Video berhasil dikirim!_" 
                },
                { quoted: message }
            );

            await sock.sendMessage(remoteJid, { react: { text: "✅", key: message.key } });

        } catch (e) {
            await sock.sendMessage(remoteJid, { react: { text: "❌", key: message.key } });
            await sendMessageWithQuote(
                sock, 
                remoteJid, 
                message, 
                `❌ *Gagal Mengirim Video:*\n\nTerjadi kesalahan saat mengunduh file video. Coba lagi nanti.`
            );
        }
    } else {
        await sendMessageWithQuote(
            sock, 
            remoteJid, 
            message, 
            `❌ *Gagal Mengunduh:*\n\nLink download video tidak ditemukan di respons API.`
        );
        await sock.sendMessage(remoteJid, { react: { text: "❌", key: message.key } });
    }
}


async function handle(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command } = messageInfo;

  try {
    if (!content?.trim() || !isDonghuaUrl(content)) {
      return sendMessageWithQuote(
        sock,
        remoteJid,
        message,
        `_⚠️ Format Penggunaan Salah!_ \n\n_Perintah ini hanya menerima link dari *donghua.web.id*_.\n\n_💬 Contoh:_ _*${
          prefix + command
        } https://donghua.web.id/throne-of-seal/*_`
      );
    }

    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });

    const apiUrlWithParams = `${API_URL}?url=${encodeURIComponent(
      content
    )}&apikey=${APIBOTCAHX_KEY}`;

    const { data: response } = await axios.get(apiUrlWithParams, { timeout: 20000 });

    if (!response.status || !response.result || !response.result.title) {
      throw new Error(
        response.message || "API gagal merespon atau data tidak ditemukan pada link tersebut."
      );
    }
    
    await processAndSendResult(sock, remoteJid, message, response.result);

  } catch (error) {
    console.error("Kesalahan saat memproses Donghua Downloader:", error);
    logCustom("info", content, `ERROR-COMMAND-${command}.txt`);

    await sock.sendMessage(remoteJid, {
        react: { text: "❌", key: message.key },
    });

    const errorMessage = `❌ Maaf, terjadi kesalahan saat memproses permintaan Anda.\n\n*Detail Kesalahan:* ${
      error.message || "Kesalahan tidak diketahui"
    }\n\n_Pastikan URL Donghua yang Anda berikan valid dan lengkap._`;
    await sendMessageWithQuote(sock, remoteJid, message, errorMessage);
  }
}

export default {
  handle,
  Commands: ["donghua", "dhdl"], 
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1,
};