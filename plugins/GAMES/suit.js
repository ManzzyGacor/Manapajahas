import mess from "../../strings.js";
import {
  addUser,
  removeUser,
  getUser,
  isUserPlaying,
} from "../../database/temporary_db/suit.js";
import { sendMessageWithMention, convertToJid } from "../../lib/utils.js";

const WAKTU_GAMES = 60; // 60 detik
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 Menit
const cooldowns = {};

// Fungsi untuk memulai permainan
async function startGame(
  sock,
  remoteJid,
  player1,
  player2,
  message,
  senderType
) {
  addUser(remoteJid, {
    status: false,
    player1,
    player2,
    answer_player1: null,
    answer_player2: null,
    hadiah: 10,
    groupId: remoteJid,
  });

  const gameQuestion = `_*SUIT PvP*_\n\n@${player1.split`@`[0]} menantang @${
    player2.split`@`[0]
  } untuk bermain suit.\n\nSilakan @${
    player2.split`@`[0]
  } ketik *terima* atau *tolak* dalam ${WAKTU_GAMES}s`;
  await sendMessageWithMention(
    sock,
    remoteJid,
    gameQuestion,
    message,
    senderType
  );

  // Timer untuk membatalkan jika tidak ada respon
  setTimeout(async () => {
    if (isUserPlaying(remoteJid)) {
      removeUser(remoteJid);
      await sock.sendMessage(
        remoteJid,
        { text: "Waktu habis! Suit dibatalkan." },
        { quoted: message }
      );
    }
  }, WAKTU_GAMES * 1000); 
}

// Fungsi utama untuk menangani command
async function handle(sock, messageInfo) {
  const { remoteJid, message, sender, mentionedJid, senderType } = messageInfo;
  
  if (isUserPlaying(remoteJid)) {
    return await sock.sendMessage(
      remoteJid,
      { text: mess.game.isPlaying },
      { quoted: message }
    );
  }

  // Cek Cooldown (Menggunakan ID Grup sebagai kunci)
  const now = Date.now();
  if (cooldowns[remoteJid] && now - cooldowns[remoteJid] < COOLDOWN_TIME) {
    const sisaWaktu = cooldowns[remoteJid] + COOLDOWN_TIME - now;
    const menit = Math.floor(sisaWaktu / 60000);
    const detik = Math.floor((sisaWaktu % 60000) / 1000);

    return await sock.sendMessage(
      remoteJid,
      { text: `⏳ *Jeda Bermain*\n\nHarap tunggu *${menit} menit ${detik} detik* lagi sebelum menantang Suit kembali.\n\n_🚫 Mohon untuk tidak melakukan spam command agar bot tetap stabil._` },
      { quoted: message }
    );
  }

  if (!mentionedJid || mentionedJid.length === 0) {
    return await sendMessageWithMention(
      sock,
      remoteJid,
      `_Siapa yang ingin kamu tantang?_\nTag orangnya.\n\nContoh: suit @${
        sender.split`@`[0]
      }`,
      message,
      senderType
    );
  }

  const player1 = sender;
  const player2 = await convertToJid(sock, mentionedJid[0])

  if (player1 === player2) {
    return await sock.sendMessage(
      remoteJid,
      { text: "Kamu tidak bisa menantang diri sendiri!" },
      { quoted: message }
    );
  }

  // Set Cooldown
  cooldowns[remoteJid] = now;
  
  await startGame(sock, remoteJid, player1, player2, message, senderType);
}
export default {
  handle,
  Commands: ["suit"],
  OnlyPremium: false,
  OnlyOwner: false,
};