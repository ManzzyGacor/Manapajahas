import { setTemplateWelcome } from "../../lib/participants.js";
import { getGroupMetadata } from "../../lib/cache.js";
import { downloadQuotedMedia, downloadMedia } from "../../lib/utils.js";
import mess from "../../strings.js";
import fs from "fs";
import path from "path";
import axios from "axios";
import FileType from "file-type";

// --- KONFIGURASI GITHUB KAMU ---
const GH_TOKEN = process.env.GITHUB_TOKEN || ""; // isi GITHUB_TOKEN di .env 
const GH_USERNAME = "ManzzyGacor";    
const GH_REPO = "Welcomevaresa";              
const GH_BRANCH = "main"; 

async function handle(sock, messageInfo) {
  const { remoteJid, isGroup, message, content, sender, command, prefix } =
    messageInfo;

  // Periksa apakah pesan berasal dari grup
  if (!isGroup) return;

  // Mendapatkan metadata grup
  const groupMetadata = await getGroupMetadata(sock, remoteJid);
  const participants = groupMetadata.participants;

  const isAdmin = participants.some(
    (p) => (p.phoneNumber === sender || p.id === sender) && p.admin
  );

  if (!isAdmin) {
    await sock.sendMessage(
      remoteJid,
      { text: mess.general.isAdmin },
      { quoted: message }
    );
    return;
  }

  // --- MODE YANG DIIZINKAN ---
  const allowedModes = ["gif", "image", "text", "random", "custom"];

  // Validasi input kosong
  if (!content || !content.trim()) {
    const usageMessage = `⚠️ *Format Penggunaan:*

💬 *Contoh Mode Standar:* 
_${prefix}${command} gif_
_${prefix}${command} image_
_${prefix}${command} text_
_${prefix}${command} random_

💬 *Contoh Mode Custom (Gambar/GIF Sendiri):*
Kirim/Reply Gambar atau Video(GIF) dengan caption:
_${prefix}${command} custom_

📌 *Keterangan Mode:*
• *gif*    = Welcome pakai GIF/Video 
• *image*  = Welcome pakai canvas 
• *text*   = Welcome teks saja
• *random* = Random di antara gif/image/text
• *custom* = Welcome pakai gambar/video yg kamu upload sendiri`;

    await sock.sendMessage(
      remoteJid,
      { text: usageMessage },
      { quoted: message }
    );
    return;
  }

  let mode = content.toLowerCase().trim();

  // Alias opsional (kalau user ngetik "canvas" / "video", tetap aman)
  if (mode === "canvas") mode = "image";
  if (mode === "video") mode = "gif";

  if (!allowedModes.includes(mode)) {
    const invalidMessage = `⚠️ _Input tidak valid!_

Gunakan salah satu:
• *gif*
• *image*
• *text*
• *random*
• *custom*

_Contoh:_
_${prefix}${command} gif_
_${prefix}${command} custom_`;

    await sock.sendMessage(
      remoteJid,
      { text: invalidMessage },
      { quoted: message }
    );
    return;
  }

  let mediaUrl = null;

  // Jika mode custom, wajib ada media yang dikirim langsung/di-reply lalu upload ke GitHub
  if (mode === "custom") {
    // Kirim reaksi loading agar kamu tahu proses upload sedang berjalan
    await sock.sendMessage(remoteJid, { react: { text: '☁️', key: message.key } });
    
    mediaUrl = await handleMediaToGitHub(messageInfo);
    
    if (!mediaUrl) {
      await sock.sendMessage(
        remoteJid,
        { text: `⚠️ _Gagal memproses media! Pastikan kamu mengirim gambar/video beserta caption *${prefix}${command} custom* atau mereply gambar/video._` },
        { quoted: message }
      );
      return;
    }
  }

  // Simpan mode ke database via participants.js
  await setTemplateWelcome(remoteJid, mode, mediaUrl);

  const successMessage = `✅ _Template Welcome Berhasil Diatur ke_ *${mode.toUpperCase()}*`;
  await sock.sendMessage(
    remoteJid,
    { text: successMessage },
    { quoted: message }
  );
}

// Fungsi untuk menangani unduhan media dan Upload ke GitHub
async function handleMediaToGitHub(messageInfo) {
  const { isQuoted, type, message } = messageInfo;
  
  const supportedMediaTypes = ["image", "video", "sticker", "document"];
  let downloadedFileName = null;
  let msgType = null;

  // Pengecekan media (Bisa langsung kirim pakai caption, atau via reply)
if (isQuoted && supportedMediaTypes.includes(isQuoted.type)) {
      // Jika mereply media
      downloadedFileName = await downloadQuotedMedia(message);
      msgType = isQuoted.type;
  } else if (supportedMediaTypes.includes(type)) {
      // Jika mengirim media langsung dengan caption
      downloadedFileName = await downloadMedia(message);
      msgType = type;
  }

  // Jika tidak ada media yang dideteksi, kembalikan null
  if (!downloadedFileName) {
      return null;
  }

  let filePath;
  try {
      // Gabungkan path lengkap
      filePath = path.join(process.cwd(), "tmp", downloadedFileName);

      if (!fs.existsSync(filePath)) {
          throw new Error(`File tidak ditemukan di ${filePath}`);
      }

      // Baca file, tentukan tipe file, dan konversi ke Base64
      const fileBuffer = fs.readFileSync(filePath);
      const fileTypeInfo = await FileType.fromBuffer(fileBuffer);

      let finalExt = path.extname(downloadedFileName); // Fallback
      
      if (fileTypeInfo) {
          finalExt = `.${fileTypeInfo.ext}`;
          
          // Logika khusus GIF/Video
          if (msgType === 'video' && fileTypeInfo.mime === 'image/gif') {
              finalExt = '.gif';
          }
      }
      
      // Konversi buffer mentah ke Base64
      const fileContent = fileBuffer.toString('base64');

      // Buat Nama File Unik untuk Welcome
      const ghFileName = `welcome_${Date.now()}_${Math.floor(Math.random() * 1000)}${finalExt}`;

      // Upload ke GitHub API
      const apiUrl = `https://api.github.com/repos/${GH_USERNAME}/${GH_REPO}/contents/${ghFileName}`;
      
      await axios.put(apiUrl, {
          message: `Upload Custom Welcome via Bot`, 
          content: fileContent,
          branch: GH_BRANCH
      }, {
          headers: {
              'Authorization': `Bearer ${GH_TOKEN}`,
              'Content-Type': 'application/json',
              'User-Agent': 'WhatsApp-Bot-Uploader'
          }
      });

      // Hapus file lokal (Bersih-bersih)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      // Return URL Raw (Direct Link) yang akan disimpan ke database JSON
      return `https://raw.githubusercontent.com/${GH_USERNAME}/${GH_REPO}/${GH_BRANCH}/${ghFileName}`;

  } catch (e) {
      console.error("Upload to GitHub Error:", e);
      // Hapus file lokal jika error tapi file sudah terdownload
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return null;
  }
}

export default {
  handle,
  Commands: ["settemplatewelcome", "templatewelcome"],
  OnlyPremium: false,
  OnlyOwner: false,
};