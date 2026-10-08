import { addSewa, listSewa } from "../../lib/sewa.js"; 
import { selisihHari } from "../../lib/utils.js";

async function handle(sock, messageInfo) {
    const { remoteJid, message, content, prefix, command } = messageInfo;

    // 1. Validasi Input
    if (!content || content.trim() === "") {
        return await sock.sendMessage(
            remoteJid,
            {
                text: `⚠️ *Format Kompensasi Massal*\n\n` +
                      `Gunakan format: *${prefix + command} <jumlah> <satuan>*\n` +
                      `Satuan: *jam* atau *hari*\n\n` +
                      `✅ Contoh:\n` +
                      `*${prefix + command} 2 jam* (Tambah 2 jam ke semua grup)\n` +
                      `*${prefix + command} 3 hari* (Tambah 3 hari ke semua grup)`
            },
            { quoted: message }
        );
    }

    const args = content.trim().split(" ");
    const amount = parseInt(args[0]);
    const unit = args[1]?.toLowerCase();

    // 2. Validasi Angka
    if (isNaN(amount) || amount <= 0) {
        return await sock.sendMessage(remoteJid, { text: "⚠️ Jumlah waktu harus berupa angka positif!" }, { quoted: message });
    }

    // 3. Tentukan Multiplier Waktu
    let multiplier = 0;
    let unitName = "";

    if (["jam", "hour", "hours"].includes(unit)) {
        multiplier = 60 * 60 * 1000; // 1 Jam dalam ms
        unitName = "Jam";
    } else if (["hari", "day", "days"].includes(unit)) {
        multiplier = 24 * 60 * 60 * 1000; // 1 Hari dalam ms
        unitName = "Hari";
    } else {
        return await sock.sendMessage(remoteJid, { text: "⚠️ Satuan waktu tidak valid. Gunakan 'jam' atau 'hari'." }, { quoted: message });
    }

    const compensationTime = amount * multiplier;

    // Kirim reaksi loading
    await sock.sendMessage(remoteJid, { react: { text: "⏳", key: message.key } });

    try {
        // 4. Ambil Semua Data Sewa
        const allGroups = await listSewa(); // Menggunakan fungsi dari sewa.js
        
        if (!allGroups) {
            return await sock.sendMessage(remoteJid, { text: "❌ Tidak ada data sewa ditemukan di database." }, { quoted: message });
        }

        let successCount = 0;
        let activeGroupsCount = 0;

        // Data dari listSewa berbentuk Object { "id_grup": {data}, ... }
        // Kita ubah jadi array of keys (ID Grup) untuk di-loop
        const groupIds = Object.keys(allGroups);

        for (const groupId of groupIds) {
            const groupData = allGroups[groupId];

            // 5. Cek apakah grup masih aktif (expired belum lewat)
            // Jika expired null/undefined, kita skip agar aman
            if (groupData.expired && groupData.expired > Date.now()) {
                
                // Tambahkan waktu expired lama dengan waktu kompensasi
                const newExpired = groupData.expired + compensationTime;

                // 6. Update Database
                // addSewa di sewa.js sudah menggunakan spread operator (...userData)
                // jadi aman cuma kirim expired baru saja.
                await addSewa(groupId, {
                    expired: newExpired
                });

                successCount++;
            }
        }

        // 7. Laporan Berhasil
        const reportText = 
            `✅ *KOMPENSASI BERHASIL*\n\n` +
            `🎁 Tambahan Waktu: *${amount} ${unitName}*\n` +
            `📊 Grup Diperpanjang: *${successCount}* Grup\n\n` +
            `_Masa aktif seluruh grup sewa yang aktif telah diperpanjang otomatis._`;

        return await sock.sendMessage(
            remoteJid,
            { text: reportText },
            { quoted: message }
        );

    } catch (error) {
        console.error("Error Kompensasi:", error);
        return await sock.sendMessage(
            remoteJid,
            { text: `❌ Terjadi kesalahan sistem saat memproses kompensasi.` },
            { quoted: message }
        );
    }
}

export default {
    handle,
    Commands: ["kompensasi"],
    OnlyPremium: false,
    OnlyOwner: true // Wajib Owner!
};