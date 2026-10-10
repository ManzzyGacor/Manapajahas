import axios from "axios";

import mess from "../../strings.js";
import { logCustom } from "../../lib/logger.js";
import { downloadToBuffer } from "../../lib/utils.js";

// --- KONFIGURASI API ---
// API Key Botcahx dipasang langsung
const APIBOTCAHX_KEY = "Varesa"; 
const API_URL = `https://api.botcahx.eu.org/api/dowloader/capcut`; // Endpoint CapCut
// -----------------------


/**
 * Mengirim pesan dengan kutipan
 * @param {object} sock - Objek koneksi WebSocket
 * @param {string} remoteJid - ID pengguna tujuan
 * @param {object} message - Pesan asli yang dikutip
 * @param {string} text - Pesan teks yang dikirim
 */
async function sendMessageWithQuote(sock, remoteJid, message, text) {
  await sock.sendMessage(remoteJid, { text }, { quoted: message });
}

/**
 * Memvalidasi apakah URL yang diberikan adalah URL CapCut yang valid
 * @param {string} url - URL yang akan divalidasi
 * @returns {boolean} True jika valid, false jika tidak
 */
function isCapCutUrl(url) {
  // Regex untuk mencocokkan domain capcut.com atau www.capcut.com
  return /^(https?:\/\/)?(www\.)?capcut\.com\//i.test(url);
}

/**
 * Fungsi utama untuk menangani permintaan unduhan template CapCut
 * @param {object} sock - Objek koneksi WebSocket
 * @param {object} messageInfo - Informasi pesan termasuk konten dan pengirim
 */
async function handle(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command } = messageInfo;
  
  /**
   * @type {string | null}
   */
  let videoUrl = null;
  /**
   * @type {string | null}
   */
  let captionText = null;

  try {
    // 1. Validasi Input
    if (!content?.trim() || !isCapCutUrl(content)) {
      return sendMessageWithQuote(
        sock,
        remoteJid,
        message,
        `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${
          prefix + command
        } https://www.capcut.com/template-detail/7299286607478181121*_\n\n_Pastikan itu adalah URL template CapCut yang valid._`
      );
    }

    // 2. Tampilkan Loading
    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });

    // =======================================================
    // PANGGIL API BOTCAHX
    // =======================================================
    try {
      const apiUrlWithParams = `${API_URL}?url=${encodeURIComponent(
        content
      )}&apikey=${APIBOTCAHX_KEY}`;

      // Panggil API dengan timeout
      const { data: response } = await axios.get(apiUrlWithParams, { timeout: 15000 }); 

      // Cek status dan hasil API
      if (response.status && response.result && response.result.video) {
        console.log("[CAPCUT-DL] Sukses menggunakan API Botcahx.");
        
        videoUrl = response.result.video;
        const result = response.result;
        
        captionText = `${mess.general.success}\n\n*Judul:* ${result.title || 'Tidak Diketahui'}\n*Pembuat:* ${result.owner || result.author.name || 'Tidak Diketahui'}\n\n_Sumber: Botcahx API_`;

      } else {
        // Jika API merespon tapi hasilnya kosong/status false
        throw new Error("API Botcahx gagal mengambil data template CapCut.");
      }
    } catch (apiError) {
      // Jika terjadi kesalahan koneksi/timeout/error lain dari API
      throw new Error(`Kesalahan API: ${apiError.message || 'Tidak dapat menghubungi server.'}`);
    }

    // 3. Kirim Media
    if (!videoUrl) {
        throw new Error("URL video tidak ditemukan.");
    }
    
    // Unduh video ke buffer
    const videoBuffer = await downloadToBuffer(videoUrl); 
    
    // Kirim video
    await sock.sendMessage(
        remoteJid,
        { video: videoBuffer, caption: captionText || mess.general.success },
        { quoted: message }
    );
    
    // 4. Akhiri dengan reaksi sukses
    await sock.sendMessage(remoteJid, {
      react: { text: "✅", key: message.key },
    });
    

  } catch (error) {
    // Menangkap semua kesalahan
    console.error("Kesalahan utama saat memproses CapCut:", error);
    logCustom("info", content, `ERROR-COMMAND-${command}.txt`);

    // Ganti reaksi menjadi error
    await sock.sendMessage(remoteJid, {
      react: { text: "❌", key: message.key },
    });

    // Kirim pesan kesalahan yang lebih deskriptif
    const errorMessage = `Maaf, terjadi kesalahan saat memproses permintaan Anda.\n\n*Detail Kesalahan:* ${
      error.message || "Kesalahan tidak diketahui"
    }`;
    await sendMessageWithQuote(sock, remoteJid, message, errorMessage);
  }
}

export default {
  handle,
  Commands: ["cc", "capcut"], // Perintah yang didukung
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1, // Jumlah limit yang akan dikurangi
};