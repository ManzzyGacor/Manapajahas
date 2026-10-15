import { listSewa } from "../../lib/sewa.js";
import { groupFetchAllParticipating } from "../../lib/cache.js";
import { listBotSewa, getBotIdentity, isValidBotKey } from "../../lib/bot-scope.js";

// Batas grup yang ditampilkan supaya pesan tidak kepanjangan untuk WhatsApp.
const MAKS_TAMPIL = 100;

/**
 * Grup yang diikuti bot INI tapi tidak tercatat sebagai grup sewa.
 *
 * - Bot utama  : dibandingkan dengan sewa global (database/sewa.json).
 * - Bot user   : dibandingkan dengan sewa PER BOT miliknya sendiri
 *                (lib/bot-scope.js) — sama dengan yang dipakai handle/sewa.js
 *                untuk bot user. Dulu selalu memakai sewa.json, jadi di bot
 *                user hampir semua grup tampil "non-sewa".
 *
 * Dipakai juga oleh .outnosewa.
 * @returns {Promise<{ ok: false, reason: "fetch" } | { ok: true, scope: "bot"|"global",
 *   nonSewa: Array<{ id: string, subject: string }>, totalGrup: number, totalSewa: number }>}
 */
export async function cariGrupNonSewa(sock, messageInfo = {}) {
  const perBot = !!messageInfo.isJadibot && isValidBotKey(messageInfo.botNumber);

  let idSewa;
  if (perBot) {
    idSewa = new Set(listBotSewa(messageInfo.botNumber).map((s) => s.groupId));
  } else {
    const sewa = (await listSewa()) || {};
    idSewa = new Set(Object.keys(sewa));
  }

  // groupFetchAllParticipating mengembalikan false kalau WhatsApp gagal
  // menjawab (dan bisa melempar error). Dulu `false` dianggap "tidak ada
  // grup" sehingga bot menjawab "Semua grup merupakan grup sewa" — keliru.
  let semuaGrup;
  try {
    semuaGrup = await groupFetchAllParticipating(sock);
  } catch {
    semuaGrup = false;
  }
  if (!semuaGrup || typeof semuaGrup !== "object") return { ok: false, reason: "fetch" };

  const nonSewa = [];
  for (const [id, data] of Object.entries(semuaGrup)) {
    if (!id.endsWith("@g.us") || idSewa.has(id)) continue;
    nonSewa.push({ id, subject: String(data?.subject || "Tanpa nama") });
  }
  return {
    ok: true,
    scope: perBot ? "bot" : "global",
    nonSewa,
    totalGrup: Object.keys(semuaGrup).length,
    totalSewa: idSewa.size,
  };
}

export const TEKS_GAGAL_AMBIL_GRUP =
  "⚠️ _Gagal mengambil daftar grup dari WhatsApp. Coba lagi beberapa saat lagi, ya._";

async function handle(sock, messageInfo) {
  const { remoteJid, message } = messageInfo;

  try {
    const hasil = await cariGrupNonSewa(sock, messageInfo);
    if (!hasil.ok) {
      return sock.sendMessage(remoteJid, { text: TEKS_GAGAL_AMBIL_GRUP }, { quoted: message });
    }

    const { nonSewa, scope } = hasil;
    const catatan =
      scope === "bot"
        ? `\n_ℹ️ Dibandingkan dengan sewa yang tercatat di bot ${getBotIdentity(messageInfo).name} saja._`
        : "";

    if (!nonSewa.length) {
      return sock.sendMessage(
        remoteJid,
        { text: `✅ _Semua grup merupakan grup sewa._${catatan}` },
        { quoted: message }
      );
    }

    let listMessage = "*▧ 「 LIST GRUP NON-SEWA 」*\n\n";
    for (const g of nonSewa.slice(0, MAKS_TAMPIL)) {
      listMessage += `╭─
│ Subject : ${g.subject}
│ ID Grup : ${g.id}
╰────────────────────────\n`;
    }
    if (nonSewa.length > MAKS_TAMPIL) {
      listMessage += `\n…dan ${nonSewa.length - MAKS_TAMPIL} grup lainnya`;
    }
    listMessage += `\n*Total : ${nonSewa.length}*${catatan}`;

    await sock.sendMessage(remoteJid, { text: listMessage }, { quoted: message });
  } catch (error) {
    console.error("[listnosewa] gagal:", error?.message || error);
    await sock.sendMessage(remoteJid, {
      text: "_Terjadi kesalahan saat mengambil data grup non-sewa._",
    });
  }
}

export default {
  handle,
  Commands: ["listnosewa"],
  OnlyPremium: false,
  OnlyOwner: true,
};
