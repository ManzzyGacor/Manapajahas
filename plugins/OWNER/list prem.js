import { readUsers } from "../../lib/users.js";
import { sendMessageWithMention } from "../../lib/utils.js";
import {
  scopeFor,
  listBotPremium,
  getBotIdentity,
  formatTanggalWIB,
} from "../../lib/bot-scope.js";
import mess from "../../strings.js";
import config from "../../config.js";

// Batas baris yang ditampilkan supaya pesan tidak kepanjangan untuk WhatsApp.
const MAKS_TAMPIL = 150;

async function handle(sock, messageInfo) {
  const { remoteJid, message, senderType } = messageInfo;

  const scope = scopeFor(messageInfo);
  if (!scope) {
    return sock.sendMessage(
      remoteJid,
      { text: mess.general.isMainOwner.replace("@dashboard", `${config.web_url}/dashboard`) },
      { quoted: message }
    );
  }

  // Owner bot: hanya premium yang diberikan di bot ini.
  if (scope.mode === "bot") {
    return listPremiumPerBot(sock, messageInfo, scope.bot);
  }

  try {
    const users = await readUsers();

    // Ambil hanya pengguna yang memiliki atribut premium dan tanggalnya masih berlaku
    const premiumUsers = Object.entries(users)
      .filter(
        ([docId, userData]) =>
          userData.premium && new Date(userData.premium) > new Date()
      )
      .map(([docId, userData]) => ({
        docId,
        username: userData.username,
        premium: userData.premium,
        aliases: userData.aliases,
      }));

    if (premiumUsers.length === 0) {
      return await sock.sendMessage(
        remoteJid,
        { text: "⚠️ Tidak ada pengguna yang premium saat ini." },
        { quoted: message }
      );
    }

    function cleanJid(jid) {
    return jid.replace(/@[\w.]+whatsapp\.net/i, "");
  }

    // Format daftar pengguna premium pakai username
   const premiumList = premiumUsers
  .map((user, index) => {
    const uname = cleanJid(user.aliases[0]);
    return `◧ *@${uname}* (Premium hingga: ${new Date(
      user.premium
    ).toLocaleDateString()})`;
  })
  .join("\n");

    const textNotif = `📋 *LIST PREMIUM:*\n\n${premiumList}\n\n_Total:_ *${premiumUsers.length}*`;

    // Kirim pesan (tidak perlu mention, atau jika mau mention ambil dari aliases)
    await sendMessageWithMention(
      sock,
      remoteJid,
      textNotif,
      message,
      senderType
    );
  } catch (error) {
    console.error("Error fetching users:", error);
    await sock.sendMessage(
      remoteJid,
      { text: "Terjadi kesalahan saat memproses data pengguna." },
      { quoted: message }
    );
  }
}

async function listPremiumPerBot(sock, messageInfo, bot) {
  const { remoteJid, message, prefix } = messageInfo;
  const identitas = getBotIdentity(messageInfo);
  const daftar = listBotPremium(bot);

  if (!daftar.length) {
    return sock.sendMessage(
      remoteJid,
      {
        text:
          `⚠️ _Belum ada pengguna premium di bot ${identitas.name}._\n\n` +
          `_Tambahkan: *${prefix}addprem @tag 30* (berlaku di bot ini saja)._`,
      },
      { quoted: message }
    );
  }

  const tampil = daftar.slice(0, MAKS_TAMPIL);
  const baris = tampil
    .map((x, i) => `${i + 1}. @${x.user} — sampai ${formatTanggalWIB(x.expiredAt)}`)
    .join("\n");
  const lebih =
    daftar.length > tampil.length ? `\n…dan ${daftar.length - tampil.length} lainnya` : "";

  return sock.sendMessage(
    remoteJid,
    {
      text:
        `📋 *PREMIUM BOT ${identitas.name.toUpperCase()}*\n\n${baris}${lebih}\n\n` +
        `_Total:_ *${daftar.length}*\n` +
        `_ℹ️ Daftar ini berlaku di bot ini saja._`,
      mentions: tampil.map((x) => `${x.user}@s.whatsapp.net`),
    },
    { quoted: message }
  );
}

export default {
  handle,
  Commands: ["listprem"],
  OnlyPremium: false,
  OnlyOwner: true,
};
