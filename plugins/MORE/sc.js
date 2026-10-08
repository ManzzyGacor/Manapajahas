import { reply } from "../../lib/utils.js";
import config from "../../config.js";

async function handle(sock, messageInfo) {
  const { m } = messageInfo;

  // Tampilan Baru (Aesthetic Box Style) dengan Update Logs
  const text = `╭───「 📦 *SCRIPT INFO - Varesa* 」
│
│ 🏷️ *Version* : ${global.version || '1.0.0'}
│ 📂 *Type* : Plugins ESM (Modular)
│ 🔓 *Status* : Not For Sale
│ 🛡️ *Developer* : *Manzzy*
│ 🌐 *Official Web* : ${config.web_url}
│
├─「 🔄 *UPDATE LOGS TERBARU* 」
│
│ ➕ Menambahkan Sistem Sewa Bot Otomatis
│ ➕ Menambahkan Fitur Welcome custom support GIF
│ ➕ Update IG Downloader 
│ ➕ Update Fitur HD/Remini
│ ➕ Fix Bug Teks Spasi pada Fitur Brat
│
╰────────────────────────⳹
_🔥 ©Varesa | Created by Manzzy_`;

  // Mengirim pesan dengan gaya balasan standar
  await reply(m, text);
}

export default {
  handle,
  Commands: ["sc", "script"], // Menambahkan alias agar lebih fleksibel
  OnlyPremium: false,
  OnlyOwner: false,
};