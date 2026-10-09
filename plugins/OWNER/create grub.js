async function handle(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command } = messageInfo;

  try {
    // Validasi input
    if (!content || content.trim() === "") {
      const tex = `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${
        prefix + command
      } nama grub*_`;
      return await sock.sendMessage(
        remoteJid,
        { text: tex },
        { quoted: message }
      );
    }

    // Membuat grup. Peserta awal = owner yang mengetik perintah ini.
    // Dulu nomor milik orang lain (pembuat script asal) ditulis langsung di
    // sini, jadi SETIAP grup yang dibuat bot mana pun ikut memasukkan nomor
    // orang asing itu. Pesan dari HP bot sendiri (fromMe) tidak perlu
    // peserta tambahan.
    const nomorBot = String(sock.user?.id || "").split(":")[0].split("@")[0];
    const peserta =
      messageInfo.sender && !messageInfo.sender.startsWith(`${nomorBot}@`)
        ? [messageInfo.sender]
        : [];
    const creategc = await sock.groupCreate(content, peserta);

    // // Mengunci pengaturan grup untuk admin saja
    await sock
      .groupSettingUpdate(creategc.id, "locked")
      .then(() =>
        console.log(
          "Sekarang *Hanya Admin Yang Dapat Mengedit Pengaturan Grup*"
        )
      )
      .catch((err) => console.error("Error mengatur grup:", err));

    // Mendapatkan tautan undangan grup
    const response_creategc = await sock.groupInviteCode(creategc.id);

    // Mengirimkan balasan
    const replyText = `「 *Create Group* 」\n\n_▸ Link : https://chat.whatsapp.com/${response_creategc}_`;
    return await sock.sendMessage(
      remoteJid,
      { text: replyText },
      { quoted: message }
    );
  } catch (error) {
    console.error("Error membuat grup:", error);
    return await sock.sendMessage(
      remoteJid,
      { text: "⚠️ _Terjadi kesalahan saat membuat grup._" },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: [
    "creategrup",
    "creategroup",
    "creategc",
    "creategrub",
    "creategroub",
  ],
  OnlyPremium: false,
  OnlyOwner: true,
};
