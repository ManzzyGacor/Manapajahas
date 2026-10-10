import { addSewa, findSewa, ambilKodeUndangan, infoGrupUndangan } from "../../lib/sewa.js";
import config from "../../config.js";
import { selisihHari, hariini } from "../../lib/utils.js";
import {
  scopeFor,
  addBotSewa,
  getBotSewa,
  getBotIdentity,
  formatTanggalWIB,
  isValidGroupId,
  BATAS,
} from "../../lib/bot-scope.js";
import mess from "../../strings.js";

const HARI_MS = 24 * 60 * 60 * 1000;

// Jumlah hari sewa: bilangan bulat 1–3650.
function bacaHari(teks) {
  if (!/^\d{1,5}$/.test(String(teks || ""))) return null;
  const n = parseInt(teks, 10);
  return n >= BATAS.minHari && n <= BATAS.maxHari ? n : null;
}

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, sender, prefix, command } = messageInfo;

  const scope = scopeFor(messageInfo);
  if (!scope) {
    return sock.sendMessage(
      remoteJid,
      { text: mess.general.isMainOwner.replace("@dashboard", `${config.web_url}/dashboard`) },
      { quoted: message }
    );
  }

  // Owner bot di bot miliknya: perpanjang sewa yang tercatat di bot ini.
  if (scope.mode === "bot") {
    return tambahSewaPerBot(sock, messageInfo, scope.bot);
  }

  // Validasi input kosong atau tidak sesuai format
  if (!content || content.trim() === "") {
    return await sock.sendMessage(
      remoteJid,
      {
        text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${
          prefix + command
        } https://chat.whatsapp.com/xxx 30*_\n\n_*30* artinya penambahan 30 hari dihitung dari sisa waktu sewabot_\n\n_Jika Bot Belum Bergabung ke Grub Sewa Silakan ketik *.sewabot*_`,
      },
      { quoted: message }
    );
  }

  // Split content menjadi array untuk memisahkan link dan jumlah hari
  const args = content.trim().split(" ");
  if (args.length < 2) {
    return await sock.sendMessage(
      remoteJid,
      {
        text: `⚠️ Format tidak valid. Contoh penggunaan:\n\n_*${
          prefix + command
        } https://chat.whatsapp.com/xxx 30*_`,
      },
      { quoted: message }
    );
  }

  const linkGrub = args[0]; // Ambil link grup
  const totalHari = parseInt(args[1], 10); // Konversi hari menjadi angka

  // Validasi link grup
  if (!linkGrub.includes("chat.whatsapp.com")) {
    return await sock.sendMessage(
      remoteJid,
      {
        text: `⚠️ Link grup harus mengandung 'chat.whatsapp.com'. Contoh penggunaan:\n\n_*${
          prefix + command
        } https://chat.whatsapp.com/xxx 30*_`,
      },
      { quoted: message }
    );
  }

  // Validasi jumlah hari
  if (isNaN(totalHari) || bacaHari(args[1]) === null) {
    return await sock.sendMessage(
      remoteJid,
      {
        text: `⚠️ Jumlah hari tidak valid (${BATAS.minHari}–${BATAS.maxHari}). Contoh penggunaan:\n\n_*${
          prefix + command
        } https://chat.whatsapp.com/xxx 30*_`,
      },
      { quoted: message }
    );
  }

  // Ekstraksi kode grup dari link
  const result_sewa = linkGrub.split("https://chat.whatsapp.com/")[1];
  let res_linkgc = "";

  const currentDate = new Date();
  const expirationDate = new Date(
    currentDate.getTime() + totalHari * 24 * 60 * 60 * 1000 + 1 * 60 * 60 * 1000
  );
  const timestampExpiration = expirationDate.getTime();

  try {
    const res = await sock.query({
      tag: "iq",
      attrs: { type: "get", xmlns: "w:g2", to: "@g.us" },
      content: [{ tag: "invite", attrs: { code: result_sewa } }],
    });

    res_linkgc = res.content[0].attrs.id;
    const res_namegc = res.content[0].attrs.subject;
    res_linkgc = res_linkgc + "@g.us";

    // cek apakah data ada
    const cekSewa = await findSewa(res_linkgc);
    if (!cekSewa) {
      return await sock.sendMessage(
        remoteJid,
        {
          text: `⚠️ _*Nomor Bot Belum Pernah Bergabung*_\n\n_Silakan Ketik *.sewabot* untuk membuat Sewa Baru_`,
        },
        { quoted: message }
      );
    }

    await sock
      .groupAcceptInvite(result_sewa)
      .then((res) => console.log(""))
      .catch((err) => console.log(""));

    const totalSewa =
      cekSewa.expired + totalHari * 24 * 60 * 60 * 1000 + 1 * 60 * 60 * 1000;

    await addSewa(res_linkgc, {
      linkGrub: linkGrub,
      expired: totalSewa,
    });

    // Kirim pesan berhasil
    return await sock.sendMessage(
      remoteJid,
      {
        text:
          `_*Perpanjangan Berhasil*_` +
          `\n\nName Grub : *${res_namegc}*` +
          `\nNomor Bot : ${messageInfo.botNumber || config.phone_number_bot}` +
          `\nExpired : *${selisihHari(totalSewa)}*` +
          `\n\n_Untuk Mengecek status sewa ketik *.ceksewa* pada grub tersebut_`,
      },
      { quoted: message }
    );
  } catch (error) {
    console.error("Gagal bergabung ke grup:", error);

    // Pesan error default
    let info = "_Pastikan link grup valid._";

    // Periksa pesan error
    if (error instanceof Error && error.message.includes("not-authorized")) {
      info = `_Kemungkinan Anda pernah dikeluarkan dari grup. Solusi: undang bot kembali atau masukkan secara manual._`;
    }

    // Kirim pesan error ke pengguna
    return await sock.sendMessage(
      remoteJid,
      {
        text: `⚠️ _Gagal bergabung ke grup._\n\n${info}`,
      },
      { quoted: message }
    );
  }
}

async function tambahSewaPerBot(sock, messageInfo, bot) {
  const { remoteJid, message, content, prefix, command } = messageInfo;
  const identitas = getBotIdentity(messageInfo);
  const contoh = `_💬 Contoh:_ *${prefix + command} https://chat.whatsapp.com/xxxx 30*`;

  const args = String(content || "").trim().split(/\s+/).filter(Boolean);
  if (args.length < 2) {
    return sock.sendMessage(
      remoteJid,
      {
        text:
          `_⚠️ Format: *${prefix + command} <link grup> <hari>*_\n\n${contoh}\n\n` +
          `_*30* = tambah 30 hari dari sisa masa sewa. Grup yang belum terdaftar: pakai *${prefix}sewabot* dulu._\n\n` +
          `_ℹ️ Berlaku untuk sewa di bot ini saja._`,
      },
      { quoted: message }
    );
  }

  const kode = ambilKodeUndangan(args[0]);
  if (!kode) {
    return sock.sendMessage(
      remoteJid,
      { text: `⚠️ _Link grup tidak valid. Harus link undangan chat.whatsapp.com._\n\n${contoh}` },
      { quoted: message }
    );
  }

  const hari = bacaHari(args[1]);
  if (hari === null) {
    return sock.sendMessage(
      remoteJid,
      { text: `⚠️ _Jumlah hari harus angka ${BATAS.minHari}–${BATAS.maxHari}._\n\n${contoh}` },
      { quoted: message }
    );
  }

  let grup;
  try {
    grup = await infoGrupUndangan(sock, kode);
  } catch (error) {
    console.error("[tambahsewa] gagal membaca link grup:", error?.message || error);
    return sock.sendMessage(
      remoteJid,
      { text: "⚠️ _Gagal membaca link grup. Pastikan link masih aktif (belum di-reset admin)._" },
      { quoted: message }
    );
  }
  if (!isValidGroupId(grup.id)) {
    return sock.sendMessage(
      remoteJid,
      { text: "⚠️ _Link grup tidak dikenali WhatsApp. Coba minta link baru dari admin grup._" },
      { quoted: message }
    );
  }

  const lama = getBotSewa(bot, grup.id);
  if (!lama) {
    return sock.sendMessage(
      remoteJid,
      {
        text: `⚠️ _Grup *${grup.subject || "itu"}* belum terdaftar sewa di bot ${identitas.name}._\n\n_Daftarkan dulu: *${prefix}sewabot <link> <hari>*_`,
      },
      { quoted: message }
    );
  }

  // Ditambah dari sisa masa sewa (atau dari sekarang kalau sudah lewat),
  // maksimal 3650 hari ke depan.
  const now = Date.now();
  const expired = Math.min(
    Math.max(lama.expired, now) + hari * HARI_MS,
    now + BATAS.maxHari * HARI_MS
  );
  const hasil = addBotSewa(bot, grup.id, { ...lama, expired });
  if (!hasil.ok) {
    return sock.sendMessage(remoteJid, { text: "⚠️ _Data sewa tidak valid._" }, { quoted: message });
  }

  // Pastikan bot masih di grup itu (mungkin sempat dikeluarkan).
  await sock.groupAcceptInvite(kode).catch(() => {});

  return sock.sendMessage(
    remoteJid,
    {
      text:
        `✅ *Perpanjangan sewa berhasil*\n\n` +
        `👥 Grup     : *${grup.subject || "-"}*\n` +
        `🤖 Bot      : ${identitas.name} (${bot})\n` +
        `➕ Tambahan : ${hari} hari\n` +
        `⏳ Sampai   : ${formatTanggalWIB(expired)}\n\n` +
        `_Cek di grup itu: *${prefix}ceksewa*_\n` +
        `_ℹ️ Sewa ini berlaku di bot ini saja._`,
    },
    { quoted: message }
  );
}

export default {
  handle,
  Commands: ["tambahsewa"],
  OnlyPremium: false,
  OnlyOwner: true,
};
