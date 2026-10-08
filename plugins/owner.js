import { sendMessageWithMention } from "../lib/utils.js";
import { listOwner } from "../lib/users.js";
import config from "../config.js";

export async function handle(sock, messageInfo) {
  const { remoteJid, message, sender, senderType, sessionConfig } = messageInfo;

  // Nomor owner diambil dari config per-sesi (diatur di dashboard web)
  // lebih dulu. Sebelumnya plugin ini selalu memakai listOwner() global
  // dari database/owner.json, jadi nomor owner yang disimpan user di
  // dashboard tidak pernah tampil di perintah .owner.
  const dashboardOwners = (sessionConfig?.ownerNumber || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => `${n.replace(/\D/g, "")}@s.whatsapp.net`);

  const data = dashboardOwners.length ? dashboardOwners : listOwner();

  let list = [];
  let no = 1;

  for (const item of data) {
    const vcard = `BEGIN:VCARD
VERSION:3.0
N:Owner ${no}
FN:Owner ${no}
TEL;waid=${item.split("@")[0]}:${item.split("@")[0]}
EMAIL;type=INTERNET:${config.owner_email}
URL:https://varesa.mom
ADR:;;${config.region};;;
END:VCARD`;

    list.push({
      displayName: `Owner ${no}`,
      vcard: vcard,
    });
    no++;
  }

  if (data.length === 0) {
    return await sendMessageWithMention(
      sock,
      remoteJid,
      "Owner belum terdaftar!",
      message,
      senderType
    );
  }

  // Mengirim pesan kontak
  const chatId = await sock.sendMessage(
    remoteJid,
    {
      contacts: {
        // 🔴 PERBAIKAN DI SINI: Jangan pakai 'data' (array), tapi string teks
        displayName: `${list.length} Owner`, 
        contacts: list,
      },
    },
    { quoted: message }
  );

  // Kirim pesan dengan mention
  await sendMessageWithMention(
    sock,
    remoteJid,
    `Hai Kak @${sender.split("@")[0]}, berikut adalah owner bot ini`,
    chatId,
    senderType
  );
}

// ESM export
export const Commands = ["owner"];
export const OnlyPremium = false;
export const OnlyOwner = false;