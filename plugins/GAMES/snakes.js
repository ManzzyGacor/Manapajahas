const DATABASE = {}; // Simpan game di RAM

const MONEY_MENANG = 100;
const opsiLoading = "sticker"; 

import fs from "fs";
import path from "path";

import { getProfilePictureUrl } from "../../lib/cache.js";
import {
  getBuffer,
  sendMessageWithMention,
  sendImagesWithMention,
} from "../../lib/utils.js";
import { addUser, updateUser, deleteUser, findUser } from "../../lib/users.js";

// --- COOLDOWN SETUP ---
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 Menit
const cooldowns = {};

const snakes = {
  99: 41, 95: 76, 89: 53, 66: 45,
  54: 31, 43: 17, 40: 2, 27: 5,
};

const ladders = {
  4: 23, 13: 46, 33: 52, 42: 63,
  50: 69, 62: 81, 74: 93,
};

let pendingDelete = null;

async function kirimSticker(sock, remoteJid, namaFile, message) {
  try {
    const mediaPath = path.join(process.cwd(), "database/assets", namaFile);
    if (!fs.existsSync(mediaPath)) {
      throw new Error(`File tidak ditemukan: ${mediaPath}`);
    }
    const buffer = fs.readFileSync(mediaPath);
    await sock.sendMessage(
      remoteJid,
      { sticker: buffer },
      { quoted: message }
    );
  } catch (error) {
    console.error("Gagal mengirim stiker:", error.message);
  }
}

async function handle(sock, messageInfo) {
  const { remoteJid, sender, isGroup, message, content, senderType } = messageInfo;
  if (!isGroup) return;

  let game = DATABASE[remoteJid];
  
  // --- LOGIKA COOLDOWN SAAT BUAT GAME BARU ---
  // Jika game belum ada, kita cek cooldown sebelum membuatnya
  if (!game) {
    const now = Date.now();
    if (cooldowns[remoteJid] && now - cooldowns[remoteJid] < COOLDOWN_TIME) {
        const sisaWaktu = cooldowns[remoteJid] + COOLDOWN_TIME - now;
        const menit = Math.floor(sisaWaktu / 60000);
        const detik = Math.floor((sisaWaktu % 60000) / 1000);

        return await sock.sendMessage(
            remoteJid,
            { text: `⏳ *Jeda Bermain*\n\nHarap tunggu *${menit} menit ${detik} detik* lagi sebelum memulai sesi Ular Tangga baru.\n\n_🚫 Mohon untuk tidak melakukan spam command agar bot tetap stabil._` },
            { quoted: message }
        );
    }
  }

  if (!game) {
    game = {
      players: [],
      started: false,
      turnIndex: 0,
      positions: {},
    };
    DATABASE[remoteJid] = game;
  }

  const command = content?.toLowerCase();

  if (!content) {
    let infoText = "🎮 *Info Game Ular Tangga*\n";

    if (game.players.length === 0) {
      infoText += "👥 Belum ada pemain yang bergabung.\n";
    } else {
      const playerList = game.players
        .map(
          (p, i) =>
            `${i + 1}. @${p.split("@")[0]}${
              i === game.turnIndex && game.started ? " 🔄 (giliran)" : ""
            }`
        )
        .join("\n");
      infoText += `👥 Pemain (${game.players.length}/10):\n${playerList}\n`;
    }

    infoText += `\nStatus: ${game.started ? "🟢 Dimulai" : "🔴 Belum dimulai"}`;
    infoText += `\n\n✅ Gunakan *.snakes join* untuk bergabung\n🚀 Gunakan *.snakes start* untuk memulai game\ndan *.snakes reset* untuk mereset permainan`;

    return await sendMessageWithMention(
      sock,
      remoteJid,
      infoText,
      message,
      senderType
    );
  }

  // Join game
  if (command === "join") {
    if (game.started) {
      return await sock.sendMessage(
        remoteJid,
        { text: "⛔ Game sudah dimulai, tidak bisa bergabung lagi." },
        { quoted: message }
      );
    }
    if (game.players.includes(sender)) {
      return await sock.sendMessage(
        remoteJid,
        { text: "⚠️ Kamu sudah bergabung." },
        { quoted: message }
      );
    }
    if (game.players.length >= 10) {
      return await sock.sendMessage(
        remoteJid,
        { text: "🚫 Maksimal 10 pemain sudah tercapai." },
        { quoted: message }
      );
    }

    game.players.push(sender);
    game.positions[sender] = 1;
    return await sendMessageWithMention(
      sock,
      remoteJid,
      `✅ @${sender.split("@")[0]} berhasil bergabung. Total pemain: ${
        game.players.length
      }`,
      message,
      senderType
    );
  }

  // Start game
  if (command === "start") {
    if (game.started) {
      return await sock.sendMessage(
        remoteJid,
        { text: "🟡 Game sudah dimulai." },
        { quoted: message }
      );
    }
    if (game.players.length < 2) {
      return await sock.sendMessage(
        remoteJid,
        { text: "❌ Minimal 2 pemain untuk memulai permainan." },
        { quoted: message }
      );
    }
    
    // Game resmi dimulai, set cooldown untuk sesi berikutnya (setelah game ini selesai/reset)
    // Cooldown di sini akan efektif setelah game dihapus dari RAM
    cooldowns[remoteJid] = Date.now(); 

    game.started = true;
    game.turnIndex = 0;
    return await sendMessageWithMention(
      sock,
      remoteJid,
      `🎲 Permainan dimulai!\nGiliran pertama: @${
        game.players[0].split("@")[0]
      } ketik ".snakes play" untuk lempar dadu.`,
      message,
      senderType
    );
  }

  // Play (lempar dadu)
  if (command === "play") {
    if (!game.started) {
      return await sock.sendMessage(
        remoteJid,
        { text: "❌ Game belum dimulai. Ketik .snakes join dan .snakes start" },
        { quoted: message }
      );
    }

    if (game.players[game.turnIndex] !== sender) {
      return await sendMessageWithMention(
        sock,
        remoteJid,
        `🔄 Bukan giliranmu. Sekarang giliran: @${
          game.players[game.turnIndex].split("@")[0]
        }`,
        message,
        senderType
      );
    }

    const dice = Math.floor(Math.random() * 6) + 1;
    let posBefore = game.positions[sender];
    game.positions[sender] += dice;

    if (game.positions[sender] > 100) {
      const overflow = game.positions[sender] - 100;
      game.positions[sender] = 100 - overflow;
    }

    let moveInfo = "";
    if (snakes[game.positions[sender]]) {
      game.positions[sender] = snakes[game.positions[sender]];
      moveInfo = "🐍 Kena ular! Turun";
    } else if (ladders[game.positions[sender]]) {
      game.positions[sender] = ladders[game.positions[sender]];
      moveInfo = "🪜 Naik tangga!";
    }

    if (game.positions[sender] === 100) {
      delete DATABASE[remoteJid];
      // Set Cooldown lagi saat game selesai
      cooldowns[remoteJid] = Date.now();

      const user = await findUser(sender);
      if (user) {
        const [docId, userData] = user;
        const moneyAdd = (userData.money || 0) + MONEY_MENANG;
        await updateUser(sender, { money: moneyAdd });
      }

      return await sendMessageWithMention(
        sock,
        remoteJid,
        `🏆 @${
          sender.split("@")[0]
        } menang! 🎉🎉\n\nAnda Dapat ${MONEY_MENANG} Money `,
        message,
        senderType
      );
    }

    game.turnIndex = (game.turnIndex + 1) % game.players.length;
    DATABASE[remoteJid] = game;

    const params = new URLSearchParams();
    for (let player of game.players) {
      const pp = await getProfilePictureUrl(sock, player);
      params.append("pp", pp);
      params.append("positions", game.positions[player] || 1);
    }

    const API_URL = `https://api.autoresbot.com/api/maker/ulartangga?${params.toString()}`;

    try {
      if (opsiLoading == "emoticon") {
        await sock.sendMessage(remoteJid, {
          react: { text: "🎲", key: message.key },
        });
      } else if (opsiLoading == "sticker") {
        await kirimSticker(sock, remoteJid, `${dice}.webp`, message);
      }

      const buffer = await getBuffer(API_URL);

      const customizedMessage = `🎲 @${
        sender.split("@")[0]
      } melempar dadu: ${dice}\n📍 Posisi sekarang: ${
        game.positions[sender]
      } ${moveInfo}\n➡️ Giliran selanjutnya: @${
        game.players[game.turnIndex].split("@")[0]
      }`;

      const result = await sendImagesWithMention(
        sock,
        remoteJid,
        buffer,
        customizedMessage,
        message,
        senderType
      );

      if (result) {
        if (pendingDelete) {
          await sock.sendMessage(remoteJid, {
            delete: {
              remoteJid: remoteJid,
              fromMe: true,
              id: pendingDelete,
              participant: undefined, 
            },
          });
        }
        pendingDelete = result?.key?.id;
      }
    } catch (err) {
      console.error(err);
      await sock.sendMessage(
        remoteJid,
        { text: "❌ Gagal mengambil gambar papan dari api." },
        { quoted: message }
      );
    }
  }

  // Reset game
  if (command === "reset") {
    if (game.players.length === 0 && !game.started) {
      return await sock.sendMessage(
        remoteJid,
        {
          text: "⚠️ Tidak ada permainan yang sedang berlangsung untuk direset.",
        },
        { quoted: message }
      );
    }

    delete DATABASE[remoteJid];
    // Set Cooldown saat reset
    cooldowns[remoteJid] = Date.now();
    return await sock.sendMessage(
      remoteJid,
      {
        text: "✅ Permainan direset. Gunakan *.snakes join* untuk memulai lagi.",
      },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["snakes"],
  OnlyPremium: false,
  OnlyOwner: false,
};