import axios from "axios";
import FormData from "form-data";
import { downloadContentFromMessage } from "baileys";
import { findUser } from "../../lib/users.js";

// ==============================
// FUNGSI UPLOAD KE CATBOX
// (Diperlukan karena API butuh URL gambar, bukan buffer)
// ==============================
async function uploadToCatbox(buffer) {
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", buffer, "image.jpg");

    const res = await axios.post("https://catbox.moe/user/api.php", form, {
        headers: form.getHeaders(),
        timeout: 30000 // 30 detik timeout upload
    });

    if (!res.data || !res.data.startsWith("http"))
        throw new Error("Gagal upload gambar sementara.");

    return res.data.trim();
}

// ==============================
// LOGIKA UTAMA
// ==============================
async function handle(sock, messageInfo) {
    const { remoteJid, message, prefix, command, sender } = messageInfo;

    // 1. Deteksi Gambar (Baik dikirim langsung atau direply)
    const msg = message.message || message;
    const quoted = msg?.extendedTextMessage?.contextInfo?.quotedMessage;
    const target = quoted || msg;

    const img =
        target?.imageMessage ||
        target?.viewOnceMessage?.message?.imageMessage ||
        target?.viewOnceMessageV2?.message?.imageMessage;

    // Jika tidak ada gambar
    if (!img) {
        return sock.sendMessage(
            remoteJid,
            {
                text: `📸 *Kirim atau reply gambar dengan caption:* ${prefix + command}\n\n⚠️ _Fitur ini menggunakan 5 Limit_`
            },
            { quoted: message }
        );
    }

    // 2. Kirim pesan Loading
    const loading = await sock.sendMessage(
        remoteJid,
        { text: "⏳ *Sedang menjernihkan foto (HD v4)...*\nMohon tunggu sebentar." },
        { quoted: message }
    );

    try {
        // 3. Download gambar dari WhatsApp menjadi Buffer
        let buffer = Buffer.from([]);
        const stream = await downloadContentFromMessage(img, "image");
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        // 4. Upload Buffer ke Catbox untuk dapat URL
        const imageUrl = await uploadToCatbox(buffer);

        // 5. Panggil API FAA HDv4
        // Menggunakan URL yang kamu berikan
        const apiUrl = `https://api-faa.my.id/faa/hdv4?image=${encodeURIComponent(imageUrl)}`;

        const { data } = await axios.get(apiUrl, { timeout: 60000 }); // Timeout 60 detik

        // Cek respon API
        if (!data.status || !data.result || !data.result.image_upscaled) {
            throw new Error("Gagal mengambil hasil gambar dari API.");
        }

        const resultUrl = data.result.image_upscaled;

        // 6. Download hasil gambar HD (buffer)
        const imageResult = await axios.get(resultUrl, { responseType: 'arraybuffer' });
        const finalBuffer = Buffer.from(imageResult.data);

        // Ambil sisa limit user untuk ditampilkan di caption
        const userEntry = findUser(sender);
        const userData = userEntry ? userEntry[1] : { limit: 0 };

        // 7. Kirim Gambar Hasil
        await sock.sendMessage(
            remoteJid,
            {
                image: finalBuffer,
                caption: `✨ *HD Applied (v4)!*\n` +
                         `Creator: ${data.creator || "Faa"}\n` +
                         `📉 Sisa Limit: ${userData.limit}`
            },
            { quoted: message }
        );

        // Hapus pesan loading
        await sock.sendMessage(remoteJid, { delete: loading.key });

    } catch (e) {
        console.error(e);
        // Hapus pesan loading
        await sock.sendMessage(remoteJid, { delete: loading.key });
        
        // Kirim pesan error
        await sock.sendMessage(
            remoteJid,
            {
                text: `❌ *Gagal proses HD:*\n${e.message || "Terjadi kesalahan pada server API."}`
            },
            { quoted: message }
        );
    }
}

// ==============================
// METADATA PLUGIN
// ==============================
export default {
    handle,
    Commands: ["hdv4", "hd4"], // Alias command
    Description: "Meningkatkan kualitas foto ke HD v4.",
    OnlyPremium: false,
    OnlyOwner: false,
    limitDeduction: 5 // Mengurangi 5 limit setiap pemakaian
};