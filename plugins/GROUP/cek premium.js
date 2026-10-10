import { findUser } from "../../lib/users.js";
import { getBotPremiumAny, getBotIdentity, formatTanggalWIB } from "../../lib/bot-scope.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message, sender, isJadibot, botNumber, userKeys } = messageInfo;

  try {
    // Ambil data pengguna
    const dataUsers = await findUser(sender);

    // Jika pengguna tidak ditemukan, tambahkan pengguna baru
    if (!dataUsers) {
      return;
    }

    const [docId, userData] = dataUsers;

    // Tentukan status premium dengan kalimat yang lebih baik
    let premiumStatus;
    if (userData.premium) {
      const premiumEndDate = new Date(userData.premium);
      const now = new Date();

      if (premiumEndDate > now) {
        premiumStatus = `📋 _Masa Premium kamu hingga:_ ${premiumEndDate.toLocaleString()}`;
      } else {
        premiumStatus = "📋 _Masa Premium kamu sudah berakhir_";
      }
    } else {
      premiumStatus = "📋 _Saat ini kamu tidak memiliki masa premium_";
    }

    // Premium per bot (dari owner bot ini lewat .addprem) hanya berlaku di
    // bot ini, jadi ditampilkan terpisah dari premium global.
    if (isJadibot && botNumber) {
      const kunci = Array.isArray(userKeys) && userKeys.length
        ? userKeys
        : [String(sender || "").split("@")[0].split(":")[0]];
      const premiumBot = getBotPremiumAny(botNumber, kunci);
      if (premiumBot) {
        const { name } = getBotIdentity(messageInfo);
        premiumStatus += `\n💎 _Premium di bot ${name} (bot ini saja) hingga:_ ${formatTanggalWIB(premiumBot)}`;
      }
    }

    const responseText = `_Halo_ @${sender.split("@")[0]} \n\n${premiumStatus}`;

    await sock.sendMessage(
      remoteJid,
      { text: responseText, mentions: [sender] },
      { quoted: message }
    );
  } catch (error) {
    console.error("Error handling user data:", error);

    // Kirim pesan kesalahan ke pengguna
    await sock.sendMessage(
      remoteJid,
      {
        text: "Terjadi kesalahan saat memproses data. Silakan coba lagi nanti.",
      },
      { quoted: message }
    );
  }
}
export default {
  handle,
  Commands: ["cekpremium"],
  OnlyPremium: false,
  OnlyOwner: false,
};
