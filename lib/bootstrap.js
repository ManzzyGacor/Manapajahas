// lib/bootstrap.js
//
// Dibuat sebagai modul terpisah (bukan kode di badan index.js) karena impor
// ESM di-hoist: semua modul yang diimpor index.js sudah dievaluasi SEBELUM
// badan index.js berjalan. Modul seperti users.js membaca file database
// saat dimuat, jadi folder & file defaultnya harus sudah ada lebih dulu.
import fs from "fs";

// Folder database (mis. "./database/additional") tidak pernah dibuat otomatis
// oleh modul manapun sebelum ada yang menulis ke sana — begitu file pertama
// coba ditulis, Node melempar ENOENT karena folder induknya belum ada.
// Dibuat sekali di sini, sebelum modul lain (users.js, participants.js) jalan.
["./database", "./database/additional", "./database/media", "./tmp", "./logs"].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// File database runtime tidak ikut disimpan di repository (berisi data
// pengguna). Di instalasi baru, buat versi kosongnya supaya modul yang
// langsung membaca file ini tidak gagal dengan ENOENT.
const DEFAULT_DB_FILES = {
  "./database/users.json": {},
  "./database/owner.json": [],
  "./database/group.json": {},
  "./database/jadibot.json": {},
  "./database/sewa.json": {},
  // Premium, bonus limit & sewa grup PER BOT (lib/bot-scope.js).
  "./database/bot-scope.json": {},
  "./database/slr.json": {},
  "./database/list.json": {},
  "./database/mediaFiles.json": {},
  "./database/numvirtual.json": {},
  "./database/additional/absen.json": {},
  "./database/additional/group participant.json": {},
  "./database/additional/totalchat.json": {},
};
for (const [file, empty] of Object.entries(DEFAULT_DB_FILES)) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(empty, null, 2), "utf8");
}
