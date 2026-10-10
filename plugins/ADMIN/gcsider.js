import { getTotalChatPerGroup } from "../../lib/totalchat.js";
import { getGroupMetadata } from "../../lib/cache.js";
import mess from "../../strings.js";

async function handle(sock, messageInfo) {
  const { remoteJid, isGroup, message, sender } = messageInfo;
  if (!isGroup) return;

  try {
    // 1. Ambil Metadata Grup
    const groupMetadata = await getGroupMetadata(sock, remoteJid);
    const participants = groupMetadata?.participants || [];

    // 2. Cek apakah pengirim admin
    const isAdmin = participants.some(
      (p) => (p.phoneNumber === sender || p.id === sender) && p.admin
    );

    if (!isAdmin) {
      return await sock.sendMessage(
        remoteJid,
        { text: mess.general.isAdmin },
        { quoted: message }
      );
    }

    // 3. Ambil data aktivitas chat di grup ini (menggunakan lib totalchat)
    const totalChatData = await getTotalChatPerGroup(remoteJid);

    const siderParticipants = [];
    const mentionedJids = [];
    const listDisplay = [];

    // 4. Cari member yang tidak ada di database chat grup (Sider)
    for (const participant of participants) {
      const jid = participant.phoneNumber || participant.id;
      const totalChat = totalChatData[jid] || 0;

      // Jika jumlah chatnya 0, berarti dia Sider
      if (totalChat === 0) {
        siderParticipants.push(participant);
        mentionedJids.push(jid); // Simpan JID asli (LID atau WA.net) untuk format Mentions

        // Ekstrak angka saja untuk tampilan text tag
        const cleanNumber = typeof jid === "string" ? jid.replace(/\D/g, "") : "unknown";
        listDisplay.push(`◧ @${cleanNumber}`);
      }
    }

    const countSider = siderParticipants.length;

    // 5. Cek apakah ada sider
    if (countSider === 0) {
      return await sock.sendMessage(
        remoteJid,
        { text: "📋 _Luar biasa! Tidak ada member sider di grup ini, semuanya aktif._" },
        { quoted: message }
      );
    }

    // 6. Format Pesan
    const memberList = listDisplay.join("\n");
    const teks_sider = `_*${countSider} Dari ${participants.length}* Anggota Grup ${groupMetadata.subject} Adalah Sider*_
        
_*Catatan:*_
_Data ini berdasarkan histori chat di grup sejak bot aktif mencatat. Member di bawah ini tercatat memiliki *0 Total Chat*._

_Harap Aktif Di Grup Karena Akan Ada Pembersihan Member Setiap Saat_

_*List Member Sider:*_
${memberList}`;

    // 7. Kirim pesan dengan Mentions bawaan Baileys
    await sock.sendMessage(
      remoteJid,
      { 
        text: teks_sider, 
        mentions: mentionedJids // Tag menggunakan array JID asli
      },
      { quoted: message }
    );

  } catch (error) {
    console.error("Error handling gcsider:", error);
    await sock.sendMessage(
      remoteJid,
      { text: "⚠️ Terjadi kesalahan saat menampilkan daftar sider." },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["gcsider"],
  OnlyPremium: false,
  OnlyOwner: false,
};