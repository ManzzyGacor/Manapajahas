import ApiAutoresbotModule from "api-autoresbot";
const ApiAutoresbot = ApiAutoresbotModule.default || ApiAutoresbotModule;
import config from "../../config.js";

import { logWithTime } from "../../lib/utils.js";
import mess from "../../strings.js";

import {
  addUser,
  removeUser,
  getUser,
  isUserPlaying,
} from "../../database/temporary_db/cak lontong.js";

const WAKTU_GAMES = 60; // 60 detik waktu menjawab
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 Menit (Jeda waktu antar game)

// Variabel untuk menyimpan waktu terakhir main setiap grup/user
const cooldowns = {};

const api = new ApiAutoresbot(config.APIKEY);

/**
 * Mengirim pesan ke pengguna.
 * @param {Object} sock - Instance koneksi.
 * @param {string} remoteJid - ID pengguna.
 * @param {Object} content - Konten pesan.
 * @param {Object} options - Opsi tambahan untuk pengiriman pesan.
 */
const sendMessage = async (sock, remoteJid, content, options = {}) => {
  try {
    await sock.sendMessage(remoteJid, content, options);
  } catch (error) {
    console.error(`Gagal mengirim pesan ke ${remoteJid}:`, error);
  }
};

/**
 * Menangani game Cak Lontong.
 * @param {Object} sock - Instance koneksi.
 * @param {Object} messageInfo - Informasi pesan.
 */
const handle = async (sock, messageInfo) => {
  const { remoteJid, message, fullText } = messageInfo;

  if (!fullText.includes("lontong")) {
    return true;
  }

  // 1. Cek apakah pengguna sedang bermain (Game belum selesai)
  if (isUserPlaying(remoteJid)) {
    await sendMessage(
      sock,
      remoteJid,
      { text: mess.game.isPlaying },
      { quoted: message }
    );
    return;
  }

  // 2. Cek Cooldown (Apakah masih dalam masa jeda?)
  const now = Date.now();
  if (cooldowns[remoteJid] && now - cooldowns[remoteJid] < COOLDOWN_TIME) {
    const sisaWaktu = cooldowns[remoteJid] + COOLDOWN_TIME - now;
    const menit = Math.floor(sisaWaktu / 60000);
    const detik = Math.floor((sisaWaktu % 60000) / 1000);

    await sendMessage(
      sock,
      remoteJid,
      {
        text: `⏳ *Jeda Bermain*\n\nHarap tunggu *${menit} menit ${detik} detik* lagi sebelum bermain Cak Lontong kembali.\n\n_🚫 Mohon untuk tidak melakukan spam command agar bot tetap stabil._`,
      },
      { quoted: message }
    );
    return;
  }

  try {
    const response = await api.get("/api/game/caklontong");
    const { soal, jawaban, deskripsi } = response.data;

    // Timer 60 detik untuk menjawab
    const timer = setTimeout(async () => {
      if (isUserPlaying(remoteJid)) {
        removeUser(remoteJid);
        await sendMessage(
          sock,
          remoteJid,
          {
            text: `Waktu Habis\nJawaban: ${jawaban}\nDeskripsi: ${deskripsi}\n\nIngin bermain? Ketik .cak lontong`,
          },
          { quoted: message }
        );
      }
    }, WAKTU_GAMES * 1000);

    // 3. Set waktu cooldown baru (dimulai saat game berhasil dibuat)
    cooldowns[remoteJid] = now;

    // Tambahkan pengguna ke database
    addUser(remoteJid, {
      answer: jawaban.toLowerCase(),
      hadiah: 10, // Jumlah hadiah jika menang
      deskripsi,
      command: fullText,
      timer: timer,
    });

    // Kirim pertanyaan ke pengguna
    await sendMessage(
      sock,
      remoteJid,
      { text: `*Jawablah Pertanyaan Berikut :*\n${soal}\n*Waktu : 60s*` },
      { quoted: message }
    );

    logWithTime("Caklontong", `Jawaban : ${jawaban}`);
  } catch (error) {
    const errorMessage = `Maaf, terjadi kesalahan saat memproses permintaan Anda. Mohon coba lagi nanti.\n\n${
      error || "Kesalahan tidak diketahui"
    }`;
    await sendMessage(
      sock,
      remoteJid,
      { text: errorMessage },
      { quoted: message }
    );
  }
};

export default {
  handle,
  Commands: ["cak", "caklontong"],
  OnlyPremium: false,
  OnlyOwner: false,
};