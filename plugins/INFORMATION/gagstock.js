import fetch from 'node-fetch';
import WebSocket from 'ws';

async function handle(sock, messageInfo) {
  const { remoteJid, message } = messageInfo;

  await sock.sendMessage(remoteJid, {
    react: { text: '⏳', key: message.key }
  });

  let data = null;
  let source = 'growagarden pro';

  // ================
  // 🔹 1️⃣ PRIMARY : WS Nekolabs
  // ================
  try {
    const ws = new WebSocket('wss://ws.growagardenpro.com', [], {
      headers: {
        'Host': 'ws.growagardenpro.com',
        'Origin': 'https://growagardenpro.com',
        'User-Agent': 'NekoHost/1.0.0'
      }
    });

    let packets = [];
    let isOpen = false;

    ws.on('open', () => { isOpen = true });
    ws.on('message', (msg) => {
      try {
        const parsed = JSON.parse(msg.toString());
        packets.push(parsed);
      } catch {
        packets.push(msg.toString());
      }
    });

    // Tunggu koneksi terbuka
    await new Promise(resolve => {
      const check = () => isOpen ? resolve() : setTimeout(check, 100);
      check();
    });

    // Tunggu 10 detik agar data masuk penuh
    await new Promise(resolve => setTimeout(resolve, 10000));
    ws.close();

    const last = packets.pop();
    if (last && last.data) data = last.data;
  } catch (err) {
    console.error('[Nekolabs Error]', err.message);
  }

  // ================
  // 🔁 2️⃣ FALLBACK : REST GAGStock
  // ================
  if (!data) {
    source = 'gagstock gleeze';
    try {
      // Pastikan node-fetch tidak ada masalah
      if (typeof fetch === 'undefined') throw new Error("node-fetch is undefined. Make sure it's installed correctly.");
      
      const res = await fetch('https://gagstock.gleeze.com/grow-a-garden', {
        headers: { Accept: 'application/json' }
      });
      const json = await res.json();
      if (json?.data) data = json.data;
    } catch (err) {
      console.error('[GAGStock Error]', err.message);
    }
  }

  // ================
  // ❌ Gagal total
  // ================
  if (!data) {
    await sock.sendMessage(remoteJid, {
      react: { text: '⚠️', key: message.key }
    });
    return sock.sendMessage(
        remoteJid, 
        { text: '❌ Gagal mengambil data dari kedua sumber (Nekolabs & GAGStock).' }, 
        { quoted: message }
    );
  }

  // ================
  // ✍️ Format Output
  // ================
  let textResult = '🌿 *ɢʀᴏᴡ ᴀ ɢᴀʀᴅᴇɴ ʀᴇᴘᴏʀᴛ*\n\n';
  textResult += `📡 *Source:* ${source}\n\n`;

  const section = (title, emoji, items) => {
    if (!items || items.length === 0) return '';
    let t = `${emoji} *${title}*\n`;
    // Gunakan item.name dan item.quantity sesuai struktur data
    for (let i of items) t += `• ${i.name} ➔ ${i.quantity}\n`;
    return t + '\n';
  };

  // Pastikan struktur data yang digunakan sesuai dengan data yang mungkin ada
  textResult += section('ꜱᴇᴇᴅꜱ', '🌱', data.seeds || data.seed);
  textResult += section('ɢᴇᴀʀ', '🛠️', data.gear);
  textResult += section('ᴇɢɢꜱ', '🥚', data.eggs || data.egg);
  textResult += section('ᴄᴏꜱᴍᴇᴛɪᴄꜱ', '💄', data.cosmetics);
  textResult += section('ʜᴏɴᴇʏ', '🍯', data.honey);

  // Weather
  if (data.weather) {
    textResult += '⛅ *ᴡᴇᴀᴛʜᴇʀ*\n';
    textResult += `• ᴛʏᴘᴇ: ${data.weather.type}\n`;
    textResult += `• ᴀᴄᴛɪᴠᴇ: ${data.weather.active ? '✅ ʏᴇꜱ' : '❌ ɴᴏ'}\n`;
    if (data.weather.effects?.length) {
      textResult += '• ᴇꜰꜰᴇᴄᴛꜱ:\n';
      for (let fx of data.weather.effects) textResult += `   ➔ ${fx}\n`;
    }
    textResult += '\n';
  }

  // Weather history
  if (data.weatherHistory) {
    textResult += '📊 *ᴡᴇᴀᴛʜᴇʀ ʜɪꜱᴛᴏʀʏ*\n';
    for (let item of data.weatherHistory)
      textResult += `• ${item.type} (${item.active ? 'Active' : 'Ended'})\n`;
    textResult += '\n';
  }

  // Traveling merchant
  if (data.travelingmerchant) {
    const t = data.travelingmerchant;
    textResult += `🚶 *ᴛʀᴀᴠᴇʟɪɴɢ ᴍᴇʀᴄʜᴀɴᴛ*\n`;
    textResult += `• ꜱᴛᴀᴛᴜꜱ: ${t.status === 'leaved' ? '❌ Not in area' : '✅ Active'}\n`;
    if (t.merchantName) textResult += `• ɴᴀᴍᴇ: ${t.merchantName}\n`;
    if (t.appearIn) textResult += `• ɴᴇxᴛ ᴀᴘᴘᴇᴀʀ: ${t.appearIn}\n`;
    if (t.items?.length) {
      textResult += '• ɪᴛᴇᴍꜱ:\n';
      for (let i of t.items) textResult += `   ➔ ${i.name} ×${i.quantity}\n`;
    }
    textResult += '\n';
  }

  // Format waktu update
  const lastKey = Object.keys(data).find(k => k.toLowerCase().includes('lastglobalupdate'));
  let updateTime = lastKey ? data[lastKey] : data.updated_at || null;
  if (updateTime) {
    try {
      let d = new Date(updateTime);
      let tanggal = d.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Jakarta'
      });
      let jam = d.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Jakarta'
      });
      updateTime = `${tanggal} - ${jam} WIB`;
    } catch {
      updateTime = 'Format waktu tidak valid';
    }
  } else updateTime = 'Data tidak tersedia';

  textResult += `🕒 *ʟᴀꜱᴛ ᴜᴘᴅᴀᴛᴇ:*\n${updateTime}`;

  // ✅ Kirim hasil
  await sock.sendMessage(remoteJid, { react: { text: '✅', key: message.key } });
  await sock.sendMessage(remoteJid, { text: textResult.trim() }, { quoted: message });
}

// Export metadata plugin
export default {
    handle,
    Commands: ['gagstock', 'growgardenstock', 'stockgag'],
    OnlyPremium: false,
    OnlyOwner: false
};