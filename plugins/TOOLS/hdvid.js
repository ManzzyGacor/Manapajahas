import axios from "axios";
import FormData from "form-data";
import { downloadContentFromMessage } from "baileys";
import { findUser } from "../../lib/users.js"; 

// Fungsi untuk mengunggah file ke Catbox.moe
async function uploadToCatbox(buffer, mimeType) {
    const form = new FormData();
    form.append("reqtype", "fileupload");
    
    let filename = 'video.mp4'; 
    if (mimeType && mimeType.includes('video/')) {
        const extension = mimeType.split('/')[1].split(';')[0];
        filename = `video.${extension}`;
    }
    
    form.append("fileToUpload", buffer, filename);

    const res = await axios.post("https://catbox.moe/user/api.php", form, {
        headers: form.getHeaders(),
        timeout: 60000 
    });

    if (!res.data || !res.data.startsWith("http"))
        throw new Error("Upload Catbox gagal atau URL tidak valid.");

    return res.data.trim();
}

async function handle(sock, messageInfo) {
    const { remoteJid, message, prefix, command } = messageInfo;

    const msg = message.message || message;
    const quoted = msg?.extendedTextMessage?.contextInfo?.quotedMessage;
    const target = quoted || msg;

    const vid =
        target?.videoMessage ||
        target?.viewOnceMessage?.message?.videoMessage ||
        target?.viewOnceMessageV2?.message?.videoMessage ||
        target?.imageMessage || // Tambahkan dukungan untuk gambar jika API mengizinkan
        target?.viewOnceMessage?.message?.imageMessage ||
        target?.viewOnceMessageV2?.message?.imageMessage;

    if (!vid) {
        return sock.sendMessage(
            remoteJid,
            {
                text: `🎥 *Kirim atau reply video/gambar dengan caption:* ${prefix + command}`
            },
            { quoted: message }
        );
    }
    
    // Tentukan tipe pesan yang di-reply
    const mediaType = vid?.mimetype?.includes('video') ? 'video' : 'image';
    const mediaKey = mediaType === 'video' ? 'videoMessage' : 'imageMessage';
    const videoMimeType = vid.mimetype;

    const userEntry = findUser(
        message.key.participant ||
        message.participant ||
        message.sender ||
        remoteJid
    );
    const userData = userEntry ? userEntry[1] : { limit: 0 };

    const loading = await sock.sendMessage(
        remoteJid,
        { text: "⏳ *Memproses Video HD...*\nMohon tunggu. Proses ini bisa memakan waktu lama (hingga 5 menit)." },
        { quoted: message }
    );

    try {
        // 1. Download Media
        let buffer = Buffer.from([]);
        // Perbaikan: gunakan mediaKey yang benar
        const stream = await downloadContentFromMessage(vid, mediaType); 
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        
        // 2. Upload ke Catbox
        const fileUrl = await uploadToCatbox(buffer, videoMimeType);

        // 3. Panggil API HD Video (Mendapatkan JSON, bukan buffer)
        const apiUrl =
            "https://api-faa.my.id/faa/hdvid?url=" +
            encodeURIComponent(fileUrl);

        // Timeout 1 (untuk mendapatkan JSON URL dari API)
        const jsonResponse = await axios.get(apiUrl, {
            timeout: 180000 // 3 menit timeout untuk pemrosesan di server
        });
        
        // 🚨 PERBAIKAN KRITIS: Ambil URL dari JSON
        const videoUrl = jsonResponse?.data?.result?.download_url;

        if (!videoUrl) {
            throw new Error("API tidak memberikan tautan unduhan video. Respon API tidak valid.");
        }
        
        // 4. Download Video dari URL yang Diberikan (Mendapatkan Buffer)
        // Timeout 2 (untuk download video hasil)
        const finalVideoResponse = await axios.get(videoUrl, {
            responseType: "arraybuffer", // 🚨 INI DIGUNAKAN DI SINI
            timeout: 300000 // 5 menit timeout untuk download
        });

        const finalBuffer = Buffer.from(finalVideoResponse.data);

        // 5. Kirim kembali hasil video
        await sock.sendMessage(
            remoteJid,
            {
                video: finalBuffer,
                caption:
                    "✨🎥 *Video HD Diterapkan!*\n" +
                    `Sisa Limit: ${userData.limit || 0}`
            },
            { quoted: message }
        );

        // 6. Hapus pesan loading
        await sock.sendMessage(remoteJid, { delete: loading.key });

    } catch (e) {
        // Tangani error
        await sock.sendMessage(
            remoteJid,
            {
                text: `❌ *Gagal memproses Video HD:*\n${String(e.message)}`
            },
            { quoted: message }
        );

        await sock.sendMessage(remoteJid, { delete: loading.key });
    }
}

export default {
    handle,
    Commands: ["hdvid"], 
    Description: "Ubah kualitas video menjadi HD (High Definition) dengan AI FAA.",
    OnlyPremium: false, 
    OnlyOwner: false, 
    limitDeduction: 5 
};