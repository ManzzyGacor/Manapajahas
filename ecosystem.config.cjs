// ecosystem.config.cjs
//
// Startup Command di panel:
//   pm2 start ecosystem.config.cjs
//
// (Kalau egg panel kamu memang sudah menjaga PM2 tetap hidup, `pm2 start`
//  sudah cukup — itu yang terbukti jalan di server ini. `pm2-runtime` hanya
//  diperlukan kalau egg-nya tidak melakukan itu.)
//
// TOKEN CLOUDFLARE:
//   Panel -> Startup / Variables:  CF_TUNNEL_TOKEN=token_kamu
//   atau buat file cf-token.txt (isi tokennya saja, satu baris).

const fs = require("fs");
const path = require("path");

function readTunnelToken() {
  const fromEnv = (process.env.CF_TUNNEL_TOKEN || "").trim();
  if (fromEnv) return fromEnv;

  const tokenFile = path.join(__dirname, "cf-token.txt");
  if (fs.existsSync(tokenFile)) {
    const fromFile = fs.readFileSync(tokenFile, "utf8").trim();
    if (fromFile) return fromFile;
  }

  throw new Error(
    "\n\n⛔ TOKEN CLOUDFLARE TUNNEL BELUM DIISI.\n" +
    "   Panel -> Startup / Variables:  CF_TUNNEL_TOKEN=token_kamu\n" +
    "   atau buat file cf-token.txt di folder ini.\n"
  );
}

const CF_TOKEN = readTunnelToken();
const PORT = String(process.env.SERVER_PORT || process.env.PORT || 4526);

// Argumen cloudflared.
//
// URUTAN PENTING: bentuk perintahnya adalah
//   cloudflared tunnel [opsi-tunnel] run [opsi-run]
// Semua opsi seperti --metrics, --protocol, --retries, --grace-period
// adalah milik `tunnel`, jadi HARUS ditulis SEBELUM kata `run`.
// Kalau ditaruh sesudahnya, cloudflared menolak argumen, mencetak seluruh
// halaman help, lalu keluar dengan code 0 — terlihat seperti mati sendiri
// tanpa error.
// CATATAN: --metrics SENGAJA TIDAK dipakai.
// Saat PM2 me-restart sebuah replica, proses lama belum tentu sudah melepas
// port metrics-nya. Proses baru lalu gagal bind ("address already in use"),
// keluar, di-restart lagi — jadi lingkaran yang tidak pernah selesai.
// Tanpa flag ini cloudflared memilih port bebas sendiri, jadi dua replica
// tidak mungkin bentrok.
function tunnelArgs() {
  return [
    "tunnel",
    "--no-autoupdate",
    "--protocol", "http2",      // UDP/QUIC diblokir di container ini
    "--retries", "10",          // lebih gigih sebelum menyerah
    "--grace-period", "30s",    // selesaikan request yang sedang jalan
    "run",
    "--token", CF_TOKEN,
  ];
}

// Satu replica tunnel. Cloudflare resmi mendukung beberapa cloudflared
// menjalankan tunnel yang SAMA (namanya replica). Kalau satu mati, yang
// lain tetap melayani — jadi tidak ada jendela 502 saat PM2 me-restart.
function tunnelApp(name) {
  return {
    name,
    script: "./cloudflared",
    interpreter: "none",
    cwd: __dirname,

    args: tunnelArgs(),

    autorestart: true,
    // Jeda cukup panjang: beri waktu proses lama benar-benar berhenti
    // sebelum yang baru mencoba menyambung.
    restart_delay: 5000,
    min_uptime: "30s",

    // Sengaja sangat tinggi. Putusnya koneksi jaringan itu normal dan bisa
    // terjadi berkali-kali dalam sebulan; kalau PM2 menyerah, tunnel mati
    // permanen dan situs ikut mati sampai ada yang sadar.
    max_restarts: 1000,

    error_file: `./logs/${name}-error.log`,
    out_file: `./logs/${name}-out.log`,
    merge_logs: true,
    time: true,
  };
}

module.exports = {
  apps: [
    {
      name: "JadiVaresa-Core",
      script: "./index.js",
      cwd: __dirname,
      watch: false,

      // Sesi WhatsApp disimpan di memori proses. Dua instance akan membuat
      // sesi ganda yang saling memutus koneksi.
      instances: 1,
      exec_mode: "fork",

      autorestart: true,
      exp_backoff_restart_delay: 100,
      min_uptime: "20s",
      max_restarts: 10,

      // Terukur di server ini: 335 MB setelah 7 jam dengan 3 sesi bot.
      // 1200 MB memberi ruang lega tanpa mendekati batas container 2 GB.
      max_memory_restart: "1200M",
      kill_timeout: 8000,

      env: {
        NODE_ENV: "production",
        TZ: "Asia/Jakarta",
        PORT: PORT,
      },

      error_file: "./logs/core-error.log",
      out_file: "./logs/core-out.log",
      merge_logs: true,
      time: true,
    },

    // Dua replica tunnel -> tidak ada jeda 502 saat salah satu restart.
    tunnelApp("CF-Tunnel-1"),
    tunnelApp("CF-Tunnel-2"),
  ],
};
