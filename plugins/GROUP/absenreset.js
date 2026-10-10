import { findAbsen, updateAbsen } from "../../lib/absen.js";
import { getGroupMetadata } from "../../lib/cache.js";

async function handle(sock, messageInfo) {
    const { remoteJid, isGroup, message, sender, prefix, command } = messageInfo;
    
    if (!isGroup) return; // Hanya berlaku di Grup

    try {
        // 1. Pengecekan Admin Pengguna (Wajib Admin)
        const groupMetadata = await getGroupMetadata(sock, remoteJid);
        const participants = groupMetadata.participants;
        const isAdmin = participants.some(
            (p) => (p.phoneNumber === sender || p.id === sender) && p.admin
        );

        if (!isAdmin) {
            await sock.sendMessage(
                remoteJid,
                { text: `⚠️ Perintah *${prefix}${command}* hanya bisa digunakan oleh Admin Grup.` },
                { quoted: message }
            );
            return;
        }

        // 2. Ambil data absen
        const absenData = await findAbsen(remoteJid);

        // 3. Cek apakah ada data yang perlu direset
        if (!absenData || absenData.member.length === 0) {
            return await sock.sendMessage(
                remoteJid,
                { text: "⚠️ Data absen hari ini sudah kosong atau belum pernah dimulai." },
                { quoted: message }
            );
        }

        // 4. Reset daftar member (member: [])
        // Ini akan mengosongkan daftar anggota yang sudah absen
        const success = await updateAbsen(remoteJid, { member: [] });

        if (success) {
            return await sock.sendMessage(
                remoteJid,
                { text: "✅ Absen berhasil direset! Daftar anggota yang absen hari ini sudah dikosongkan." },
                { quoted: message }
            );
        } else {
             return await sock.sendMessage(
                remoteJid,
                { text: "❌ Gagal mereset absen. Terjadi kesalahan saat menyimpan data." },
                { quoted: message }
            );
        }
        
    } catch (error) {
        console.error("Error handling resetabsen:", error);
        await sock.sendMessage(
            remoteJid,
            { text: "❌ Terjadi kesalahan tak terduga saat mencoba mereset absen. Periksa log konsol." },
            { quoted: message }
        );
    }
}

export default {
    handle,
    Commands: ["resetabsen"],
    OnlyPremium: false,
    OnlyOwner: false,
};