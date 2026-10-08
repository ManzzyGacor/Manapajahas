import axios from "axios";
import { downloadMediaMessage } from "baileys"; // Sesuaikan jika kamu punya fungsi utilitas sendiri
import mess from "../../strings.js";
import { logCustom } from "../../lib/logger.js";

// --- KONFIGURASI API & GITHUB ---
const API_HD = `https://api-faa.my.id/faa/hdv2`;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ""; // Wajib diisi dengan Personal Access Token GitHub
const GITHUB_REPO = "ManzzyGacor/Urlmanzzy"; 
const GITHUB_BRANCH = "main";
// --------------------------------

/**
 * Mengunggah buffer gambar ke GitHub dan mengembalikan Raw URL
 */
async function uploadToGithub(buffer, filename) {
  const base64Content = buffer.toString("base64");
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`;

  await axios.put(
    apiUrl,
    {
      message: `Auto-upload ${filename} via Bot for HD processing`,
      content: base64Content,
      branch: GITHUB_BRANCH,
    },
    {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  // Mengembalikan direct URL (raw) dari GitHub
  return `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${filename}`;
}

/**
 * Mengirim pesan dengan kutipan
 */
async function sendMessageWithQuote(sock, remoteJid, message, text) {
  await sock.sendMessage(remoteJid, { text }, { quoted: message });
}

/**
 * Fungsi utama untuk menangani fitur HD/Enhance
 */
async function handle(sock, messageInfo) {
  const { remoteJid, message, prefix, command } = messageInfo;

  try {
    // 1. Validasi Input: Pastikan user mengirim gambar atau me-reply gambar
    const isImage = message?.message?.imageMessage;
    const isQuotedImage = message?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

    if (!isImage && !isQuotedImage) {
      return sendMessageWithQuote(
        sock,
        remoteJid,
        message,
        `_⚠️ Kirim gambar dengan caption *${prefix + command}* atau balas gambar dengan perintah tersebut._`
      );
    }

    // 2. Tampilkan Loading
    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });

    // 3. Download Gambar dari pesan WhatsApp
    const mediaMessage = isImage ? message : { message: message.message.extendedTextMessage.contextInfo.quotedMessage };
    const buffer = await downloadMediaMessage(
      mediaMessage, 
      "buffer", 
      {}, 
      {
        logger: console,
        rethrowDownloadErrors: true
      }
    );

    // 4. Upload ke GitHub
    const filename = `file_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
    let githubUrl;
    try {
      githubUrl = await uploadToGithub(buffer, filename);
      console.log("[HD] Berhasil upload ke GitHub:", githubUrl);
    } catch (uploadError) {
      console.error("[HD] Gagal upload ke GitHub:", uploadError.response?.data || uploadError.message);
      throw new Error("Gagal mengunggah gambar ke GitHub. Pastikan GitHub Token sudah benar dan memiliki akses Repo.");
    }

    // 5. Hit API HD Faa
    const apiUrlWithParams = `${API_HD}?url=${encodeURIComponent(githubUrl)}`;
    const { data: response } = await axios.get(apiUrlWithParams, { timeout: 30000 });

    // Validasi struktur respons dari API
    if (!response || !response.status || !response.result) {
      throw new Error("API tidak mengembalikan URL gambar HD yang valid.");
    }

    const hdImageUrl = response.result;
    console.log("[HD] Sukses memproses gambar HD:", hdImageUrl);

    // 6. Kirim Gambar Hasil ke User
    await sock.sendMessage(
      remoteJid,
      { 
        image: { url: hdImageUrl }, 
        caption: mess.general.success || "_Selesai! Ini hasil gambar HD-nya._" 
      },
      { quoted: message }
    );

    // 7. Akhiri dengan reaksi sukses
    await sock.sendMessage(remoteJid, {
      react: { text: "✅", key: message.key },
    });

  } catch (error) {
    console.error("Kesalahan saat memproses fitur HD:", error);
    logCustom("info", error.message, `ERROR-COMMAND-${command}.txt`);

    // Ganti reaksi menjadi error
    await sock.sendMessage(remoteJid, {
      react: { text: "❌", key: message.key },
    });

    const errorMessage = `Maaf, terjadi kesalahan.\n\n*Detail:* ${error.message || "Kesalahan API atau Server"}`;
    await sendMessageWithQuote(sock, remoteJid, message, errorMessage);
  }
}

export default {
  handle,
  Commands: ["hd", "remini", "hdr"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1, 
};