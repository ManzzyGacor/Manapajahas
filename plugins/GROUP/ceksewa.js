import { findSewa } from "../../lib/sewa.js";
import { selisihHari } from "../../lib/utils.js";
import { getGroupMetadata } from "../../lib/cache.js";
import { getBotSewa, getBotIdentity, formatTanggalWIB } from "../../lib/bot-scope.js";

async function handle(sock, messageInfo) {
  const { remoteJid, isGroup, message, isJadibot, botNumber } = messageInfo;
  if (!isGroup) return; // Only Grub

  // Mendapatkan metadata grup
  const { subject } = await getGroupMetadata(sock, remoteJid);

  // Bot milik user membaca sewa yang dicatat owner bot ini (per bot);
  // bot utama tetap membaca database/sewa.json. Sewa bot utama tidak
  // relevan untuk bot user di grup yang sama, begitu juga sebaliknya.
  const dataSewa = isJadibot ? getBotSewa(botNumber, remoteJid) : await findSewa(remoteJid);

  if (!dataSewa) {
    // Jika grup tidak termasuk sewa bot
    await sock.sendMessage(
      remoteJid,
      { text: "_Grup Tidak Termasuk Sewa Bot_" },
      { quoted: message }
    );
    return;
  }

  // Mengecek masa sewa
  const selisihHariSewa = selisihHari(dataSewa.expired);

  if (isJadibot) {
    const identitas = getBotIdentity(messageInfo);
    await sock.sendMessage(
      remoteJid,
      {
        text:
          `_*Name Group:*_ ${subject}\n` +
          `_*Bot:*_ ${identitas.name}\n\n` +
          `_*Masa Sewabot:*_ _*${selisihHariSewa}*_\n` +
          `_*Sampai:*_ ${formatTanggalWIB(dataSewa.expired)}` +
          (identitas.ownerLink ? `\n\n_Perpanjang sewa? Hubungi owner: ${identitas.ownerLink}_` : ""),
      },
      { quoted: message }
    );
    return;
  }

  // Mengirimkan informasi masa sewa
  await sock.sendMessage(
    remoteJid,
    {
      text: `_*Name Group:*_ ${subject}

_*Masa Sewabot:*_ _*${selisihHariSewa}*_`,
    },
    { quoted: message }
  );
}

export default {
  handle,
  Commands: ["ceksewa"],
  OnlyPremium: false,
  OnlyOwner: false,
};
