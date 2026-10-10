import axios from 'axios';
import FormData from 'form-data';
import { downloadContentFromMessage } from 'baileys';
import config from "../../config.js";

// --- Metadata Plugin ---
export const Name = "ocr";
export const Commands = ["ocr", "totext"];
export const Description = "Mengambil teks dari sebuah gambar (Optical Character Recognition).";
export const OnlyGroup = false;
export const limitDeduction = 2;

// --- Konfigurasi API ---
const API_KEY = config.ANABOT_APIKEY || "freeApikey";
const OCR_API_URL = "https://anabot.my.id/api/tools/ocr";

/**
 * Fungsi utama untuk menangani command .ocr
 * @param {object} sock - Instance koneksi Baileys.
 * @param {object} messageInfo - Informasi detail tentang pesan yang masuk.
 */
export async function handle(sock, messageInfo) {
    const { remoteJid, message, prefix, command } = messageInfo;

    try {
        // 1. Deteksi gambar di pesan atau di pesan yang direply
        const msgContent = message.message || message;
        const quotedMsg = msgContent?.extendedTextMessage?.contextInfo?.quotedMessage;
        const targetMsg = quotedMsg || msgContent;

        const imageMessage = targetMsg?.imageMessage ||
                             targetMsg?.viewOnceMessage?.message?.imageMessage ||
                             targetMsg?.viewOnceMessageV2?.message?.imageMessage;

        if (!imageMessage) {
            return sock.sendMessage(remoteJid, {
                text: `❌ *Gambar Tidak Ditemukan!*\n\nPastikan Anda mengirim gambar dengan caption *${prefix + command}* atau membalas gambar.`
            }, { quoted: message });
        }

        // 2. Kirim pesan status awal
        const statusMsg = await sock.sendMessage(remoteJid, {
            text: "♻️ *Memproses Gambar...*\n_Mohon tunggu, sedang menyiapkan media._"
        }, { quoted: message });

        const editStatus = async (newText) => {
            await sock.sendMessage(remoteJid, {
                text: newText,
                edit: statusMsg.key,
            });
        };

        // 3. Unduh buffer gambar
        const stream = await downloadContentFromMessage(imageMessage, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        // 4. Unggah gambar ke Catbox untuk mendapatkan URL
        await editStatus("📤 *Mengunggah Media...*\n_Gambar sedang diunggah ke server sementara._");
        
        const form = new FormData();
        form.append('fileToUpload', buffer, 'ocr-image.jpg');
        form.append('reqtype', 'fileupload');

        const uploadResponse = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: { ...form.getHeaders(), 'User-Agent': 'Mozilla/5.0' }
        });
        
        const mediaUrl = uploadResponse.data.trim();

        if (!mediaUrl.startsWith("http")) {
            await editStatus("❌ *Gagal Mengunggah Media!* Server upload sedang bermasalah. Coba lagi nanti.");
            return;
        }

        // 5. Panggil API OCR dengan URL yang didapat
        await editStatus("✍️ *Mengekstrak Teks...*\n_Permintaan OCR dikirim ke server._");

        const finalApiUrl = `${OCR_API_URL}?imageUrl=${encodeURIComponent(mediaUrl)}&apikey=${API_KEY}`;
        const { data: ocrResult } = await axios.get(finalApiUrl);

        // 6. Proses hasil dari API (INI BAGIAN YANG DIPERBAIKI)
        if (!ocrResult.success || !ocrResult.data?.result) {
            const errorMessage = ocrResult.message || "API OCR tidak memberikan hasil yang valid.";
            throw new Error(errorMessage);
        }

        const extractedText = ocrResult.data.result.trim();
        // ----------------------------------------------------

        if (!extractedText) {
            await editStatus("ℹ️ *Tidak Ada Teks Terdeteksi*\nTidak ada teks yang dapat ditemukan pada gambar ini.");
            return;
        }

        // 7. Kirim hasil
        await editStatus("✅ *Ekstraksi Selesai!* Mengirim hasil...");

        const resultText = `
*--- 📝 HASIL PEMINDAIAN (OCR) 📝 ---*

${extractedText}
        `.trim();

        await sock.sendMessage(remoteJid, { text: resultText }, { quoted: message });

    } catch (error) {
        console.error("Error di Plugin OCR:", error);
        await sock.sendMessage(remoteJid, {
            text: `❌ *Terjadi Kesalahan:*\n${error.message}`
        }, { quoted: message });
    }
}

export default {
    handle,
    Commands,
    Description,
    OnlyGroup,
    limitDeduction,
};
