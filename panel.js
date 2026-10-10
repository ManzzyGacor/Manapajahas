// panel.js — titik start untuk panel Pterodactyl (PM2).
//
// Setiap kali server di panel di-Start/Restart, script ini:
//   1. Menarik kode terbaru dari GitHub (git), tanpa menyentuh data:
//      .env, database/, session-*, uploads — semuanya di .gitignore.
//   2. Menjalankan `npm install` HANYA kalau package-lock.json berubah
//      (restart biasa tetap cepat).
//   3. Mengunduh binary cloudflared kalau token tunnel diisi tapi
//      binary-nya belum ada.
//   4. Menyalakan aplikasi lewat pm2-runtime (ecosystem.config.cjs).
//
// Cara pakai di panel: isi file utama / startup jadi `node panel.js`.
// Variabel opsional (Startup/Variables atau .env):
//   GIT_BRANCH   cabang yang dipakai (default: main)
//   GIT_URL      alamat repo (default: repo Varesa di GitHub)
//   GIT_TOKEN    token GitHub, hanya kalau repo dijadikan private
//   AUTO_UPDATE  0 = jangan tarik update (default: 1)
//   PANEL_RUNNER pm2 (default) atau node (tanpa PM2)
//   PANEL_DRY_RUN 1 = cuma update & install, tidak menyalakan aplikasi
//   SKIP_NPM     1 = jangan pernah menjalankan npm (modul diurus sendiri)
//
// Script ini sengaja TIDAK mengimpor apa pun dari project: saat pertama
// kali dipakai, file project lain mungkin belum ada / masih versi lama.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
process.chdir(ROOT);

const DEFAULT_GIT_URL = "https://github.com/ManzzyGacor/Manapajahas.git";

const log = (msg) => console.log(`[panel] ${msg}`);
const warn = (msg) => console.warn(`[panel] ⚠️  ${msg}`);

// ── .env sederhana (hanya untuk membaca variabel panel di atas) ─────
function readEnvFile() {
  const out = {};
  try {
    const text = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
      let value = line.slice(eq + 1).trim();
      if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
      out[key] = value;
    }
  } catch {}
  return out;
}
const fileEnv = readEnvFile();
// Variabel panel menang atas .env, sama seperti lib/env.js.
const env = (key, fallback = "") => (process.env[key] ?? fileEnv[key] ?? fallback).toString().trim();

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 10 * 60 * 1000, ...opts });
  // `raw` tidak di-trim: format `git status --porcelain` diawali spasi
  // yang bermakna (" M file"), trim akan memotong nama file pertama.
  const raw = r.stdout || "";
  return { ok: r.status === 0, raw, out: raw.trim(), err: (r.stderr || r.error?.message || "").trim() };
}

const hasGit = () => run("git", ["--version"]).ok;

// ── 1. Update kode dari GitHub ──────────────────────────────────────
// Pakai fetch + reset --hard, bukan `git pull`: server harus SAMA PERSIS
// dengan GitHub. `git pull` gagal diam-diam kalau ada file yang diedit
// langsung di panel, dan update jadi tidak pernah masuk.
// Supaya editan di panel tidak hilang begitu saja, file kode yang berbeda
// disalin dulu ke folder backups/ (folder ini tidak ikut git).
function backupFiles(files, label) {
  if (!files.length) return;
  const dir = path.join(ROOT, "backups", `${label}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  let copied = 0;
  for (const f of files) {
    try {
      const src = path.join(ROOT, f);
      if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
      const dest = path.join(dir, f);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      copied++;
    } catch {}
  }
  if (copied) log(`${copied} file kode lama/diedit dicadangkan ke ${path.relative(ROOT, dir)}/`);
}

function updateCode() {
  if (env("AUTO_UPDATE", "1") === "0") return log("AUTO_UPDATE=0, lewati update kode.");
  if (!hasGit()) return warn("git tidak tersedia di container ini, lewati update kode.");

  const branch = env("GIT_BRANCH", "main");
  let url = env("GIT_URL", DEFAULT_GIT_URL);
  const token = env("GIT_TOKEN");
  if (token && url.startsWith("https://")) url = url.replace("https://", `https://x-access-token:${token}@`);

  const firstTime = !fs.existsSync(path.join(ROOT, ".git"));
  if (firstTime) {
    log("Folder ini belum terhubung ke GitHub — menghubungkan untuk pertama kali...");
    if (!run("git", ["init", "-q"]).ok) return warn("git init gagal.");
    run("git", ["remote", "add", "origin", url]);
  } else {
    run("git", ["remote", "set-url", "origin", url]);
  }

  log(`Mengambil update dari cabang "${branch}"...`);
  const fetched = run("git", ["fetch", "--depth=50", "origin", branch], { timeout: 3 * 60 * 1000 });
  if (!fetched.ok) {
    // Jangan pernah gagal start hanya karena GitHub tidak terjangkau:
    // jalankan saja kode yang sudah ada.
    const reason = fetched.err.split("\n").find((l) => /fatal|error/i.test(l)) || fetched.err.split("\n")[0];
    return warn(`Gagal mengambil update (${reason}). Memakai kode yang ada.`);
  }

  if (firstTime) {
    // File lama yang isinya beda dengan versi GitHub (mis. config.js lama
    // yang berisi API key) dicadangkan sebelum ditimpa.
    const tracked = run("git", ["ls-tree", "-r", "--name-only", "FETCH_HEAD"]).out.split("\n").filter(Boolean);
    const existing = tracked.filter((f) => fs.existsSync(path.join(ROOT, f)));
    const changed = [];
    if (existing.length) {
      const local = run("git", ["hash-object", "--stdin-paths"], { input: existing.join("\n") }).out.split("\n");
      const remote = new Map(
        run("git", ["ls-tree", "-r", "FETCH_HEAD"]).out.split("\n").map((l) => {
          const [meta, file] = l.split("\t");
          return [file, meta?.split(" ")[2]];
        })
      );
      existing.forEach((f, i) => { if (local[i] && local[i] !== remote.get(f)) changed.push(f); });
    }
    backupFiles(changed, "sebelum-git");
  } else {
    // -z: nama file apa adanya (tanpa kutip/escape untuk nama berspasi
    // seperti "plugins/TOOLS/to url.js").
    const dirty = run("git", ["status", "--porcelain", "-z", "--untracked-files=no"]).raw
      .split("\0").filter(Boolean).map((l) => l.slice(3));
    backupFiles(dirty, "editan-panel");
  }

  const reset = run("git", ["reset", "--hard", "-q", "FETCH_HEAD"]);
  if (!reset.ok) return warn(`Gagal menerapkan update: ${reset.err}`);
  const ver = run("git", ["log", "-1", "--format=%h %s (%cr)"]).out;
  log(`Kode terbaru: ${ver}`);
}

// ── 2. Pasang modul hanya kalau memang perlu ───────────────────────
// Dependensi langsung (package.json) yang belum terpasang, atau versinya
// beda dengan package-lock.json.
function depsToInstall() {
  let pkg, lock = {};
  try { pkg = JSON.parse(fs.readFileSync("package.json", "utf8")); } catch { return ["package.json tidak terbaca"]; }
  try { lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8")).packages || {}; } catch {}
  const out = [];
  for (const dep of Object.keys(pkg.dependencies || {})) {
    let installed = null;
    try { installed = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", dep, "package.json"), "utf8")).version; } catch {}
    const wanted = lock[`node_modules/${dep}`]?.version;
    if (!installed || (wanted && installed !== wanted)) out.push(dep);
  }
  return out;
}

function runNpm(args) {
  const r = spawnSync("npm", [...args, "--omit=dev", "--no-audit", "--no-fund"], { stdio: "inherit", timeout: 20 * 60 * 1000 });
  if (r.error) warn(`npm tidak bisa dijalankan: ${r.error.message}`);
  return r.status === 0;
}

function installDeps() {
  if (env("SKIP_NPM") === "1") return log("SKIP_NPM=1, lewati pemasangan modul.");

  const lockFile = fs.existsSync("package-lock.json") ? "package-lock.json" : "package.json";
  const hash = crypto.createHash("sha1")
    .update(fs.readFileSync(lockFile))
    .update(process.versions.node.split(".")[0]) // modul native (canvas) ikut versi Node
    .digest("hex");
  const modulesDir = path.join(ROOT, "node_modules");
  const marker = path.join(modulesDir, ".varesa-deps");
  const saveMarker = () => { try { fs.mkdirSync(modulesDir, { recursive: true }); fs.writeFileSync(marker, hash); } catch {} };
  const hasModules = fs.existsSync(modulesDir);

  if (hasModules && fs.existsSync(marker) && fs.readFileSync(marker, "utf8").trim() === hash) {
    return log("Dependensi tidak berubah, lewati npm install.");
  }

  let ok;
  if (hasModules) {
    // node_modules SUDAH ADA (mis. instalasi lama yang selama ini jalan).
    // JANGAN pakai `npm ci`: perintah itu menghapus seluruh node_modules
    // dulu — kalau pemasangan ulang gagal di panel, bot yang tadinya jalan
    // ikut mati. Cukup pasang yang kurang saja.
    const need = depsToInstall();
    if (!need.length) {
      saveMarker();
      return log("Semua modul sudah terpasang, lewati npm install.");
    }
    log(`Modul kurang/beda versi: ${need.slice(0, 6).join(", ")}${need.length > 6 ? ` (+${need.length - 6} lagi)` : ""} — memasang...`);
    ok = runNpm(["install", "--no-save"]);
  } else {
    log("node_modules belum ada — memasang semua modul (pertama kali, bisa 5–10 menit)...");
    // `npm ci` di sini aman (tidak ada yang dihapus) dan tidak mengubah
    // package-lock.json, jadi file itu tidak dianggap "diedit" saat update.
    ok = runNpm(["ci"]) || (warn("npm ci gagal, mencoba npm install biasa..."), runNpm(["install", "--no-save"]));
  }

  if (ok) return saveMarker();
  warn("Pemasangan modul GAGAL. Aplikasi tetap dicoba jalan dengan modul yang ada.");
  warn("Penyebab umum: Docker image bukan Node.js 20 · RAM/disk panel penuh · koneksi ke registry npm terputus.");
  warn("Kirim ±20 baris log npm di atas ke admin/pengembang supaya bisa dicek.");
}

// ── 3. cloudflared (opsional) ──────────────────────────────────────
async function ensureCloudflared() {
  const token = env("CF_TUNNEL_TOKEN") || (fs.existsSync("cf-token.txt") ? fs.readFileSync("cf-token.txt", "utf8").trim() : "");
  if (!token || fs.existsSync(path.join(ROOT, "cloudflared"))) return;
  const arch = { x64: "amd64", arm64: "arm64", arm: "arm" }[process.arch];
  if (!arch) return warn(`Arsitektur ${process.arch} tidak dikenal, unduh cloudflared manual.`);
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;
  log("Token tunnel ada tapi binary cloudflared belum ada — mengunduh...");
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = path.join(ROOT, "cloudflared");
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    fs.chmodSync(file, 0o755);
    log("cloudflared siap.");
  } catch (err) {
    warn(`Gagal mengunduh cloudflared (${err.message}). Unduh manual, lihat README.`);
  }
}

// ── 4. Jalankan aplikasi ───────────────────────────────────────────
function start() {
  const pm2Runtime = path.join(ROOT, "node_modules", "pm2", "bin", "pm2-runtime");
  const usePm2 = env("PANEL_RUNNER", "pm2") !== "node" && fs.existsSync(pm2Runtime);
  const [cmd, args] = usePm2
    ? [process.execPath, [pm2Runtime, "start", "ecosystem.config.cjs"]]
    : [process.execPath, ["index.js"]];
  log(usePm2 ? "Menyalakan lewat pm2-runtime (ecosystem.config.cjs)..." : "Menyalakan langsung: node index.js");

  // pm2-runtime tetap di foreground, jadi panel menganggap server hidup
  // dan log tampil di console panel. Sinyal stop dari panel diteruskan.
  const child = spawn(cmd, args, { stdio: "inherit", env: process.env });
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => child.kill(sig));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 0 : 1)));
}

log("Varesa — persiapan start di panel");
updateCode();
installDeps();
await ensureCloudflared();
// PANEL_DRY_RUN=1: hanya update + install, tanpa menyalakan bot (untuk uji).
if (env("PANEL_DRY_RUN") === "1") log("PANEL_DRY_RUN=1 — selesai tanpa menyalakan aplikasi.");
else start();
