import fs from 'fs/promises';
import path from 'path';

// --- Helper: Format Bytes ke Readable (KB, MB, GB) ---
function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// --- Helper: Menghitung Size Direktori secara Rekursif ---
async function getDirSize(directory, excludedDirs = []) {
    const files = await fs.readdir(directory, { withFileTypes: true });
    let size = 0;
    let count = 0;

    for (const file of files) {
        const filePath = path.join(directory, file.name);

        // Cek apakah folder/file masuk daftar abaikan
        if (excludedDirs.includes(file.name)) continue;

        if (file.isDirectory()) {
            const subDirInfo = await getDirSize(filePath, excludedDirs);
            size += subDirInfo.size;
            count += subDirInfo.count;
        } else {
            try {
                const stats = await fs.stat(filePath);
                size += stats.size;
                count++;
            } catch (e) {
                // Abaikan file yang tidak bisa dibaca (permission error dll)
            }
        }
    }
    return { size, count };
}

/**
 * Handler utama
 */
async function handle(sock, messageInfo) {
    const { remoteJid, message, pushName } = messageInfo;

    // Folder yang TIDAK akan dihitung (node_modules, .git, .npm, .cache diabaikan)
    // Folder 'session' sudah DIHAPUS dari daftar abaikan agar terhitung.
    const ignoredFolders = ['.git', '.npm', '.cache'];
    const rootDir = process.cwd();

    await sock.sendMessage(remoteJid, { react: { text: "📂", key: message.key } });

    try {
        // 1. Hitung Total Seluruh Project (Tidak termasuk yang diabaikan)
        const totalStats = await getDirSize(rootDir, ignoredFolders);

        // 2. Ambil Rincian File/Folder di Root
        const rootFiles = await fs.readdir(rootDir, { withFileTypes: true });
        let detailsText = "";

        // Urutkan: Folder dulu, baru File
        rootFiles.sort((a, b) => (a.isDirectory() === b.isDirectory() ? 0 : a.isDirectory() ? -1 : 1));

        for (const file of rootFiles) {
            // Cek apakah folder/file masuk daftar abaikan saat merinci
            if (ignoredFolders.includes(file.name)) continue; 

            const filePath = path.join(rootDir, file.name);
            let itemSize = 0;

            if (file.isDirectory()) {
                // Saat menghitung ukuran sub-folder, kita tidak perlu filter ignore lagi
                const dirInfo = await getDirSize(filePath, []); 
                itemSize = dirInfo.size;
                detailsText += `📂 *${file.name}/* : ${formatSize(itemSize)}\n`;
            } else {
                const stats = await fs.stat(filePath);
                itemSize = stats.size;
                detailsText += `📄 *${file.name}* : ${formatSize(itemSize)}\n`;
            }
        }

        // 3. Susun Pesan
        const responseText = `
╭───〔 *💾 SERVER STORAGE* 〕───✧
│
│ 📁 *Total Files:* ${totalStats.count.toLocaleString()} Files
│ 📦 *Total Size:* ${formatSize(totalStats.size)}
│
╰──────────────✧

*RINCIAN FILE & FOLDER:*
─────────────────────
${detailsText}
─────────────────────
_Note: Folder node_modules, .git, .npm, & .cache diabaikan dari perhitungan._
`.trim();

        // 4. Kirim Pesan
        await sock.sendMessage(
            remoteJid,
            {
                text: responseText,
                contextInfo: {
                    externalAdReply: {
                        title: "💾 SCRIPT SIZE INFO",
                        body: `Varesa System Info`,
                        thumbnailUrl: "https://autoresbot.com/tmp_files/f1d90ac1-89d5-4303-a4d9-46991586bd06.jpg", 
                        sourceUrl: "https://autoresbot.com",
                        mediaType: 1,
                        renderLargerThumbnail: true
                    }
                }
            },
            { quoted: message }
        );

    } catch (err) {
        console.error(err);
        await sock.sendMessage(remoteJid, { text: "❌ Terjadi kesalahan saat menghitung ukuran file." }, { quoted: message });
    }
}

// --- Export Default ---
export default {
    handle,
    Commands: ["sizesc", "scsize", "ceksizen"],
    OnlyPremium: false,
    OnlyOwner: false,
};