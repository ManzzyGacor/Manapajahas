import ApiAutoresbotModule from "api-autoresbot";
const ApiAutoresbot = ApiAutoresbotModule.default || ApiAutoresbotModule;

import config from "../../config.js";
const api = new ApiAutoresbot(config.APIKEY);
import mess from "../../strings.js";
import { logWithTime } from "../../lib/utils.js";

const WAKTU_GAMES = 60; // 60 detik
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 Menit
const cooldowns = {};

import {
  addUser,
  removeUser,
  isUserPlaying,
} from "../../database/temporary_db/tebak gambar.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message, fullText } = messageInfo;

  if (!fullText.includes("gambar")) {
    return true;
  }

  // Cek jika sedang bermain
  if (isUserPlaying(remoteJid)) {
    return await sock.sendMessage(
      remoteJid,
      { text: mess.game.isPlaying },
      { quoted: message }
    );
  }

  // Cek Cooldown
  const now = Date.now();
  if (cooldowns[remoteJid] && now - cooldowns[remoteJid] < COOLDOWN_TIME) {
    const sisaWaktu = cooldowns[remoteJid] + COOLDOWN_TIME - now;
    const menit = Math.floor(sisaWaktu / 60000);
    const detik = Math.floor((sisaWaktu % 60000) / 1000);

    return await sock.sendMessage(
      remoteJid,
      { text: `⏳ *Jeda Bermain*\n\nHarap tunggu *${menit} menit ${detik} detik* lagi sebelum bermain Tebak Gambar kembali.\n\n_🚫 Mohon untuk tidak melakukan spam command agar bot tetap stabil._` },
      { quoted: message }
    );
  }

  try {
    const response = await api.get(`/api/game/tebakgambar`);

    const UrlData = response.data.img;
    const answer = response.data.jawaban;
    const deskripsi = response.data.deskripsi;

    // Set Timer
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

    // Update Cooldown
    cooldowns[remoteJid] = now;

    addUser(remoteJid, {
      answer: answer.toLowerCase(),
      hadiah: 10, 
      command: fullText,
      timer: timer,
    });

    await sock.sendMessage(
      remoteJid,
      {
        image: { url: UrlData },
        caption: `Silahkan Jawab Soal Di Atas Ini\n\nDeskripsi : ${deskripsi}\nWaktu : ${WAKTU_GAMES}s`,
      },
      { quoted: message }
    );

    logWithTime("Tebak Gambar", `Jawaban : ${answer}`);
  } catch (error) {
    const errorMessage = `Maaf, terjadi kesalahan saat memproses permintaan Anda. Mohon coba lagi nanti.\n\n${
      error || "Kesalahan tidak diketahui"
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
  Commands: ["tebakgambar"],
  OnlyPremium: false,
  OnlyOwner: false,
};