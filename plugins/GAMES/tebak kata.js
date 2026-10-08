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
  getUser,
  isUserPlaying,
} from "../../database/temporary_db/tebak kata.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message, fullText } = messageInfo;

  if (!fullText.includes("kata")) {
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
      { text: `⏳ *Jeda Bermain*\n\nHarap tunggu *${menit} menit ${detik} detik* lagi sebelum bermain Tebak Kata kembali.\n\n_🚫 Mohon untuk tidak melakukan spam command agar bot tetap stabil._` },
      { quoted: message }
    );
  }

  try {
    const response = await api.get(`/api/game/tebakkata`);

    const soal = response.data.soal;
    const jawaban = response.data.jawaban;

    // Set Timer
    const timer = setTimeout(async () => {
      if (!isUserPlaying(remoteJid)) return;

      removeUser(remoteJid); // Hapus user dari database jika waktu habis

      if (mess.game_handler.waktu_habis) {
        const messageWarning = mess.game_handler.waktu_habis.replace(
          "@answer",
          jawaban
        );
        await sock.sendMessage(
          remoteJid,
          { text: messageWarning },
          { quoted: message }
        );
      }
    }, WAKTU_GAMES * 1000);

    // Update Cooldown setelah sukses dapat soal
    cooldowns[remoteJid] = now;

    // Tambahkan pengguna ke database
    addUser(remoteJid, {
      answer: jawaban.toLowerCase(),
      hadiah: 10, // jumlah money jika menang
      command: fullText,
      timer: timer,
    });

    logWithTime("Tebak kata", `Jawaban : ${jawaban}`);

    await sock.sendMessage(
      remoteJid,
      {
        text: `Silahkan Jawab Pertanyaan Berikut\n\n${soal}\nWaktu : ${WAKTU_GAMES}s`,
      },
      { quoted: message }
    );
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
  Commands: ["tebak", "tebakkata"],
  OnlyPremium: false,
  OnlyOwner: false,
};