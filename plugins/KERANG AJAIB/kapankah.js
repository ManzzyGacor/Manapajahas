async function handle(sock, messageInfo) {
  const { remoteJid, message, fullText, content, mentionedJid, prefix, command } = messageInfo;

  if (!content || content.trim() === "") {
    return sock.sendMessage(
      remoteJid,
      { text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${prefix + command} aku ganteng*_` },
      { quoted: message }
    );
  }

  const possibleAnswers = [
    "Besok", "Lusa", "Tadi", "4 Hari Lagi", "5 Hari Lagi", "6 Hari Lagi", 
    "1 Minggu Lagi", "2 Minggu Lagi", "3 Minggu Lagi", "1 Bulan Lagi", 
    "2 Bulan Lagi", "3 Bulan Lagi", "4 Bulan Lagi", "5 Bulan Lagi", 
    "6 Bulan Lagi", "1 Tahun Lagi", "2 Tahun Lagi", "3 Tahun Lagi", 
    "4 Tahun Lagi", "5 Tahun Lagi", "6 Tahun Lagi", "1 Abad lagi", "3 Hari Lagi"
  ];

  const randomAnswer = possibleAnswers[Math.floor(Math.random() * possibleAnswers.length)];
  const responseText = `*Pertanyaan:* ${fullText}\n\n*Jawaban:* ${randomAnswer}`;

  await sock.sendMessage(
    remoteJid,
    { text: responseText, mentions: mentionedJid || [] },
    { quoted: message }
  );
}

export default {
  handle,
  Commands: ["kapankah"],
  OnlyPremium: false,
  OnlyOwner: false,
};