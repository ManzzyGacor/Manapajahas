import { addSewa, findSewa, ambilKodeUndangan, infoGrupUndangan } from "../../lib/sewa.js";
import config from "../../config.js";
import { selisihHari, hariini } from "../../lib/utils.js";
import { deleteCache } from "../../lib/globalCache.js";
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
  let { remoteJid, message, content, sender, prefix, command } = messageInfo;

  const scope = scopeFor(messageInfo);
  if (!scope) {
    return sock.sendMessage(
      remoteJid,
      { text: mess.general.isMainOwner.replace("@dashboard", `${config.web_url}/dashboard`) },
      { quoted: message }
    );
  }

  // Owner bot di bot miliknya: sewa dicatat untuk bot ini saja.
  if (scope.mode === "bot") {
    return sewaPerBot(sock, messageInfo, scope.bot);
  }

  // Validasi input kosong atau tidak sesuai format
  if (!content || content.trim() === "") {
    return await sock.sendMessage(
      remoteJid,
      {
        text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${
          prefix + command
        } https://chat.whatsapp.com/xxx 30*_\n\n_*30* artinya 30 hari, bot otomatis akan keluar apabila waktu habis_\n\n_Jika Bot Sudah Bergabung ke Grup Sewa dan untuk perpanjang silakan ketik *.tambahsewa*_`,
      },
      { quoted: message }
    );
  }

  // Bersihkan jika ada ?mode di akhir link
  content = content.replace(/\?mode=[^ ]+/gi, "");

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

    await sock
      .groupAcceptInvite(result_sewa)
      .then((res) => console.log(""))
      .catch((err) => console.log(""));

    // Proses penambahan sewa ke database
    await addSewa(res_linkgc, {
      linkGrub: linkGrub,
      start: hariini,
      expired: timestampExpiration,
    });

    deleteCache(`sewa-${remoteJid}`); // reset cache

    // Kirim pesan berhasil
    return await sock.sendMessage(
      remoteJid,
      {
        text:
          `_*Bot Sudah Bergabung*_` +
          `\n\nName Grub : *${res_namegc}*` +
          `\nNomor Bot : ${messageInfo.botNumber || config.phone_number_bot}` +
          `\nExpired : *${selisihHari(timestampExpiration)}*` +
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

// Sewa grup milik bot user: dicatat di database/bot-scope.json atas nama
// nomor bot ini. Bot utama & bot lain di grup yang sama tidak terpengaruh,
// dan saat masa sewa habis hanya bot ini yang pamit keluar (handle/sewa.js).
async function sewaPerBot(sock, messageInfo, bot) {
  const { remoteJid, message, content, prefix, command, sender } = messageInfo;
  const identitas = getBotIdentity(messageInfo);
  const contoh = `_💬 Contoh:_ *${prefix + command} https://chat.whatsapp.com/xxxx 30*`;

  const args = String(content || "").trim().split(/\s+/).filter(Boolean);
  if (args.length < 2) {
    return sock.sendMessage(
      remoteJid,
      {
        text:
          `_⚠️ Format: *${prefix + command} <link grup> <hari>*_\n\n${contoh}\n\n` +
          `_*30* = 30 hari. Saat masa sewa habis, bot ${identitas.name} otomatis pamit & keluar dari grup itu._\n` +
          `_Perpanjang sewa: *${prefix}tambahsewa*_\n\n` +
          `_ℹ️ Sewa ini tercatat di bot ini saja._`,
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
    console.error("[sewabot] gagal membaca link grup:", error?.message || error);
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

  try {
    await sock.groupAcceptInvite(kode);
  } catch (error) {
    // Sudah jadi anggota juga dilaporkan sebagai error oleh WhatsApp, jadi
    // sewa tetap dicatat; yang benar-benar ditolak hanya "not-authorized".
    if (String(error?.message || "").includes("not-authorized")) {
      return sock.sendMessage(
        remoteJid,
        {
          text: "⚠️ _Bot tidak bisa masuk: kemungkinan pernah dikeluarkan dari grup itu. Minta admin grup menambahkan bot secara manual, lalu ulangi perintah ini._",
        },
        { quoted: message }
      );
    }
  }

  const sebelumnya = getBotSewa(bot, grup.id);
  const expired = Date.now() + hari * HARI_MS;
  const nomorPengirim = String(sender || "").split("@")[0].split(":")[0];
  const hasil = addBotSewa(bot, grup.id, {
    expired,
    linkGrub: `https://chat.whatsapp.com/${kode}`,
    addedBy: nomorPengirim,
  });
  if (!hasil.ok) {
    const alasan =
      hasil.error === "full"
        ? `Daftar sewa bot ini sudah penuh (maks ${BATAS.maxSewaPerBot} grup). Hapus yang lama pakai *${prefix}delsewa*.`
        : "Data sewa tidak valid.";
    return sock.sendMessage(remoteJid, { text: `⚠️ _${alasan}_` }, { quoted: message });
  }

  return sock.sendMessage(
    remoteJid,
    {
      text:
        `✅ *Sewa bot tercatat*\n\n` +
        `👥 Grup      : *${grup.subject || "-"}*\n` +
        `🤖 Bot       : ${identitas.name} (${bot})\n` +
        `⏳ Masa sewa : ${hari} hari — sampai ${formatTanggalWIB(expired)}\n` +
        (sebelumnya ? `\n_Sewa lama grup ini diganti dengan masa sewa baru. Untuk menambah hari, pakai *${prefix}tambahsewa*._\n` : "") +
        `\n_Cek di grup itu: *${prefix}ceksewa*_\n` +
        `_ℹ️ Sewa ini berlaku di bot ini saja._`,
    },
    { quoted: message }
  );
}

export default {
  handle,
  Commands: ["sewabot"],
  OnlyPremium: false,
  OnlyOwner: true,
};
