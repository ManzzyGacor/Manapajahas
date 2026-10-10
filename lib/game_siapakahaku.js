import similarity from "similarity";
import {
  getUser,
  removeUser,
  isUserPlaying,
} from "../database/temporary_db/db_siapakahaku.js";
import { updateUser, findUser } from "./users.js"; // Import users dari folder lib yg sama

const threshold = 0.72; // Ambang batas kemiripan

export async function cekJawabanSiapakahAku(sock, messageInfo) {
  const { remoteJid, message, fullText, sender } = messageInfo;

  // 1. Cek apakah ada game aktif
  if (!isUserPlaying(remoteJid)) return false;

  const game = getUser(remoteJid);
  const jawabanBenar = game.jawaban.toLowerCase().trim();
  const jawabanUser = fullText.toLowerCase().trim();

  // 2. Logika Cek Jawaban
  if (jawabanUser === jawabanBenar) {
    // --- JAWABAN BENAR ---
    
    // Tambah Saldo User
    const user = findUser(sender);
    if (user) {
      const [docId, userData] = user;
      const currentMoney = userData.money || 0;
      const newMoney = currentMoney + game.poin;
      
      updateUser(sender, { money: newMoney });
    }

    await sock.sendMessage(
      remoteJid,
      { text: `🎉 *BENAR!*\n+${game.poin} Money` },
      { quoted: message }
    );

    // Bersihkan sesi game
    clearTimeout(game.timer);
    removeUser(remoteJid);
    return true; // Stop handler lain

  } else if (similarity(jawabanUser, jawabanBenar) >= threshold) {
    // --- JAWABAN MIRIP ---
    await sock.sendMessage(
      remoteJid,
      { text: `🤏 *Dikit Lagi!*` },
      { quoted: message }
    );
    return true;
  }

  return false;
}