import axios from "axios";
import config from "../../config.js";
import { logWithTime } from "../../lib/utils.js";
import {
  addUser,
  removeUser,
  isUserPlaying,
  getUser,
} from "../../database/temporary_db/db_asahotak.js";

const APIKEY = config.APIBOTCAHX || "Varesa"; 
const TIMEOUT = 120 * 1000; // 120 Detik
const POIN = 10; // Hadiah 10 Money
const COOLDOWN_TIME = 5 * 60 * 1000; // Cooldown 5 Menit

const lastPlayed = {}; // Variable untuk simpan waktu terakhir main

async function handle(sock, messageInfo) {
  const { remoteJid, message, prefix, command } = messageInfo;

  // --- COMMAND: MULAI GAME ---
  if (command === "asahotak") {
    
    // 1. Cek User sedang main atau tidak
    if (isUserPlaying(remoteJid)) {
      return await sock.sendMessage(
        remoteJid,
        { text: "Masih ada soal Asah Otak yang belum terjawab di chat ini!" },
        { quoted: message }
      );
    }

    // 2. Cek Cooldown
    const now = Date.now();
    if (lastPlayed[remoteJid] && (now - lastPlayed[remoteJid] < COOLDOWN_TIME)) {
        const remainingTime = COOLDOWN_TIME - (now - lastPlayed[remoteJid]);
        const minutes = Math.floor(remainingTime / 60000);
        const seconds = Math.floor((remainingTime % 60000) / 1000);
        
        return await sock.sendMessage(
            remoteJid,
            { text: `⏳ *Cooldown:* Tunggu ${minutes} menit ${seconds} detik lagi.` },
            { quoted: message }
        );
    }

    try {
      // 3. Mengambil soal dari API
      const { data } = await axios.get(
        `https://api.botcahx.eu.org/api/game/asahotak?apikey=${APIKEY}`
      );

      let json = Array.isArray(data)
        ? data[Math.floor(Math.random() * data.length)]
        : data;

      if (!json || !json.soal) throw new Error("Data soal tidak ditemukan");

      const caption = `
${json.soal}

┌─⊷ *ASAH OTAK*
▢ Timeout: *${TIMEOUT / 1000} detik*
▢ Bonus: *${POIN} Money*
▢ Bantuan: *${prefix}toka*
└──────────────
*Balas/Reply pesan ini untuk menjawab!*
`.trim();

      // Kirim Soal
      const sentMsg = await sock.sendMessage(
        remoteJid,
        { text: caption },
        { quoted: message }
      );

      // Set Timer Habis
      const timer = setTimeout(() => {
        if (isUserPlaying(remoteJid)) {
          const game = getUser(remoteJid);
          sock.sendMessage(
            remoteJid,
            {
              text: `⏳ Waktu Habis!\nJawabannya adalah: *${game.jawaban}*`,
            },
            { quoted: sentMsg }
          );
          removeUser(remoteJid);
        }
      }, TIMEOUT);

      // Simpan Sesi Game
      addUser(remoteJid, {
        soal: json.soal,
        jawaban: json.jawaban,
        poin: POIN,
        timer: timer,
      });

      // Update Cooldown
      lastPlayed[remoteJid] = now;

      logWithTime("Asah Otak", `Soal: ${json.soal} | Jawab: ${json.jawaban}`);

    } catch (e) {
      console.error(e);
      await sock.sendMessage(
        remoteJid,
        { text: "❌ Gagal mengambil soal. Coba lagi nanti." },
        { quoted: message }
      );
    }
  }

  // --- COMMAND: HINT (BANTUAN) ---
  if (command === "toka") {
    if (!isUserPlaying(remoteJid)) return; // Abaikan jika tidak main
    
    const game = getUser(remoteJid);
    const ans = game.jawaban;
    // Ganti huruf vokal/konsonan dengan underscore
    const clue = ans.replace(/[bcdfghjklmnpqrstvwxyz]/gi, "_");
    
    await sock.sendMessage(
      remoteJid,
      { text: "```" + clue + "```" },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["asahotak", "toka"],
  OnlyPremium: false,
  OnlyOwner: false,
};