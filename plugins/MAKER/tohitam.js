import axios from "axios";
import FormData from "form-data";
import { downloadContentFromMessage } from "baileys";
import { findUser } from "../../lib/users.js";
// Bonus limit dari owner bot ini ikut ditampilkan (berlaku di bot ini saja).
import { bonusLimitText } from "../../lib/bot-scope.js";

async function uploadToCatbox(buffer) {
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", buffer, "image.jpg");

    const res = await axios.post("https://catbox.moe/user/api.php", form, {
        headers: form.getHeaders(),
        timeout: 30000
    });

    if (!res.data || !res.data.startsWith("http"))
        throw new Error("Upload Catbox gagal.");

    return res.data.trim();
}

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

    const userEntry = findUser(
        message.key.participant ||
        message.participant ||
        message.sender ||
        remoteJid
    );
    const userData = userEntry ? userEntry[1] : { limit: 0 };

    const loading = await sock.sendMessage(
        remoteJid,
        { text: "⏳ *Menerapkan efek Hitam...*\nMohon tunggu." },
        { quoted: message }
    );

    try {
        let buffer = Buffer.from([]);
        const stream = await downloadContentFromMessage(img, "image");
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        const fileUrl = await uploadToCatbox(buffer);

        const apiUrl =
            "https://api-faa.my.id/faa/tohitam?url=" +
            encodeURIComponent(fileUrl);

        const result = await axios.get(apiUrl, {
            responseType: "arraybuffer",
            timeout: 90000
        });

        const finalBuffer = Buffer.from(result.data);

        await sock.sendMessage(
            remoteJid,
            {
                image: finalBuffer,
                caption:
                    "🖤✨ *Hitam Filter Applied!*\n" +
                    `Sisa Limit: ${userData.limit || 0}${bonusLimitText(messageInfo)}`
            },
            { quoted: message }
        );

        await sock.sendMessage(remoteJid, { delete: loading.key });

    } catch (e) {
        await sock.sendMessage(
            remoteJid,
            {
                text: `❌ *Gagal menerapkan filter hitam:*\n${String(e.message)}`
            },
            { quoted: message }
        );

        await sock.sendMessage(remoteJid, { delete: loading.key });
    }
}

export default {
    handle,
    Commands: ["tohitam"],
    Description: "Ubah foto menjadi gaya hitam gelap dengan AI FAA.",
    OnlyPremium: false,
    OnlyOwner: false,
    limitDeduction: 2
};