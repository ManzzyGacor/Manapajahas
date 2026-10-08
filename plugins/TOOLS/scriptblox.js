import axios from "axios";

// Fungsi untuk membangun URL API Scriptblox
const buildUrl = (query, page = 1, strict = true, max = 10) => {
  const q = encodeURIComponent(query);
  return `https://scriptblox.com/api/script/search?page=${page}&strict=${strict}&q=${q}&max=${max}`;
};

// Header API (⚠️ PERHATIAN: Authorization Token Anda KEMUNGKINAN SUDAH KADALUARSA)
// Anda harus mendapatkan token baru untuk memastikan fungsi ini berjalan.
const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "Accept": "*/*",
  "Authorization": "eyJhbGciOiJIUzI1NiJ9"
    + ".eyJpZCI6IjY5MDc1NmQxNGNlZmRlMDFjNjFiM2UxOCIsInZlcmlmaWVkIjp0cnVlLCJyb2xlIjoidXNlciIsImlzQmFubmVkIjpmYWxzZSwidXNlcm5hbWUiOiJBbGZpRGV2IiwiZXhwIjoxNzY1MDM0NTYyfQ"
    + ".XIjS9Q0VSBFdbzHWpHHj53ooKAZjRtJ2MQchul3ziOY",
  "Connection": "keep-alive"
};

// Fungsi untuk menyederhanakan data hasil API
const simplify = (scripts) => {
  return scripts.map(s => ({
    id: s._id,
    title: s.title,
    game: s.game?.name || null,
    slug: s.slug,
    views: s.views,
    verified: s.verified,
    key: s.key,
    script: s.script 
  }));
};

async function handle(sock, messageInfo) {
    const { remoteJid, message, prefix, command, args } = messageInfo;
    const query = args.join(" ").trim();
    
    if (!query) {
        return sock.sendMessage(
            remoteJid,
            {
                text: `🔎 *Masukkan query pencarian:*\nContoh: ${prefix + command} blox fruits auto farm`
            },
            { quoted: message }
        );
    }
    
    const maxResults = 5; 
    const url = buildUrl(query, 1, true, maxResults);
    
    const loading = await sock.sendMessage(
        remoteJid,
        { text: `⏳ *Mencari skrip:* "${query}"...` },
        { quoted: message }
    );

    try {
        const res = await axios.get(url, { headers, timeout: 15000 });
        const r = res.data.result;
        
        if (!r.scripts || r.scripts.length === 0) {
            await sock.sendMessage(remoteJid, { delete: loading.key });
            return sock.sendMessage(
                remoteJid,
                { text: `❌ *Tidak ada skrip yang ditemukan* untuk query: "${query}"` },
                { quoted: message }
            );
        }

        const simplifiedScripts = simplify(r.scripts);
        
        let responseText = `📜 *Hasil Pencarian Scriptblox*\n\n`;
        responseText += `Query: **${query}**\n`;
        responseText += `Total Halaman: ${r.totalPages}\n`;
        responseText += `Ditemukan: ${r.totalScripts} skrip\n`;
        responseText += `---`;
        
        simplifiedScripts.forEach((s, index) => {
            responseText += `\n\n*${index + 1}. ${s.title}*`;
            responseText += `\n- Game: ${s.game || 'N/A'}`;
            responseText += `\n- Views: ${s.views.toLocaleString()}`;
            responseText += `\n- Verified: ${s.verified ? '✅ Ya' : '❌ Tidak'}`;
            responseText += `\n- Link: https://scriptblox.com/script/${s.slug}`;
        });
        
        responseText += `\n\nTips: Kunjungi tautan di atas untuk melihat kode skrip lengkap.`;
        
        await sock.sendMessage(
            remoteJid,
            { text: responseText },
            { quoted: message }
        );

        await sock.sendMessage(remoteJid, { delete: loading.key });

    } catch (e) {
        await sock.sendMessage(remoteJid, { delete: loading.key });
        
        // 🚨 ERROR HANDLING LEBIH SPESIFIK UNTUK MASALAH API/TOKEN
        let errorMessage = "❌ *Gagal Mencari Skrip:*\n";
        
        if (axios.isAxiosError(e)) {
            const status = e.response?.status;
            // Coba ambil pesan dari body respons atau status text
            const dataMessage = e.response?.data?.message || e.response?.statusText || "Tidak ada pesan spesifik dari API.";
            
            if (status === 401 || status === 403) {
                errorMessage += `⚠️ *ERROR AUTENTIKASI!* Token Anda mungkin sudah kadaluarsa atau tidak valid.\n`;
                errorMessage += `Status: ${status}\nPesan: ${dataMessage}`;
            } else if (status) {
                errorMessage += `Status API: ${status}\nPesan: ${dataMessage}`;
            } else {
                errorMessage += `Kesalahan Jaringan/Timeout (15 detik): ${e.message}`;
            }
        } else {
            errorMessage += `Kesalahan Internal: ${e.message}`;
        }
        
        console.error("Error Scriptblox:", e); // Logging error penuh
        
        await sock.sendMessage(
            remoteJid,
            { text: errorMessage },
            { quoted: message }
        );
    }
}

export default {
    handle,
    Commands: ["scriptblox"],
    Description: "Mencari skrip Roblox dari Scriptblox.",
    OnlyPremium: false,
    OnlyOwner: false,
    limitDeduction: 1 
};