import { getGroupMetadata } from "../../lib/cache.js";
import { checkMessage } from "../../lib/participants.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command } = messageInfo;
  
  try {
    // Validasi input konten
    if (!content) {
      await sock.sendMessage(
        remoteJid,
        {
          text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_\n_*${prefix + command} custom*_\n_*${prefix + command} text*_`,
        },
        { quoted: message }
      );
      return;
    }

    // Indikator proses
    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });

    // Ambil metadata grup (hanya ambil subject untuk caption, tidak butuh profil picture lagi)
    const groupMetadata = await getGroupMetadata(sock, remoteJid);
    const { subject } = groupMetadata;
    const mode = content.toLowerCase().trim();

    // --- HANDLE MODE CUSTOM (GAMBAR/GIF BUATANMU SENDIRI) ---
    if (mode === "custom") {
      // Ambil URL media custom dari database
      const customMediaUrl = await checkMessage(remoteJid, "templatewelcomeMedia");
      
      if (!customMediaUrl) {
         await sock.sendMessage(
          remoteJid,
          { text: `_⚠️ Belum ada media custom yang disimpan untuk grup ini. Silakan atur dengan mengirim gambar/video dengan caption *${prefix}settemplatewelcome custom*_` },
          { quoted: message }
        );
        return;
      }

      // Cek apakah video (.mp4) atau gambar biasa
      const isVideo = customMediaUrl.endsWith('.mp4'); 
      const captionText = `_Welcome bro di grub ${subject}_\n\n_Untuk menggunakan template ini silakan ketik_ *.templatewelcome custom*`;

      if (isVideo) {
         await sock.sendMessage(
            remoteJid,
            { video: { url: customMediaUrl }, gifPlayback: true, caption: captionText },
            { quoted: message }
         );
      } else {
         await sock.sendMessage(
            remoteJid,
            { image: { url: customMediaUrl }, caption: captionText },
            { quoted: message }
         );
      }
      return;
    }

    // --- HANDLE MODE TEXT ---
    if (mode === "text") {
      await sock.sendMessage(
        remoteJid,
        {
          text: `_Welcome bro di grub ${subject}_\n\n_Untuk menggunakan template ini silakan ketik_ *.templatewelcome text*`,
        },
        { quoted: message }
      );
      return;
    }

    // --- JIKA INPUT TIDAK VALID ---
    await sock.sendMessage(
      remoteJid,
      {
        text: `_⚠️ Format tidak valid! Pilih *custom* atau *text*._`,
      },
      { quoted: message }
    );

  } catch (error) {
    console.error("Error in handle function:", error);
    await sock.sendMessage(
      remoteJid,
      {
        text: `_❌ Terjadi kesalahan: ${error.message}_`,
      },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["teswelcome"],
  OnlyPremium: false,
  OnlyOwner: false,
};