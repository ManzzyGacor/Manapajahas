import mess from "../../strings.js";
import { logWithTime } from "../../lib/utils.js";
import {
  addUser,
  removeUser,
  isUserPlaying,
} from "../../database/temporary_db/tebak angka.js";

const WAKTU_GAMES = 60; // 60 detik
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 Menit
const cooldowns = {};

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, fullText } = messageInfo;

  let level_tebakangka = "";

  if (!fullText.includes("angka")) {
    return true; // Skip plugin ini
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
      { text: `⏳ *Jeda Bermain*\n\nHarap tunggu *${menit} menit ${detik} detik* lagi sebelum bermain Tebak Angka kembali.\n\n_🚫 Mohon untuk tidak melakukan spam command agar bot tetap stabil._` },
      { quoted: message }
    );
  }

  const validLevels = ["easy", "normal", "hard", "expert", "setan"];
  const args = content.split(" ");
  const KATA_TERAKHIR = args[args.length - 1];

  if (validLevels.includes(KATA_TERAKHIR)) {
    level_tebakangka = KATA_TERAKHIR;
  } else {
    return await sock.sendMessage(
      remoteJid,
      {
        text: `Masukkan Level\n\nContoh *tebak angka easy*\n\n*Opsi*\neasy\nnormal\nhard\nexpert\nsetan`,
      },
      { quoted: message }
    );
  }

  const levelMap = {
    easy: 10,
    normal: 100,
    hard: 1000,
    expert: 10000,
    setan: 10000000000,
  };

  const akhir_angkaAcak = levelMap[level_tebakangka];
  const angkaAcak = Math.floor(Math.random() * akhir_angkaAcak) + 1;

  // Set Cooldown sebelum memulai
  cooldowns[remoteJid] = now;

  // Buat timer baru untuk user
  const timer = setTimeout(async () => {
    if (!isUserPlaying(remoteJid)) return;

    removeUser(remoteJid); // Hapus user dari database jika waktu habis

    if (mess.game_handler.waktu_habis) {
      const messageWarning = mess.game_handler.waktu_habis.replace(
        "@answer",
        angkaAcak
      );
      await sock.sendMessage(
        remoteJid,
        { text: messageWarning },
        { quoted: message }
      );
    }
  }, WAKTU_GAMES * 1000);

  // Tambahkan pengguna ke database
  addUser(remoteJid, {
    angkaAcak,
    level: level_tebakangka,
    angkaEnd: akhir_angkaAcak,
    attempts: 6, // jumlah percobaan
    hadiah: 10, // jumlah money jika menang
    command: fullText,
    timer: timer,
  });

  // Kirim pesan awal
  await sock.sendMessage(
    remoteJid,
    {
      text: `Game dimulai! Tebak angka dari 1 hingga ${akhir_angkaAcak} untuk level *${level_tebakangka}*. Anda memiliki waktu ${WAKTU_GAMES}s`,
    },
    { quoted: message }
  );

  logWithTime("Tebak Angka", `Jawaban : ${angkaAcak}`);
}

export default {
  handle,
  Commands: ["tebak", "tebakangka"],
  OnlyPremium: false,
  OnlyOwner: false,
};