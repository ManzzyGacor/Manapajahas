#!/usr/bin/env node
/**
 * diagnose.js — jalankan: node diagnose.js
 *
 * Mengumpulkan semua yang dibutuhkan untuk memastikan penyebab 502,
 * supaya tidak perlu menebak lagi. Salin seluruh outputnya.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import net from "net";

const line = (t = "") => console.log(t);
const head = (t) => { line(); line("═══ " + t + " ".repeat(Math.max(0, 40 - t.length))); };

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    return `(gagal: ${err.message.split("\n")[0]})`;
  }
}

head("LINGKUNGAN");
line(`Node          : ${process.version}`);
line(`Platform      : ${process.platform} ${process.arch}`);
line(`CWD           : ${process.cwd()}`);
line(`SERVER_PORT   : ${process.env.SERVER_PORT || "(kosong)"}`);
line(`PORT          : ${process.env.PORT || "(kosong)"}`);
line(`CF_TUNNEL_TOKEN: ${process.env.CF_TUNNEL_TOKEN ? "ADA (" + process.env.CF_TUNNEL_TOKEN.length + " karakter)" : "KOSONG  <-- kalau kosong, tunnel pasti mati"}`);

const PORT = process.env.SERVER_PORT || process.env.PORT || 4526;

head("BINARY CLOUDFLARED");
const cfPath = path.join(process.cwd(), "cloudflared");
if (!fs.existsSync(cfPath)) {
  line(`❌ ./cloudflared TIDAK ADA di ${process.cwd()}`);
} else {
  const st = fs.statSync(cfPath);
  const executable = !!(st.mode & 0o111);
  line(`Ada           : ya (${(st.size / 1048576).toFixed(1)} MB)`);
  line(`Bisa dieksekusi: ${executable ? "ya" : "TIDAK  <-- jalankan: chmod +x cloudflared"}`);
  line(`Versi         : ${run("./cloudflared --version")}`);
}

head("FILE TOKEN");
const tokenFile = path.join(process.cwd(), "cf-token.txt");
line(fs.existsSync(tokenFile)
  ? `cf-token.txt  : ADA (${fs.readFileSync(tokenFile, "utf8").trim().length} karakter)`
  : "cf-token.txt  : tidak ada");

head(`APAKAH PORT ${PORT} SUDAH DILAYANI?`);
await new Promise((resolve) => {
  const sock = net.connect({ host: "127.0.0.1", port: Number(PORT) }, () => {
    line(`✅ Ada yang listen di 127.0.0.1:${PORT} — aplikasi web hidup.`);
    sock.destroy();
    resolve();
  });
  sock.on("error", (e) => {
    line(`❌ Tidak ada yang listen di 127.0.0.1:${PORT} (${e.code})`);
    line(`   Kalau aplikasi mengaku jalan, berarti port-nya BEDA dari tujuan tunnel.`);
    resolve();
  });
  sock.setTimeout(3000, () => { line("❌ timeout"); sock.destroy(); resolve(); });
});

head("HEALTHZ");
try {
  const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
  line(`Status ${r.status}: ${(await r.text()).slice(0, 300)}`);
} catch (e) {
  line(`❌ Gagal: ${e.message}`);
}

head("STATUS PM2");
line(run("pm2 jlist | head -c 1500") === "" ? "(pm2 tidak ditemukan)" : run("pm2 list --no-color"));

head("50 BARIS TERAKHIR ERROR CF-TUNNEL");
line(run("pm2 logs CF-Tunnel --err --lines 50 --nostream --no-color"));

head("20 BARIS TERAKHIR ERROR CORE");
line(run("pm2 logs JadiVaresa-Core --err --lines 20 --nostream --no-color"));

head("SELESAI — salin seluruh output di atas");
