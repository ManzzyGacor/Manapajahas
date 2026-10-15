/**
 * tools/check-plugins.mjs — pastikan SEMUA plugin & handler bisa dimuat.
 *
 *   node tools/check-plugins.mjs           # ringkas: hanya yang gagal/aneh
 *   node tools/check-plugins.mjs --verbose # tampilkan juga daftar lengkap
 *
 * Kenapa ada: lib/handler.js memuat plugin satu per satu dan cuma MENCATAT
 * kalau ada yang gagal (supaya satu plugin rusak tidak mematikan bot). Itu
 * bagus di produksi, tapi artinya plugin yang salah import / salah ketik
 * baru ketahuan setelah di-deploy — fiturnya diam-diam hilang dari menu.
 * Script ini meniru cara lib/handler.js memuat (handle/ dulu, lalu
 * plugins/, rekursif, semua berkas .js) dan GAGAL (exit 1) kalau ada satu
 * saja yang tidak bisa dimuat, supaya CI menangkapnya sebelum merge.
 *
 * Aman dijalankan di mana saja (CI, laptop, bahkan server produksi):
 *   - tidak pernah memanggil connectToWhatsApp / membuka sesi bot;
 *   - SEMUA koneksi jaringan diblokir sebelum plugin pertama dimuat
 *     (socket TCP/TLS, DNS, fetch). Plugin yang mencoba menghubungi
 *     jaringan SAAT DIMUAT dicatat dan membuat cek ini gagal — memuat
 *     plugin seharusnya tidak menunggu internet (boot jadi lambat dan
 *     rapuh kalau API pihak ketiga sedang mati);
 *   - MONGO_URI dikosongkan, jadi tidak ada yang tersambung ke database;
 *   - lib/version.js TIDAK diimpor (modul itu menulis ulang strings.js dkk.).
 * Efek samping satu-satunya: lib/bootstrap.js membuat berkas database
 * kosong yang belum ada (sama seperti saat bot pertama kali dinyalakan;
 * semuanya sudah di-.gitignore).
 */
import fs from "fs";
import path from "path";
import net from "net";
import dns from "dns";
import { pathToFileURL, fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const VERBOSE = process.argv.includes("--verbose");
// Batas waktu total. Memuat ~360 plugin normalnya beberapa detik; kalau
// lebih dari ini hampir pasti ada modul yang menggantung (top-level await).
const BATAS_WAKTU_MS = Number(process.env.CHECK_PLUGINS_TIMEOUT_MS) || 180000;

/* ------------------------------------------------------------------
   1. Lingkungan aman: tanpa database, tanpa jaringan
   ------------------------------------------------------------------ */
process.env.MONGO_URI = "";
process.env.TZ = process.env.TZ || "Asia/Jakarta";
// Mode development memasang pengawas berkas (hot reload) begitu
// autoresbot.js ikut termuat; tidak berguna di sini dan hanya menahan proses.
process.env.BOT_MODE = process.env.BOT_MODE || "production";
// lib/version.js sengaja tidak diimpor (lihat di atas); config.js membaca
// global.version saat dimuat.
global.version = global.version || "check";

const percobaanJaringan = []; // { modul, jenis, tujuan }
let modulSekarang = "(sebelum memuat plugin)";

function catatJaringan(jenis, tujuan) {
  percobaanJaringan.push({ modul: modulSekarang, jenis, tujuan: String(tujuan).slice(0, 120) });
  const err = new Error(`[check-plugins] jaringan diblokir (${jenis} ${tujuan})`);
  err.code = "ECONNREFUSED";
  return err;
}

function tujuanSocket(args) {
  const a = args[0];
  if (Array.isArray(a)) return tujuanSocket(a); // bentuk internal [options, cb]
  if (a && typeof a === "object") return a.path || `${a.host || a.hostname || "localhost"}:${a.port ?? "?"}`;
  if (typeof a === "number") return `${args[1] || "localhost"}:${a}`;
  return String(a);
}

// Semua koneksi keluar (http, https, ws/WebSocket Baileys, fetch/undici,
// driver MongoDB) akhirnya lewat net.Socket#connect — tls.TLSSocket juga
// turunan net.Socket. Cukup satu titik blokir di sini.
net.Socket.prototype.connect = function connectDiblokir(...args) {
  const err = catatJaringan("socket", tujuanSocket(args));
  process.nextTick(() => this.destroy(err));
  return this;
};

const lookupDiblokir = (host, opts, cb) => {
  const done = typeof opts === "function" ? opts : cb;
  const err = catatJaringan("dns", host);
  if (typeof done === "function") process.nextTick(() => done(err));
};
dns.lookup = lookupDiblokir;
dns.promises.lookup = async (host) => { throw catatJaringan("dns", host); };
for (const nama of ["resolve", "resolve4", "resolve6", "resolveAny", "resolveSrv", "resolveTxt"]) {
  if (typeof dns.promises[nama] === "function") dns.promises[nama] = async (host) => { throw catatJaringan("dns", host); };
  if (typeof dns[nama] === "function") dns[nama] = (host, ...rest) => lookupDiblokir(host, ...rest);
}

globalThis.fetch = async (input) => {
  throw catatJaringan("fetch", typeof input === "string" ? input : input?.url || input);
};

// Efek samping modul yang gagal belakangan (mis. promise dari request yang
// diblokir) jangan sampai menjatuhkan pemeriksaan; cukup dicatat.
const galatBelakangan = [];
process.on("unhandledRejection", (e) => {
  if (String(e?.message || e).includes("[check-plugins] jaringan diblokir")) return;
  galatBelakangan.push({ modul: modulSekarang, pesan: String(e?.message || e).split("\n")[0] });
});
process.on("uncaughtException", (e) => {
  if (String(e?.message || e).includes("[check-plugins] jaringan diblokir")) return;
  galatBelakangan.push({ modul: modulSekarang, pesan: String(e?.message || e).split("\n")[0] });
});

const pengawas = setTimeout(() => {
  console.error(`\n❌ Melebihi ${Math.round(BATAS_WAKTU_MS / 1000)} detik — macet saat memuat ${modulSekarang}.`);
  process.exit(1);
}, BATAS_WAKTU_MS);
pengawas.unref();

/* ------------------------------------------------------------------
   2. Siapkan berkas database bawaan (seperti index.js)
   ------------------------------------------------------------------ */
// Modul seperti lib/users.js membaca database/*.json saat dimuat. Di
// checkout baru (CI) berkas itu belum ada; bootstrap membuat versi kosong.
await import(pathToFileURL(path.join(ROOT, "lib", "bootstrap.js")).href);

/* ------------------------------------------------------------------
   3. Muat semua berkas, urutan sama dengan lib/handler.js
   ------------------------------------------------------------------ */
function kumpulkan(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const nama of fs.readdirSync(dir)) {
    const full = path.join(dir, nama);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...kumpulkan(full));
    else if (nama.endsWith(".js")) out.push(full);
  }
  return out;
}

const berkas = [...kumpulkan(path.join(ROOT, "handle")), ...kumpulkan(path.join(ROOT, "plugins"))];
const gagal = [];      // { rel, pesan }
const cacat = [];      // plugin yang bentuknya salah (Commands tanpa handle, dst.)
const bukanKeduanya = []; // modul pembantu: bukan handler, bukan plugin
const petaCommand = new Map(); // command -> [rel]
let jumlahHandler = 0;
let jumlahPlugin = 0;
const mulai = Date.now();

for (const full of berkas) {
  const rel = path.relative(ROOT, full).split(path.sep).join("/");
  modulSekarang = rel;
  try {
    const mod = await import(pathToFileURL(full).href);
    const h = mod.default || mod;
    let dikenal = false;

    if (h && typeof h.process === "function") {
      jumlahHandler++;
      dikenal = true;
    }
    if (h && Array.isArray(h.Commands)) {
      if (typeof h.handle !== "function") {
        cacat.push({ rel, pesan: "punya Commands tapi tidak punya fungsi handle()" });
      } else {
        jumlahPlugin++;
        dikenal = true;
        const kosong = h.Commands.filter((c) => typeof c !== "string" || !c.trim());
        if (kosong.length) cacat.push({ rel, pesan: `Commands berisi ${kosong.length} nama kosong/bukan teks` });
        for (const c of h.Commands) {
          const k = String(c).toLowerCase();
          if (!petaCommand.has(k)) petaCommand.set(k, []);
          petaCommand.get(k).push(rel);
        }
      }
    }
    if (!dikenal) bukanKeduanya.push(rel);
  } catch (err) {
    const kode = err?.code ? `${err.code}: ` : "";
    gagal.push({ rel, pesan: (kode + (err?.message || String(err))).split("\n")[0] });
  }
}
modulSekarang = "(setelah semua dimuat)";

// Beri kesempatan efek samping asinkron (timer 0, promise) muncul dulu,
// supaya percobaan jaringan yang tertunda sedikit tetap tercatat.
await new Promise((r) => setTimeout(r, 300));

/* ------------------------------------------------------------------
   4. Laporan
   ------------------------------------------------------------------ */
const durasi = ((Date.now() - mulai) / 1000).toFixed(1);
const ganda = [...petaCommand.entries()].filter(([, v]) => v.length > 1);

console.log(`Plugin dicek: ${berkas.length} berkas dalam ${durasi} dtk`);
console.log(`  handler sistem : ${jumlahHandler}`);
console.log(`  plugin command : ${jumlahPlugin} (${petaCommand.size} command)`);
console.log(`  modul pembantu : ${bukanKeduanya.length}`);

if (VERBOSE && bukanKeduanya.length) {
  console.log("\nModul pembantu (dimuat, tapi bukan handler/plugin):");
  for (const r of bukanKeduanya) console.log(`  - ${r}`);
}
if (ganda.length) {
  // Hanya peringatan: urutan muat menentukan plugin mana yang menang, dan
  // beberapa duplikat memang disengaja (alias lama). Tetap ditampilkan
  // supaya duplikat baru yang tidak disengaja kelihatan.
  console.log(`\n⚠️  Command yang dipakai lebih dari satu plugin (${ganda.length}):`);
  for (const [c, v] of ganda.slice(0, VERBOSE ? ganda.length : 15)) console.log(`  - ${c}: ${v.join(", ")}`);
  if (!VERBOSE && ganda.length > 15) console.log(`  … dan ${ganda.length - 15} lagi (pakai --verbose)`);
}
if (galatBelakangan.length) {
  console.log(`\n⚠️  Galat dari efek samping modul (${galatBelakangan.length}):`);
  for (const g of galatBelakangan.slice(0, 20)) console.log(`  - ${g.modul}: ${g.pesan}`);
}
if (cacat.length) {
  console.log(`\n❌ Bentuk plugin salah (${cacat.length}):`);
  for (const c of cacat) console.log(`  - ${c.rel}: ${c.pesan}`);
}
if (gagal.length) {
  console.log(`\n❌ Gagal dimuat (${gagal.length}):`);
  for (const g of gagal) console.log(`  - ${g.rel}: ${g.pesan}`);
}
if (percobaanJaringan.length) {
  console.log(`\n❌ Mencoba menghubungi jaringan saat dimuat (${percobaanJaringan.length}, semuanya diblokir):`);
  for (const p of percobaanJaringan.slice(0, 30)) console.log(`  - ${p.modul}: ${p.jenis} ${p.tujuan}`);
}

const ok = !gagal.length && !cacat.length && !percobaanJaringan.length && berkas.length > 0;
console.log(ok ? "\n✅ Semua plugin & handler bisa dimuat." : "\n❌ Pemeriksaan plugin GAGAL.");
// Keluar eksplisit: beberapa modul memasang timer/watcher yang membuat
// proses tidak pernah berhenti sendiri.
setTimeout(() => process.exit(ok ? 0 : 1), 50);
