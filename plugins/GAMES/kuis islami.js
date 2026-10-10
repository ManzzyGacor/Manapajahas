import axios from 'axios';
import config from "../../config.js"; 
import mess from "../../strings.js"; 
import { logWithTime } from "../../lib/utils.js"; 

const APIKEY_BOTCAHX = config.APIBOTCAHX || "Varesa";
const BOTCAHX_API_URL = `https://api.botcahx.eu.org/api/game/kuisislami?apikey=${APIKEY_BOTCAHX}`;

const WAKTU_GAMES = 90; 
const PREFIXES = config.prefix || [".", "!", "#"]; 
const COMMANDS = ["kuisislami", "kuisislam"];

// --- COOLDOWN DITAMBAHKAN DI SINI ---
const COOLDOWN_TIME = 2 * 60 * 1000; // 2 menit dalam milidetik
const lastPlayed = {}; // Melacak penggunaan terakhir per JID
// ------------------------------------

import {
  addUser,
  removeUser,
  isUserPlaying,
} from "../../database/temporary_db/tebak bendera.js";


function formatChoices(choices) {
    if (!Array.isArray(choices) || choices.length === 0) return "Tidak ada pilihan jawaban.";
    
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    
    return choices.map((choice, index) => {
        const letter = alphabet[index] || (index + 1).toString(); 
        return `${letter}. ${choice}`;
    }).join('\n');
}

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
          { text: `🚫 Mohon tunggu ${timeString} sebelum memulai Kuis Islami lagi.` },
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

    const question = data.soal;
    const choices = data.pilihan;
    const answer = data.jawaban; 
    const description = data.deskripsi || "Tidak ada deskripsi tersedia.";

    if (!question || !answer) {
         throw new Error("Data kuis tidak lengkap (Soal atau Jawaban kosong).");
    }

    const formattedChoices = formatChoices(choices);

    const timer = setTimeout(async () => {
      if (!isUserPlaying(remoteJid)) return;

      removeUser(remoteJid); 

      if (mess.game_handler.waktu_habis) {
        const messageWarning = mess.game_handler.waktu_habis.replace(
          "@answer",
          answer
        ) + `\n\n*Clue/Penjelasan: ${description}*`;

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
      `🕌 **KUIS ISLAMI** 🕋\n\n` + 
      `*PERTANYAAN:*\n` +
      `"${question}"\n\n` +
      `*PILIHAN JAWABAN:*\n` +
      `${formattedChoices}\n\n` +
      `Jawab dengan mengetik jawaban yang benar (misal: *Isa as*).\n` +
      `Waktu : ${WAKTU_GAMES} detik`;

    await sock.sendMessage(
      remoteJid,
      { text: captionMessage },
      { quoted: message }
    );
    
    // --- COOLDOWN UPDATE ---
    lastPlayed[remoteJid] = now;
    // -----------------------

    logWithTime("Kuis Islami", `Jawaban : ${answer}, Pilihan: ${choices.length}`);
  } catch (error) {
    const errorMessage = `Maaf, terjadi kesalahan saat memproses permintaan API Kuis Islami.\n\nDetail Error: ${
      error.message || "Kesalahan tidak diketahui"
    }`;
    await sock.sendMessage(
      remoteJid,
      { text: errorMessage },
      { quoted: message }
    );
    logWithTime("Kuis Islami Error", error.message);
  }
}

export default {
  handle,
  Commands: COMMANDS,
  OnlyPremium: false,
  OnlyOwner: false,
};