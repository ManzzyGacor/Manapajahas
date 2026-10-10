import axios from "axios";
import FormData from "form-data";
import { downloadContentFromMessage } from "baileys";
import { findUser } from "../../lib/users.js";
// Bonus limit dari owner bot ini ikut ditampilkan (berlaku di bot ini saja).
import { bonusLimitText } from "../../lib/bot-scope.js";

// ==============================
// UPLOAD KE CATBOX
// ==============================
async function uploadToCatbox(buffer) {
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", buffer, "image.jpg");

    const res = await axios.post("https://catbox.moe/user/api.php", form, {
        headers: form.getHeaders(),
        timeout: 30000
    });

    if (!res.data || !res.data.startsWith("http"))
        throw new Error("Upload catbox gagal.");

    return res.data.trim();
}

// ==============================
// HANDLE
// ==============================
async function handle(sock, messageInfo) {
    const { remoteJid, message, prefix, command } = messageInfo;

    const msg = message.message || message;
    const quoted = msg?.extendedTextMessage?.contextInfo?.quotedMessage;

    const target = quoted || msg;

    const img =
        target?.imageMessage ||
        target?.viewOnceMessage?.message?.imageMessage ||
        target?.viewOnceMessageV2?.message?.imageMessage;

    if (!img) {
        return sock.sendMessage(
            remoteJid,
            {
                text: `📸 *Kirim atau reply gambar dengan caption:* ${prefix + command}`
            },
            { quoted: message }
        );
    }

    // Ambil data user dari DB
    const userEntry = findUser(message.key.participant || message.participant || message.sender || remoteJid);
    const userData = userEntry ? userEntry[1] : { limit: 0 };

    const loading = await sock.sendMessage(
        remoteJid,
        { text: "⏳ *Memproses Hijab...*\nMohon tunggu." },
        { quoted: message }
    );

    try {
        // DOWNLOAD GAMBAR
        let buffer = Buffer.from([]);
        const stream = await downloadContentFromMessage(img, "image");
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        // UPLOAD CATBOX
        const imageUrl = await uploadToCatbox(buffer);

        // API FAA TOHIJAB
        const apiUrl =
            "https://api-faa.my.id/faa/tohijab?url=" +
            encodeURIComponent(imageUrl);

        const result = await axios.get(apiUrl, {
            responseType: "arraybuffer",
            timeout: 90000
        });

        const finalBuffer = Buffer.from(result.data);

        // ••• KIRIM HASIL + SISA LIMIT •••
        await sock.sendMessage(
            remoteJid,
            {
                image: finalBuffer,
                caption:
                    "🧕✨ *Hijab Applied!*\n" +
                    `Sisa Limit: ${userData.limit || 0}${bonusLimitText(messageInfo)}`
            },
            { quoted: message }
        );

        await sock.sendMessage(remoteJid, { delete: loading.key });

    } catch (e) {
        await sock.sendMessage(
            remoteJid,
            {
                text: `❌ *Gagal membuat hijab:*\n${String(e.message)}`
            },
            { quoted: message }
        );

        await sock.sendMessage(remoteJid, { delete: loading.key });
    }
}

// ==============================
// EXPORT
// ==============================
export default {
    handle,
    Commands: ["tohijab"],
    Description: "Ubah foto menjadi berhijab menggunakan AI FAA.",
    OnlyPremium: false,
    OnlyOwner: false,
    limitDeduction: 2
};