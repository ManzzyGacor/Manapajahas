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

## Data runtime

File database pengguna (`database/users.json`, `database/jadibot.json`, dll.) dibuat otomatis kosong saat instalasi baru
oleh `lib/bootstrap.js`. Saat meng-update server lama, **jangan timpa folder `database/`** milikmu.
Statistik monitor & pengaturan situs disimpan di `database/runtime/`, media banner yang di-upload admin di `JadiVaresaWeb/uploads/`.
