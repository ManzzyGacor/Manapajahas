import axios from "axios";
import { findUser } from "../../lib/users.js";

async function handle(sock, messageInfo) {
    const { remoteJid, message, sender } = messageInfo;

    const userEntry = findUser(sender);
    const userData = userEntry ? userEntry[1] : { limit: 0 };

    const loading = await sock.sendMessage(
        remoteJid,
        { text: "⏳ *Mengambil random pap...*" },
        { quoted: message }
    );

    try {
        const res = await axios.get("https://api-faa.my.id/faa/papayang", {
            responseType: "arraybuffer",
            timeout: 20000
        });

        const finalBuffer = Buffer.from(res.data);

        await sock.sendMessage(
            remoteJid,
            {
                image: finalBuffer,
                caption:
                    "📸 *Random Pap Ayang*\n" +
                    `Limit Tersisa: ${userData.limit || 0}`
            },
            { quoted: message }
        );

        await sock.sendMessage(remoteJid, { delete: loading.key });

    } catch (e) {
        await sock.sendMessage(
            remoteJid,
            {
                text: `❌ Error mengambil pap:\n${String(e.message)}`
            },
            { quoted: message }
        );

        await sock.sendMessage(remoteJid, { delete: loading.key });
    }
}

export default {
    handle,
    Commands: ["randompap", "papayang"],
    Description: "Mengambil pap ayang random.",
    OnlyPremium: false,
    OnlyOwner: false,
    limitDeduction: 3
};