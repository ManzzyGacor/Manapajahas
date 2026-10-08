async function handle(sock, messageInfo) {
  const { remoteJid, message, content, mentionedJid, prefix, command } = messageInfo;

  if (!mentionedJid?.length) {
    return sock.sendMessage(
      remoteJid,
      { text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${prefix + command} @TAG*_` },
      { quoted: message }
    );
  }

  const random_cekmati = Math.floor(Math.random() * 31) + 20; 

  const responseText = `🔮 *Nama:* ${content}\n🕒 *Mati Pada Umur:* ${random_cekmati} Tahun\n\n⚠️ _Cepet-cepet Tobat, karena mati itu tak ada yang tahu!_`;

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
  Commands: ["cekmati"],
  OnlyPremium: false,
  OnlyOwner: false,
};