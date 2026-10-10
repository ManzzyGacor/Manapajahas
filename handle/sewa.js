const ONLY_GC_SEWA = false; 

import { findSewa, deleteSewa } from "../lib/sewa.js";
import config from "../config.js";
import { selisihHari, danger, logTracking } from "../lib/utils.js";
import { logCustom } from "../lib/logger.js";
import { getGroupMetadata } from "../lib/cache.js";
import { getBotSewa, delBotSewa, getBotIdentity } from "../lib/bot-scope.js";
import mess from "../strings.js";

const notificationDays = 3; 
// Kunci "nomorBot|idGrup": dua bot di grup yang sama punya masa sewa
// sendiri-sendiri, jadi pemberitahuannya juga dicatat per bot.
const notifiedGroups = new Set(); 
const nonSewaGroups = new Set();

async function leaveGroupWithRetry(sock, remoteJid, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logTracking(`Sewa Handler - keluar dari grub ${remoteJid}`);
      await sock.groupLeave(remoteJid);
      console.log(`Berhasil keluar dari grup pada percobaan ke-${attempt}`);
      break; 
    } catch (err) {
      console.error(`Gagal keluar dari grup (percobaan ke-${attempt}):`, err);
      if (attempt === maxRetries) {
        console.error(`Gagal setelah ${maxRetries} kali mencoba.`);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1000)); 
      }
    }
  }
}

async function process(sock, messageInfo) {
  const { remoteJid, isGroup, message, isJadibot, botNumber } = messageInfo;

  if (!isGroup) {
    return true;
  }

  // Sewa grup dicatat PER BOT. Bot utama memakai database/sewa.json;
  // bot milik user (jadibot) memakai sewa yang dicatat owner-nya sendiri
  // (database/bot-scope.json). Dulu bot user dilewati sepenuhnya karena
  // sewa.json dikunci per ID grup: bot user yang kebetulan ada di grup
  // yang sama ikut mengirim notifikasi lalu KELUAR saat sewa bot utama
  // habis. Sekarang tiap bot hanya menilai sewa miliknya sendiri, dan bot
  // user yang tidak punya data sewa untuk grup ini tetap jalan seperti biasa.
  const dataSewa = isJadibot
    ? getBotSewa(botNumber, remoteJid)
    : await findSewa(remoteJid);

  const kunciNotif = `${isJadibot ? botNumber : "utama"}|${remoteJid}`;

  if (dataSewa) {
    const now = Date.now(); 
    const notificationMs = notificationDays * 24 * 60 * 60 * 1000; 
    const timeRemaining = dataSewa.expired - now; 

    // Masih lama: tidak perlu apa-apa (dan tidak perlu metadata grup).
    if (timeRemaining > notificationMs) {
      return;
    }

    const selisihHariSewa = selisihHari(dataSewa.expired);

    // Ambil Metadata Grup
    let adminIds = [];
    try {
      const groupMetadata = await getGroupMetadata(sock, remoteJid);
      const participants = groupMetadata?.participants || [];

      // --- LOGIKA FILTER ADMIN ---
      // Kita filter participant yang punya properti 'admin' (admin atau superadmin)
      const groupAdmins = participants.filter(p => p.admin !== null && p.admin !== undefined);
      adminIds = groupAdmins.map(p => p.id); // Ambil ID Admin saja
    } catch {
      /* tanpa mention admin pun pemberitahuan tetap dikirim */
    }
    // ---------------------------

    // Nama & kontak di pemberitahuan: milik bot INI. Bot user tidak boleh
    // menampilkan nama/nomor operator Varesa ke grup pelanggannya.
    const identitas = getBotIdentity(messageInfo);

    // 1. Notifikasi H-3 (Tag Admin Saja)
    if (timeRemaining <= notificationMs && timeRemaining > 0) {
      if (!notifiedGroups.has(kunciNotif)) {
        if (mess.handler.sewa_notif) {
          let warningMessage = mess.handler.sewa_notif
            .replace("@date", selisihHariSewa)
            .replace("@botname", identitas.name);

          if (isJadibot && identitas.ownerLink) {
            warningMessage += `\n\nPerpanjang sewa? Hubungi owner: ${identitas.ownerLink}`;
          }
          
          // Tambahkan pesan khusus untuk admin
          warningMessage += "\n\ncc: Admin Group";

          logTracking(`Sewa Handler - Send notif sewa ke ${remoteJid}`);
          
          await sock.sendMessage(
            remoteJid,
            { 
                text: warningMessage, 
                mentions: adminIds // <--- HANYA MENTION ID ADMIN
            },
            { quoted: message }
          );
        }

        notifiedGroups.add(kunciNotif);
        return false;
      }
    
    // 2. Notifikasi Expired / Habis (Tag Admin Saja)
    } else if (timeRemaining <= 0) {

      if (mess.handler.sewa_out) {
        // Kontak owner kalau ada; kalau OWNER_NUMBERS kosong, arahkan ke
        // website (dulu jadi "wa.me/undefined"). Bot user: owner bot itu
        // (owner dashboard pertama → nomor bot sendiri).
        const kontak = isJadibot
          ? identitas.ownerLink || `wa.me/${botNumber}`
          : config.owner_number[0]
          ? `wa.me/${config.owner_number[0]}`
          : `${config.web_url}/dashboard`;
        let warningMessage = mess.handler.sewa_out
          .replace("@ownernumber", kontak)
          .replace("@botname", identitas.name);
        
        logTracking(`Sewa Handler - Send notif out sewa ke ${remoteJid}`);
        
        await sock.sendMessage(
          remoteJid,
          { 
              text: warningMessage, 
              mentions: adminIds // <--- HANYA MENTION ID ADMIN
          },
          { quoted: message }
        );
      }

      // Delete database sewa (milik bot ini saja)
      if (isJadibot) {
        delBotSewa(botNumber, remoteJid);
      } else {
        await deleteSewa(remoteJid);
      }
      notifiedGroups.delete(kunciNotif);

      try {
        await leaveGroupWithRetry(sock, remoteJid);
        danger("Sewa Habis", `Berhasil keluar Grub :  ${remoteJid}`);
      } catch (error) {
        console.error(`Gagal keluar dari grup ${remoteJid}:`, error);
        danger("Sewa Habis", `Gagal keluar grup : ${remoteJid}:`);
        logCustom(
          "info",
          "Gagal keluar grup",
          `gagal-keluar-grub-sewa-${remoteJid}.txt`
        );
      }
      return false;
    }
  } else {
    // Bot user tanpa sewa di grup ini: jalan seperti biasa, tanpa log.
    if (isJadibot) {
      return true;
    }
    //Hanya log grup non-sewa satu kali
    if (!nonSewaGroups.has(remoteJid)) {
      logCustom(
        "info",
        "GRUB INI BUKAN TERMASUK SEWABOT",
        `bukan-sewa-${remoteJid}.txt`
      );
      nonSewaGroups.add(remoteJid); 
    }
    if (ONLY_GC_SEWA) {
      return false;
    }
  }
}

export default {
  name: "Sewa Handle",
  priority: 10,
  process,
};