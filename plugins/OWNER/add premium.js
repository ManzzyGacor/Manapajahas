import { findUser, updateUser } from "../../lib/users.js";
import { sendMessageWithMention, convertToJid } from "../../lib/utils.js";
import {
  scopeFor,
  resolveTargetUser,
  addBotPremium,
  getBotIdentity,
  formatTanggalWIB,
  BATAS,
} from "../../lib/bot-scope.js";
import mess from "../../strings.js";
import config from "../../config.js";

// Jumlah hari harus bilangan bulat 1–3650 (maks ±10 tahun), supaya tidak
// ada premium "selamanya" karena salah ketik angka raksasa.
function bacaHari(teks) {
  if (!/^\d{1,5}$/.test(String(teks || ""))) return null;
  const n = parseInt(teks, 10);
  return n >= BATAS.minHari && n <= BATAS.maxHari ? n : null;
}

async function handle(sock, messageInfo) {
  const {
    remoteJid,
    message,
    sender,
    mentionedJid,
    isQuoted,
    content,
    prefix,
    command,
    senderType,
  } = messageInfo;

  const scope = scopeFor(messageInfo);
  if (!scope) {
    return sock.sendMessage(
      remoteJid,
      { text: mess.general.isMainOwner.replace("@dashboard", `${config.web_url}/dashboard`) },
      { quoted: message }
    );
  }

  // Owner bot di bot miliknya sendiri: premium hanya berlaku di bot ini.
  if (scope.mode === "bot") {
    return premiumPerBot(sock, messageInfo, scope.bot);
  }

  try {
    // Validasi input
    if (!content?.trim()) {
      const tex =
        `_⚠️ Format: *${prefix + command} id 30*_\n\n` +
        `_💬 Contoh: *${prefix + command} @tag 30*_`;

      return sock.sendMessage(remoteJid, { text: tex }, { quoted: message });
    }

    let [nomorHp, jumlahHariPremium] = content.split(" ");

    // Validasi input lebih lanjut
    if (!nomorHp || !jumlahHariPremium || isNaN(jumlahHariPremium)) {
      const tex = "⚠️ _Pastikan format yang benar : .addprem username/id 30_";
      return await sock.sendMessage(
        remoteJid,
        { text: tex },
        { quoted: message }
      );
    }

    if (bacaHari(jumlahHariPremium) === null) {
      return sock.sendMessage(
        remoteJid,
        { text: `⚠️ _Jumlah hari harus angka ${BATAS.minHari}–${BATAS.maxHari}._` },
        { quoted: message }
      );
    }

      // --- Cek user single function ---
  let dataUsers = await findUser(nomorHp);
  let userJid = nomorHp;

  if (!dataUsers) {
    // Jika tidak ketemu, coba dengan JID
    const r = await convertToJid(sock, nomorHp);
    userJid = r;
    dataUsers = await findUser(r);

    if (!dataUsers) {
      return sock.sendMessage(
        remoteJid,
        {
          text: `⚠️ _Pengguna dengan username/id ${nomorHp} tidak ditemukan._`,
        },
        { quoted: message }
      );
    }
  }

    const [docId, userData] = dataUsers;

    // Hitung waktu premium baru dari hari ini
    const currentDate = new Date();
    const addedPremiumTime = currentDate.setDate(
      currentDate.getDate() + parseInt(jumlahHariPremium)
    ); // Menambahkan hari

    // Update data premium pengguna
    userData.premium = new Date(addedPremiumTime).toISOString(); // Simpan dalam format ISO 8601

    // Update data pengguna di database
    await updateUser(userJid, userData);

    // Tampilkan pesan bahwa premium sudah ditambahkan
    const premiumEndDate = new Date(addedPremiumTime);
    const responseText = `_Masa Premium pengguna_ ${userJid} _telah diperpanjang hingga:_ ${premiumEndDate.toLocaleString()}`;

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

// Premium per bot: disimpan di database/bot-scope.json, bukan users.json,
// jadi tidak ikut aktif di bot utama atau bot milik orang lain.
async function premiumPerBot(sock, messageInfo, bot) {
  const { remoteJid, message, content, prefix, command } = messageInfo;
  const identitas = getBotIdentity(messageInfo);
  const contoh =
    `_💬 Contoh:_\n` +
    `• *${prefix + command} @tag 30*\n` +
    `• *${prefix + command} 628xxxxxxxxxx 30*\n` +
    `• balas pesan orangnya: *${prefix + command} 30*`;

  const bagian = String(content || "").trim().split(/\s+/).filter(Boolean);
  if (!bagian.length) {
    return sock.sendMessage(
      remoteJid,
      {
        text:
          `_⚠️ Format: *${prefix + command} <tag/nomor> <hari>*_\n\n${contoh}\n\n` +
          `_ℹ️ Premium ini berlaku di bot *${identitas.name}* ini saja._`,
      },
      { quoted: message }
    );
  }

  // Angka terakhir = jumlah hari; sisanya = target (kalau tidak pakai mention/reply).
  const hari = bacaHari(bagian[bagian.length - 1]);
  if (hari === null) {
    return sock.sendMessage(
      remoteJid,
      {
        text: `⚠️ _Jumlah hari harus angka ${BATAS.minHari}–${BATAS.maxHari}._\n\n${contoh}`,
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

  const hasil = addBotPremium(bot, target.number, hari);
  if (!hasil.ok) {
    const alasan =
      hasil.error === "full"
        ? `Daftar premium bot ini sudah penuh (maks ${BATAS.maxPremiumPerBot}). Hapus yang tidak aktif pakai *${prefix}delprem*.`
        : "Data tidak valid.";
    return sock.sendMessage(remoteJid, { text: `⚠️ _${alasan}_` }, { quoted: message });
  }

  const tag = target.jid.split("@")[0];
  return sock.sendMessage(
    remoteJid,
    {
      text:
        `✅ *Premium aktif*\n\n` +
        `👤 Pengguna : @${tag}\n` +
        `⏳ Sampai   : ${formatTanggalWIB(hasil.expiredAt)}\n` +
        `🤖 Bot      : ${identitas.name}\n\n` +
        `_ℹ️ Premium ini berlaku di bot ini saja, tidak di bot lain._`,
      mentions: [target.jid],
    },
    { quoted: message }
  );
}

export default {
  handle,
  Commands: ["addprem", "addpremium"],
  OnlyPremium: false,
  OnlyOwner: true, // Hanya owner yang bisa akses
};
