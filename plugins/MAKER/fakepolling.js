// plugins/fakepoll.js

/**
 * Handler untuk command fakepoll
 * Membuat tampilan hasil voting palsu (Fake Poll Result)
 */
async function handle(sock, messageInfo) {
    // Ambil fullText, prefix, dan command dari messageInfo
    const { remoteJid, message, fullText, prefix, command } = messageInfo;

    // --- LOGIKA PENGAMBILAN TEKS (FIX ERROR JOIN) ---
    // Hitung panjang karakter (prefix + command)
    const prefixLen = prefix ? prefix.length : 0;
    const commandLen = command ? command.length : 0;
    
    // Ambil sisa teks setelah command (Input User)
    const input = fullText.slice(prefixLen + commandLen).trim();

    if (!input || !input.includes("|")) {
        return await sock.sendMessage(
            remoteJid, 
            { 
                text: `❌ *Format salah!*

Cara Penggunaan: 
.fakepoll Judul|Opsi1,Angka|Opsi2,Angka

*Contoh:*
> .fakepoll Siapa yang paling ganteng?|Admin,9999|Member,10|Bot,5000` 
            }, 
            { quoted: message }
        );
    }

    // 1. Pisah judul dan opsi berdasarkan '|' pertama
    const firstPipe = input.indexOf("|");
    const title = input.slice(0, firstPipe).trim();
    const optionsRaw = input.slice(firstPipe + 1);

    // Validasi judul
    if (title.length === 0) return await sock.sendMessage(remoteJid, { text: "⚠️ Judulnya mana? Kok gak ada!" }, { quoted: message });
    if (title.length > 200) return await sock.sendMessage(remoteJid, { text: "⚠️ Judul maksimal 200 karakter!" }, { quoted: message });

    // 2. Pecah opsi: opsi1,jumlah|opsi2,jumlah|...
    const optionParts = optionsRaw
        .split("|")
        .map(v => v.trim())
        .filter(v => v);

    if (optionParts.length === 0) return await sock.sendMessage(remoteJid, { text: "⚠️ Minimal harus ada 1 opsi!" }, { quoted: message });
    if (optionParts.length > 10) return await sock.sendMessage(remoteJid, { text: "⚠️ Maksimal 10 opsi!" }, { quoted: message });

    const pollVotes = [];

    for (const part of optionParts) {
        // Cek apakah ada koma pemisah antara nama dan jumlah
        if (!part.includes(",")) continue;

        // Pisahkan Nama Opsi dan Jumlah Vote
        // Menggunakan lastIndexOf agar nama opsi boleh mengandung koma lain
        const lastComma = part.lastIndexOf(",");
        const name = part.slice(0, lastComma).trim();
        const countStr = part.slice(lastComma + 1).trim();

        if (!name || !countStr) continue;

        // Validasi nama opsi
        if (name.length > 50) return await sock.sendMessage(remoteJid, { text: `⚠️ Opsi "${name}" terlalu panjang (maks 50 karakter)!` }, { quoted: message });

        // Validasi jumlah (ambil angka saja)
        const voteCount = parseInt(countStr.replace(/\D/g, ""), 10);
        if (isNaN(voteCount) || voteCount < 0) continue;

        pollVotes.push({
            optionName: name,
            optionVoteCount: voteCount
        });
    }

    if (pollVotes.length === 0) {
        return await sock.sendMessage(remoteJid, { text: "⚠️ Format opsi salah! Gunakan: Opsi,Jumlah" }, { quoted: message });
    }

    // 3. Kirim Pesan (Relay Message)
    try {
        await sock.relayMessage(
            remoteJid, 
            {
                pollResultSnapshotMessage: {
                    name: title,
                    pollVotes: pollVotes,
                    contextInfo: {
                        // Agar pesan terlihat seolah-olah dibalas/diquote
                        stanzaId: message.key.id,
                        participant: message.key.participant || message.key.remoteJid,
                        quotedMessage: message.message
                    }
                }
            }, 
            { messageId: message.key.id }
        );

    } catch (e) {
        console.error("FAKE POLL ERROR:", e);
        await sock.sendMessage(remoteJid, { text: "⚠️ Gagal mengirim fake poll: " + (e.message || e) }, { quoted: message });
    }
}

// --- ESM Export Default ---
export default {
    handle,
    Commands: ["fakepoll", "fakepolling"],
    OnlyPremium: false,
    OnlyOwner: false,
    limitDeduction: 1,
};