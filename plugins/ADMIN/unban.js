import mess from "../../strings.js";
import { removeUserFromBlock } from "../../lib/group.js";
import { getGroupMetadata } from "../../lib/cache.js";
import { determineUser } from "../../lib/utils.js";

async function handle(sock, messageInfo) {
  const { remoteJid, isGroup, message, sender, content, prefix, command, mentionedJid, isQuoted } = messageInfo;

  if (!isGroup) return; // Only Grub

  // Mendapatkan metadata grup
  const groupMetadata = await getGroupMetadata(sock, remoteJid);
  const participants = groupMetadata.participants;
  const isAdmin = participants.some((p) => (p.phoneNumber === sender || p.id === sender) && p.admin);
  
  if (!isAdmin) {
    await sock.sendMessage(remoteJid, { text: mess.general.isAdmin }, { quoted: message });
    return;
  }

  // Menentukan pengguna
  const userToBan = determineUser(mentionedJid, isQuoted, content);
  if (!userToBan) {
    return await sock.sendMessage(
      remoteJid,
      { text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${prefix + command} 6285246154386*_` },
      { quoted: message }
    );
  }
  
  const whatsappJid = userToBan;
  const cleanNumber = whatsappJid.split("@")[0].split(":")[0];

  try {
    const result = await removeUserFromBlock(remoteJid, whatsappJid);
    if (result) {
      await sock.sendMessage(
        remoteJid,
        { 
          text: `✅ @${cleanNumber} _Berhasil di unban untuk grub ini_`, 
          mentions: [whatsappJid] 
        },
        { quoted: message }
      );
    } else {
      await sock.sendMessage(
        remoteJid,
        { 
          text: `⚠️ @${cleanNumber} _Tidak di temukan di list ban_`, 
          mentions: [whatsappJid] 
        },
        { quoted: message }
      );
    }
  } catch (error) {
    console.log(error);
    await sock.sendMessage(
      remoteJid,
      { 
        text: `❌ _Tidak dapat unban nomor_ @${cleanNumber}`, 
        mentions: [whatsappJid] 
      },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["unban"],
  OnlyPremium: false,
  OnlyOwner: false,
};