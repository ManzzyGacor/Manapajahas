const ONLY_GC_SEWA = false; 

import { findSewa, deleteSewa } from "../lib/sewa.js";
import config from "../config.js";
import { selisihHari, danger, logTracking } from "../lib/utils.js";
import { logCustom } from "../lib/logger.js";
import { getGroupMetadata } from "../lib/cache.js";
import mess from "../strings.js";

const notificationDays = 3; 
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
  const { remoteJid, isGroup, message, isJadibot } = messageInfo;

  if (!isGroup) {
    return true;
  }

  // Sistem sewa grup hanya milik BOT UTAMA. database/sewa.json dikunci per
  // ID grup, jadi tanpa pengecekan ini bot milik user (jadibot) yang
  // kebetulan ada di grup yang sama ikut mengirim notifikasi sewa, lalu
  // KELUAR dari grup saat sewa bot utama habis.
  if (isJadibot) {
    return true;
  }

  const dataSewa = await findSewa(remoteJid);

  if (dataSewa) {
    const now = Date.now(); 
    const notificationMs = notificationDays * 24 * 60 * 60 * 1000; 
    const timeRemaining = dataSewa.expired - now; 

    const selisihHariSewa = selisihHari(dataSewa.expired);

    // Ambil Metadata Grup
    const groupMetadata = await getGroupMetadata(sock, remoteJid);
    const participants = groupMetadata.participants;

    // --- LOGIKA FILTER ADMIN ---
    // Kita filter participant yang punya properti 'admin' (admin atau superadmin)
    const groupAdmins = participants.filter(p => p.admin !== null && p.admin !== undefined);
    const adminIds = groupAdmins.map(p => p.id); // Ambil ID Admin saja
    // ---------------------------

    // 1. Notifikasi H-3 (Tag Admin Saja)
    if (timeRemaining <= notificationMs && timeRemaining > 0) {
      if (!notifiedGroups.has(remoteJid)) {
        if (mess.handler.sewa_notif) {
          let warningMessage = mess.handler.sewa_notif.replace(
            "@date",
            selisihHariSewa
          );
          
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

        notifiedGroups.add(remoteJid); 
        return false;
      }
    
    // 2. Notifikasi Expired / Habis (Tag Admin Saja)
    } else if (timeRemaining <= 0) {

      if (mess.handler.sewa_out) {
        // Kontak owner kalau ada; kalau OWNER_NUMBERS kosong, arahkan ke
        // website (dulu jadi "wa.me/undefined").
        const kontak = config.owner_number[0]
          ? `wa.me/${config.owner_number[0]}`
          : `${config.web_url}/dashboard`;
        let warningMessage = mess.handler.sewa_out.replace(
          "@ownernumber",
          kontak
        );
        
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

      // Delete database sewa
      await deleteSewa(remoteJid);

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