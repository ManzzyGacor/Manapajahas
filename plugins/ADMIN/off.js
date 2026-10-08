import { findGroup, updateGroup } from "../../lib/group.js";
import { getGroupMetadata } from "../../lib/cache.js";
import { updateSocket } from "../../lib/scheduled.js";
import mess from "../../strings.js";

const icon_on = "🟢";
const icon_off = "🔴";

const THUMBNAIL_URL = "https://autoresbot.com/tmp_files/67b73161-58c2-4f3b-bf19-326c8232079f.jpg"; 
const SOURCE_URL = "https://sewa.manzzy.web.id"; 

const formatFeatureStatus = (status) => (status ? icon_on : icon_off);

const featureList = [
  { name: "antilink", label: "ᴀɴᴛɪʟɪɴᴋ", cat: "Anti & Security" },
  { name: "antilinkv2", label: "ᴀɴᴛɪʟɪɴᴋᴠ2", cat: "Anti & Security" },
  { name: "antilinkwa", label: "ᴀɴᴛɪʟɪɴᴋᴡᴀ", cat: "Anti & Security" },
  { name: "antilinkwav2", label: "ᴀɴᴛɪʟɪɴᴋᴡᴀᴠ2", cat: "Anti & Security" },
  { name: "antilinkch", label: "ᴀɴᴛɪʟɪɴᴋᴄʜ", cat: "Anti & Security" },
  { name: "antilinkchv2", label: "ᴀɴᴛɪʟɪɴᴋᴄʜᴠ2", cat: "Anti & Security" },
  { name: "antidelete", label: "ᴀɴᴛɪᴅᴇʟᴇᴛᴇ", cat: "Anti & Security" },
  { name: "antiedit", label: "ᴀɴᴛɪᴇᴅɪᴛ", cat: "Anti & Security" },
  { name: "antigame", label: "ᴀɴᴛɪɢᴀᴍᴇ", cat: "Anti & Security" },
  { name: "antifoto", label: "ᴀɴᴛɪғᴏᴛᴏ", cat: "Anti & Security" },
  { name: "antivideo", label: "ᴀɴᴛɪᴠɪᴅᴇᴏ", cat: "Anti & Security" },
  { name: "antiaudio", label: "ᴀɴᴛɪᴀᴜᴅɪᴏ", cat: "Anti & Security" },
  { name: "antidocument", label: "ᴀɴᴛɪᴅᴏᴄᴜᴍᴇɴᴛ", cat: "Anti & Security" },
  { name: "antikontak", label: "ᴀɴᴛɪᴋᴏɴᴛᴀᴋ", cat: "Anti & Security" },
  { name: "antisticker", label: "ᴀɴᴛɪsᴛɪᴄᴋᴇʀ", cat: "Anti & Security" },
  { name: "antipolling", label: "ᴀɴᴛɪᴘᴏʟʟɪɴɢ", cat: "Anti & Security" },
  { name: "antispamchat", label: "ᴀɴᴛɪsᴘᴀᴍᴄʜᴀᴛ", cat: "Anti & Security" },
  { name: "antivirtex", label: "ᴀɴᴛɪᴠɪʀᴛᴇx", cat: "Anti & Security" },
  { name: "badword", label: "ʙᴀᴅᴡᴏʀᴅ", cat: "Anti & Security" },
  { name: "badwordv2", label: "ʙᴀᴅᴡᴏʀᴅv2", cat: "Anti & Security" },
  { name: "badwordv3", label: "ʙᴀᴅᴡᴏʀᴅv3", cat: "Anti & Security" },
  { name: "detectblacklist", label: "ᴅᴇᴛᴇᴄᴛʙʟᴀᴄᴋʟɪꜱᴛ", cat: "Anti & Security" },
  { name: "detectblacklist2", label: "ᴅᴇᴛᴇᴄᴛʙʟᴀᴄᴋʟɪꜱᴛ2", cat: "Anti & Security" },
  { name: "antibot", label: "ᴀɴᴛɪʙᴏᴛ", cat: "Anti & Security" },
  { name: "antitagsw", label: "ᴀɴᴛɪᴛᴀɢꜱᴡ", cat: "Anti & Security" },
  { name: "antitagsw2", label: "ᴀɴᴛɪᴛᴀɢꜱᴡ2", cat: "Anti & Security" },
  { name: "antiswgc", label: "ᴀɴᴛɪꜱᴡɢᴄ", cat: "Anti & Security" },
  { name: "antitagmeta", label: "ᴀɴᴛɪᴛᴀɢᴍᴇᴛᴀ", cat: "Anti & Security" },
  { name: "antitagmeta2", label: "ᴀɴᴛɪᴛᴀɢᴍᴇᴛᴀ2", cat: "Anti & Security" },
  { name: "antiforward", label: "ᴀɴᴛɪꜰᴏʀᴡᴀʀᴅ", cat: "Anti & Security" },
  { name: "antiforward2", label: "ᴀɴᴛɪꜰᴏʀᴡᴀʀᴅ2", cat: "Anti & Security" },
  { name: "antihidetag", label: "ᴀɴᴛɪʜɪᴅᴇᴛᴀɢ", cat: "Anti & Security" },
  { name: "antihidetag2", label: "ᴀɴᴛɪʜɪᴅᴇᴛᴀɢ2", cat: "Anti & Security" },
  { name: "autoai", label: "ᴀᴜᴛᴏᴀɪ", cat: "Bot & Automation" },
  { name: "autosimi", label: "ᴀᴜᴛᴏsɪᴍɪ", cat: "Bot & Automation" },
  { name: "autorusuh", label: "ᴀᴜᴛᴏʀᴜꜱᴜʜ", cat: "Bot & Automation" },
  { name: "demote", label: "ᴅᴇᴍᴏᴛᴇ", cat: "Group Utility" },
  { name: "left", label: "ʟᴇғᴛ", cat: "Group Utility" },
  { name: "promote", label: "ᴘʀᴏᴍᴏᴛᴇ", cat: "Group Utility" },
  { name: "welcome", label: "ᴡᴇʟᴄᴏᴍᴇ", cat: "Group Utility" },
  { name: "waktusholat", label: "ᴡᴀᴋᴛᴜꜱʜᴏʟᴀᴛ", cat: "Group Utility" },
  { name: "onlyadmin", label: "ᴏɴʟʏᴀᴅᴍɪɴ", cat: "Group Utility" },
];

const createTemplate = (fitur, prefix, command) => {
  let template = `╭───「 🚫 *GROUP SETTINGS - OFF* 」
│ 
│ 📌 *Perintah Deaktivasi:*
│ ▹ *${prefix}${command} <fitur>*
│ ▹ _Contoh:_ *${prefix}${command} antilink*
│ 
├─「 🛡️ *ANTI & SECURITY* 」\n`;

  featureList.filter(f => f.cat === "Anti & Security").forEach(({ name, label }) => {
    template += `│ ⭔ [${formatFeatureStatus(fitur[name])}] ${label}\n`;
  });

  template += `│\n├─「 🤖 *BOT & AUTOMATION* 」\n`;
  featureList.filter(f => f.cat === "Bot & Automation").forEach(({ name, label }) => {
    template += `│ ⭔ [${formatFeatureStatus(fitur[name])}] ${label}\n`;
  });

  template += `│\n├─「 🛠️ *GROUP UTILITY* 」\n`;
  featureList.filter(f => f.cat === "Group Utility").forEach(({ name, label }) => {
    template += `│ ⭔ [${formatFeatureStatus(fitur[name])}] ${label}\n`;
  });

  template += `│ 
├─「 📝 *KETERANGAN* 」
│ ${icon_on} = Aktif
│ ${icon_off} = Tidak Aktif
╰──────────────⳹`.trim();

  return template;
};

const deactivateFeature = async (remoteJid, featureName, currentStatus) => {
  if (!currentStatus) {
    return `⚠️ _Fitur *${featureName}* sudah Nonaktif sebelumnya._`;
  }

  const updateData = { fitur: { [featureName]: false } };
  await updateGroup(remoteJid, updateData);
  
  let successText = `❌ Fitur *${featureName.toUpperCase()}* berhasil **DINONAKTIFKAN**!`;

  return {
    text: successText,
    contextInfo: {
        externalAdReply: {
            title: `⚙️ Fitur Dinonaktifkan`,
            body: `Fitur ${featureName.toUpperCase()} sudah dimatikan.`,
            thumbnailUrl: THUMBNAIL_URL,
            sourceUrl: SOURCE_URL,
            mediaType: 1, 
            renderLargerThumbnail: true
        }
    }
  };
};

async function handle(sock, messageInfo) {
  const { remoteJid, isGroup, message, content, sender, prefix, command } = messageInfo; 
  if (!isGroup) return; 

  try {
    const groupMetadata = await getGroupMetadata(sock, remoteJid);
    const participants = groupMetadata.participants;
    
    const isAdmin = participants.some(
      (p) => (p.phoneNumber === sender || p.id === sender) && p.admin
    );

    if (!isAdmin) {
      await sock.sendMessage(remoteJid, { text: mess.general.isAdmin }, { quoted: message });
      return;
    }

    const dataGrub = await findGroup(remoteJid);
    if (!dataGrub) {
      return await sock.sendMessage(remoteJid, { text: "⚠️ _Data grup tidak ditemukan. Bot mungkin belum terdaftar._" }, { quoted: message });
    }

    const rawArgs = content?.trim() ? content.trim() : '';
    const arg = rawArgs.split(/\s+/)[0] || '';
    
    const feature = featureList.find(
      ({ name }) => arg.toLowerCase() === name.toLowerCase()
    );

    if (feature) {
      const currentStatus = dataGrub.fitur[feature.name] || false;
      const resultObject = await deactivateFeature(remoteJid, feature.name, currentStatus);

      if (feature.name.toLowerCase() == "waktusholat") {
        updateSocket(sock);
      }

      if (typeof resultObject === 'string') {
          return await sock.sendMessage(remoteJid, { text: resultObject }, { quoted: message });
      } else {
          return await sock.sendMessage(remoteJid, resultObject, { quoted: message });
      }
    }

    const template_onchat = createTemplate(dataGrub.fitur, prefix, command); 
    await sock.sendMessage(
      remoteJid,
      { 
        text: template_onchat,
        contextInfo: {
            externalAdReply: {
                title: "⚙️ Daftar Fitur Grup (Nonaktifkan)",
                body: `Total ${featureList.length} fitur tersedia.`,
                thumbnailUrl: THUMBNAIL_URL,
                sourceUrl: SOURCE_URL,
                mediaType: 1, 
                renderLargerThumbnail: true
            }
        }
      },
      { quoted: message }
    );
  } catch (error) {
    console.error("Error handling the message:", error);
    await sock.sendMessage(
      remoteJid,
      { text: "Terjadi kesalahan saat memproses perintah: " + error.message },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["off"],
  OnlyPremium: false,
  OnlyOwner: false,
};