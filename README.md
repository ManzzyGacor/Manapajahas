# Varesa — Jadibot WhatsApp

Platform "jadibot" WhatsApp multi-sesi: pengguna login, menghubungkan nomornya lewat pairing code,
dan bot langsung aktif dengan ratusan fitur. Dilengkapi dashboard pengguna, panel admin,
pembayaran QRIS, monitor server real-time, dan API pengiriman pesan.

## Fitur utama

- **Landing page baru** bergaya dark minimalis dengan banner bergerak (video/gambar) yang diatur dari panel admin.
- **Kapasitas server asli** — dihitung dari RAM/CPU container dan rata-rata pemakaian per bot,
  sehingga pengunjung tahu server masih bisa menampung berapa bot lagi. Saat penuh, bot baru ditolak dengan pesan yang jelas.
- **Log command real-time** — command yang dipakai di semua bot tampil langsung, nomor bot disensor (`6285xxxx026`).
- **Performa server real-time** — CPU, RAM, event-loop lag, pesan/detik, grafik 10 menit terakhir.
- **API gateway** — kirim pesan dari aplikasi sendiri (`POST /api/v1/text`) memakai token per bot.
- Pengaturan bot dari dashboard (nama bot, menu, owner, auto-reply, perintah kustom, welcome, dsb.) tersambung ke bot per sesi.

## Struktur

| Folder/File | Isi |
|---|---|
| `index.js` | Titik masuk: memuat `.env`, menyalakan web server, lalu sesi bot |
| `lib/webserver.js` | Express: halaman web + seluruh API |
| `lib/monitor.js` | Performa, kapasitas, dan log command real-time |
| `lib/site-settings.js` | Pengaturan situs (banner, pengumuman) dari panel admin |
| `autoresbot.js` | Pemroses pesan masuk bot |
| `plugins/` | Fitur bot (satu file = satu fitur, dikelompokkan per kategori) |
| `handle/` | Handler sistem (anti-spam, game, AFK, dll.) |
| `JadiVaresaWeb/` | Frontend: landing, login, dashboard, admin, status, invoice |

## Instalasi

Butuh **Node.js 20.x**.

```bash
npm install
cp .env.example .env   # lalu isi nilainya
npm start              # atau: pm2 start ecosystem.config.cjs
```

### Variabel `.env`

Semua rahasia dibaca dari `.env` (dimuat otomatis oleh `lib/env.js`). Variabel yang diset di panel
(Pterodactyl → Startup/Variables) tetap diutamakan. Daftar lengkap ada di `.env.example`; yang wajib:

- `MONGO_URI` — koneksi MongoDB (login, pembayaran, dashboard)
- `BOT_NUMBER`, `OWNER_NUMBERS` — nomor bot utama & owner
- `CF_TUNNEL_TOKEN` — kalau memakai Cloudflare Tunnel lewat `ecosystem.config.cjs`

> Repository ini **public**. Jangan pernah commit `.env`, `cf-token.txt`, folder `session-*`, atau file database pengguna —
> semuanya sudah ada di `.gitignore`.

### Cloudflare Tunnel

`ecosystem.config.cjs` menjalankan binary `./cloudflared` (tidak disimpan di repo karena besar). Unduh sekali di server:

```bash
curl -L -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared
```

## Kapasitas server

`lib/monitor.js` memperkirakan berapa bot yang masih muat, lalu menampilkannya di landing page,
halaman status, dan dashboard. Saat penuh, `POST /api/bot/start` menolak bot baru (`503 SERVER_FULL`); admin tetap bisa.

```
batas RAM   = min(jatah RAM container, MAX_MEMORY_MB / batas PM2 1200 MB)
terpakai    = baseline proses (diukur saat 0 bot, awal 160 MB)
per bot     = rata-rata tambahan RAM per sesi (diukur, awal 70 MB)
kapasitas   = min( (batas RAM × (1 − cadangan%) − baseline) ÷ per bot,  core CPU × 25,  batas admin )
```

Cadangan (default 15%) dan batas manual bisa diatur di panel admin → **Kapasitas Server**.

## Paket & batas bot

Paket berlaku **per bot**, bukan per akun. Satu akun boleh punya beberapa bot (nomor WhatsApp) dan tiap bot
bisa beda paket — mis. satu bot Free untuk coba-coba dan satu bot Zenith untuk grup jualan.

| Paket | Kunci | Owner | Auto-reply | Perintah kustom | Lainnya |
|---|---|---|---|---|---|
| Free | `free` | 0 | 0 | 0 | kuota grup Free |
| Core | `basic` | 1 | 10 | 0 | nama bot, menu, watermark |
| Prime | `plus` | 3 | 30 | 15 | |
| Zenith | `booster` | 5 | 100 | 50 | gambar menu, add-on MLBB |

- Harga per bot per bulan dari `GET /api/pricing` (`source`: `database` / `cache` / `default`).
- Pembelian selalu untuk satu bot: `POST /api/payment/create` wajib menyertakan `botNumber` milik akun itu.
  Prorata dihitung dari paket bot tersebut.
- **Batas per akun** (panel admin → Pengaturan situs → `limits`): maksimal `maxBotsPerUser` bot (default 5, 1–50)
  dan `maxFreeBotsPerUser` bot Free (default 1, 0–10). Menambah bot di luar batas ditolak `403 BOT_LIMIT` /
  `403 BOT_LIMIT_FREE`. Admin tidak terkena batas. Penjaga kapasitas server (`503 SERVER_FULL`) tetap dicek lebih dulu.
- Menghapus bot yang paketnya masih aktif **tidak menghanguskan paket**: paketnya disimpan sebagai *paket tertunda*
  dan otomatis dipasang ke bot berikutnya yang ditambahkan (sisa masa aktif tetap berjalan).
- Paket yang habis masa aktifnya diturunkan ke Free per bot (dicek tiap 10 menit, dan langsung saat bot membaca tier).
- Daftar bot milik akun: `GET /api/bots/mine?userId=…`; admin mengatur paket satu bot lewat `POST /api/admin/bot-tier`.
- Data lama (paket per akun) dimigrasi otomatis saat server tersambung ke MongoDB: paket aktif pindah ke bot pertama
  akun itu, atau jadi paket tertunda kalau akunnya belum punya bot. Migrasi aman diulang di setiap boot.

## Monitor real-time

- `GET /api/public/live` — performa server, lalu lintas, kapasitas, dan log command (nomor bot disensor, isi pesan tidak pernah dicatat).
- `GET /api/admin/live` — sama, plus nomor lengkap & statistik per bot (khusus admin).
- Halaman `/status` menampilkan semuanya dengan grafik 10 menit terakhir.

## API kirim pesan

Token tiap bot dibuat dari dashboard (menu **API**). Kuota harian mengikuti paket **bot itu**: Free 50, Core 1.000, Prime 5.000, Zenith 20.000; maksimal 1 pesan/detik.

```bash
curl -X POST https://varesa.mom/api/v1/text \
  -H "x-varesa-token: vrs_TOKEN_KAMU" \
  -H "Content-Type: application/json" \
  -d '{"number":"6281234567890","text":"Halo dari Varesa 👋"}'
```

Endpoint lain: `POST /api/v1/image` (`{ number, url, caption }`) dan `GET /api/v1/me`.

## Data runtime

File database pengguna (`database/users.json`, `database/jadibot.json`, dll.) dibuat otomatis kosong saat instalasi baru
oleh `lib/bootstrap.js`. Saat meng-update server lama, **jangan timpa folder `database/`** milikmu.
Statistik monitor & pengaturan situs disimpan di `database/runtime/`, media banner yang di-upload admin di `JadiVaresaWeb/uploads/`.
