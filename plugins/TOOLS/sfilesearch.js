// Plugins: SFileMobi Search
// API by BOTCAHX (apikey: Varesa)
import axios from "axios";

const SF_API_KEY = "Varesa";
const SF_BASE_URL = "https://api.botcahx.eu.org/api/search/sfilemobi";

async function handle(sock, messageInfo) {
    const {
        remoteJid,
        message,
        content,
        prefix,
        command,
        pushName,
    } = messageInfo;

    const usedPrefix = prefix || ".";
    const cmdName = command || "sfilemobi";

    // Ambil query dari content
    let query = (content || "").trim();

    // Kalau router kamu mengisi content dengan full teks (termasuk prefix+cmd),
    // bisa fallback parsing manual:
    if (!query && message?.message?.conversation) {
        const fullText = message.message.conversation.trim();
        const lower = fullText.toLowerCase();
        const trigger1 = `${usedPrefix}${cmdName}`.toLowerCase();
        if (lower.startsWith(trigger1)) {
            query = fullText.slice(trigger1.length).trim();
        }
    }

    if (!query) {
        const usageText =
            `🔍 *SFileMobi Search*\n` +
            `Kirim perintah dengan kata kunci.\n\n` +
            `*Contoh:*\n` +
            `• ${usedPrefix}${cmdName} Happy Mod\n` +
            `• ${usedPrefix}${cmdName} Minecraft\n`;
        await sock.sendMessage(
            remoteJid,
            { text: usageText },
            { quoted: message }
        );
        return;
    }

    let statusMsg = null;

    try {
        // Kirim status "sedang mencari..."
        statusMsg = await sock.sendMessage(
            remoteJid,
            {
                text: `⏳ *Mencari di SFileMobi...*\n_Kata kunci:_ *${query}*`,
            },
            { quoted: message }
        );

        const editStatus = async (newText) => {
            if (statusMsg && statusMsg.key) {
                await sock.sendMessage(remoteJid, {
                    text: newText,
                    edit: statusMsg.key,
                });
            }
        };

        const url = `${SF_BASE_URL}?text1=${encodeURIComponent(
            query
        )}&apikey=${SF_API_KEY}`;

        const response = await axios.get(url, {
            timeout: 20000,
            validateStatus: (s) => s >= 200 && s < 500,
        });

        const data = response.data || {};

        if (response.status >= 400) {
            throw new Error(
                `Request gagal dengan status ${response.status}`
            );
        }

        if (!data.status || !Array.isArray(data.result)) {
            const reason =
                data.message ||
                data.msg ||
                "Response tidak valid atau status=false.";
            throw new Error(reason);
        }

        const results = data.result;

        if (!results.length) {
            await editStatus(
                `❌ *Tidak ada hasil ditemukan di SFileMobi.*\n_Kata kunci:_ *${query}*`
            );
            return;
        }

        // Batasi misal 10 hasil biar tidak kepanjangan
        const maxShow = 10;
        const sliced = results.slice(0, maxShow);

        let txt = `📂 *SFileMobi Search Result*\n`;
        txt += `👤 User: *${pushName || "Guest"}*\n`;
        txt += `🔎 Query: *${query}*\n`;
        txt += `📦 Ditemukan: *${results.length}* file\n`;
        if (results.length > maxShow) {
            txt += `⚠️ Ditampilkan pertama *${maxShow}* hasil.\n`;
        }
        txt += `\n`;

        sliced.forEach((item, idx) => {
            txt += `*${idx + 1}. ${item.title || "-"}*\n`;
            txt += `   • 📏 Size : ${item.size || "-"}\n`;
            txt += `   • 🔗 Link : ${item.url || "-"}\n\n`;
        });

        txt += `—\n⚠️ *Note:*\nLink di atas menuju halaman download di SFileMobi.`;

        await editStatus(txt);
    } catch (err) {
        const msg =
            (err && err.message) ||
            "Terjadi kesalahan tak diketahui saat menghubungi API.";
        if (statusMsg && statusMsg.key) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *Gagal mengambil data SFileMobi!*\n\n*Error:* ${msg}`,
                edit: statusMsg.key,
            });
        } else {
            await sock.sendMessage(
                remoteJid,
                {
                    text: `❌ *Gagal mengambil data SFileMobi!*\n\n*Error:* ${msg}`,
                },
                { quoted: message }
            );
        }
    }
}

export default {
    handle,
    Commands: ["sfilemobi", "sfile"],
    OnlyPremium: false,
    OnlyOwner: false,
    limitDeduction: 1,
};