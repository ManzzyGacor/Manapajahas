import ApiAutoresbotModule from "api-autoresbot";
const ApiAutoresbot = ApiAutoresbotModule.default || ApiAutoresbotModule;

import config from "../../config.js";
import { reply } from "../../lib/utils.js";

async function handle(sock, messageInfo) {
  const { m, remoteJid, message, pushName } = messageInfo;

  try {
    // 1. Reaksi Loading
    await sock.sendMessage(remoteJid, {
      react: { text: "⏳", key: message.key },
    });

    const api = new ApiAutoresbot(config.APIKEY);

    // 2. Request ke API
    const response = await api.get("/check_apikey");

    // 3. Format Tanggal
    const bulan = [
      "Januari", "Februari", "Maret", "April", "Mei", "Juni",
      "Juli", "Agustus", "September", "Oktober", "November", "Desember",
    ];

    if (response && response.limit_key) {
      const tanggalAktif = new Date(response.limit_key * 1000);
      const formattedDate = `${tanggalAktif.getDate()} ${bulan[tanggalAktif.getMonth()]} ${tanggalAktif.getFullYear()}`;

      // --- DESAIN TEKS SUKSES ---
      const captionSukses = `╭───「 ♛ *APIKEY STATUS* 」
│
│ 👤 *User* : ${pushName}
│ 🟢 *Status* : *ACTIVE*
│ 📆 *Expired* : ${formattedDate}
│ ⚡ *Limit* : ${response.limit_apikey} Request
│
╰──────────────────⳹`;

      // Kirim pesan sukses
      await reply(m, captionSukses);
      
      // Ubah reaksi jadi Centang
      await sock.sendMessage(remoteJid, { react: { text: "✅", key: message.key } });

    } else {
      // --- DESAIN TEKS GAGAL ---
      const captionGagal = `╭───「 ⛔ *ACCESS DENIED* 」
│
│ 👤 *User* : ${pushName}
│ 🔴 *Status* : *EXPIRED / INVALID*
│ ⚠️ *Msg* : Apikey tidak terdaftar.
│
╰──────────────────⳹`;

      // Kirim pesan gagal
      await reply(m, captionGagal);

      // Ubah reaksi jadi Silang
      await sock.sendMessage(remoteJid, { react: { text: "❌", key: message.key } });
    }

  } catch (error) {
    await sock.sendMessage(
      remoteJid,
      { text: `⚠️ *System Error:*\n${error.message}` },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["apikey"],
  OnlyPremium: false,
  OnlyOwner: false,
};