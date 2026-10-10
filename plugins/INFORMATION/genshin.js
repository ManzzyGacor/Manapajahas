import axios from 'axios';

// API Key yang digunakan
const BOTCAHX_API_KEY = "Varesa";
const API_URL = "https://api.botcahx.eu.org/api/stalk/genshin";

async function handle(sock, messageInfo) {
    // 1. Ambil variabel yang BENAR-BENAR dikirim oleh autoresbot.js
    const { remoteJid, message, prefix, command, fullText } = messageInfo;

    // 2. Buat fungsi kirim pesan lokal agar lebih aman dan tidak tergantung lib luar yang error
    const sendReply = async (text) => {
        await sock.sendMessage(remoteJid, { text: text }, { quoted: message });
    };

    // 3. Parsing input manual dari fullText karena 'content' tidak ada di messageInfo
    const content = fullText.slice(prefix.length + command.length).trim();
    const input = content ? content.split(/\s+/) : [];

    // Validasi input
    if (input.length === 0) {
        return sendReply( 
            `❌ Format salah. Masukkan UID Genshin Impact.\nContoh: *${prefix + command} 843829161*`
        );
    }
    
    const uid = input[0];

    if (!/^\d+$/.test(uid)) {
        return sendReply("❌ UID harus berupa angka.");
    }
    
    await sendReply(`🔍 Sedang mencari data akun Genshin Impact UID: ${uid}...`);

    try {
        const apiUrl = `${API_URL}?id=${uid}&apikey=${BOTCAHX_API_KEY}`;
        
        const response = await axios.get(apiUrl);
        const json = response.data;

        // Cek validasi response API
        if (!json.status || json.code !== 200 || !json.result || !json.result.item) {
            throw new Error("Gagal mendapatkan data. Pastikan UID benar & Showcase Publik aktif.");
        }

        // Perhatikan struktur JSON result. Biasanya result langsung objek atau array
        // Sesuaikan dengan struktur output API Botcahx terbaru
        const data = json.result.item || json.result[0] || json.result; 

        // --- Formatting Output Teks ---
        const outputText = `
✨ *Genshin Impact Stalker* ✨

👤 *Nickname:* ${data.nickname || "-"}
🆔 *UID:* ${data.uid || uid}

⭐ *Level & World*
• Rank Petualangan (AR): *Level ${data.level || "-"}*
• Level Dunia (WL): *WL ${data.worldLevel || "-"}*

🏆 *Pencapaian*
• Total Achievement: *${data.achievement || "-"}*
• Spiral Abyss Terakhir: *${data.spiralAbyss || "-"}*

---
🔗 *Detail Showcase*
${data.detail || "Tidak ada detail tersedia"}

_(Data Karakter dan Profil diambil dari Enka Network)_
        `.trim();

        // --- MENGIRIM MEDIA ---
        // Menggunakan 'sock' langsung, bukan mediaConn/conn yang undefined
        if (data.icon || data.image) {
            const imageUrl = data.image || data.icon; // Coba ambil image, kalau tidak ada ambil icon
            
            await sock.sendMessage(remoteJid, {
                image: { url: imageUrl },
                caption: outputText
            }, { quoted: message });
            
        } else {
             // Jika tidak ada gambar, kirim teks saja
             await sendReply(outputText);
        }

    } catch (e) {
        console.error("Error Stalk Genshin:", e);
        await sendReply(`❌ Gagal Stalk Genshin Impact.\n\nDetail Error: ${e.message}`);
    }
}

// Export Plugin
export default {
    handle,
    Commands: ["stalkgenshin", "genshinstalk"],
    OnlyPremium: false,
    OnlyOwner: false,
    limitDeduction: 1,
};