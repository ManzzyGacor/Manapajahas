import axios from 'axios';
import config from "../../config.js"; 
import mess from "../../strings.js"; 
import { logWithTime } from "../../lib/utils.js"; 

const APIKEY_BOTCAHX = config.APIBOTCAHX || "Varesa";
const BOTCAHX_API_URL = `https://api.botcahx.eu.org/api/game/tebakheroml?apikey=${APIKEY_BOTCAHX}`;

const WAKTU_GAMES = 60; 
const PREFIXES = config.prefix || [".", "!", "#"]; 
const COMMANDS = ["tebakml", "tebakheroml"];

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
          { text: `🚫 Mohon tunggu ${timeString} sebelum memulai game Tebak ML lagi.` },
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
    
    const gameArray = response.data; 
    
    if (!Array.isArray(gameArray) || gameArray.length === 0) {
        throw new Error("API merespons data kosong atau tidak dalam format array yang diharapkan.");
    }

    const data = gameArray[Math.floor(Math.random() * gameArray.length)];

    const UrlData = data.fullimg || data.img; 
    const answer = data.jawaban; 
    const clue = data.deskripsi || "Tidak ada deskripsi tersedia.";

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
      `**🎮 Tebak Hero Mobile Legends 🎮**\n\n` + 
      `Siapakah nama hero di atas ini?\n` +
      `Clue (Deskripsi): *${clue}*\n\n` +
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

    logWithTime("Tebak ML", `Jawaban : ${answer}, Clue: ${clue}`);
  } catch (error) {
    const errorMessage = `Maaf, terjadi kesalahan saat memproses permintaan API Tebak ML.\n\nDetail Error: ${
      error.message || "Kesalahan tidak diketahui"
    }`;
    await sock.sendMessage(
      remoteJid,
      { text: errorMessage },
      { quoted: message }
    );
    logWithTime("Tebak ML Error", error.message);
  }
}

export default {
  handle,
  Commands: COMMANDS,
  OnlyPremium: false,
  OnlyOwner: false,
};