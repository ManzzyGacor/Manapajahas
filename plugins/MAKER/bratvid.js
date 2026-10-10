import config from "../../config.js";
import { sendImageAsSticker } from "../../lib/exif.js";
import { logCustom } from "../../lib/logger.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, isQuoted, prefix, command } =
    messageInfo;

  try {
    const text =
      content && content.trim() !== "" ? content : isQuoted?.text ?? null;

    // Validasi input konten
    if (!text) {
      await sock.sendMessage(
        remoteJid,
        {
          text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${
            prefix + command
          } halo namaku budi*_`,
        },
        { quoted: message }
      );
      return; // Hentikan eksekusi jika tidak ada konten
    }

    // Kirimkan pesan loading dengan reaksi emoji
    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });

    // Bersihkan konten dan ubah ke format URI (mengganti spasi, enter, dll agar aman untuk URL)
    const sanitizedContent = encodeURIComponent(
      text.trim().replace(/\n+/g, " ")
    );

    // Ambil data langsung dari endpoint API baru menggunakan fetch
    const apiUrl = `https://api-faa.my.id/faa/bratvid?text=${sanitizedContent}`;
    const response = await fetch(apiUrl);
    
    // Pastikan API merespons dengan sukses (status 200 OK)
    if (!response.ok) {
        throw new Error(`Gagal mengambil data dari API (Status: ${response.status})`);
    }

    // Ubah respons menjadi buffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const options = {
      packname: config.sticker_packname,
      author: config.sticker_author,
    };

    // Kirim stiker
    // Catatan: Jika API mengembalikan video/GIF animasi, mungkin Anda perlu mengganti ini 
    // dengan sendVideoAsSticker tergantung pada library exif.js bot Anda.
    await sendImageAsSticker(sock, remoteJid, buffer, options, message);
    
  } catch (error) {
    logCustom("info", content, `ERROR-COMMAND-${command}.txt`);
    // Tangani kesalahan dan kirimkan pesan error ke pengguna
    const errorMessage = `Maaf, terjadi kesalahan saat memproses permintaan Anda. Coba lagi nanti.\n\nError: ${error.message}`;
    await sock.sendMessage(
      remoteJid,
      {
        text: errorMessage,
      },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["bratvid"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1,
};