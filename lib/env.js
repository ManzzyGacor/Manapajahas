// lib/env.js
//
// Memuat file .env ke process.env TANPA dependensi tambahan.
//
// Harus diimpor PALING PERTAMA di index.js: impor ESM dievaluasi berurutan,
// dan beberapa modul (webserver.js, payment.js, config.js) membaca
// process.env saat modulnya dimuat. Kalau .env dibaca belakangan,
// nilainya sudah terlambat.
//
// Variabel yang sudah diset dari luar (panel Pterodactyl / PM2) TIDAK
// ditimpa — panel tetap menang atas file.
import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env");

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  let loaded = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
      loaded++;
    }
  }
  console.log(`[✔] .env dimuat (${loaded} variabel).`);
} else {
  console.warn("[!] File .env tidak ditemukan. Salin .env.example menjadi .env lalu isi nilainya.");
}
