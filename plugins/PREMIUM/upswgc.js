import { generateWAMessageContent, generateWAMessageFromContent, getContentType } from "baileys";
import crypto from "node:crypto";
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { downloadQuotedMedia, downloadMedia } from "../../lib/utils.js";
import { getGroupMetadata } from "../../lib/cache.js";
import mess from "../../strings.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, isGroup, sender, isQuoted } = messageInfo;

  // 1. Cek Admin
  if (!isGroup) return;
  try {
    const groupMetadata = await getGroupMetadata(sock, remoteJid);
    const isAdmin = groupMetadata.participants.some(
      (p) => (p.phoneNumber === sender || p.id === sender) && p.admin
    );
    if (!isAdmin) return sock.sendMessage(remoteJid, { text: "❌ Fitur ini khusus Admin." }, { quoted: message });
  } catch (e) {
    return sock.sendMessage(remoteJid, { text: "❌ Gagal cek admin." }, { quoted: message });
  }

  // 2. Parse Input
  let [rawText, rawWarna] = content.split('|').map(s => s ? s.trim() : s);
  const caption = rawText || message.caption || '';

  // 3. Cek Tipe Media
  const isMediaMessage = isQuoted ? isQuoted.type : getContentType(message.message);
  const isImage = /image/.test(isMediaMessage);
  const isVideo = /video/.test(isMediaMessage);
  const isAudio = /audio/.test(isMediaMessage);

  // --- SKENARIO 1: UPLOAD MEDIA (GAMBAR/VIDEO/AUDIO) ---
  if ((isImage || isVideo || isAudio) && !rawWarna) {
    
    // Kasih reaksi jam pasir biar tau lagi proses
    await sock.sendMessage(remoteJid, { react: { text: '⏳', key: message.key } });

    try {
      // A. Download File
      const fileName = isQuoted ? await downloadQuotedMedia(message) : await downloadMedia(message);
      
      if (!fileName) {
        return sock.sendMessage(remoteJid, { text: "⚠️ Gagal mendownload media." }, { quoted: message });
      }

      // B. Path File
      const filePath = path.join(process.cwd(), "tmp", fileName);
      
      if (!fs.existsSync(filePath)) {
         return sock.sendMessage(remoteJid, { text: `⚠️ Error: File ${fileName} tidak ditemukan di folder tmp.` }, { quoted: message });
      }
      const buffer = fs.readFileSync(filePath);

      // C. Siapkan Options Upload
      let uploadOptions = {};
      
      if (isImage) {
        uploadOptions = { image: buffer, caption: caption };
      } else if (isVideo) {
        uploadOptions = { video: buffer, caption: caption };
      } else if (isAudio) {
         const vnBuffer = await toVN(buffer);
         const waveform = await generateWaveform(vnBuffer);
         uploadOptions = { 
            audio: vnBuffer, 
            mimetype: 'audio/ogg; codecs=opus', 
            ptt: true,
            waveform: waveform 
         };
      }

      // Hapus file tmp
      fs.unlinkSync(filePath);

      // D. Generate & Kirim Status
      const generatedContent = await generateWAMessageContent(uploadOptions, { upload: sock.waUploadToServer });
      
      // 🔥 PERUBAHAN DISINI: Kita simpan hasil return fungsi ini ke variabel 'statusMsg'
      const statusMsg = await sendGroupStatus(sock, remoteJid, generatedContent);
      
      // E. Kirim Konfirmasi dengan Reply ke Status (statusMsg)
      await sock.sendMessage(remoteJid, { react: { text: '✅', key: message.key } });
      
      return sock.sendMessage(
          remoteJid, 
          { text: '✅ Status berhasil terupload silahkan cek reply pesan ini' }, 
          { quoted: statusMsg } // <--- Ini kuncinya, kita reply ke objek status yang baru dibuat
      );

    } catch (e) {
      console.error(e);
      return sock.sendMessage(remoteJid, { text: "❌ Gagal upload status media. Cek log." }, { quoted: message });
    }
  } 
  
  // --- SKENARIO 2: STATUS TEKS BERWARNA ---
  else if (rawWarna) {
    const warnaMap = {
      'merah': '#FF0000', 'hijau': '#00FF00', 'biru': '#0000FF',
      'kuning': '#FFFF00', 'ungu': '#800080', 'hitam': '#000000',
      'putih': '#FFFFFF'
    };
    const color = warnaMap[rawWarna.toLowerCase()];
    
    if (!caption) return sock.sendMessage(remoteJid, { text: "⚠️ Masukkan teks status." }, { quoted: message });
    if (!color) return sock.sendMessage(remoteJid, { text: "⚠️ Warna tidak tersedia. Coba: merah, hijau, biru, kuning." }, { quoted: message });

    const generatedContent = await generateWAMessageContent(
      { text: caption, backgroundColor: color },
      { upload: sock.waUploadToServer }
    );

    // 🔥 PERUBAHAN DISINI JUGA: Simpan statusMsg
    const statusMsg = await sendGroupStatus(sock, remoteJid, generatedContent);
    
    return sock.sendMessage(
        remoteJid, 
        { text: '✅ Status berhasil terupload silahkan cek reply pesan ini' }, 
        { quoted: statusMsg } // <--- Reply ke status teks
    );
  } 
  
  // --- SKENARIO 3: FORMAT SALAH ---
  else {
    return sock.sendMessage(remoteJid, { text: "⚠️ *Format Salah!*\n\n1. Reply Gambar/Video: `!swgc Caption`\n2. Teks Warna: `!swgc Teks Status|merah`" }, { quoted: message });
  }
}

/**
 * Helper: Kirim Status Grup V2 & Return Pesan Utuh
 */
async function sendGroupStatus(sock, jid, content) {
  const messageSecret = crypto.randomBytes(32);
  const messageContextInfo = { messageSecret };

  const msg = generateWAMessageFromContent(jid, {
    messageContextInfo,
    groupStatusMessageV2: {
      message: {
        ...content,
        messageContextInfo
      }
    }
  }, {});

  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
  
  // Kembalikan objek pesan agar bisa di-reply (quoted)
  return msg; 
}

// --- Helper Audio ---
async function toVN(buffer) {
  return new Promise((resolve, reject) => {
    const stream = new PassThrough();
    stream.end(buffer);
    const buffers = [];
    ffmpeg(stream)
      .noVideo()
      .audioCodec('libopus')
      .format('ogg')
      .audioBitrate('48k')
      .audioChannels(1)
      .audioFrequency(48000)
      .on('error', reject)
      .on('end', () => resolve(Buffer.concat(buffers)))
      .pipe(new PassThrough().on('data', c => buffers.push(c)));
  });
}

async function generateWaveform(buffer) {
  return new Promise((resolve) => {
    resolve(Buffer.alloc(64).toString('base64')); 
  });
}

export default {
  handle,
  Commands: ["swgc", "upswgc"],
  OnlyPremium: true, 
  OnlyOwner: false
};