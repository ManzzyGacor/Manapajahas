import mess from "../../strings.js";
import {
  addUser,
  removeUser,
  getUser,
  isUserPlaying,
} from "../../database/temporary_db/tictactoe.js";
import TicTacToe from "../../lib/games/tictactoe.js";

const WAKTU_GAMES = 60; // 60 detik
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 Menit
const cooldowns = {};

async function handle(sock, messageInfo) {
  const { remoteJid, message, sender, isGroup, command } = messageInfo;

  const groupOnlyMessage = { text: mess.game.isGroup };
  const waitingMessage = `Menunggu partner (${WAKTU_GAMES} s)... \n\nKetik *${command}* untuk menanggapi`;
  const timeoutMessage = `⏳ Waktu habis! Tidak ada lawan yang ingin bermain`;

  if (!isGroup) {
    return sock.sendMessage(remoteJid, groupOnlyMessage, { quoted: message });
  }

  const isPlaying = isUserPlaying(remoteJid);
  if (isPlaying) {
    const currentGame = getUser(remoteJid);
    if (currentGame.state === "PLAYING") return true;
    await sock.sendMessage(
      remoteJid,
      { text: mess.game.isPlaying },
      { quoted: message }
    );
    return true;
  }

  // Cek Cooldown
  const now = Date.now();
  if (cooldowns[remoteJid] && now - cooldowns[remoteJid] < COOLDOWN_TIME) {
    const sisaWaktu = cooldowns[remoteJid] + COOLDOWN_TIME - now;
    const menit = Math.floor(sisaWaktu / 60000);
    const detik = Math.floor((sisaWaktu % 60000) / 1000);

    return await sock.sendMessage(
      remoteJid,
      { text: `⏳ *Jeda Bermain*\n\nHarap tunggu *${menit} menit ${detik} detik* lagi sebelum bermain TicTacToe kembali.\n\n_🚫 Mohon untuk tidak melakukan spam command agar bot tetap stabil._` },
      { quoted: message }
    );
  }

  // Set Cooldown
  cooldowns[remoteJid] = now;

  addUser(remoteJid, {
    id_room: remoteJid,
    playerX: sender,
    playerO: null,
    state: "WAITING",
    game: new TicTacToe(sender, "o"),
  });

  setTimeout(async () => {
    if (isUserPlaying(remoteJid)) {
      const currentGame = getUser(remoteJid);
      if (currentGame.state === "PLAYING") return true;

      removeUser(remoteJid); 
      await sock.sendMessage(
        remoteJid,
        { text: timeoutMessage },
        { quoted: message }
      );
      return true;
    }
  }, WAKTU_GAMES * 1000);

  await sock.sendMessage(
    remoteJid,
    { text: waitingMessage },
    { quoted: message }
  );
  return true;
}

export default {
  handle,
  Commands: ["ttc", "ttt", "tictactoe"],
  OnlyPremium: false,
  OnlyOwner: false,
};