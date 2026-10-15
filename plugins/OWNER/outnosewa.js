import { cariGrupNonSewa, TEKS_GAGAL_AMBIL_GRUP } from "./listnosewa.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handle(sock, messageInfo) {
  const { remoteJid, message, prefix } = messageInfo;

  try {
    const hasil = await cariGrupNonSewa(sock, messageInfo);
    if (!hasil.ok) {
      return sock.sendMessage(remoteJid, { text: TEKS_GAGAL_AMBIL_GRUP }, { quoted: message });
    }

    // Belum ada satu pun grup sewa: semua grup akan dianggap non-sewa dan
    // bot keluar dari SEMUA grupnya. Bot user yang tidak memakai sistem
    // sewa justru harus tetap jalan normal di grup-grupnya, jadi perintah
    // ini dibatalkan dulu.
    if (hasil.totalSewa === 0) {
      return sock.sendMessage(
        remoteJid,
        {
          text:
            "⚠️ _Belum ada grup sewa yang tercatat di bot ini, jadi .outnosewa dibatalkan — " +
            "kalau diteruskan, bot akan keluar dari SEMUA grup._\n\n" +
            `_Daftarkan grup sewa dulu: *${prefix || "."}sewabot <link grup> <hari>*_`,
        },
        { quoted: message }
      );
    }

    const { nonSewa } = hasil;
    if (!nonSewa.length) {
      return sock.sendMessage(
        remoteJid,
        { text: "✅ _Semua grup merupakan grup sewa._" },
        { quoted: message }
      );
    }

    // Grup tempat perintah ini diketik ditinggalkan PALING AKHIR, setelah
    // laporan terkirim — kalau duluan, laporannya tidak bisa dikirim lagi.
    const grupIni = nonSewa.find((g) => g.id === remoteJid);
    const lainnya = nonSewa.filter((g) => g.id !== remoteJid);

    await sock.sendMessage(
      remoteJid,
      { text: `⏳ _Keluar dari ${nonSewa.length} grup non-sewa, mohon tunggu..._` },
      { quoted: message }
    );

    let count = 0;
    let listMessage = "*▧ 「 LIST GRUP NON-SEWA 」*\n\n";
    for (const g of lainnya) {
      try {
        await sock.groupLeave(g.id);
        await sleep(2000); // Delay 2 detik agar tidak spam
        listMessage += `╭───────────────
│ *Subject* : ${g.subject}
│ *ID Grup* : ${g.id}
╰───────────────\n\n`;
        count++;
      } catch (leaveErr) {
        console.error(`Gagal keluar dari grup ${g.id}:`, leaveErr.message);
        listMessage += `⚠️ *Gagal keluar dari grup: ${g.subject} (${g.id})*\n\n`;
      }
    }

    if (grupIni) {
      listMessage += `🚪 _Grup ini juga bukan grup sewa, bot akan keluar setelah pesan ini._\n\n`;
    }
    listMessage += `*Total keluar: ${count + (grupIni ? 1 : 0)} grup.*`;

    await sock.sendMessage(remoteJid, { text: listMessage });

    if (grupIni) {
      try {
        await sleep(1000);
        await sock.groupLeave(grupIni.id);
      } catch (leaveErr) {
        console.error(`Gagal keluar dari grup ${grupIni.id}:`, leaveErr.message);
      }
    }
  } catch (error) {
    console.error("[outnosewa] gagal:", error?.message || error);
    await sock.sendMessage(remoteJid, {
      text: "_Terjadi kesalahan saat mengambil data grup non-sewa._",
    });
  }
}

export default {
  handle,
  Commands: ["outnosewa"],
  OnlyPremium: false,
  OnlyOwner: true,
};
