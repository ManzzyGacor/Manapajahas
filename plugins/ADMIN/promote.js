import mess from "../../strings.js";
import { determineUser, convertToJid } from "../../lib/utils.js";
import { getGroupMetadata } from "../../lib/cache.js";

async function handle(sock, messageInfo) {
  const {
    remoteJid,
    isGroup,
    message,
    sender,
    mentionedJid,
    content,
    isQuoted,
    prefix,
    command,
  } = messageInfo;
  
  if (!isGroup) return; // Only Grub

  try {
    // Mendapatkan metadata grup
    const groupMetadata = await getGroupMetadata(sock, remoteJid);
    const participants = groupMetadata.participants;
    
    // Validasi apakah PENGIRIM PESAN adalah admin
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

    // Menentukan pengguna yang di-tag / reply
    let userToAction = determineUser(mentionedJid, isQuoted, content);
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

    // 🔥 FIX LID BUG: Konversi ke nomor asli jika terdeteksi sebagai @lid
    if (userToAction.endsWith("@lid")) {
      const resolvedJid = await convertToJid(sock, userToAction);
      if (resolvedJid) {
        userToAction = resolvedJid;
      }
    }

    // Pastikan berakhiran JID WhatsApp yang benar jika belum ada
    if (!userToAction.includes("@")) {
      userToAction = `${userToAction}@s.whatsapp.net`;
    }

    // Proses promote
    await sock.groupParticipantsUpdate(remoteJid, [userToAction], "promote");

    // 🔥 FIX TAG TEXT: Gunakan native sendMessage Baileys agar tidak muncul angka random
    const cleanNumber = userToAction.split("@")[0];
    await sock.sendMessage(
      remoteJid,
      {
        text: `@${cleanNumber} Telah Menjadi admin grub`,
        mentions: [userToAction]
      },
      { quoted: message }
    );
    
  } catch (error) {
    console.error("Error in promote command:", error);

    // Kirim pesan kesalahan
    await sock.sendMessage(
      remoteJid,
      { text: "⚠️ Terjadi kesalahan saat mencoba menaikkan menjadi admin." },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["promote"],
  OnlyPremium: false,
  OnlyOwner: false,
};