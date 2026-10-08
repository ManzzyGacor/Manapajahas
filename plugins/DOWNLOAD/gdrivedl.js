import axios from 'axios';
import { reply } from '../../lib/utils.js'; // Pastikan path ini benar sesuai struktur folder Anda

// API Key yang digunakan
const BOTCAHX_API_KEY = "Varesa";
const API_URL = "https://api.botcahx.eu.org/api/download/gdrive";

async function handle(sock, messageInfo) {
    // 1. Ambil properti yang BENAR dari messageInfo (sesuai autoresbot.js)
    const { remoteJid, message, prefix, command, fullText } = messageInfo;

    // 2. Definisikan 'content' manual dengan membuang prefix + command dari fullText
    // Contoh: ".gdrive https://..." menjadi "https://..."
    const content = fullText.slice(prefix.length + command.length).trim();
    
    const input = content ? content.split(/\s+/) : [];

    // Helper function untuk reply aman (menggunakan sock langsung jika reply util gagal)
    const sendReply = async (text) => {
        await sock.sendMessage(remoteJid, { text: text }, { quoted: message });
    };

    // --- Validasi Input ---
    if (input.length === 0) {
        return sendReply( 
            `❌ Format salah. Masukkan URL Google Drive.\nContoh: *${prefix + command} https://drive.google.com/file/d/ID/view*`
        );
    }
    
    const driveUrl = input[0];

    // Validasi URL Google Drive
    if (!driveUrl.includes('drive.google.com')) {
        return sendReply("❌ URL harus berupa tautan Google Drive yang valid.");
    }
    
    await sendReply('⏳ Sedang memproses tautan Google Drive dan mengunduh file...');

    try {
        const apiUrl = `${API_URL}?url=${encodeURIComponent(driveUrl)}&apikey=${BOTCAHX_API_KEY}`;
        
        const response = await axios.get(apiUrl);
        const json = response.data;

        // Cek status API
        if (!json.status || !json.result || !json.result.data) {
            throw new Error(json.message || "Gagal mendapatkan data unduhan Google Drive. Pastikan file bersifat publik.");
        }

        const result = json.result;
        const downloadUrl = result.data;
        const fileName = result.fileName || "file_gdrive.bin"; 
        const fileSize = result.fileSize || "-";
        const mimetype = result.mimetype || 'application/octet-stream';

        // --- Mengirim File sebagai Dokumen ---
        // FIX: Gunakan 'remoteJid' bukan 'm.chat'
        // FIX: Gunakan 'message' untuk quoted, bukan 'm'
        await sock.sendMessage(remoteJid, {
            document: { url: downloadUrl }, 
            fileName: fileName,
            mimetype: mimetype,
            caption: `✅ *File Berhasil Diunduh:*\n\nNama: *${fileName}*\nUkuran: ${fileSize}\n\nCreator API: ${json.creator}`
        }, { quoted: message });
        
    } catch (e) {
        console.error("Error GDrive Downloader:", e);
        
        // Pesan error teks
        await sendReply(`❌ Gagal mengunduh file Google Drive.\n\nDetail Error: ${e.message}`);
    }
}

// Export plugin
export default {
    handle,
    Commands: ["gdrive", "gdl", "gdownload"],
    OnlyPremium: false,
    OnlyOwner: false,
    limitDeduction: 1,
};