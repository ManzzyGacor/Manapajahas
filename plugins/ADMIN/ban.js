import mess from "../../strings.js";
import { addUserBlock } from "../../lib/group.js";
import { getGroupMetadata } from "../../lib/cache.js";
import { determineUser } from "../../lib/utils.js";

async function handle(sock, messageInfo) {
  const { remoteJid, isGroup, message, sender, isQuoted, content, prefix, command, mentionedJid } = messageInfo;

  if (!isGroup) return; // Only Grub

  // Mendapatkan metadata grup
  const groupMetadata = await getGroupMetadata(sock, remoteJid);
  const participants = groupMetadata.participants;
  const isAdmin = participants.some((p) => (p.phoneNumber === sender || p.id === sender) && p.admin);
  
  if (!isAdmin) {
    await sock.sendMessage(remoteJid, { text: mess.general.isAdmin }, { quoted: message });
    return;
  }

  // Menentukan pengguna yang akan dikeluarkan
  const userToBan = determineUser(mentionedJid, isQuoted, content);
  if (!userToBan) {
    return await sock.sendMessage(
      remoteJid,
      { text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${prefix + command} 6285246154386*_` },
      { quoted: message }
    );
  }

  const whatsappJid = userToBan;
  // Memisahkan LID / perangkat tertaut agar tag berfungsi normal
  const cleanNumber = whatsappJid.split("@")[0].split(":")[0];

  try {
    await addUserBlock(remoteJid, whatsappJid);
    await sock.sendMessage(
      remoteJid,
      { 
        text: `✅ @${cleanNumber} _Berhasil di ban untuk grub ini_`, 
        mentions: [whatsappJid] 
      },
      { quoted: message }
    );
  } catch (error) {
    console.log(error);
    await sock.sendMessage(
      remoteJid,
      { 
        text: `❌ _Tidak dapat ban nomor_ @${cleanNumber}`, 
        mentions: [whatsappJid] 
      },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["ban"],
  OnlyPremium: false,
  OnlyOwner: false,
};