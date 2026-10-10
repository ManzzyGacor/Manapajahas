import { findUser, updateUser } from "../../lib/users.js";
import { sendMessageWithMention } from "../../lib/utils.js";
import {
  scopeFor,
  resolveTargetUser,
  delBotPremium,
  getBotIdentity,
} from "../../lib/bot-scope.js";
import mess from "../../strings.js";
import config from "../../config.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message, sender, content, prefix, command, senderType } =
    messageInfo;

  const scope = scopeFor(messageInfo);
  if (!scope) {
    return sock.sendMessage(
      remoteJid,
      { text: mess.general.isMainOwner.replace("@dashboard", `${config.web_url}/dashboard`) },
      { quoted: message }
    );
  }

  // Owner bot di bot miliknya sendiri: hanya premium bot ini yang dihapus.
  if (scope.mode === "bot") {
    return hapusPremiumPerBot(sock, messageInfo, scope.bot);
  }

  try {
    // Validasi input
    if (!content || content.trim() === "") {
      const tex = `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${
        prefix + command
      } 628xxxxxxxxxx*_`;
      return await sock.sendMessage(
        remoteJid,
        { text: tex },
        { quoted: message }
      );
    }

    let nomorHp = content;

    // Validasi input lebih lanjut
    if (!nomorHp) {
      const tex = "_Pastikan format yang benar : .delprem 628xxxxxxxxxx_";
      return await sock.sendMessage(
        remoteJid,
        { text: tex },
        { quoted: message }
      );
    }

    nomorHp = nomorHp.replace(/\D/g, "");

    // Ambil data pengguna
    let dataUsers = await findUser(nomorHp);

    // Jika pengguna tidak ditemukan, tambahkan pengguna baru
    if (!dataUsers) {
      return await sock.sendMessage(
        remoteJid,
        { text: "tidak ada user di temukan" },
        { quoted: message }
      );
    }

    const [docId, userData] = dataUsers;

    userData.premium = null;

    // Update data pengguna di database
    await updateUser(nomorHp, userData);

    const responseText = `_Pengguna_ @${
      nomorHp.split("@")[0]
    } _telah di hapus dari premium:_`;

    // Kirim pesan dengan mention
    await sendMessageWithMention(
      sock,
      remoteJid,
      responseText,
      message,
      senderType
    );
  } catch (error) {
    console.error("Error processing premium addition:", error);

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

async function hapusPremiumPerBot(sock, messageInfo, bot) {
  const { remoteJid, message, content, prefix, command } = messageInfo;
  const identitas = getBotIdentity(messageInfo);

  const target = await resolveTargetUser(sock, messageInfo, content, findUser);
  if (!target) {
    return sock.sendMessage(
      remoteJid,
      {
        text:
          `_⚠️ Format: *${prefix + command} <tag/nomor>*_\n\n` +
          `_💬 Contoh:_ *${prefix + command} @tag* atau *${prefix + command} 628xxxxxxxxxx*\n\n` +
          `_Lihat daftarnya: *${prefix}listprem*_`,
      },
      { quoted: message }
    );
  }

  // Hapus di semua ID orang itu (nomor HP & LID), karena premium bisa
  // tersimpan dengan salah satunya.
  let terhapus = false;
  for (const k of target.keys) {
    if (delBotPremium(bot, k)) terhapus = true;
  }

  const tag = target.jid.split("@")[0];
  if (!terhapus) {
    return sock.sendMessage(
      remoteJid,
      {
        text: `⚠️ _@${tag} tidak punya premium aktif di bot ${identitas.name} ini._`,
        mentions: [target.jid],
      },
      { quoted: message }
    );
  }

  return sock.sendMessage(
    remoteJid,
    {
      text:
        `✅ _Premium @${tag} di bot *${identitas.name}* sudah dihapus._\n\n` +
        `_ℹ️ Berlaku di bot ini saja; premium dari owner utama (kalau ada) tidak berubah._`,
      mentions: [target.jid],
    },
    { quoted: message }
  );
}

export default {
  handle,
  Commands: ["delprem", "delpremium"],
  OnlyPremium: false,
  OnlyOwner: true, // Hanya owner yang bisa akses
};
