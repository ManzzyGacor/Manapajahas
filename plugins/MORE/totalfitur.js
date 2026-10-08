// plugins/totalfitur.js (ES Module)

/**
 * Handler untuk command totalfitur
 * Mengakses daftar plugin dari global.plugins.
 */
async function handle(sock, messageInfo) {
    const { remoteJid, message, pushName } = messageInfo;

    // --- 1. Mendapatkan daftar perintah dari variabel global yang sudah diisi handler.js ---
    const allPlugins = global.plugins || global.commands || []; 

    if (allPlugins.length === 0) {
        return await sock.sendMessage(
            remoteJid,
            { text: "⚠️ Error: Daftar plugin kosong. Cek kembali `handler.js` atau apakah ada plugin yang termuat." },
            { quoted: message }
        );
    }

    // --- 2. Menghitung Total Perintah Unik ---
    
    const uniqueCommands = new Set();
    
    allPlugins.forEach(plugin => {
        if (plugin && plugin.Commands && Array.isArray(plugin.Commands)) {
            plugin.Commands.forEach(cmd => {
                if (typeof cmd === 'string' && cmd.trim() !== '') {
                    uniqueCommands.add(cmd.toLowerCase());
                }
            });
        }
    });

    const totalCommands = uniqueCommands.size;
    
    // --- 3. Menyusun dan Mengirim Respon ---
    
    const textResponse = `
📊 *STATISTIK FITUR BOT*
─────────────────────
👋 Halo Kak ${pushName}, 

Bot Varesa saat ini memiliki total:
*${totalCommands}* Fitur / Perintah Unik.
*${allPlugins.length}* File Plugin terdaftar.
─────────────────────
`;

    await sock.sendMessage(
        remoteJid,
        { text: textResponse.trim() },
        { quoted: message }
    );
}

// --- ESM Export Default ---
export default {
    handle,
    Commands: ["totalfitur", "totalcmd", "fitur"],
    OnlyPremium: false,
    OnlyOwner: false,
};