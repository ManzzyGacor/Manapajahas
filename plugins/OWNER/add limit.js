import { findUser, updateUser } from "../../lib/users.js";
import { sendMessageWithMention, convertToJid } from "../../lib/utils.js";
import {
  scopeFor,
  resolveTargetUser,
  addLimitBonus,
  getBotIdentity,
  BATAS,
} from "../../lib/bot-scope.js";
import mess from "../../strings.js";
import config from "../../config.js";

// Jumlah limit: bilangan bulat 1–100.000 per sekali tambah.
function bacaJumlah(teks) {
  if (!/^\d{1,7}$/.test(String(teks || ""))) return null;
  const n = parseInt(teks, 10);
  return n >= BATAS.minLimit && n <= BATAS.maxLimit ? n : null;
}

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command, senderType } =
    messageInfo;

  const scope = scopeFor(messageInfo);
  if (!scope) {
    return sock.sendMessage(
      remoteJid,
      { text: mess.general.isMainOwner.replace("@dashboard", `${config.web_url}/dashboard`) },
      { quoted: message }
    );
  }

  // Owner bot di bot miliknya: jadi BONUS limit yang hanya terpakai di bot ini.
  if (scope.mode === "bot") {
    return limitPerBot(sock, messageInfo, scope.bot);
  }

  // --- Validasi input ---
  if (!content?.trim()) {
    const tex =
      `_⚠️ Format: *${prefix + command} tag 30*_\n\n` +
      `_💬 Contoh: *${prefix + command} @tag 50*_`;
    return sock.sendMessage(remoteJid, { text: tex }, { quoted: message });
  }

  // Pisahkan target dan jumlah limit
  const [rawNumber, rawLimit] = content.split(" ").map((s) => s.trim());

  if (!rawNumber || !rawLimit) {
    return sock.sendMessage(
      remoteJid,
      {
        text: `_Masukkan format yang benar_\n\n_Contoh: *${
          prefix + command
        } @tag 50*_`,
      },
      { quoted: message }
    );
  }

  // Validasi jumlah limit
  const limitToAdd = bacaJumlah(rawLimit);
  if (limitToAdd === null) {
    return sock.sendMessage(
      remoteJid,
      {
        text: `⚠️ _Jumlah limit harus angka ${BATAS.minLimit}–${BATAS.maxLimit.toLocaleString("id-ID")}_\n\n_Contoh: *${
          prefix + command
        } username/id 5*_`,
      },
      { quoted: message }
    );
  }


  // --- Cek user single function ---
  let dataUsers = await findUser(rawNumber);
  let userJid = rawNumber;

  if (!dataUsers) {
    // Jika tidak ketemu, coba dengan JID
    const r = await convertToJid(sock, rawNumber);
    userJid = r;
    dataUsers = await findUser(r);

    if (!dataUsers) {
      return sock.sendMessage(
        remoteJid,
        {
          text: `⚠️ _Pengguna dengan username/id ${rawNumber} tidak ditemukan._`,
        },
        { quoted: message }
      );
    }
  }

  const [docId, userData] = dataUsers;

  // --- Update data user ---
  await updateUser(userJid, {
    limit: (userData.limit || 0) + limitToAdd,
  });

  // --- Kirim pesan konfirmasi ---
  await sendMessageWithMention(
    sock,
    remoteJid,
    `✅ _Limit berhasil ditambahkan ${limitToAdd}_`,
    message,
    senderType
  );
}

// Bonus limit per bot disimpan di database/bot-scope.json. Saat user
// memakai perintah berlimit di bot ini, bonus dipotong DULU, baru limit
// biasa (lihat autoresbot.js). Di bot lain bonus ini tidak berlaku.
async function limitPerBot(sock, messageInfo, bot) {
  const { remoteJid, message, content, prefix, command } = messageInfo;
  const identitas = getBotIdentity(messageInfo);
  const contoh =
    `_💬 Contoh:_\n` +
    `• *${prefix + command} @tag 50*\n` +
    `• *${prefix + command} 628xxxxxxxxxx 50*\n` +
    `• balas pesan orangnya: *${prefix + command} 50*`;

  const bagian = String(content || "").trim().split(/\s+/).filter(Boolean);
  if (!bagian.length) {
    return sock.sendMessage(
      remoteJid,
      {
        text:
          `_⚠️ Format: *${prefix + command} <tag/nomor> <jumlah>*_\n\n${contoh}\n\n` +
          `_ℹ️ Limit ini jadi bonus yang berlaku di bot *${identitas.name}* ini saja._`,
      },
      { quoted: message }
    );
  }

  const jumlah = bacaJumlah(bagian[bagian.length - 1]);
  if (jumlah === null) {
    return sock.sendMessage(
      remoteJid,
      {
        text: `⚠️ _Jumlah limit harus angka ${BATAS.minLimit}–${BATAS.maxLimit.toLocaleString("id-ID")}._\n\n${contoh}`,
      },
      { quoted: message }
    );
  }

  const target = await resolveTargetUser(
    sock,
    messageInfo,
    bagian.slice(0, -1).join(" "),
    findUser
  );
  if (!target) {
    return sock.sendMessage(
      remoteJid,
      {
        text: `⚠️ _Target tidak valid. Tag orangnya, balas pesannya, atau tulis nomor WhatsApp-nya (8–15 digit)._\n\n${contoh}`,
      },
      { quoted: message }
    );
  }

  const hasil = addLimitBonus(bot, target.number, jumlah);
  if (!hasil.ok) {
    const alasan =
      hasil.error === "full"
        ? `Daftar bonus limit bot ini sudah penuh (maks ${BATAS.maxLimitUsersPerBot} orang).`
        : "Data tidak valid.";
    return sock.sendMessage(remoteJid, { text: `⚠️ _${alasan}_` }, { quoted: message });
  }

  const tag = target.jid.split("@")[0];
  return sock.sendMessage(
    remoteJid,
    {
      text:
        `✅ *Bonus limit ditambahkan*\n\n` +
        `👤 Pengguna    : @${tag}\n` +
        `➕ Tambahan    : ${jumlah.toLocaleString("id-ID")}\n` +
        `🎁 Total bonus : ${hasil.total.toLocaleString("id-ID")}\n` +
        `🤖 Bot         : ${identitas.name}\n\n` +
        `_ℹ️ Bonus dipakai duluan sebelum limit biasa, dan berlaku di bot ini saja._`,
      mentions: [target.jid],
    },
    { quoted: message }
  );
}

export default {
  handle,
  Commands: ["addlimit"],
  OnlyPremium: false,
  OnlyOwner: true,
};
