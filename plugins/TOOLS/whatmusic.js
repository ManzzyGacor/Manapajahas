import axios from "axios";
import FormData from "form-data";
import { downloadContentFromMessage } from "baileys";
import { findUser } from "../../lib/users.js";

async function uploadToCatbox(buffer) {
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", buffer, "audio.mp3");

    const res = await axios.post("https://catbox.moe/user/api.php", form, {
        headers: form.getHeaders(),
        timeout: 30000
    });

    if (!res.data || !res.data.startsWith("http")) {
        throw new Error("Upload Catbox gagal.");
    }

    return res.data.trim();
}

async function handle(sock, messageInfo) {
    const { remoteJid, message, sender, prefix, command } = messageInfo;

    const msg = message.message || message;
    const quoted = msg?.extendedTextMessage?.contextInfo?.quotedMessage;

    const target = quoted || msg;

    const audio =
        target?.audioMessage ||
        target?.voiceMessage ||
        target?.viewOnceMessage?.message?.audioMessage ||
        target?.viewOnceMessageV2?.message?.audioMessage;

    if (!audio) {
        return sock.sendMessage(
            remoteJid,
            {
                text:
                    "🎵 *WHAT MUSIC IS THIS?*\n" +
                    `Kirim atau reply audio dengan caption *${prefix + command}*`
            },
            { quoted: message }
        );
    }

    const userEntry = findUser(sender);
    const userData = userEntry ? userEntry[1] : { limit: 0 };

    const loading = await sock.sendMessage(
        remoteJid,
        { text: "⏳ *Mendeteksi musik...*" },
        { quoted: message }
    );

    try {
        let buffer = Buffer.from([]);
        const stream = await downloadContentFromMessage(audio, "audio");

        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        const fileUrl = await uploadToCatbox(buffer);

        const apiUrl =
            "https://api-faa.my.id/faa/whatmusic?url=" +
            encodeURIComponent(fileUrl);

        const result = await axios.get(apiUrl, { timeout: 20000 });

        if (!result.data || !result.data.status) {
            throw new Error("Tidak bisa mengenali musik.");
        }

        const music = result.data.result;

        const caption =
            "🎧 *IDENTIFIKASI MUSIK*\n\n" +
            `• *Judul:* ${music.title || "-"}\n` +
            `• *Artist:* ${music.artist || "-"}\n` +
            `• *Durasi:* ${music.duration || "-"}\n` +
            `• *Channel:* ${music.channel || "-"}\n` +
            `• *Upload:* ${music.uploadedAt || "-"}\n` +
            `• *Views:* ${music.views?.toLocaleString("id-ID") || "-"}\n` +
            `• *Link:* ${music.url || "-"}\n\n` +
            ` Sisa Limit: ${userData.limit || 0}`;

        await sock.sendMessage(
            remoteJid,
            {
                image: { url: music.thumbnail },
                caption
            },
            { quoted: message }
        );

        await sock.sendMessage(remoteJid, { delete: loading.key });
    } catch (e) {
        await sock.sendMessage(
            remoteJid,
            { text: `❌ Error:\n${String(e.message)}` },
            { quoted: message }
        );
        await sock.sendMessage(remoteJid, { delete: loading.key });
    }
}

export default {
    handle,
    Commands: ["whatmusic"],
    Description: "Identifikasi musik dari audio dan tampilkan detail Youtube.",
    OnlyPremium: false,
    OnlyOwner: false,
    limitDeduction: 2
};