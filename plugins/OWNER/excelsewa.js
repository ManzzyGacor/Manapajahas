import fs from "fs";
import ExcelJS from "exceljs";

async function handle(sock, messageInfo) {
    const { remoteJid, message, sender } = messageInfo;

    // Lokasi file database sewa
    const pathDatabase = "./database/sewa.json";

    // 1. Cek apakah file database ada
    if (!fs.existsSync(pathDatabase)) {
        return await sock.sendMessage(remoteJid, { text: "❌ Database sewa belum ada." }, { quoted: message });
    }

    // 2. Notifikasi proses (karena ambil metadata grup agak lama jika datanya banyak)
    await sock.sendMessage(remoteJid, { text: "⏳ Sedang merekap data sewa ke Excel..." }, { quoted: message });

    try {
        // Baca dan parse database
        const rawData = fs.readFileSync(pathDatabase, "utf-8");
        const dbSewa = JSON.parse(rawData);
        
        // Cek jika kosong
        if (Object.keys(dbSewa).length === 0) {
            return await sock.sendMessage(remoteJid, { text: "❌ Belum ada grup yang menyewa bot." }, { quoted: message });
        }

        // 3. Setup Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Laporan Sewa Bot");

        // Setup Header
        worksheet.columns = [
            { header: "No", key: "no", width: 5 },
            { header: "Nama Grup", key: "nama", width: 30 },
            { header: "ID Grup", key: "id", width: 25 },
            { header: "Status", key: "status", width: 10 },
            { header: "Tanggal Join", key: "join", width: 20 },
            { header: "Tanggal Expired", key: "expired", width: 20 },
            { header: "Sisa Hari", key: "sisa", width: 15 },
        ];

        // Style Header (Bold & Center)
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).alignment = { horizontal: "center" };

        let nomor = 1;
        const now = Date.now();

        // 4. Looping Data
        // Menggunakan for...of agar bisa await (untuk ambil nama grup)
        for (const [groupId, data] of Object.entries(dbSewa)) {
            let groupName = "Unknown Group";
            
            // Coba ambil nama grup dari metadata WA
            // Note: Ini mungkin agak memperlambat proses jika listnya ratusan
            try {
                const metadata = await sock.groupMetadata(groupId);
                groupName = metadata.subject;
            } catch (e) {
                groupName = "Grup Tidak Dikenal/Keluar";
            }

            // Hitung sisa hari
            const expiredMs = parseInt(data.expired);
            const timeLeft = expiredMs - now;
            const daysLeft = Math.ceil(timeLeft / (1000 * 60 * 60 * 24));
            
            // Tentukan status teks
            let statusText = "Aktif";
            let sisaText = `${daysLeft} Hari`;

            if (daysLeft < 0) {
                statusText = "Expired";
                sisaText = "Habis";
            } else if (!data.status) {
                statusText = "Non-Aktif";
            }

            // Format Tanggal
            const joinDate = new Date(data.date).toLocaleDateString("id-ID");
            const expDate = new Date(expiredMs).toLocaleDateString("id-ID");

            // Masukkan row
            const row = worksheet.addRow({
                no: nomor++,
                nama: groupName,
                id: groupId,
                status: statusText,
                join: joinDate,
                expired: expDate,
                sisa: sisaText
            });

            // Warnai baris jika Expired (Opsional: Merah jika expired)
            if (daysLeft < 0) {
                row.eachCell((cell) => {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFCCCC' } // Warna merah muda
                    };
                });
            }
        }

        // 5. Simpan dan Kirim
        const timestamp = new Date().getTime();
        const fileName = `Laporan_Sewa_${timestamp}.xlsx`;
        const filePath = `./tmp/${fileName}`;

        // Pastikan folder tmp ada
        if (!fs.existsSync("./tmp")) fs.mkdirSync("./tmp");

        await workbook.xlsx.writeFile(filePath);

        await sock.sendMessage(
            remoteJid,
            {
                document: fs.readFileSync(filePath),
                mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                fileName: fileName,
                caption: `📊 *Laporan Data Sewa*\nTotal Grup: ${nomor - 1}`,
            },
            { quoted: message }
        );

        // 6. Hapus file temp
        setTimeout(() => {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }, 5000);

    } catch (error) {
        console.error("Gagal export excel:", error);
        await sock.sendMessage(remoteJid, { text: "❌ Terjadi kesalahan sistem saat export Excel." }, { quoted: message });
    }
}

export default {
    handle,
    Commands: ["excelsewa", "listsewaexcel"], // Command pemicu
    OnlyPremium: false,
    OnlyOwner: true // Sebaiknya hanya owner yg bisa liat
};