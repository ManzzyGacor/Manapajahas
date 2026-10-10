import config from "../../config.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message, fullText, mentionedJid, prefix, command } = messageInfo;

  if (!mentionedJid?.length) {
    return sock.sendMessage(
      remoteJid,
      { text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${prefix + command} @TAG*_` },
      { quoted: message }
    );
  }

  const mentionedNumberMatch = fullText.match(/@(\d+)/);
  const mentionedNumber = mentionedNumberMatch ? mentionedNumberMatch[1] : null;

  const isOwner = mentionedNumber && config.owner_number.includes(mentionedNumber);

  const gan = isOwner
    ? ["83%", "97%", "100%", "102%", "120%", "9999%", "127%", "86%"] 
    : ["10%", "30%", "20%", "40%", "50%", "60%", "70%", "62%", "74%", "83%", "97%", "100%", "29%", "94%", "75%", "82%", "41%", "39%"];

  const selectedAnswer = gan[Math.floor(Math.random() * gan.length)];
  const responseText = `*Pertanyaan:* ${fullText}\n\n*Jawaban:* ${selectedAnswer}`;

  try {
    await sock.sendMessage(
      remoteJid,
      { text: responseText, mentions: mentionedJid },
      { quoted: message }
    );
  } catch (error) {
    console.error("Error sending message:", error);
  }
}

export default {
  handle,
  Commands: ["cekganteng"],
  OnlyPremium: false,
  OnlyOwner: false,
};