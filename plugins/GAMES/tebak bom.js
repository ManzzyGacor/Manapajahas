import mess from "../../strings.js";
import {
  addUser,
  removeUser,
  getUser,
  isUserPlaying,
} from "../../database/temporary_db/tebak bom.js";
import { logWithTime } from "../../lib/utils.js";

const COOLDOWN_TIME = 5 * 60 * 1000; // 5 Menit
const cooldowns = {};

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, fullText } = messageInfo;

  if (!fullText.includes("bom")) return true;

  if (isUserPlaying(remoteJid)) {
    await sock.sendMessage(
      remoteJid,
      { text: mess.game.isPlaying },
      { quoted: message }
    );
    return;
  }

  // Cek Cooldown
  const now = Date.now();
  if (cooldowns[remoteJid] && now - cooldowns[remoteJid] < COOLDOWN_TIME) {
    const sisaWaktu = cooldowns[remoteJid] + COOLDOWN_TIME - now;
    const menit = Math.floor(sisaWaktu / 60000);
    const detik = Math.floor((sisaWaktu % 60000) / 1000);

    return await sock.sendMessage(
      remoteJid,
      { text: `⏳ *Jeda Bermain*\n\nHarap tunggu *${menit} menit ${detik} detik* lagi sebelum bermain Tebak Bom kembali.\n\n_🚫 Mohon untuk tidak melakukan spam command agar bot tetap stabil._` },
      { quoted: message }
    );
  }

  const buah = [
    "🍏", "🍎", "🍐", "🍊", "🍋", "🍉",
    "🍇", "🍓", "🍒", "🍑", "🥭", "🍅",
  ];

  const acakArray = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  };

  const tambahBom = (grid) => {
    const posisiBom = Math.floor(Math.random() * 9);
    grid[Math.floor(posisiBom / 3)][posisiBom % 3] = "💣";
    return posisiBom + 1;
  };

  const grid = [
    acakArray(buah.slice(0, 3)),
    acakArray(buah.slice(3, 6)),
    acakArray(buah.slice(6, 9)),
  ];

  const posisiBomReal = tambahBom(grid);
  const bomView_User = `1️⃣ 2️⃣ 3️⃣\n4️⃣ 5️⃣ 6️⃣\n7️⃣ 8️⃣ 9️⃣`;
  const bomView_User_Abjad = `A B C D E F G H I`;

  // Update Cooldown
  cooldowns[remoteJid] = now;

  addUser(remoteJid, {
    posisiBom: posisiBomReal,
    terjawab: [],
    ListBuah: grid,
    bomView_User: bomView_User_Abjad,
    hadiah: 5, 
    moneyMenang: 10,
    moneyKalah: 25, 
    command: fullText,
  });

  logWithTime("Tebak Bom", `Posisibom : ${posisiBomReal}`);

  await sock.sendMessage(
    remoteJid,
    { text: `_*Tebak Bom Dimulai*_\n\n${bomView_User}` },
    { quoted: message }
  );
}

export default {
  handle,
  Commands: ["tebakbom"],
  OnlyPremium: false,
  OnlyOwner: false,
};