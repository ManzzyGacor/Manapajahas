// =========================================================
// BRAT MAKER PLUGIN
// Command: .brat <teks>
// =========================================================

'use strict';

import axios from 'axios';

const API_KEY = 'VaresaMD';
const BASE_URL = 'https://api.jerexd.my.id/api/maker/brat';

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, isQuoted, prefix, command } = messageInfo;
  
  // Mengambil teks dari input chat atau pesan yang direply (quoted)
  const text = content && content.trim() !== "" ? content : isQuoted?.text ?? null;

  if (!text) {
    await sock.sendMessage(
      remoteJid,
      { text: `Contoh penggunaan:\n${prefix + command} Manji gacor 🐱` },
      { quoted: message }
    );
    return;
  }

  // Kirim reaction loading
  await sock.sendMessage(remoteJid, { react: { text: '🎨', key: message.key } }).catch(() => {});

  try {
    // Encode teks agar aman dikirim melalui parameter URL GET
    const encodedText = encodeURIComponent(text);
    const targetUrl = `${BASE_URL}?apikey=${API_KEY}&text=${encodedText}&type=image`;

    // Mengambil data gambar dari API dalam bentuk buffer
    const response = await axios.get(targetUrl, {
      responseType: 'arraybuffer',
      timeout: 15000
    });

    const buffer = Buffer.from(response.data);

    // Kirim hasil gambar ke WhatsApp
    await sock.sendMessage(
      remoteJid,
      {
        image: buffer,
        caption: `Nih hasil Brat maker untuk: "${text}"`
      },
      { quoted: message }
    );

    // React sukses
    await sock.sendMessage(remoteJid, { react: { text: '✅', key: message.key } }).catch(() => {});

  } catch (error) {
    console.error('[BRAT ERROR]', error.message);
    await sock.sendMessage(remoteJid, { react: { text: '❌', key: message.key } }).catch(() => {});
    await sock.sendMessage(
      remoteJid,
      { text: `Gagal membuat gambar Brat.\n\n> ${error?.message || 'Server error'}` },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["brat", "bratmaker"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1,
};