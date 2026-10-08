import fs from 'fs';
import path from 'path';
import axios from 'axios';
// Import file-type untuk mendeteksi tipe file yang akurat
import FileType from 'file-type'; 
import { downloadQuotedMedia, downloadMedia } from "../../lib/utils.js"; 

// --- KONFIGURASI GITHUB KAMU ---
const GH_TOKEN = process.env.GITHUB_TOKEN || ""; // isi GITHUB_TOKEN di .env 
const GH_USERNAME = "ManzzyGacor";    
const GH_REPO = "Urlmanzzy";              
const GH_BRANCH = "main"; 

/**
 * Handler Uploader ke GitHub
 */
async function handle(sock, messageInfo) {
    const { remoteJid, message, isQuoted, type } = messageInfo;

    // Cek apakah ada media
    const isMedia = (type === 'imageMessage' || type === 'videoMessage' || type === 'documentMessage' || type === 'audioMessage' || type === 'stickerMessage');
    const isQuotedMedia = isQuoted && (isQuoted.type === 'image' || isQuoted.type === 'video' || isQuoted.type === 'document' || isQuoted.type === 'audio' || isQuoted.type === 'sticker');

    if (!isMedia && !isQuotedMedia) {
        return sock.sendMessage(remoteJid, { text: "⚠️ Kirim/Reply gambar/video/file dengan caption *.tourl*" }, { quoted: message });
    }

    // 1. Kirim reaksi loading
    await sock.sendMessage(remoteJid, { react: { text: '☁️', key: message.key } });

    let filePath;
    
    try {
        // 2. Download Media ke folder tmp
        const downloadedFileName = isQuoted 
            ? await downloadQuotedMedia(message) 
            : await downloadMedia(message);
        
        if (!downloadedFileName) throw new Error("Gagal download media.");

        // Gabungkan path lengkap
        filePath = path.join(process.cwd(), "tmp", downloadedFileName);

        if (!fs.existsSync(filePath)) {
            throw new Error(`File tidak ditemukan di ${filePath}`);
        }

        // 3. Baca file, tentukan tipe file, dan konversi ke Base64
        
        // Baca file ke dalam Buffer
        const fileBuffer = fs.readFileSync(filePath);
        
        // Deteksi tipe file yang akurat menggunakan file-type
        const fileTypeInfo = await FileType.fromBuffer(fileBuffer);

        let finalExt = path.extname(downloadedFileName); // Fallback
        
        if (fileTypeInfo) {
            // Gunakan ekstensi yang dideteksi file-type
            finalExt = `.${fileTypeInfo.ext}`;
            
            // Logika khusus: Jika message type adalah video, tapi fileTypeInfo adalah image/gif, 
            // kita gunakan ekstensi .gif
            const msgType = isQuoted ? isQuoted.type : type;
            if (msgType === 'video' && fileTypeInfo.mime === 'image/gif') {
                finalExt = '.gif';
            }
        }
        
        // Konversi buffer mentah ke Base64 (Syarat GitHub API)
        const fileContent = fileBuffer.toString('base64');

        // 4. Buat Nama File Unik menggunakan ekstensi yang benar
        const ghFileName = `file_${Date.now()}_${Math.floor(Math.random() * 1000)}${finalExt}`;

        // 5. Upload ke GitHub API
        const apiUrl = `https://api.github.com/repos/${GH_USERNAME}/${GH_REPO}/contents/${ghFileName}`;
        
        await axios.put(apiUrl, {
            message: `Upload via Bot WhatsApp`, // Pesan commit
            content: fileContent,
            branch: GH_BRANCH
        }, {
            headers: {
                'Authorization': `Bearer ${GH_TOKEN}`,
                'Content-Type': 'application/json',
                'User-Agent': 'WhatsApp-Bot-Uploader'
            }
        });

        // 6. Hapus file lokal (Bersih-bersih)
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        // 7. Generate URL Raw (Direct Link)
        const rawUrl = `https://raw.githubusercontent.com/${GH_USERNAME}/${GH_REPO}/${GH_BRANCH}/${ghFileName}`;

        // 8. Kirim Hasil
        await sock.sendMessage(remoteJid, { react: { text: '✅', key: message.key } });
        
        // Hitung ukuran file dari buffer
        const fileSize = formatSize(fileBuffer.length); 
        
        const caption = `✅ *Upload Berhasil!*\n\n🔗 *URL:* ${rawUrl}\n📂 *Filename:* ${ghFileName}\n📦 *Size:* ${fileSize}`;
        
        await sock.sendMessage(remoteJid, { text: caption }, { quoted: message });

    } catch (e) {
        console.error("Upload Error:", e);
        // Hapus file jika error tapi file sudah terdownload
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        
        const errMsg = e.response?.data?.message || e.message;
        await sock.sendMessage(remoteJid, { text: `❌ Gagal Upload ke GitHub: ${errMsg}` }, { quoted: message });
    }
}

// Helper: Format Ukuran File
function formatSize(bytes) {
    if (bytes >= 1073741824) { bytes = (bytes / 1073741824).toFixed(2) + " GB"; }
    else if (bytes >= 1048576) { bytes = (bytes / 1048576).toFixed(2) + " MB"; }
    else if (bytes >= 1024) { bytes = (bytes / 1024).toFixed(2) + " KB"; }
    else if (bytes > 1) { bytes = bytes + " bytes"; }
    else if (bytes == 1) { bytes = bytes + " byte"; }
    else { bytes = "0 bytes"; }
    return bytes;
}

export default {
    handle,
    Commands: ["tourl", "upload", "uploader"],
    OnlyPremium: false,
    OnlyOwner: false
};