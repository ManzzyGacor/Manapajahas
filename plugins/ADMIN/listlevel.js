import { sendMessageWithMention } from "../../lib/utils.js";
import { readUsers } from "../../lib/users.js";

async function handle(sock, messageInfo) {
    const { remoteJid, message } = messageInfo; 
    
    try {
        const dataUsers = await readUsers();
        // Variabel mentionedJids tidak lagi diperlukan karena utils.js yang mengekstraknya
        
        const title = `LEVEL SELURUH PENGGUNA (TOP 50 GLOBAL)`;
        
        const sortedUsers = Object.entries(dataUsers)
            .sort((a, b) => (b[1]?.level || 0) - (a[1]?.level || 0))
            .filter(([id, user]) => (user.level || 0) > 0)
            .slice(0, 50); 
            
        
        if (sortedUsers.length === 0) {
            return await sock.sendMessage(remoteJid, { text: "❌ Tidak ada pengguna bot yang memiliki data Level (> 0)." }, { quoted: message });
        }

        const displayLimit = 50; 

        
        const levelList = sortedUsers
            .map(([, user], index) => {
                
                if (
                    !user.aliases ||
                    !Array.isArray(user.aliases) ||
                    user.aliases.length === 0
                )
                    return null; 
                    
                let alias;
                
                // Cari alias JID WhatsApp (@s.whatsapp.net)
                const jidAliasFull = user.aliases.find((a) => a.endsWith("@s.whatsapp.net"));
                
                if (jidAliasFull) {
                    // Jika JID WhatsApp ditemukan:
                    // Alias harus berupa NOMOR saja agar sendMessageWithMention dapat bekerja
                    alias = jidAliasFull.split("@")[0]; 
                    
                } else {
                    // Jika tidak ada JID WhatsApp, cari alias @lid
                    const lidAlias = user.aliases.find((a) => a.endsWith("@lid"));
                    if (lidAlias) {
                        // Jika LID ditemukan, gunakan sebagai alias tapi tidak akan bisa di-mention
                        alias = lidAlias.split("@")[0];
                    } else {
                        // Jika tidak ada alias WA atau LID, lewati
                        return null; 
                    }
                }
                
                const level = user.level || 0;
                
                // Format: ┣ ⌬ *#{Ranking}* | Level: *{Level}* | @{Alias}
                // @{Alias} di sini akan di-extract oleh utils.js untuk mention
                return `┣ ⌬ *#${index + 1}* | Level: *${level}* | @${alias}`; 
            })
            .filter(Boolean)
            .join("\n");
            
        
        const footerText = sortedUsers.length < Object.entries(dataUsers).length
              ? `\n_Hanya menampilkan ${displayLimit} pengguna teratas dari total ${Object.entries(dataUsers).length} pengguna._`
              : "";
              
        const textNotif = `┏━『 *${title.toUpperCase()}* 』\n┣\n${levelList}\n┗━━━━━━━━━━━━━━━━━━${footerText}`;

        // Kirim pesan menggunakan fungsi mention. Fungsi ini akan mengekstrak JID dari textNotif.
        await sendMessageWithMention(
            sock,
            remoteJid,
            textNotif,
            message
            // Parameter mentionedJids yang kelima dihilangkan
        );

    } catch (error) {
        console.error("❌ Fatal Error in listlevel (Global):", error); 
        await sock.sendMessage(
            remoteJid,
            { text: "⚠️ Terjadi kesalahan saat menampilkan daftar Level Global. Periksa log konsol untuk detailnya." },
            { quoted: message }
        );
    }
}

export default {
    handle,
    Commands: ["listlevel"], // Hanya listlevel
    OnlyGroup: false, 
    OnlyPremium: false,
    OnlyOwner: false,
};