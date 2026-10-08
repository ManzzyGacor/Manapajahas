import mess from "../../strings.js";
import config from "../../config.js";
import { getGroupMetadata } from "../../lib/cache.js";
import { determineUser } from "../../lib/utils.js";
import { sendImageAsSticker } from "../../lib/exif.js"; // Import untuk fungsi stiker
import axios from "axios"; // Import untuk download stiker

// URL stiker yang diminta
const KICK_STICKER_URL = "https://raw.githubusercontent.com/ManzzyGacor/Urlmanzzy/main/file_1763913870746_984.webp";


async function handle(sock, messageInfo) {
  const {
    remoteJid,
    isGroup,
    message,
    sender,
    mentionedJid,
    isQuoted,
    content,
    prefix,
    command,
  } = messageInfo;
  
  if (!isGroup) return; // Only Grub
  
  try {
    // Mendapatkan metadata grup
    const groupMetadata = await getGroupMetadata(sock, remoteJid);
    const participants = groupMetadata.participants;

    // Pengecekan Admin Pengguna
    const isAdmin = participants.some(
      (p) => (p.phoneNumber === sender || p.id === sender) && p.admin
    );

    if (!isAdmin) {
      await sock.sendMessage(
        remoteJid,
        { text: mess.general.isAdmin },
        { quoted: message }
      );
      return;
    }

    // Menentukan pengguna
    const userToAction = determineUser(mentionedJid, isQuoted, content);
    if (!userToAction) {
      return await sock.sendMessage(
        remoteJid,
        {
          text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${
            prefix + command
          } @NAME*_`,
        },
        { quoted: message }
      );
    }

    const targetNumber = userToAction.split("@")[0];

    if (targetNumber === config.phone_number_bot) {
      return await sock.sendMessage(
        remoteJid,
        { text: `⚠️ _Tidak dapat kick nomor sendiri_` },
        { quoted: message }
      );
    }

    // **PERHATIAN: Pengecekan Admin Bot Dihilangkan Sesuai Permintaan**

    // Mengeluarkan pengguna dari grup
    const kickResult = await sock.groupParticipantsUpdate(
      remoteJid,
      [userToAction],
      "remove"
    );
    
    // Blok Sukses: Tambahkan Stiker
    if (kickResult && mess.action.user_kick) {
        
        // 1. Kirim pesan teks sukses (menggunakan mess.action.user_kick)
        await sock.sendMessage(
            remoteJid,
            { text: mess.action.user_kick, mentions: [userToAction] }, // Ditambahkan mentions untuk tag
            { quoted: message }
        );
        
        // 2. Download stiker
        const stickerBuffer = await axios.get(KICK_STICKER_URL, { responseType: 'arraybuffer' }).then(res => res.data).catch(() => null);

        // 3. Kirim stiker
        if (stickerBuffer) {
            await sendImageAsSticker(
                sock, 
                remoteJid, 
                stickerBuffer, 
                { packname: "Varesa", author: "Kicked" },
                message 
            );
        }
        
        return;
    }


  } catch (error) {
    console.error("Error handling kick:", error);
    await sock.sendMessage(
      remoteJid,
      {
        text: "⚠️ Terjadi kesalahan saat mencoba mengeluarkan pengguna. Pastikan bot memiliki izin.",
      },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["kick", "dor"],
  OnlyPremium: false,
  OnlyOwner: false,
};