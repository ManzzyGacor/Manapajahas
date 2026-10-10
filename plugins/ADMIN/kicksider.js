import mess from "../../strings.js";
import config from "../../config.js";
import { getTotalChatPerGroup } from "../../lib/totalchat.js";
import { getGroupMetadata } from "../../lib/cache.js";

const DELAY_KICK = 3000; // Jeda 3 detik per kick agar tidak kena spam/banned WA
let inProccess = false;

// Fungsi helper untuk delay
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function handle(sock, messageInfo) {
  const { remoteJid, isGroup, message, sender, content, prefix, command } = messageInfo;
  if (!isGroup) return;

  try {
    // 1. Ambil Metadata Grup
    const groupMetadata = await getGroupMetadata(sock, remoteJid);
    const participants = groupMetadata.participants || [];

    // 2. Cek apakah pengirim adalah admin
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

    // 3. Cek apakah Bot adalah admin (wajib untuk bisa kick)
    const botId = sock.user.id.split(":")[0];
    const isBotAdmin = participants.some(
      (p) => p.id.includes(botId) && p.admin
    );

    if (!isBotAdmin) {
      return await sock.sendMessage(
        remoteJid,
        { text: "_⚠️ Bot harus menjadi admin terlebih dahulu untuk bisa mengeluarkan member!_" },
        { quoted: message }
      );
    }

    // 4. Cegah double eksekusi jika proses kick sedang berjalan
    if (inProccess) {
      return await sock.sendMessage(
        remoteJid,
        { text: "_⏳ Proses pembersihan member sider sedang berlangsung, silakan tunggu hingga selesai._" },
        { quoted: message }
      );
    }

    // 5. Ambil data total chat grup ini
    const totalChatData = await getTotalChatPerGroup(remoteJid);
    const siderParticipants = [];

    // 6. Deteksi Sider (Total chat = 0), kecualikan Admin, Owner, dan Bot
    for (const participant of participants) {
      const jid = participant.phoneNumber || participant.id;
      const totalChat = totalChatData[jid] || 0;

      const isParticipantAdmin = participant.admin === "admin" || participant.admin === "superadmin";
      const isOwner = config.owner_number.some((num) => jid.includes(num));
      const isBot = jid.includes(botId);

      // Jika chat 0 dan BUKAN admin/owner/bot, masukkan ke daftar eksekusi
      if (totalChat === 0 && !isParticipantAdmin && !isOwner && !isBot) {
        siderParticipants.push(jid);
      }
    }

    const countSider = siderParticipants.length;
    const totalMember = participants.length;

    // Jika tidak ada sider
    if (countSider === 0) {
      return await sock.sendMessage(
        remoteJid,
        { text: "📋 _Hebat! Tidak ada member sider (yang bisa di-kick) di grup ini._" },
        { quoted: message }
      );
    }

    // 7. Parsing argumen (all atau angka)
    const arg = content ? content.trim().toLowerCase() : "";
    let jumlahKick = 0;

    if (arg === "all") {
      jumlahKick = countSider;
    } else if (!isNaN(parseInt(arg)) && parseInt(arg) > 0) {
      jumlahKick = Math.min(parseInt(arg), countSider);
    }

    // 8. Eksekusi Kick
    if (jumlahKick > 0) {
      inProccess = true;
      let successCount = 0;
      let failedCount = 0;

      await sock.sendMessage(
        remoteJid,
        { text: `_⚙️ Memulai proses pengeluaran ${jumlahKick} member sider..._\n_Mohon tunggu sebentar._` },
        { quoted: message }
      );

      for (let i = 0; i < jumlahKick; i++) {
        const memberToKick = siderParticipants[i];
        try {
          await sleep(DELAY_KICK); // Jeda aman
          await sock.groupParticipantsUpdate(remoteJid, [memberToKick], "remove");
          successCount++;
        } catch (error) {
          failedCount++;
        }
      }

      inProccess = false; // Reset status

      // Laporan hasil eksekusi
      let finishMessage = `_✅ Berhasil mengeluarkan ${successCount} member sider._`;
      if (failedCount > 0) {
        finishMessage += `\n_❌ Gagal mengeluarkan ${failedCount} member._`;
      }

      return await sock.sendMessage(
        remoteJid,
        { text: finishMessage },
        { quoted: message }
      );
    }

    // 9. Pesan Default (jika hanya ketik .kicksider tanpa argumen)
    const defaultMessage = `_*${countSider}* dari ${totalMember} Anggota Adalah Sider_\n\n_Untuk melanjutkan pembersihan member sider, ketik:_\n• *${prefix + command} all* — untuk keluarkan semua\n• *${prefix + command} <jumlah>* — untuk keluarkan sebagian\n\n_Contoh:_ *${prefix + command} 5*`;

    return await sock.sendMessage(
      remoteJid,
      { text: defaultMessage },
      { quoted: message }
    );

  } catch (error) {
    inProccess = false;
    console.error("Error handling kicksider:", error);
    return await sock.sendMessage(
      remoteJid,
      { text: "⚠️ _Terjadi kesalahan saat memproses data sider._" },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["kicksider"],
  OnlyPremium: false,
  OnlyOwner: false,
};