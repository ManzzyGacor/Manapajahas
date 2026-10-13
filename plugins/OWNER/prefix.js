import { updateBotConfig } from "../../lib/jadibot.js";
import {
  PREFIX_SIMBOL,
  normalkanPrefix,
  prefixTampilan,
} from "../../lib/bot-prefix.js";

// .prefix — ubah simbol awalan perintah untuk BOT INI saja.
// Bot utama milik operator tetap memakai config.prefix (tidak punya entri
// di jadibot.json), jadi perintah ini khusus bot milik user.
async function handle(sock, messageInfo) {
  const { remoteJid, message, content, command, prefix, isJadibot, botNumber, sessionConfig } = messageInfo;

  const balas = (text) => sock.sendMessage(remoteJid, { text }, { quoted: message });

  if (!isJadibot || !botNumber) {
    return balas(
      `_Bot utama memakai prefix dari config.js._\n\n` +
      `_Perintah ini untuk bot milik user (diatur lewat dashboard)._`
    );
  }

  const arg = String(content || "").trim();
  const aktif = Array.isArray(sessionConfig?.prefix) && sessionConfig.prefix.length
    ? sessionConfig.prefix
    : [prefixTampilan(null)];

  // Tanpa argumen: tampilkan setelan sekarang.
  if (!arg) {
    return balas(
      `⌬ *PREFIX BOT INI*\n\n` +
      `Sekarang: ${aktif.map((p) => `*${p}*`).join("  ")}\n` +
      `Contoh: *${aktif[0]}menu*\n\n` +
      `_Ubah dengan:_ *${prefix}${command} !*\n` +
      `_Kembalikan ke bawaan:_ *${prefix}${command} reset*\n\n` +
      `_Simbol yang didukung:_ ${PREFIX_SIMBOL.join(" ")}`
    );
  }

  // "reset" = kembali memakai prefix bawaan (config.js).
  if (/^(reset|default|bawaan)$/i.test(arg)) {
    await updateBotConfig(botNumber, { prefix: [] });
    const bawaan = prefixTampilan(null);
    return balas(`✅ Prefix dikembalikan ke bawaan: *${bawaan}*`);
  }

  const baru = normalkanPrefix(arg.split(/\s+/));
  if (!baru.length) {
    return balas(
      `❌ Simbol tidak valid.\n\n` +
      `Pakai satu simbol non-huruf, mis. *${prefix}${command} !* atau *${prefix}${command} #*.\n` +
      `_Didukung:_ ${PREFIX_SIMBOL.join(" ")}`
    );
  }

  await updateBotConfig(botNumber, { prefix: baru });
  // Bot lama bisa memuat ulang dari disk; cache di memori sudah diperbarui
  // oleh updateBotConfig sehingga prefix langsung berlaku.
  return balas(
    `✅ Prefix bot ini sekarang: ${baru.map((p) => `*${p}*`).join("  ")}\n` +
    `Contoh: *${baru[0]}menu*\n\n` +
    `_Simbol lama tidak lagi berlaku. Kembalikan dengan_ *${baru[0]}${command} reset*`
  );
}

export default {
  handle,
  Commands: ["prefix"],
  OnlyPremium: false,
  // Hanya owner bot (dihitung di autoresbot.js: nomor dashboard + pemilik
  // akun bot). Bot lain tidak boleh mengubah setelan bot ini.
  OnlyOwner: true,
};