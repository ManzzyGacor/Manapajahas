import axios from "axios";
import { logCustom } from "../../lib/logger.js";

// ==========================================================
// INFORMASI PLUGIN
// ==========================================================
export const Name = "ai_image";
export const Commands = ["aiimage"];
export const limitDeduction = 3;
export const Description = "Generate gambar berdasarkan prompt menggunakan API FAA.";
export const OnlyGroup = false;

// ==========================================================
// HANDLE
// ==========================================================
export async function handle(sock, messageInfo) {
    const { remoteJid, message, prefix, command, content } = messageInfo;

    const prompt = content.trim();
    if (!prompt) {
        return await sock.sendMessage(
            remoteJid,
            {
                text: `_⚠️ Contoh:_\n*${
                    prefix + command
                } Seorang dengan baju bernama Iban mencuri besi pagar*`
            },
            { quoted: message }
        );
    }

    try {
        await sock.sendMessage(remoteJid, {
            react: { text: "⏳", key: message.key }
        });

        const apiURL =
            "https://api-faa.my.id/faa/ai-text2img-pro?prompt=" +
            encodeURIComponent(prompt);

        let response;
        try {
            response = await axios.get(apiURL, {
                responseType: "arraybuffer"
            });
        } catch (e) {
            throw new Error(
                `Gagal menghubungi API FAA (Status: ${
                    e.response ? e.response.status : "UNKNOWN"
                })`
            );
        }

        const buffer = Buffer.from(response.data);
        const type = response.headers["content-type"];

        if (!type || !type.startsWith("image/")) {
            throw new Error("API tidak mengembalikan gambar valid.");
        }

        // Kirim hasil
        await sock.sendMessage(
            remoteJid,
            {
                image: buffer,
                caption: `🎨 *AI Generated Image*\nPrompt: _${prompt}_`
            },
            { quoted: message }
        );

        await sock.sendMessage(remoteJid, {
            react: { text: "✔️", key: message.key }
        });
    } catch (err) {
        logCustom(
            "error",
            `AI Image Error: ${err.message}`,
            `ERROR-COMMAND-${command}.txt`
        );

        await sock.sendMessage(remoteJid, {
            react: { text: "❌", key: message.key }
        });

        await sock.sendMessage(
            remoteJid,
            { text: `❌ Error: ${err.message}` },
            { quoted: message }
        );
    }
}