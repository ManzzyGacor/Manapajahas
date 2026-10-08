import { reply } from "../../lib/utils.js";

async function handle(sock, messageInfo) {
  const { m, remoteJid, message, prefix, command, content } = messageInfo;

  try {
    // Validasi input
    if (!content) {
      return await reply(
        m,
        `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _${
          prefix + command
        } https://whatsapp.com/channel/0029VbCIEdlLNSZyA97fD222_`
      );
    }

    // Validasi link Saluran WhatsApp (Channel)
    const regex = /https:\/\/whatsapp\.com\/channel\/([\w\d]+)/i;
    const match = content.match(regex);
    if (!match || !match[1]) {
      return await reply(
        m,
        `_❌ Link saluran tidak valid. Pastikan link seperti ini:_\nhttps://whatsapp.com/channel/0029VbCIEdlLNSZyA97fD222`
      );
    }

    const inviteCode = match[1];

    // Ambil metadata saluran menggunakan invite code
    const channelInfo = await sock.newsletterMetadata("invite", inviteCode);

    // Susun informasi yang didapat
    const info = [
      `🆔 ID Saluran: ${channelInfo.id}`,
      `📛 Nama: ${channelInfo.name}`,
      `👥 Pengikut: ${channelInfo.subscribers || "Tidak diketahui"}`,
    ].join("\n");

    return await reply(m, `_✅ Informasi Saluran:_\n${info}`);
  } catch (error) {
    console.error("Kesalahan di fungsi handle:", error);

    const errorMessage = error.message || "Terjadi kesalahan tak dikenal. Pastikan link benar atau saluran bersifat publik.";
    return await sock.sendMessage(
      remoteJid,
      { text: `_❌ Error: ${errorMessage}_` },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["cekidch", "idchannel"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1,
};