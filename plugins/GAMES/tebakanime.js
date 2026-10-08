import axios from 'axios';
import config from "../../config.js"; 
import mess from "../../strings.js"; 
import { logWithTime } from "../../lib/utils.js"; 

const APIKEY_BOTCAHX = config.APIBOTCAHX || "Varesa";
const BOTCAHX_API_URL = `https://api.botcahx.eu.org/api/game/tebakanime?apikey=${APIKEY_BOTCAHX}`;

const WAKTU_GAMES = 60; 
const PREFIXES = config.prefix || [".", "!", "#"]; 
const COMMANDS = ["tebakanime", "guessanime"];

// --- COOLDOWN DITAMBAHKAN DI SINI ---
const COOLDOWN_TIME = 2 * 60 * 1000; // 2 menit dalam milidetik
const lastPlayed = {}; // Melacak penggunaan terakhir per JID
// ------------------------------------

import {
  addUser,
  removeUser,
  isUserPlaying,
} from "../../database/temporary_db/tebak bendera.js";


async function handle(sock, messageInfo) {
  const { remoteJid, message, fullText } = messageInfo;

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
    return true; 
  }

  // --- COOLDOWN CHECK ---
  const now = Date.now();
  if (lastPlayed[remoteJid] && (now - lastPlayed[remoteJid] < COOLDOWN_TIME)) {
      const remainingTime = COOLDOWN_TIME - (now - lastPlayed[remoteJid]);
      const minutes = Math.floor(remainingTime / 60000);
      const seconds = Math.floor((remainingTime % 60000) / 1000);
      
      const timeString = `${minutes > 0 ? minutes + 'm ' : ''}${seconds}d`;
      
      return await sock.sendMessage(
          remoteJid,
          { text: `🚫 Mohon tunggu ${timeString} sebelum memulai game Tebak Anime lagi.` },
          { quoted: message }
      );
  }
  // -----------------------

  // Ketika sedang bermain 
  if (isUserPlaying(remoteJid)) {
    return await sock.sendMessage(
      remoteJid,
      { text: mess.game.isPlaying },
      { quoted: message }
    );
  }

  try {
    const response = await axios.get(BOTCAHX_API_URL);
    
    // API ini mengembalikan objek tunggal
    const data = response.data; 
    
    if (!data || !data.img || !data.jawaban) {
        throw new Error("API merespons data kosong atau tidak lengkap.");
    }

    const UrlData = data.img; 
    const answer = data.jawaban; 
    const description = data.deskripsi || "Tidak ada deskripsi tersedia.";
    const releaseYear = data['tahun rilis'] || "Tidak diketahui";


    if (!UrlData || !answer) {
         throw new Error("Data game tidak lengkap (URL Gambar atau Jawaban kosong).");
    }

    const timer = setTimeout(async () => {
      if (!isUserPlaying(remoteJid)) return;

      removeUser(remoteJid); 

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

    addUser(remoteJid, {
      answer: answer.toLowerCase().trim(),
      hadiah: 10, 
      command: fullText,
      timer: timer,
    });

    const captionMessage = 
      `**🎬 Tebak Anime (Judul/Karakter) 🎬**\n\n` + 
      `Apa judul anime atau nama karakter dari gambar di atas?\n\n` +
      `*-- CLUE --*\n` +
      `Deskripsi: ${description}\n` +
      `Tahun Rilis: ${releaseYear}\n\n` +
      `Waktu : ${WAKTU_GAMES} detik`;

    await sock.sendMessage(
      remoteJid,
      {
        image: { url: UrlData },
        caption: captionMessage,
      },
      { quoted: message }
    );
    
    // --- COOLDOWN UPDATE ---
    lastPlayed[remoteJid] = now;
    // -----------------------

    logWithTime("Tebak Anime", `Jawaban : ${answer}, Tahun: ${releaseYear}`);
  } catch (error) {
    const errorMessage = `Maaf, terjadi kesalahan saat memproses permintaan API Tebak Anime.\n\nDetail Error: ${
      error.message || "Kesalahan tidak diketahui"
    }`;
    await sock.sendMessage(
      remoteJid,
      { text: errorMessage },
      { quoted: message }
    );
    logWithTime("Tebak Anime Error", error.message);
  }
}

export default {
  handle,
  Commands: COMMANDS,
  OnlyPremium: false,
  OnlyOwner: false,
};