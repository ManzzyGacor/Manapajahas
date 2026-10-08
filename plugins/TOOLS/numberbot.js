import { reply } from "../../lib/utils.js";

async function handle(sock, messageInfo) {
  const { m, remoteJid, message, content } = messageInfo;

  try {
    // global.phone_number_bot = bot yang TERAKHIR tersambung, bukan bot yang
    // sedang membalas. Nomor sesi ini dibawa messageInfo.botNumber.
    return reply(m, `_NUMBER BOT :_ *${messageInfo.botNumber || global.phone_number_bot}*`);
  } catch (error) {
    console.error("Error saat memproses grup:", error);

    // Kirim pesan kesalahan
    await sock.sendMessage(
      remoteJid,
      { text: "⚠️ Terjadi kesalahan" },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["numberbot"],
  OnlyPremium: false,
  OnlyOwner: false,
};
