// plugins/MORE/jadibot.js
import config from "../../config.js";

// Panduan "jadi bot": cara menjadikan nomor WhatsApp sendiri sebagai bot
// lewat web dashboard Varesa. Perintah .jadibot dicontohkan di menu kustom
// bawaan dashboard (Edit Menu) tapi dulu tidak ada plugin-nya, jadi bot
// diam saja saat perintah itu dicoba. Pendaftaran & pairing sendiri tetap
// lewat website — di sini cukup arahan + link-nya.
const TEKS_JADIBOT = (pushName, prefix) => `
🤖 *BIKIN BOT WHATSAPP SENDIRI*

Halo Kak *${pushName || "Kak"}*! Bot ini berjalan di *Varesa*. Kamu juga bisa punya bot sendiri — gratis, tanpa install apa pun:

1️⃣ Daftar / login di ${config.web_url}/dashboard
2️⃣ Masukkan nomor WhatsApp yang mau dijadikan bot
3️⃣ Buka WhatsApp → *Perangkat tertaut* → *Tautkan dengan nomor telepon*, lalu masukkan kode pairing dari dashboard
4️⃣ Selesai — bot langsung aktif 24/7 dengan ratusan fitur

⚙️ Nama bot, nomor owner, menu, pesan otomatis, perintah kustom & sambutan grup semuanya diatur dari dashboard.
💎 Paket: Free • Core • Prime • Zenith — ketik *${prefix || "."}premium* untuk info upgrade.
`.trim();

async function handle(sock, messageInfo) {
  const { remoteJid, message, pushName, prefix } = messageInfo;

  await sock.sendMessage(
    remoteJid,
    { text: TEKS_JADIBOT(pushName, prefix) },
    { quoted: message }
  );
}

export default {
  handle,
  Commands: ["jadibot", "buatbot", "bikinbot"],
  OnlyPremium: false,
  OnlyOwner: false,
};
