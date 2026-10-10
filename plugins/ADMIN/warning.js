const batasPeringatan = 3;

import mess from "../../strings.js";
import { getGroupMetadata } from "../../lib/cache.js";
import { determineUser } from "../../lib/utils.js";

// Warning list disimpan di memori (RAM)
const warningList = {};

async function handle(sock, messageInfo) {
  const { remoteJid, isGroup, message, sender, content, prefix, command, mentionedJid, isQuoted } = messageInfo;

  if (!isGroup) return;

  const groupMetadata = await getGroupMetadata(sock, remoteJid);
  const participants = groupMetadata.participants;
  const isAdmin = participants.some((p) => (p.phoneNumber === sender || p.id === sender) && p.admin);

  if (!isAdmin) {
    await sock.sendMessage(remoteJid, { text: mess.general.isAdmin }, { quoted: message });
    return;
  }

  // Debug internal RAM warning list
  if (command === "debugwarn") {
    console.log("🔧 Debug warningList:", warningList);
    return await sock.sendMessage(
      remoteJid,
      { text: "📦 Debug log dikirim ke console." },
      { quoted: message }
    );
  }

  // Menampilkan daftar warning
  if (command === "listwarning" || command === "listwarn") {
    let warningText = "⚠️ *Daftar Peringatan:*\n\n";
    let mentions = [];
    let found = false;

    for (const user in warningList) {
      if (warningList[user] > 0) {
        // Membersihkan format LID
        const cleanNumber = user.split("@")[0].split(":")[0];
        warningText += `👤 @${cleanNumber}: ${warningList[user]}/${batasPeringatan} peringatan\n`;
        mentions.push(user);
        found = true;
      }
    }

    if (!found) warningText = "✅ Tidak ada pengguna yang memiliki peringatan.";

    await sock.sendMessage(
      remoteJid,
      { text: warningText, mentions: mentions },
      { quoted: message }
    );
    return;
  }

  // Menghapus warning user
  if (command === "deletewarning" || command === "delwarning") {
    const userToDelete = determineUser(mentionedJid, isQuoted, content);
    if (!userToDelete) {
      return await sock.sendMessage(
        remoteJid,
        { text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ *${prefix + command} 628xxxx*` },
        { quoted: message }
      );
    }

    const cleanNumber = userToDelete.split("@")[0].split(":")[0];

    if (warningList[userToDelete]) {
      delete warningList[userToDelete];
      await sock.sendMessage(
        remoteJid,
        { 
          text: `✅ Peringatan untuk @${cleanNumber} telah dihapus.`, 
          mentions: [userToDelete] 
        },
        { quoted: message }
      );
    } else {
      await sock.sendMessage(
        remoteJid,
        { 
          text: `❌ @${cleanNumber} tidak memiliki peringatan.`, 
          mentions: [userToDelete] 
        },
        { quoted: message }
      );
    }
    return;
  }

  // Jika command warn
  if (command === "warn" || command === "warning") {
    const userToWarn = determineUser(mentionedJid, isQuoted, content);
    if (!userToWarn) {
      return await sock.sendMessage(
        remoteJid,
        { text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ *${prefix + command} 628xxxx*` },
        { quoted: message }
      );
    }

    const whatsappJid = userToWarn;
    const cleanNumber = whatsappJid.split("@")[0].split(":")[0];

    try {
      warningList[whatsappJid] = (warningList[whatsappJid] || 0) + 1;

      if (warningList[whatsappJid] >= batasPeringatan) {
        await sock.sendMessage(
          remoteJid,
          { 
            text: `❌ _@${cleanNumber} telah mencapai batas peringatan dan akan dikeluarkan dari grup._`, 
            mentions: [whatsappJid] 
          },
          { quoted: message }
        );
        await sock.groupParticipantsUpdate(remoteJid, [whatsappJid], "remove");
        delete warningList[whatsappJid];
        return;
      }

      await sock.sendMessage(
        remoteJid,
        { 
          text: `⚠️ @${cleanNumber} telah diperingati (${warningList[whatsappJid]}/${batasPeringatan})`, 
          mentions: [whatsappJid] 
        },
        { quoted: message }
      );
    } catch (error) {
      await sock.sendMessage(
        remoteJid,
        { 
          text: `❌ _Tidak dapat memberikan warning ke nomor_ @${cleanNumber}`, 
          mentions: [whatsappJid] 
        },
        { quoted: message }
      );
    }
  }
}

export default {
  handle,
  Commands: [
    "warn",
    "warning",
    "listwarning",
    "listwarn",
    "deletewarning",
    "delwarning",
    "debugwarn",
  ],
  OnlyPremium: false,
  OnlyOwner: false,
};