import { listSewa } from "../../lib/sewa.js";
import { selisihHari } from "../../lib/utils.js";
import { groupFetchAllParticipating } from "../../lib/cache.js";
import {
  scopeFor,
  listBotSewa,
  getBotIdentity,
  formatTanggalWIB,
} from "../../lib/bot-scope.js";
import mess from "../../strings.js";
import config from "../../config.js";

// Batas grup yang ditampilkan supaya pesan tidak kepanjangan untuk WhatsApp.
const MAKS_TAMPIL = 100;

async function handle(sock, messageInfo) {
  const { remoteJid, sender, message } = messageInfo;

  const scope = scopeFor(messageInfo);
  if (!scope) {
    return sock.sendMessage(
      remoteJid,
      { text: mess.general.isMainOwner.replace("@dashboard", `${config.web_url}/dashboard`) },
      { quoted: message }
    );
  }

  // Owner bot di bot miliknya: hanya sewa yang tercatat di bot ini.
  if (scope.mode === "bot") {
    return listSewaPerBot(sock, messageInfo, scope.bot);
  }

  try {
    // Ambil data list berdasarkan grup
    const sewa = await listSewa();

    // Jika tidak ada list
    if (!sewa || Object.keys(sewa).length === 0) {
      await sock.sendMessage(remoteJid, {
        text: "⚠️ _Tidak Ada daftar sewa ditemukan_",
      });
      return;
    }

    // Konversi objek ke array dan urutkan berdasarkan waktu expired terbaru
    const sortedSewa = Object.entries(sewa).sort(
      ([, a], [, b]) => a.expired - b.expired
    );

    const allGroups = await groupFetchAllParticipating(sock);

    // Buat daftar untuk ditampilkan
    let listMessage = "*▧ 「 LIST SEWA* 」\n\n";
    sortedSewa.forEach(([groupId, data], index) => {
      // Ambil subject dari allGroups jika ada
      const subject = allGroups[groupId]
        ? allGroups[groupId].subject
        : "Nama Grup Tidak Ditemukan";

      listMessage += `╭─
│ Subject : ${subject}
│ ID Grup : ${groupId}
│ Expired : ${selisihHari(data.expired)}
╰────────────────────────\n`;
    });

    listMessage += `\n*Total : ${sortedSewa.length}*`;

    // Kirim pesan daftar sewa
    await sock.sendMessage(remoteJid, {
      text: listMessage,
    });
  } catch (error) {
    await sock.sendMessage(remoteJid, {
      text: "_Terjadi kesalahan saat mengambil daftar sewa_",
    });
  }
}

async function listSewaPerBot(sock, messageInfo, bot) {
  const { remoteJid, message, prefix } = messageInfo;
  const identitas = getBotIdentity(messageInfo);
  const daftar = listBotSewa(bot);

  if (!daftar.length) {
    return sock.sendMessage(
      remoteJid,
      {
        text:
          `⚠️ _Belum ada grup sewa di bot ${identitas.name}._\n\n` +
          `_Daftarkan: *${prefix}sewabot <link grup> <hari>*_`,
      },
      { quoted: message }
    );
  }

  // Nama grup dari daftar grup bot ini (di-cache per nomor bot).
  const semuaGrup = (await groupFetchAllParticipating(sock)) || {};
  const tampil = daftar.slice(0, MAKS_TAMPIL);
  let teks = `*▧ 「 LIST SEWA ${identitas.name.toUpperCase()} 」*\n\n`;
  for (const s of tampil) {
    const subject = semuaGrup[s.groupId]?.subject || "Nama grup tidak ditemukan (bot sudah keluar?)";
    const status = s.expired > Date.now() ? selisihHari(s.expired) : "Sudah habis";
    teks += `╭─
│ Grup    : ${subject}
│ ID Grup : ${s.groupId}
│ Sampai  : ${formatTanggalWIB(s.expired)}
│ Sisa    : ${status}
╰────────────────────────\n`;
  }
  if (daftar.length > tampil.length) {
    teks += `\n…dan ${daftar.length - tampil.length} grup lainnya`;
  }
  teks += `\n*Total : ${daftar.length}*\n_ℹ️ Daftar ini berlaku di bot ini saja._`;

  return sock.sendMessage(remoteJid, { text: teks }, { quoted: message });
}

export default {
  handle,
  Commands: ["listsewa"],
  OnlyPremium: false,
  OnlyOwner: true,
};
