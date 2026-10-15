// Alat bantu bersama untuk tests/*.test.mjs (berkas ini sendiri bukan test:
// namanya tidak berakhiran .test.mjs, jadi tidak dijalankan `node --test`).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dibuat = [];
process.once("exit", () => {
  for (const d of dibuat) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* biarkan */ }
  }
});

// Folder sementara yang dihapus otomatis saat proses test selesai.
export function tempDir(nama = "tmp") {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `varesa-test-${nama}-`));
  dibuat.push(d);
  return d;
}

// Banyak modul lib/ menulis ke `process.cwd()/database/...` (pengaturan
// situs, statistik monitor, rahasia sesi). Test pindah dulu ke folder
// sementara SEBELUM mengimpor modul itu, supaya `npm test` tidak pernah
// menyentuh data asli — aman dijalankan di server produksi sekalipun.
export function pindahKeFolderSementara(nama) {
  const d = tempDir(nama);
  process.chdir(d);
  return d;
}

export const HARI_MS = 86400000;
