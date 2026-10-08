import axios from 'axios';
import { logCustom } from "../lib/logger.js"; // Sesuaikan path folder logger lu cuy

// ==========================================================
// 🔴 METADATA PLUGIN
// ==========================================================
export const Name = "openai_chat";
export const Commands = ["gpt"];
export const Description = "AI Chat menggunakan AI (Model GPT-5.6 Terra).";
export const OnlyGroup = true;
export const limitDeduction = 1;

// ==========================================================
// 🔴 FUNGSI HANDLE PLUGIN
// ==========================================================
export async function handle(sock, messageInfo) {
    const { remoteJid, message, prefix, command, content } = messageInfo;
    const isGroup = remoteJid.endsWith("@g.us");

    // --- FITUR ANTI MATI: Blokir eksekusi di Private Chat ---
    if (!isGroup) {
        return; // Silent drop, bot bakal pura-pura budeg di PC
    }

    const text = content; 

    try {
        if (!text || !text.trim()) {
            return await sock.sendMessage(
                remoteJid,
                {
                    text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${prefix + command} 1+1 berapa?*_`,
                },
                { quoted: message }
            );
        }

        // Kirim reaction loading (Biar user tau bot lagi mikir)
        await sock.sendMessage(remoteJid, {
            react: { text: "⏰", key: message.key },
        });

        // --- REQUEST KE API JEREXD ---
        const response = await axios.post(
            'https://api.jerexd.my.id/api/ai/aichat?apikey=VaresaMD',
            {
                prompt: text,
                model: "openai/gpt-5.6-terra"
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        const data = response.data;

        // Validasi response API (Ngecek status code 200 dan status true)
        if (data && data.statusCode === 200 && data.status === true) {
            let responseText = data.result.trim();
            
            // Hapus reaksi loading (diganti jadi kosong)
            await sock.sendMessage(remoteJid, {
                react: { text: "", key: message.key },
            });
            
            // Kirim balasan hasil dari AI
            await sock.sendMessage(remoteJid, { text: responseText }, { quoted: message });
        } else {
            // Lempar error kalau API-nya lagi maintenance atau ngaco
            throw new Error(data.message || "Respon API tidak valid atau server sedang down.");
        }

    } catch (error) {
        // Catat error di file log biar gampang di-track
        logCustom("error", `AI Command Error: ${error.message}`, `ERROR-COMMAND-${command}.txt`);
        
        // Hapus reaksi loading kalau error
        await sock.sendMessage(remoteJid, {
            react: { text: "", key: message.key },
        });
        
        // Kasih tau ke grup kalau AI-nya lagi pusing
        await sock.sendMessage(
            remoteJid,
            { text: `❌ Waduh cuy, AI-nya lagi gangguan nih: ${error.message}` },
            { quoted: message }
        );
    }
}