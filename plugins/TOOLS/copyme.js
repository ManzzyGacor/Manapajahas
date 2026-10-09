import BaileysHelper from "baileys_helper";
import config from "../../config.js";

const { sendInteractiveMessage } = BaileysHelper;

async function handle(sock, messageInfo) {
    const { remoteJid, message, sender, sessionConfig } = messageInfo;

    // Nama bot dari dashboard (Core ke atas), kalau kosong nama bawaan.
    const botName = (sessionConfig?.botName || "").trim() || config.bot_name;

    // Ambil nomor
    const number = sender.replace(/[^0-9]/g, "");

    // Header seperti di menu.js
    const header = {
        title: "📋 Salin Nomor Anda",
        subtitle: botName,
        hasMediaAttachment: false
    };

    // Teks utama
    const caption =
        `🪀 *Nomor Kamu:*\n` +
        `╰┈➤ *${number}*\n\n` +
        `Tekan tombol di bawah untuk menyalin nomor.`;

    // Buttons (pakai BaileysHelper)
    const interactiveButtons = [
        {
            name: "cta_copy",
            buttonParamsJson: JSON.stringify({
                display_text: "📋 SALIN NOMOR",
                copy_code: number
            })
        }
    ];

    // Kirim pesan interaktif
    await sendInteractiveMessage(
        sock,
        remoteJid,
        {
            text: caption,
            footer: botName,
            header,
            interactiveButtons
        },
        { quoted: message }
    );
}

export default {
    handle,
    Commands: ["copyme"],
    OnlyPremium: false,
    OnlyOwner: false
};