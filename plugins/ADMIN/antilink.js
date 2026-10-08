import mess from "../../strings.js";
import { getGroupMetadata } from "../../lib/cache.js";

async function sendMessage(sock, remoteJid, text, message) {
  try {
    await sock.sendMessage(remoteJid, { text }, { quoted: message });
  } catch (error) {
    console.error(`Failed to send message: ${error.message}`);
  }
}

async function handle(sock, messageInfo) {
  const { remoteJid, isGroup, message, sender, command } = messageInfo;

  if (!isGroup) {
    await sendMessage(sock, remoteJid, mess.general.isGroup, message);
    return;
  }

  try {
    // Mendapatkan metadata grup
    const groupMetadata = await getGroupMetadata(sock, remoteJid);
    const participants = groupMetadata.participants;
    const isAdmin = participants.some(
      (p) => (p.phoneNumber === sender || p.id === sender) && p.admin
    );

    if (!isAdmin) {
      await sendMessage(sock, remoteJid, mess.general.isAdmin, message);
      return;
    }

    const responseText = `
✨ *Group Protection Mode* ✨
━━━━━━━━━━━━━━━━

Silakan pilih level keamanan grup kamu dengan mengetik:
👉 *.on ${command}*

📂 *Menu Pilihan:*

🔒 *Proteksi Semua Link*
✦ *antilink* : Hapus chat
✦ *antilinkv2* : Hapus chat & Kick 

🔰 *Proteksi Link WA Saja*
✦ *antilinkwa* : Hapus chat
✦ *antilinkwav2* : Hapus chat & Kick 

contoh penggunaan: .on antilink
━━━━━━━━━━━━━━━━
_Pastikan bot sudah menjadi Admin._
`;
    await sendMessage(sock, remoteJid, responseText.trim(), message);
  } catch (error) {
    console.error(`Error in handle function: ${error.message}`);
  }
}

export default {
  handle,
  Commands: ["antilink"],
  OnlyPremium: false,
  OnlyOwner: false,
};
