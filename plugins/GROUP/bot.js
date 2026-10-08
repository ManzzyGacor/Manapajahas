async function handle(sock, messageInfo) {
  const { remoteJid, isGroup, message, pushName } = messageInfo;
  
  if (!isGroup) return; // Hanya merespon di dalam Grup

  // Daftar jawaban random
  const jawaban = [
    `Halo ${pushName}, ada yang bisa dibantu?`,
    "Hadir kak! 🫡",
    "Iya, ada apa manggil-manggil?",
    "Bot aktif siap melayani!",
    "Ketik .menu untuk melihat daftar perintah.",
    "Apaaa???",
    "Jangan spam ya kak...",
    "Lagi sibuk nih, tapi buat kamu apa sih yang enggak.",
    "Waalaikumsalam (kalo ngucap salam)",
    "Kenapa kak? Butuh bantuan?",
    "Hadir, jangan lupa donasi ya kak biar bot tetep hidup ☕",
    "Diem dulu, lagi mantau grup nih."
  ];

  // Rumus mengambil satu jawaban secara acak
  const randomRespon = jawaban[Math.floor(Math.random() * jawaban.length)];

  await sock.sendMessage(
    remoteJid,
    { text: randomRespon },
    { quoted: message }
  );
}

export default {
  handle,
  Commands: ["bot", "tes"], // Menambahkan alias command
  OnlyPremium: false,
  OnlyOwner: false,
};