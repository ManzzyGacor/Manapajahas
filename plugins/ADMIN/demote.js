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
    let userToDemote = determineUser(mentionedJid, isQuoted, content);
    if (!userToDemote) {
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
    if (userToDemote.endsWith("@lid")) {
      const resolvedJid = await convertToJid(sock, userToDemote);
      if (resolvedJid) {
        userToDemote = resolvedJid;
      }
    }

    // Pastikan berakhiran JID WhatsApp yang benar jika belum ada
    if (!userToDemote.includes("@")) {
      userToDemote = `${userToDemote}@s.whatsapp.net`;
    }

    // Proses demote
    await sock.groupParticipantsUpdate(remoteJid, [userToDemote], "demote");

    // 🔥 FIX TAG TEXT: Gunakan native sendMessage Baileys agar tidak muncul angka random
    const cleanNumber = userToDemote.split("@")[0];
    await sock.sendMessage(
      remoteJid,
      {
        text: `@${cleanNumber} _telah diturunkan dari admin._`,
        mentions: [userToDemote]
      },
      { quoted: message }
    );
    
  } catch (error) {
    console.error("Error in demote command:", error);

    // Kirim pesan kesalahan
    await sock.sendMessage(
      remoteJid,
      { text: "⚠️ Terjadi kesalahan saat mencoba menurunkan admin." },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["demote"],
  OnlyPremium: false,
  OnlyOwner: false,
};