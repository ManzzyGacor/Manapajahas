import axios from 'axios';
import config from "../../config.js"; // Untuk konfigurasi (API Key, Prefix)
import mess from "../../strings.js"; // Untuk pesan-pesan bot
import { logWithTime } from "../../lib/utils.js"; // Untuk logging

// --- Konfigurasi API dan Game ---
const APIKEY_BOTCAHX = config.APIBOTCAHX || "Varesa";
const BOTCAHX_API_URL = `https://api.botcahx.eu.org/api/game/tebakpop?apikey=${APIKEY_BOTCAHX}`;

const WAKTU_GAMES = 60; // 60 detik
const PREFIXES = config.prefix || [".", "!", "#"]; 
const COMMANDS = ["tebakpop", "guesspop", "tebakkpop"];

// Import database sementara 
import {
  addUser,
  removeUser,
  isUserPlaying,
} from "../../database/temporary_db/tebak bendera.js";


async function handle(sock, messageInfo) {
  const { remoteJid, message, fullText } = messageInfo;

  // --- 1. Pengecekan Perintah (Mempertimbangkan Prefix) ---
  const lowerText = fullText.toLowerCase().trim();
  let isCommand = false;

  for (const prefix of PREFIXES) {
    for (const cmd of COMMANDS) {
      if (lowerText.startsWith(prefix + cmd)) {
        isCommand = true;
        break;
      }
    }
    if (isCommand) break;
  }

  if (!isCommand) {
    return true; // Keluar jika bukan perintah yang valid
  }
  // --------------------------------------------------------

  // 2. Ketika sedang bermain (pencegahan konflik)
  if (isUserPlaying(remoteJid)) {
    return await sock.sendMessage(
      remoteJid,
      { text: mess.game.isPlaying },
      { quoted: message }
    );
  }

  try {
    // 3. Panggil API Botcahx
    const response = await axios.get(BOTCAHX_API_URL);
    
    // API ini mengembalikan array, kita pilih satu objek secara acak
    const gameArray = response.data; 
    
    if (!Array.isArray(gameArray) || gameArray.length === 0) {
        throw new Error("API merespons data kosong atau tidak dalam format array yang diharapkan.");
    }

    // Pilih item secara acak
    const data = gameArray[Math.floor(Math.random() * gameArray.length)];

    const UrlData = data.img; 
    const answer = data.jawaban; 
    const description = data.deskripsi || "Tidak ada clue tersedia.";


    if (!UrlData || !answer) {
         throw new Error("Data game tidak lengkap (URL Gambar atau Jawaban kosong).");
    }

    // 4. Set timer
    const timer = setTimeout(async () => {
      if (!isUserPlaying(remoteJid)) return;

      removeUser(remoteJid); // Hapus user dari database jika waktu habis

      if (mess.game_handler.waktu_habis) {
        const messageWarning = mess.game_handler.waktu_habis.replace(
          "@answer",
          answer
        );
        await sock.sendMessage(
          remoteJid,
          { text: messageWarning },
          { quoted: message }
        );
      }
    }, WAKTU_GAMES * 1000);

    // 5. Tambahkan pengguna ke database
    addUser(remoteJid, {
      answer: answer.toLowerCase().trim(),
      hadiah: 10, // jumlah money jika menang
      command: fullText,
      timer: timer,
    });

    // 6. Kirim pesan game dengan Clue (Deskripsi)
    const captionMessage = 
      `*🎤 Tebak Pop (K-Pop/Artis) 🎤*\n\n` + 
      `Siapakah nama artis, grup, atau individu di dalam gambar ini?\n\n` +
      `*-- CLUE --*\n` +
      `Petunjuk: ${description}\n\n` +
      `Waktu : ${WAKTU_GAMES} detik`;

    await sock.sendMessage(
      remoteJid,
      {
        image: { url: UrlData },
        caption: captionMessage,
      },
      { quoted: message }
    );

    logWithTime("Tebak Pop", `Jawaban : ${answer}`);
  } catch (error) {
    const errorMessage = `Maaf, terjadi kesalahan saat memproses permintaan API Tebak Pop.\n\nDetail Error: ${
      error.message || "Kesalahan tidak diketahui"
    }`;
    await sock.sendMessage(
      remoteJid,
      { text: errorMessage },
      { quoted: message }
    );
    logWithTime("Tebak Pop Error", error.message);
  }
}

export default {
  handle,
  Commands: COMMANDS,
  OnlyPremium: false,
  OnlyOwner: false,
};