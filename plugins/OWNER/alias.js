import { updateBotConfig } from "../../lib/jadibot.js";
import {
  ALIAS_DILINDUNGI,
  normalkanAlias,
  normalkanPerintah,
  petaAliasDariConfig,
  prefixTampilan,
} from "../../lib/bot-prefix.js";

// .alias — nama pendek untuk sebuah perintah, khusus BOT INI saja.
//   .alias ss sticker      → .ss sama dengan .sticker
//   .alias del ss          → hapus alias
//   .alias                 → daftar alias
//   .alias reset           → hapus semua
// Perintah inti (menu, ping, owner, ...) tidak bisa dialihkan supaya bot
// tidak bisa "merusak" dirinya sendiri.
async function handle(sock, messageInfo) {
  const { remoteJid, message, content, command, prefix, isJadibot, botNumber, sessionConfig } = messageInfo;

  const balas = (text) => sock.sendMessage(remoteJid, { text }, { quoted: message });

  if (!isJadibot || !botNumber) {
    return balas(
      `_Bot utama memakai perintah apa adanya (tidak punya setelan per bot)._\n\n` +
      `_Perintah ini untuk bot milik user._`
    );
  }

  const peta = petaAliasDariConfig(sessionConfig);
  const daftar = Object.entries(peta);
  const arg = String(content || "").trim();

  // .alias  → daftar
  if (!arg) {
    if (!daftar.length) {
      return balas(
        `⌬ *ALIAS PERINTAH*\n\n` +
        `_Belum ada alias._\n\n` +
        `_Buat dengan:_ *${prefix}${command} ss sticker*\n` +
        `_Setelah itu_ *${prefix}ss* _sama dengan_ *${prefix}sticker*.`
      );
    }
    return balas(
      `⌬ *ALIAS PERINTAH BOT INI*\n\n` +
      daftar.map(([a, t]) => `┣⌬ *${prefix}${a}* → ${prefix}${t}`).join("\n") +
      `\n\n_Hapus:_ *${prefix}${command} del <alias>*\n_Hapus semua:_ *${prefix}${command} reset*`
    );
  }

  const [aksi, ...sisa] = arg.split(/\s+/);

  // .alias reset → bersihkan semua
  if (/^(reset|clear|hapus)$/i.test(aksi) && !sisa.length) {
    await updateBotConfig(botNumber, { alias: {} });
    return balas("✅ Semua alias dihapus.");
  }

  // .alias del <alias> → hapus satu
  if (/^(del|delete|hapus|remove)$/i.test(aksi)) {
    const nama = normalkanAlias(sisa[0]);
    if (!nama) return balas(`_Contoh:_ *${prefix}${command} del ss*`);
    if (!peta[nama]) return balas(`⚠️ Alias *${nama}* tidak ditemukan.`);
    const baru = { ...peta };
    delete baru[nama];
    await updateBotConfig(botNumber, { alias: baru });
    return balas(`✅ Alias *${nama}* dihapus.`);
  }

  // .alias <alias> <perintah>
  const nama = normalkanAlias(aksi);
  const tujuan = normalkanPerintah(sisa[0]);
  if (!nama || !tujuan) {
    return balas(
      `_⚠️ Format:_ *${prefix}${command} <alias> <perintah>*\n\n` +
      `_Contoh:_ *${prefix}${command} ss sticker*`
    );
  }
  if (ALIAS_DILINDUNGI.has(nama)) {
    return balas(`❌ *${nama}* adalah perintah inti dan tidak bisa dialihkan.`);
  }

  const baru = { ...peta, [nama]: tujuan };
  if (Object.keys(baru).length > 100) {
    return balas("❌ Alias sudah terlalu banyak. Hapus beberapa dulu.");
  }
  await updateBotConfig(botNumber, { alias: baru });
  return balas(
    `✅ *${prefix}${nama}* sekarang = *${prefix}${tujuan}*\n\n` +
    `_Coba ketik_ *${prefix}${nama}*_._`
  );
}

export default {
  handle,
  Commands: ["alias"],
  OnlyPremium: false,
  OnlyOwner: true,
};