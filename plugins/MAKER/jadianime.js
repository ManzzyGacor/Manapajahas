import axios from 'axios';
import FormData from 'form-data';
import { downloadContentFromMessage } from 'baileys';
import config from "../../config.js";

// --- KONFIGURASI UTAMA ---
const API_KEY = "Varesa"; 
const API_URL = "https://api.botcahx.eu.org/api/maker/jadianime";

// --- KONFIGURASI TAMPILAN ---
const THUMBNAIL_URL = "https://autoresbot.com/tmp_files/f1d90ac1-89d5-4303-a4d9-46991586bd06.jpg"; 
const SOURCE_URL = config.web_url; // link kartu pratinjau -> website Varesa
const AD_TITLE = "💎 OPEN SEWA BOT VARESA";
const AD_BODY = "Klik di sini untuk info website";

async function handle(sock, messageInfo) {
    const { remoteJid, message, prefix, command } = messageInfo;

    // --- UTILS TAMPILAN ---
    // Objek Context Info untuk AdReply (Biar tidak berulang nulisnya)
    const adReplyContext = {
        externalAdReply: {
            title: AD_TITLE,
            body: AD_BODY,
            thumbnailUrl: THUMBNAIL_URL,
            sourceUrl: SOURCE_URL,
            mediaType: 1,
            renderLargerThumbnail: true 
        }
    };

    try {
        // 1. DEEP DETECTION: Cari gambar
        const msgContent = message.message || message; 
        const quotedMsg = msgContent?.extendedTextMessage?.contextInfo?.quotedMessage;
        const targetMsg = quotedMsg || msgContent;

        const imageMessage = targetMsg?.imageMessage || 
                             targetMsg?.viewOnceMessage?.message?.imageMessage || 
                             targetMsg?.viewOnceMessageV2?.message?.imageMessage;

        if (!imageMessage) {
            return sock.sendMessage(remoteJid, { 
                text: `❌ *Gambar Tidak Ditemukan!* \n\nPastikan kamu mengirim gambar dengan caption *${prefix + command}* atau mereply gambar.`,
                contextInfo: adReplyContext
            }, { quoted: message });
        }

        // 2. KIRIM STATUS AWAL (Simpan key pesan untuk diedit nanti)
        // Kita kirim pesan "Mengonversi..." dan tangkap return object-nya
        const statusMsg = await sock.sendMessage(remoteJid, {
            text: "♻️ *Mengonversi Media ke URL...*\n_Mohon tunggu, sedang memproses gambar._",
            contextInfo: adReplyContext
        }, { quoted: message });

        // Fungsi Helper untuk mengedit pesan status yang sudah dikirim
        const editStatus = async (newText) => {
            await sock.sendMessage(remoteJid, {
                text: newText,
                edit: statusMsg.key, // KUNCI: Masukkan key dari pesan status awal
                contextInfo: adReplyContext // Tetap pertahankan tampilan AdReply
            });
        };

        // 3. DOWNLOAD BUFFER
        const stream = await downloadContentFromMessage(imageMessage, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        // 4. UPLOAD KE CATBOX
        const form = new FormData();
        form.append('fileToUpload', buffer, 'req.jpg');
        form.append('reqtype', 'fileupload');

        const uploadResponse = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: { 
                ...form.getHeaders(),
                'User-Agent': 'Mozilla/5.0' 
            }
        });
        
        const mediaUrl = uploadResponse.data.trim();

        if (!mediaUrl.startsWith("http")) {
            // Jika gagal upload, edit pesan jadi error
            await editStatus("❌ *Gagal Upload Media!* Silakan coba lagi.");
            return; 
        }

        // 5. EDIT PESAN: Ubah status jadi "Sedang Menggambar..."
        // Pesan lama "Mengonversi..." akan berubah teksnya di chat user
        await editStatus("🎨 *Sedang Menggambar Anime...*\n_Request dikirim ke server, sedang merender..._");

        // 6. API CALL (Botcahx)
        const finalApiUrl = `${API_URL}?url=${mediaUrl}&apikey=${API_KEY}`;
        const { data } = await axios.get(finalApiUrl);

        if (!data.status || !data.result) {
            await editStatus("❌ *Gagal Konversi!* Wajah tidak terdeteksi atau server sibuk.");
            return;
        }

        // 7. KIRIM HASIL AKHIR
        // Edit status terakhir menjadi "Sukses" (Opsional, biar rapi)
        await editStatus("✅ *Selesai!* Mengirim hasil...");

        // Kirim Gambar Hasil (Pesan Baru)
        await sock.sendMessage(remoteJid, {
            image: { url: data.result.img_1 },
            caption: `✨ *JADIANIME SUKSES* ✨\n\n👤 *Creator:* ${data.creator}\n🚀 *Powered By:* Varesa MultiDevice`,
            contextInfo: adReplyContext
        }, { quoted: message });

    } catch (error) {
        console.error("Error ToAnime:", error);
        await sock.sendMessage(remoteJid, { 
            text: `❌ *Terjadi Kesalahan:*\n${error.message}`,
            contextInfo: adReplyContext
        }, { quoted: message });
    }
}

export default {
    handle,
    Commands: ["toanime", "jadianime", "wibu"],
    OnlyPremium: false,
    OnlyOwner: false,
    limitDeduction: 1,
};