import mess from "../../strings.js";
import { addFiturBlock } from "../../lib/group.js";
import { getGroupMetadata } from "../../lib/cache.js";

async function handle(sock, messageInfo) {
  const { remoteJid, isGroup, message, sender, content, prefix, command } = messageInfo;

  if (!isGroup) return; // Only Grub

  // Mendapatkan metadata grup
  const groupMetadata = await getGroupMetadata(sock, remoteJid);
  const participants = groupMetadata.participants;
  const isAdmin = participants.some((p) => (p.phoneNumber === sender || p.id === sender) && p.admin);
  
  if (!isAdmin) {
    await sock.sendMessage(remoteJid, { text: mess.general.isAdmin }, { quoted: message });
    return;
  }

  if (!content) {
    return await sock.sendMessage(
      remoteJid,
      { text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${prefix + command} pin*_` },
      { quoted: message }
    );
  }

  try {
    await addFiturBlock(remoteJid, content.trim());
    await sock.sendMessage(
      remoteJid,
      { text: `_Fitur *${content}* Berhasil di ban untuk grub ini_\n\n_Untuk membuka fitur ketik *.unbanfitur*_` },
      { quoted: message }
    );
  } catch (error) {
    console.log(error);
    await sock.sendMessage(
      remoteJid,
      { text: `❌ _Tidak dapat ban fitur_ *${content}*` },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["banfitur"],
  OnlyPremium: false,
  OnlyOwner: false,
};