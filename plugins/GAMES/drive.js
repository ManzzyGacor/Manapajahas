import config from "../../config.js";

import { logCustom } from "../../lib/logger.js";

// Ganti dengan domain atau IP server bot Anda

const GAME_URL = "https://domain-bot-kamu.com/game/drive";

async function handle(sock, messageInfo) {

  const { remoteJid, message, command } = messageInfo;

  try {

    const text = 

`🏎️ *3D CITY DRIVE ARENA* 🏎️

🎮 *Mode:* Synthwave Retro Arcade

⚡ *Kontrol:* Geser layar atau tombol sentuh

Tekan banner di bawah untuk mulai bermain:

🔗 ${GAME_URL}`;

    await sock.sendMessage(

      remoteJid,

      {

        text,

        contextInfo: {

          externalAdReply: {

            title: "3D CITY DRIVE • Play Now",

            body: "Sentuh untuk mengendalikan mobil langsung di layar",

            mediaType: 1,

            thumbnailUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500",

            renderLargerThumbnail: true,

            sourceUrl: GAME_URL, // In-app browser langsung terbuka saat banner diklik

          },

        },

      },

      { quoted: message }

    );

  } catch (error) {

    logCustom("info", error.message, `ERROR-COMMAND-${command}.txt`);

    await sock.sendMessage(

      remoteJid,

      { text: `Gagal memuat game: ${error.message}` },

      { quoted: message }

    );

  }

}

export default {

  handle,

  Commands: ["drive"],

  OnlyPremium: false,

  OnlyOwner: false,

  limitDeduction: 1,

};