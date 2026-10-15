import os from "os";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import figlet from "figlet";
import axios from "axios";
import config from "../config.js";
import { success, danger } from "../lib/utils.js";
import { connectToWhatsApp, isSessionBusy, eventBus } from "../lib/connection.js";
import { listJadibot } from "../lib/jadibot.js";
import { getCapacity } from "../lib/monitor.js";


const TERMINAL_WIDTH = process.stdout.columns || 45; // Default ke 45 jika tidak tersedia
const ALIGNMENT_PADDING = 3;

// Mengubah default karakter garis pembatas agar terlihat lebih solid
const horizontalLine = (length = TERMINAL_WIDTH, char = "━") =>
  char.repeat(length);

let cachedIP = null;

// ASCII custom untuk MANZZY (Desain baru yang lebih sleek)
const VARESA_ASCII = `
 __   __  _  ___  ____  ____  ___   
 \\ \\ / / / \\|  _ \\| ___|/ ___|/ _ \\  
  \\ V / / _ \\ |_) | |_  \\___ \\| | | | 
   \\_/ /_/ \\_\\_  /|___| |___/ |_| |_|
`.trim();

const getPublicIP = async () => {
  if (cachedIP) {
    return cachedIP;
  }

  const ipServices = [
    "https://api.ipify.org?format=json",
    "https://ipv4.icanhazip.com",
    "https://ifconfig.me/ip",
  ];

  for (const url of ipServices) {
    try {
      const response = await axios.get(url);

      let ip;
      if (
        response.data &&
        typeof response.data === "object" &&
        response.data.ip
      ) {
        ip = response.data.ip;
      } else if (typeof response.data === "string") {
        ip = response.data.trim();
      }

      if (ip) {
        cachedIP = ip;
        return cachedIP;
      }
    } catch (error) {
      // Lanjut ke URL berikutnya jika gagal
      continue;
    }
  }

  throw new Error("Tidak dapat mengambil IP publik dari semua layanan");
};

const getServerSpecs = async () => ({
  hostname: os.hostname(),
  platform: os.platform(),
  arch: os.arch(),
  totalMemory: `${(os.totalmem() / 1024 ** 3).toFixed(2)} GB`,
  freeMemory: `${(os.freemem() / 1024 ** 3).toFixed(2)} GB`,
  uptime: `${(os.uptime() / 3600).toFixed(2)} hours`,
  publicIp: await getPublicIP(),
  mode: config.mode,
});

const getStatusApikey = async () => {
  try {
    const response = await axios.get(
      `https://api.autoresbot.com/check_apikey?apikey=${config.APIKEY}`
    );
    const { limit_apikey } = response.data || {};
    if (limit_apikey <= 0) return chalk.redBright("Limit Habis");
    return chalk.green(limit_apikey);
  } catch (error) {
    if (error.response) {
      const { status, data } = error.response;
      const errorCode = data?.error_code;
      const errorMessage = data?.message;

      if (status === 403) return status;
      if (status === 404)
        return chalk.redBright("Not Found: Invalid endpoint or resource");
      if (status === 401) return chalk.redBright("INVALID APIKEY");

      if (errorCode === "LIMIT_REACHED")
        return chalk.redBright(
          `APIKEY LIMIT (${errorMessage || "No message"})`
        );
      if (errorCode === "INVALID_API_KEY")
        return chalk.redBright("INVALID APIKEY");
      if (errorCode === "MISSING_API_KEY")
        return chalk.redBright("INVALID APIKEY");
    }
    return chalk.red("Error fetching API status");
  }
};

async function showServerInfo(e = {}) {
  // Menyesuaikan opsi default agar menyatu dengan tema baru
  const { title: t = "VARESA", borderChar: o = "━", color: i = "cyan" } = e;
  const n = {
    horizontalLayout: TERMINAL_WIDTH > 40 ? "default" : "fitted",
    width: Math.min(TERMINAL_WIDTH - 4, 40),
  };

  const specs = await getServerSpecs();
  const apiStatus = await getStatusApikey();

  if (apiStatus === 403) {
    console.log("━━━━━━━━━━━━━━━━━━━━");
    danger("Error ⚠️", "Forbidden: API key is not authorized");
    danger(
      "Error ⚠️",
      `Solusi: Tambahkan ip anda ${await getPublicIP()} ke dalam whitelist`
    );
    success("IP", await getPublicIP());
    success("Info", "Kunjungi linknya dan tambahkan ip kamu");
    console.log("https://autoresbot.com/services/rest-api");
    console.log("━━━━━━━━━━━━━━━━━━━━");
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await delay(30000);
    process.exit();
    return;
  }

  // Mengubah ikon peluru menjadi desain baru
  const labels = [
    "❖ Hostname",
    "❖ Platform",
    "❖ Architecture",
    "❖ Total Memory",
    "❖ Free Memory",
    "❖ Uptime",
    "❖ Public IP",
    "❖ Mode Aktif",
  ];

  const values = Object.values(specs);
  const maxLabelLength = Math.max(...labels.map((e) => e.length));

  // Mengubah pewarnaan teks spesifikasi
  const specText = labels
    .map(
      (label, idx) =>
        `   ${chalk.cyan(label.padEnd(maxLabelLength + ALIGNMENT_PADDING))} : ${chalk.whiteBright(
          values[idx]
        )}`
    )
    .join("\n");

  // Rombak total struktur output console.log
  console.log(
    `\n${chalk.magenta(horizontalLine(TERMINAL_WIDTH, o))}\n` +
      `${chalk.cyan.bold(VARESA_ASCII)}\n` +
      `${chalk.magenta(horizontalLine(TERMINAL_WIDTH, o))}\n\n` +
      `${chalk.blueBright.bold(" ✦ SYSTEM INFORMATION ✦ ")}\n` +
      `   ${chalk.cyan("Version Sc".padEnd(maxLabelLength + ALIGNMENT_PADDING))} : ${chalk.whiteBright("VARESA " + global.version)}\n` +
      `   ${chalk.cyan("API Status".padEnd(maxLabelLength + ALIGNMENT_PADDING))} : ${apiStatus}\n\n` +
      `${chalk.blueBright.bold(" ✦ SERVER SPECIFICATIONS ✦ ")}\n` +
      `${specText}\n\n` +
      `${chalk.magenta(horizontalLine(TERMINAL_WIDTH, o))}\n` +
      `${chalk.cyan.bold("       [ VARESA  -  MANAGED BY MANZZY ]       ")}\n` +
      `${chalk.magenta(horizontalLine(TERMINAL_WIDTH, o))}\n`
  );
}

// ── Pemulihan bot user setelah restart ───────────────────────────
// Setelah server restart, bot user yang tadinya tersambung dinyalakan lagi
// otomatis — tapi BERGILIR (satu per satu, berjeda RECONNECT_STAGGER_MS,
// bawaan 2,5 detik), bukan sekaligus. Membuka puluhan socket WhatsApp
// bersamaan membuat CPU/RAM melonjak tepat saat web baru menyala (502 dari
// Cloudflare) dan WhatsApp bisa menolak banyak login dari satu IP sekaligus.
//
// Yang dipulihkan hanya bot yang:
//  - statusnya di jadibot.json masih "active"/"connecting"/"baned" (bukan
//    "stop"/"logout" — itu dimatikan pemiliknya atau sistem), dan
//  - folder kredensialnya sudah tertaut (creds.json registered). Bot yang
//    belum selesai pairing TIDAK disambungkan, karena itu akan meminta kode
//    pairing baru tanpa ada yang menunggu.
// RESTORE_USER_BOTS=off mematikan pemulihan ini tanpa mengubah kode.
const STATUS_DIPULIHKAN = new Set(["active", "connecting", "baned"]);
const JEDA_PEMULIHAN_BAWAAN_MS = 2500;

function jedaPemulihan() {
  const n = Number(process.env.RECONNECT_STAGGER_MS);
  return Number.isFinite(n) && n >= 0 && String(process.env.RECONNECT_STAGGER_MS ?? "").trim() !== ""
    ? Math.min(Math.floor(n), 60000)
    : JEDA_PEMULIHAN_BAWAAN_MS;
}

function kredensialTertaut(folder) {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), folder, "creds.json"), "utf8");
    const creds = JSON.parse(raw);
    return !!(creds?.registered || creds?.me?.id);
  } catch {
    return false;
  }
}

/** Nomor bot user yang perlu disambungkan lagi (urutan jadibot.json). */
function daftarBotDipulihkan(jadibots, { credsReady = kredensialTertaut } = {}) {
  const out = [];
  if (!jadibots || typeof jadibots !== "object") return out;
  for (const number of Object.keys(jadibots)) {
    // Kunci jadibot.json selalu nomor; kunci lain tidak pernah dijadikan
    // nama folder (path traversal).
    if (!/^\d{8,15}$/.test(number)) continue;
    const status = String(jadibots[number]?.status || "");
    if (!STATUS_DIPULIHKAN.has(status)) continue;
    if (!credsReady(`session-${number}`)) continue;
    out.push(number);
  }
  return out;
}

const tidur = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Antrean pemulihan: SATU bot dalam satu waktu, jeda `stagger` ms di antara
 * dua penyambungan. Bot yang sudah dinyalakan lewat dashboard (socket hidup
 * atau sedang disiapkan) dilewati — penjaga sesi ganda di connection.js
 * akan menutup socket itu kalau disambung ulang. Berhenti kalau kapasitas
 * server habis (sama seperti tombol Start yang menolak saat server penuh).
 */
async function pulihkanBotUser({
  numbers = [],
  connect = connectToWhatsApp,
  isBusy = isSessionBusy,
  hasCapacity = () => getCapacity().remaining > 0,
  stagger = jedaPemulihan(),
  sleep = tidur,
  log = (pesan) => console.log(pesan),
  onStart = (number) =>
    eventBus.emit("bot_log", { number, message: "Server baru dinyalakan ulang — menyambungkan bot kembali..." }),
} = {}) {
  const hasil = { started: [], skipped: [], failed: [], notStarted: [] };
  for (let i = 0; i < numbers.length; i++) {
    const number = numbers[i];
    const folder = `session-${number}`;
    if (isBusy(folder)) {
      hasil.skipped.push(number);
      continue;
    }
    // Jeda SEBELUM penyambungan kedua dst. (bukan sesudah yang terakhir).
    if (hasil.started.length || hasil.failed.length) await sleep(stagger);
    // Bisa saja sudah dinyalakan dari dashboard selama menunggu jeda.
    if (isBusy(folder)) {
      hasil.skipped.push(number);
      continue;
    }
    let adaKapasitas = true;
    try {
      adaKapasitas = !!hasCapacity();
    } catch {
      adaKapasitas = true;
    }
    if (!adaKapasitas) {
      hasil.notStarted = numbers.slice(i);
      log(`[pemulihan] Kapasitas server penuh — ${hasil.notStarted.length} bot tidak disambungkan otomatis.`);
      break;
    }
    try {
      try { onStart(number); } catch { /* log dashboard tidak boleh menghentikan antrean */ }
      await connect(folder);
      hasil.started.push(number);
    } catch (err) {
      hasil.failed.push(number);
      log(`[pemulihan] ${folder} gagal disambungkan: ${err?.message || err}`);
    }
  }
  return hasil;
}

async function jalankanPemulihanBotUser() {
  if (String(process.env.RESTORE_USER_BOTS || "").toLowerCase() === "off") {
    console.log("ℹ️ Pemulihan bot user saat start dimatikan (RESTORE_USER_BOTS=off).");
    return null;
  }
  const numbers = daftarBotDipulihkan(await listJadibot());
  if (!numbers.length) return null;
  const stagger = jedaPemulihan();
  console.log(
    `[pemulihan] Menyambungkan ulang ${numbers.length} bot user, bergiliran tiap ${stagger} ms...`
  );
  const hasil = await pulihkanBotUser({ numbers, stagger });
  console.log(
    `[pemulihan] Selesai: ${hasil.started.length} disambungkan, ${hasil.skipped.length} sudah jalan, ` +
      `${hasil.failed.length} gagal, ${hasil.notStarted.length} tertunda (kapasitas).`
  );
  return hasil;
}

async function start_app() {
  await showServerInfo();

  connectToWhatsApp();

  // Bot user dipulihkan SETELAH bot utama mulai menyambung, diberi jeda
  // satu putaran supaya tidak berebut CPU dengan bot utama & web.
  setTimeout(() => {
    jalankanPemulihanBotUser().catch((err) =>
      console.error("⚠️ Pemulihan bot user gagal:", err?.message || err)
    );
  }, jedaPemulihan());
}

export {
  showServerInfo,
  start_app,
  getServerSpecs,
  daftarBotDipulihkan,
  pulihkanBotUser,
  jalankanPemulihanBotUser,
  jedaPemulihan,
};
