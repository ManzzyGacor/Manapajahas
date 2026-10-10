import fs from "fs/promises";
import path from "path";
import ApiAutoresbotModule from "api-autoresbot";
const ApiAutoresbot = ApiAutoresbotModule.default || ApiAutoresbotModule;

import config from "../../config.js";
import mess from "../../strings.js"; // Import strings.js untuk pesan standar (opsional)

const api = new ApiAutoresbot(config.APIKEY);
import { textToAudio } from "../../lib/features.js";
import {
  convertAudioToCompatibleFormat,
  generateUniqueFilename,
} from "../../lib/utils.js";

// --- KONFIGURASI COOLDOWN ---
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 Menit
const cooldowns = {}; // Database sementara untuk menyimpan waktu cooldown

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, fullText, pushName } = messageInfo;

  // Pastikan trigger command benar
  if (!fullText.includes("odam")) return true;

  // --- 1. CEK COOLDOWN ---
  const now = Date.now();
  if (cooldowns[remoteJid] && now - cooldowns[remoteJid] < COOLDOWN_TIME) {
    const sisaWaktu = cooldowns[remoteJid] + COOLDOWN_TIME - now;
    const menit = Math.floor(sisaWaktu / 60000);
    const detik = Math.floor((sisaWaktu % 60000) / 1000);

    // Kirim pesan peringatan cooldown
    await sock.sendMessage(
      remoteJid,
      {
        text: `⏳ *Jeda Cek Khodam*\n\nHarap tunggu *${menit} menit ${detik} detik* lagi sebelum mengecek khodam kembali.\n\n_🚫 Jangan spam agar server suara tidak error._`,
      },
      { quoted: message }
    );
    return; // Hentikan proses
  }

  const nameCekodam = content.trim() || pushName;

  try {
    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });

    // Panggil API Kodam
    const response = await api.get(`/api/game/kodam`);
    if (!response?.data) {
      console.error("⚠️ API response is empty or invalid:", response);
      return false;
    }

    const kodam = response.data;
    const resultKodam = `Nama, ${nameCekodam} , , , Kodam , ${kodam}`;
    
    // --- 2. SET COOLDOWN (Jika API berhasil) ---
    // Kita set di sini agar user terkena cooldown setelah berhasil request
    cooldowns[remoteJid] = now;

    let bufferAudio = await textToAudio(resultKodam);

    if (!bufferAudio) {
      console.error("⚠️ Gagal menghasilkan audio dari teks.");
      return false;
    }

    const inputPath = path.join(process.cwd(), generateUniqueFilename());
    await fs.writeFile(inputPath, bufferAudio);

    let bufferFinal = bufferAudio; // Default gunakan buffer original

    try {
      const convertedPath = await convertAudioToCompatibleFormat(inputPath);
      bufferFinal = await fs.readFile(convertedPath);
    } catch (err) {}

    await sock.sendMessage(
      remoteJid,
      {
        audio: bufferFinal,
        mimetype: "audio/mp4",
        ptt: true // Opsional: true agar dikirim sebagai Voice Note (bukan audio file biasa)
      },
      { quoted: message }
    );
  } catch (error) {
    console.error("⚠️ Terjadi kesalahan:", error);

    const errorMessage = `Maaf, terjadi kesalahan saat memproses permintaan Anda. Mohon coba lagi nanti.\n\n${
      error.message || "Kesalahan tidak diketahui"
    }`;
    await sock.sendMessage(
      remoteJid,
      { text: errorMessage },
      { quoted: message }
    );
  }
}
export default {
  handle,
  Commands: ["cekkodam"],
  OnlyPremium: false,
  OnlyOwner: false,
};