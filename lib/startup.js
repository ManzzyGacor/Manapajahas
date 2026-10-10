import os from "os";
import chalk from "chalk";
import figlet from "figlet";
import axios from "axios";
import config from "../config.js";
import { success, danger } from "../lib/utils.js";
import { connectToWhatsApp } from "../lib/connection.js";


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

async function start_app() {
  await showServerInfo();

  connectToWhatsApp();
}

export { showServerInfo, start_app, getServerSpecs };
