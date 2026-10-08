

const mess = {
  game: {
    isPlaying:
      "🎮✨ _Permainan masih berlangsung..._\nKetik *nyerah* jika ingin mengakhirinya.",
    isGroup: "👥⚠️ _Fitur game hanya dapat digunakan di dalam grup._",
    isStop: "🚫 _Fitur game sedang dimatikan di grup ini._",
  },

  general: {
    isOwner: "🛡️ _Perintah ini hanya untuk Owner bot._",
    // Perintah yang mengubah data seluruh server (premium, limit, sewa,
    // plugin, dll). @dashboard diganti alamat dashboard dari config.
    isMainOwner:
      "🛡️ _Perintah ini mengubah data seluruh server Varesa, jadi khusus owner utama._\n\nAtur bot kamu sendiri (owner, menu, pesan otomatis, perintah kustom) lewat dashboard:\n🌐 @dashboard",
    isPremium: "💎 _Fitur ini khusus pengguna Premium._",
    isAdmin: "🔧 _Perintah ini hanya dapat digunakan oleh Admin grup._",
    isGroup: "👥 _Perintah ini hanya bisa dijalankan di dalam grup._",

    limit:
      "🚨 *LIMIT KAMU HABIS!* 🚨\n\nKamu kehabisan Limit untuk menjalankan perintah ini.\n\n✨ *Solusi:*\n* Klaim Limit Gratis: Ketik *.claim*\n* Upgrade ke .Premium: Dapatkan Limit *TANPA BATAS*!",

    success: "✨ _Berhasil, kak!_",
    isBlocked: "⛔ _Akses kamu ke bot ini sedang diblokir._",
    isBaned: "🚫 _Kamu dibatasi dari penggunaan bot di grup ini._",
    fiturBlocked: "⛔ _Fitur ini sedang dinonaktifkan di grup ini._",
  },

  action: {
    grub_open: "🔓✨ Grup berhasil dibuka.",
    grub_close: "🔒✨ Grup berhasil ditutup.",
    user_kick: "🚫🧹 _Satu hama telah dibersihkan dari grup._",
    mute:
      "🔇 _Grup berhasil di-mute. Semua perintah dinonaktifkan._\nAktifkan kembali dengan mengetik *.unmute*.",
    unmute: "🔊 _Grup berhasil di-unmute. Semua perintah aktif kembali._",
    resetgc: "♻️ _Link grup berhasil direset._",
  },

  handler: {
    badword_warning:
      "⚠️🗯️ _*Kata Kasar Terdeteksi!*_ (@detectword)\n\n@sender _mendapatkan peringatan_ (@warning/@totalwarning).",
    badword_block:
      "⛔🗯️ @sender _diblokir karena mengirim *kata kasar* berulang. (@detectword)_\nHubungi Owner jika ingin mengajukan banding.",

    antiedit:
      "✏️🚫 _*Anti-Edit Terdeteksi!*_\n\n_Pesan sebelumnya:_ @oldMessage",
    antidelete:
      "🗑️🚫 _*Anti-Delete Terdeteksi!*_\n_Pengirim:_ @sender\n_Pesan sebelumnya:_ @text",

    antispamchat:
      "⚠️💢 @sender _Jangan spam! Ini peringatan ke-@warning dari @totalwarning._",
    antispamchat2:
      "⛔💢 @sender _diblokir karena melakukan spam berulang. Hubungi Owner bila perlu._",

    antivirtex: "⚠️💥 @sender _Terdeteksi mengirim Virtex._",
    antitagsw: "⚠️🏷️ @sender _Terdeteksi melakukan Tag SW di grup ini._",
    antibot: "🤖🚫 @sender _terdeteksi sebagai bot lain._",

    afk:
      "🚫✨ *Jangan tag dia dulu!*\n@sender sedang AFK sejak *🕒 @durasi*@alasan",
    afk_message:
      "🕊️✨ @sender sudah kembali dari AFK sejak *🕒 @durasi*@alasan",

    sewa_notif:
      "⏳✨ _*Pemberitahuan Masa Sewa*_ \n_Masa aktif sewa bot:_ @date",
    sewa_out:
      "❌⏳ _*Masa Sewa Bot Telah Berakhir*_ \nBot akan keluar dari grup ini.\n\nTerima kasih sudah menggunakan layanan sewa Varesa.\n\n📞 *Owner Contact:*\n@ownernumber",
  },

  game_handler: {
    menyerah:
      "😔🎮 Kamu menyerah…\nJawaban: @answer\n\nIngin bermain lagi? Ketik *@command*",
    waktu_habis:
      "⏳❗ Waktu habis!\nJawaban yang benar: @answer",

    tebak_angka:
      "🎉✨ Jawabanmu benar! Kamu mendapatkan @hadiah Money.",
    tebak_bendera:
      "🎉🇮🇩 Jawaban tepat! Kamu mendapatkan @hadiah Money.",
    tebak_gambar:
      "🎉🖼️ Keren! Kamu benar dan mendapatkan @hadiah Money.",
    tebak_hewan:
      "🎉🐾 Kamu benar! Hadiah: @hadiah Money.",
    tebak_kalimat:
      "🎉📝 Jawabanmu tepat! +@hadiah Money.",
    tebak_kata:
      "🎉🔤 Kamu berhasil menjawab dengan benar! +@hadiah Money.",
    tebak_lagu:
      "🎉🎶 Hebat! Kamu mendapatkan @hadiah Money.",
    tebak_lirik:
      "🎉🎤 Jawaban tepat! Kamu mendapatkan @hadiah Money.",
  },
};

// Variable
global.group = {};
global.group.variable = `
☍ @name
☍ @date
☍ @day
☍ @desc
☍ @group
☍ @greeting
☍ @size
☍ @time`;

export default mess;
