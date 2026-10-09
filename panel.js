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

// ── 2. npm install hanya kalau dependensi berubah ──────────────────
function installDeps() {
  const lockFile = fs.existsSync("package-lock.json") ? "package-lock.json" : "package.json";
  const hash = crypto.createHash("sha1")
    .update(fs.readFileSync(lockFile))
    .update(process.versions.node.split(".")[0]) // modul native (canvas) ikut versi Node
    .digest("hex");
  const marker = path.join(ROOT, "node_modules", ".varesa-deps");
  const current = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : "";
  if (current === hash && fs.existsSync(path.join(ROOT, "node_modules"))) {
    return log("Dependensi tidak berubah, lewati npm install.");
  }
  log("Dependensi berubah — memasang modul (bisa beberapa menit)...");
  // `npm ci` dipakai karena TIDAK PERNAH mengubah package-lock.json. Kalau
  // lock ikut berubah, file itu jadi "diedit" di server, ditimpa lagi saat
  // restart berikutnya, lalu install terulang terus-menerus.
  const opts = { stdio: "inherit", timeout: 20 * 60 * 1000 };
  const flags = ["--omit=dev", "--no-audit", "--no-fund"];
  let r = lockFile === "package-lock.json" ? spawnSync("npm", ["ci", ...flags], opts) : { status: 1 };
  if (r.status !== 0) {
    if (lockFile === "package-lock.json") warn("npm ci gagal, mencoba npm install biasa...");
    r = spawnSync("npm", ["install", "--no-save", ...flags], opts);
  }
  if (r.status === 0) {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, hash);
  } else {
    warn("npm install gagal. Aplikasi tetap dicoba jalan dengan modul yang ada.");
  }
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
