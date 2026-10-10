import { sendMessageWithMention } from "../../lib/utils.js";
import { readUsers } from "../../lib/users.js"; 
import { getGroupMetadata } from "../../lib/cache.js"; // Tetap diimpor
import mess from "../../strings.js"; // Tetap diimpor

async function handle(sock, messageInfo) {
  const { remoteJid, isGroup, message } = messageInfo;
  
  if (!isGroup) return; // Hanya untuk grup

  try {
    // Baca data user dari database atau file
    const dataUsers = await readUsers();

    
    const sortedUsers = Object.entries(dataUsers)
      .sort((a, b) => {
        // Mengambil Level (default 0 jika field tidak ada)
        const levelA = a[1]?.level || 0; 
        const levelB = b[1]?.level || 0;

        // Urutkan berdasarkan Level (B - A = descending/tertinggi)
        return levelB - levelA; 
      })
      .slice(0, 5); // Ambil Top 5

    const mentionedJids = []; // Untuk menampung JID yang akan di-mention
    
    const aliasList = sortedUsers
      .map(([id, user], index) => {
        // --- Logika Ekstraksi Alias (Dipertahankan dari kode Anda) ---
        if (
          !user.aliases ||
          !Array.isArray(user.aliases) ||
          user.aliases.length === 0
        )
          return null;

        let displayAlias;
        // Cari JID WhatsApp (nomor@s.whatsapp.net)
        let jidAlias = user.aliases.find((a) => a.endsWith("@s.whatsapp.net"));

        if (jidAlias) {
            displayAlias = jidAlias.split("@")[0];
        } else {
            // Coba cari alias @lid jika JID WhatsApp tidak ditemukan
            let lidAlias = user.aliases.find((a) => a.endsWith("@lid"));
            if (lidAlias) {
                displayAlias = lidAlias.split("@")[0];
            } else {
                return null; // Tidak ada alias yang valid
            }
        }

        mentionedJids.push(id); 


        const level = user.level || 0;
        
        let rankSymbol;
        switch (index) {
            case 0:
                rankSymbol = "🥇";
                break;
            case 1:
                rankSymbol = "🥈";
                break;
            case 2:
                rankSymbol = "🥉";
                break;
            default:
                rankSymbol = "◗";
                break;
        }

        // Format output baru yang lebih menarik
        return `┣ ${rankSymbol} Rank #${index + 1}: @${displayAlias}\n┣ ╰ Level: ${level}\n┣`;
      })
      .filter(Boolean)
      .join("\n");
      
    // Tambahkan baris penutup jika ada data
    const closingLine = sortedUsers.length > 0 ? "\n┗━━━━━━━━━━━━━━━━━━━━" : "\n┗━━━━━━━━━━━━━━━━━━━━";

    const textNotif = `┏━『 *TOP 5 PLAYER LEVEL TERTINGGI* 』\n┣\n${aliasList.trim()}\n${closingLine}`;

    // Kirim pesan dengan mention
    await sendMessageWithMention(
      sock,
      remoteJid,
      textNotif,
      message,
      mentionedJids 
    );

  } catch (error) {
    console.error("Error in toprank:", error);
    await sock.sendMessage(
      remoteJid,
      { text: "⚠️ Terjadi kesalahan saat menampilkan Top Rank. Pastikan field `level` ada di data user." },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["toprank"],
  OnlyPremium: false,
  OnlyOwner: false,
};