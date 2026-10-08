import mess from "../../strings.js";
import { removeFiturFromBlock } from "../../lib/group.js";
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
    const result = await removeFiturFromBlock(remoteJid, content);
    if (result) {
      await sock.sendMessage(
        remoteJid,
        { text: `✅ _Fitur ${content} berhasil di aktifkan untuk grub ini_` },
        { quoted: message }
      );
    } else {
      await sock.sendMessage(
        remoteJid,
        { text: `⚠️ _*${content}* tidak di temukan di banfitur_` },
        { quoted: message }
      );
    }
  } catch (error) {
    console.log(error);
    await sock.sendMessage(
      remoteJid,
      { text: `❌ _Ada masalah saat mengaktifkan fitur ${content}_` },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["unbanfitur"],
  OnlyPremium: false,
  OnlyOwner: false,
};