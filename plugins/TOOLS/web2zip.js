import axios from 'axios';
import { reply } from '../../lib/utils.js'; // Menggunakan utilitas reply yang berhasil

// API Key digunakan langsung
const BOTCAHX_API_KEY = "Varesa";
const API_URL = "https://api.botcahx.eu.org/api/tools/web2zip";

async function handle(sock, messageInfo) {
    // Menggunakan variabel yang sama seperti di stalkml.js
    const { m, content, prefix, command } = messageInfo;
    
    // Ambil content, bagi berdasarkan spasi
    const input = content ? content.trim().split(/\s+/) : []; 

    if (input.length === 0) {
        return reply(m, 
            `❌ Format salah. Masukkan URL website yang ingin di-ZIP.\nContoh: *${prefix + command} https://google.com*`
        );
    }
    
    let url = input[0];

    if (!url.startsWith('http')) {
        url = 'https://' + url; 
    }
    
    await reply(m, 
        `⏳ Sedang memproses website: ${url}\nProses ini mungkin membutuhkan waktu sebentar...`
    );

    try {
        const apiUrl = `${API_URL}?url=${encodeURIComponent(url)}&apikey=${BOTCAHX_API_KEY}`;
        
        const response = await axios.get(apiUrl);
        const json = response.data;

        if (!json.status || !json.result) {
            throw new Error(json.message || "Gagal membuat ZIP. URL mungkin tidak valid atau server API sedang sibuk.");
        }

        const zipUrl = json.result;
        
        const outputText = `
📦 *Website Berhasil di-ZIP!*

🌐 *URL Sumber:* ${url}

🔗 *Tautan Unduh ZIP:*
${zipUrl}

_Harap segera unduh, tautan mungkin kadaluwarsa._
        `.trim();

        await reply(m, outputText);

    } catch (e) {
        console.error("Error Web to ZIP:", e);
        
        reply(m, 
            `❌ Gagal memproses Web ke ZIP.\n\nDetail Error: ${e.message}`
        );
    }
}

export default {
    handle,
    Commands: ["webtozip", "web2zip"],
    OnlyPremium: false,
    OnlyOwner: false,
    limitDeduction: 1,
};