/**
 * tools/health-probe.js — uji pengecekan kesehatan fitur dari terminal.
 *
 *   node tools/health-probe.js              # cek semua endpoint yang dikenal
 *   node tools/health-probe.js tiktok       # cek satu command
 *   node tools/health-probe.js --json       # keluarkan hasil sebagai JSON
 *   node tools/health-probe.js --list       # tampilkan pemetaan command -> API
 *
 * Catatan: script ini sengaja TIDAK memuat plugin lewat lib/plugins.js (yang
 * menarik seluruh dependensi npm). Yang dibutuhkan pengawas kesehatan cuma
 * tiga hal dari tiap plugin: nama berkas, daftar Commands, dan isi berkasnya
 * (untuk mengenali API pihak ketiga). Ketiganya dibaca langsung dari disk,
 * jadi script ini tetap bisa jalan di server yang belum `npm install`.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { syncFromPlugins, runHealthChecks, getHealthReport, stopHealthMonitor } from "../lib/health.js";
import { collectSource } from "../lib/health-providers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
process.chdir(ROOT);

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const listOnly = args.includes("--list");
const only = args.find((a) => !a.startsWith("--")) || null;

/* ------------------------------------------------------------------
   Baca daftar command tiap plugin dari berkasnya
   ------------------------------------------------------------------ */
const PLUGINS_DIR = path.join(ROOT, "plugins");

function daftarBerkas(dir) {
  const out = [];
  for (const entri of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entri.name);
    if (entri.isDirectory()) out.push(...daftarBerkas(full));
    else if (entri.name.endsWith(".js")) out.push(full);
  }
  return out;
}

// Ambil "Commands: [...]" pertama dari berkas plugin. Cukup untuk keperluan
// pengujian; bot sendiri memakai array Commands hasil impor modul.
function commandsDari(src) {
  const m = /Commands\s*:\s*\[([^\]]*)\]/.exec(src);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^["'`]|["'`]$/g, "").toLowerCase())
    .filter(Boolean);
}

const plugins = [];
for (const file of daftarBerkas(PLUGINS_DIR)) {
  const src = fs.readFileSync(file, "utf8");
  const Commands = commandsDari(src);
  if (!Commands.length) continue;
  plugins.push({
    __file: path.relative(ROOT, file),
    // Hanya isi berkas plugin sendiri — dasar atribusi provider di
    // syncFromPlugins(). (collectSource() tersedia untuk diagnosa manual.)
    __source: src,
    Commands,
  });
}

const jumlah = syncFromPlugins(plugins);
const laporan0 = getHealthReport();
console.log(
  `[i] ${plugins.length} plugin dibaca, ${jumlah} command dipantau, ` +
  `${laporan0.dipantau} command punya pengecekan otomatis.`
);

if (listOnly) {
  for (const it of laporan0.items) {
    const tag = it.hasProbe ? `probe:${(it.providers || []).join("+") || "khusus"}` : "hanya-statistik";
    console.log(`${it.command.padEnd(22)} ${(it.plugin || "").padEnd(34)} ${tag}`);
  }
  stopHealthMonitor();
  process.exit(0);
}

const hasil = await runHealthChecks({ only });
if (asJson) {
  console.log(JSON.stringify({ hasil, laporan: getHealthReport() }, null, 2));
} else {
  console.log(`[i] Probe selesai: diperiksa ${hasil.diperiksa}, sehat ${hasil.sehat}, rusak ${hasil.rusak}.`);
  const laporan = getHealthReport();
  const items = laporan.items.filter((x) => x.hasProbe || x.failsToday);
  if (!items.length) {
    console.log("[i] Belum ada command dengan data kesehatan.");
  } else {
    console.log(`\n${"command".padEnd(20)} ${"hari ini".padStart(8)} ${"total".padStart(7)}  status`);
    for (const it of items) {
      const status = it.disabled
        ? `NONAKTIF (${it.disabledReason})`
        : it.hasProbe ? "aktif (dipantau)" : "aktif";
      console.log(`${it.command.padEnd(20)} ${String(it.failsToday).padStart(8)} ${String(it.failTotal).padStart(7)}  ${status}`);
    }
  }
}
stopHealthMonitor();
process.exit(0);