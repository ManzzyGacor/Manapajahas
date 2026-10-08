import { checkIfAdmin } from "../../lib/utils.js"; 
import { findGroup } from "../../lib/group.js";

async function handle(sock, messageInfo) {
    const { remoteJid, content, message, prefix, sender } = messageInfo;
    const isGroup = remoteJid.endsWith("@g.us");

    // 1. Silently ignore kalau dipake di Private Chat (biar bot aman gak gampang mati)
    if (!isGroup) {
        return; 
    }

    // 2. Cek apakah yang ngirim command ini admin grup atau bukan
    const isAdmin = await checkIfAdmin(sock, remoteJid, sender);
    
    if (!isAdmin) {
        return sock.sendMessage(
            remoteJid, 
            { text: "⚠️ Maaf cuy, cuma *Admin Grup* yang bisa ganti setingan menu di sini!" }, 
            { quoted: message }
        );
    }

    // 3. Proses argumen yang dikirim
    const args = content ? content.toLowerCase().trim() : "";
    
    // Validasi input: cuma nerima "button" atau "text"
    if (args !== "button" && args !== "text") {
        return sock.sendMessage(
            remoteJid, 
            { text: `Format salah bos!\n\nCara pake:\n${prefix}setmenu button\n${prefix}setmenu text` }, 
            { quoted: message }
        );
    }

    // 4. Update data grup lewat lib/group.js (data di memori yang disimpan
    // berkala). BUG SEBELUMNYA: plugin ini menulis langsung ke file
    // group.json, lalu autosave lib/group.js menimpa file itu dengan data
    // di memorinya — setelan menu kembali ke semula dalam 30 detik.
    const dataGrup = await findGroup(remoteJid);
    if (dataGrup) {
        dataGrup.menu_mode = args;
        dataGrup.updatedAt = new Date().toISOString();
    }
    
    // 5. Kirim konfirmasi berhasil
    sock.sendMessage(
        remoteJid, 
        { text: `✅ Mantap! Tampilan menu di grup ini sekarang diubah ke mode: *${args.toUpperCase()}*` }, 
        { quoted: message }
    );
}

export default {
    handle,
    Commands: ["setmenu"],
    OnlyPremium: false,
    OnlyOwner: false, 
};