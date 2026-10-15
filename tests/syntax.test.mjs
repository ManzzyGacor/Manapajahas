// Cek sintaks SEMUA berkas JavaScript yang ada di repo (node --check).
//
// Kenapa: sebagian besar kode di repo ini (plugin, handler, halaman web)
// tidak punya test sendiri. Salah ketik kecil — kurung kurawal kurang,
// koma ganda — baru ketahuan saat berkas itu dimuat di server. `node
// --check` hanya mem-parse berkas (tidak menjalankannya), jadi aman dan
// cepat untuk semua berkas sekaligus, termasuk skrip browser di
// JadiVaresaWeb/ (dicek dengan aturan yang sama dengan berkas lain di repo).
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EKSTENSI = /\.(c|m)?js$/;
const LEWATI = new Set(["node_modules", ".git", "session", "sessions", "tmp", "logs", "backups"]);

// Daftar berkas: dari git (berkas yang ter-commit + berkas baru yang belum
// di-.gitignore). Kalau git tidak ada (mis. salinan zip), telusuri folder.
function daftarBerkas() {
  try {
    const out = execFileSync("git", ["ls-files", "-z", "-co", "--exclude-standard"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\0").filter((f) => f && EKSTENSI.test(f) && fs.existsSync(path.join(ROOT, f)));
  } catch {
    const hasil = [];
    const jalan = (dir) => {
      for (const nama of fs.readdirSync(path.join(ROOT, dir))) {
        if (LEWATI.has(nama) || nama.startsWith("session-")) continue;
        const rel = dir ? `${dir}/${nama}` : nama;
        const st = fs.statSync(path.join(ROOT, rel));
        if (st.isDirectory()) jalan(rel);
        else if (EKSTENSI.test(nama)) hasil.push(rel);
      }
    };
    jalan("");
    return hasil;
  }
}

function cekSatu(rel) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--check", rel], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { if (err.length < 4000) err += d; });
    child.on("close", (code) => resolve({ rel, ok: code === 0, err: err.trim() }));
    child.on("error", (e) => resolve({ rel, ok: false, err: e.message }));
  });
}

test("semua berkas .js/.mjs/.cjs lolos node --check", { timeout: 300000 }, async () => {
  const berkas = daftarBerkas();
  assert.ok(berkas.length > 100, `berkas JS yang ditemukan terlalu sedikit (${berkas.length}) — daftar berkas salah?`);

  // Jalan paralel (sebanyak core) supaya ~450 berkas selesai dalam hitungan detik.
  const antrean = [...berkas];
  const gagal = [];
  const pekerja = Array.from({ length: Math.max(2, Math.min(8, os.cpus().length)) }, async () => {
    while (antrean.length) {
      const r = await cekSatu(antrean.shift());
      if (!r.ok) gagal.push(r);
    }
  });
  await Promise.all(pekerja);

  const pesan = gagal
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .map((g) => `\n--- ${g.rel}\n${g.err.split("\n").slice(0, 6).join("\n")}`)
    .join("");
  assert.equal(gagal.length, 0, `${gagal.length} berkas gagal di-parse:${pesan}`);
});
