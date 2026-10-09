import config from "../config.js"; 
import fs from "fs";
import path from "path";
import chalk from "chalk";

import {
  makeWASocket,
  useMultiFileAuthState,
  getContentType,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "baileys";

import EventEmitter from "events";

export const eventBus = new EventEmitter();
const store = { contacts: {} };

global.statusConnected = global.statusConnected || {};

function setStatusConnected(id, status) {
  global.statusConnected = global.statusConnected || {};
  global.statusConnected[id] = !!status; 
}
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import pino from "pino";
const logger = pino({ level: "silent" });

import { updateSocket } from "./scheduled.js";
import { sessions } from "./cache.js";
import serializeMessage from "./serializeMessage.js";
import { updateJadibot, getJadibot } from "./jadibot.js"; 
import { enforceForSession } from "./tier-enforcer.js";

import { processMessage, participantUpdate } from "../autoresbot.js";

import {
  getnumberbot,
  logWithTime,
  setupSessionDirectory,
  isQuotedMessage,
  removeSpace,
  restaring,
  success,
  danger,
  sleep,
  sendMessageWithMentionNotQuoted,
  validations,
  extractNumbers,
  deleteFolderRecursive,
  getSenderType,
} from "./utils.js";


const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let qrCount = 0;
let error403Timestamps = [];

// ── Kendali reconnect per sesi ──────────────────────────────
// BUG SEBELUMNYA: connectToWhatsApp(folder) dipanggil ulang TANPA jeda
// dan TANPA batas. Sesi yang gagal permanen (nomor diblokir, kredensial
// rusak) masuk loop rapat: tiap putaran membuat socket Baileys baru,
// timer, dan listener baru. CPU/memori/koneksi keluar melonjak sampai
// server tidak sanggup melayani request lain -> Cloudflare 502.
const reconnectState = new Map(); // folder -> { attempts, timer }
const MAX_RECONNECT_ATTEMPTS = 6;   // bot utama milik operator
const MAX_JADIBOT_ATTEMPTS = 2;     // jadibot user: cepat menyerah, lalu dibersihkan

function resetReconnect(folder) {
  const st = reconnectState.get(folder);
  if (st?.timer) clearTimeout(st.timer);
  reconnectState.delete(folder);
}

// Reconnect dengan jeda bertambah (2s, 4s, 8s, ... maks 60s) dan batas
// percobaan. Dijadwalkan lewat setTimeout, BUKAN await rekursif, supaya
// tidak menumpuk stack pemanggilan.
function scheduleReconnect(folder, numbersString) {
  // Bot utama ("session") tetap disambung ulang otomatis — itu milik
  // operator, bukan user.
  const isMainBot = folder === "session";

  const st = reconnectState.get(folder) || { attempts: 0, timer: null };
  st.attempts++;

  // Jadibot milik user: batasnya sengaja kecil. Kalau nomornya memang
  // sudah mati, mencoba terus hanya membebani server tanpa hasil —
  // lebih baik sesinya dibersihkan dan user Start manual dari dashboard.
  const maxAttempts = isMainBot ? MAX_RECONNECT_ATTEMPTS : MAX_JADIBOT_ATTEMPTS;

  if (st.attempts > maxAttempts) {
    eventBus.emit("bot_log", {
      number: numbersString,
      message: `Gagal menyambung ${maxAttempts}x. Sesi dihentikan — silakan Start ulang dari dashboard.`,
    });
    resetReconnect(folder);
    if (!isMainBot) dropDeadSession(folder, numbersString);
    return;
  }

  const wait = Math.min(60000, 2000 * 2 ** (st.attempts - 1));
  eventBus.emit("bot_log", {
    number: numbersString,
    message: `Mencoba sambung ulang dalam ${Math.round(wait / 1000)}s (percobaan ${st.attempts}/${maxAttempts}).`,
  });

  if (st.timer) clearTimeout(st.timer);
  st.timer = setTimeout(() => {
    connectToWhatsApp(folder).catch((err) =>
      console.error(`[reconnect] ${folder} gagal:`, err?.message || err)
    );
  }, wait);
  reconnectState.set(folder, st);
}

// Bersihkan sesi jadibot yang sudah tidak bisa diselamatkan: tutup socket,
// hapus folder kredensial, dan tandai offline. Ini yang membuat server tidak
// lagi menyeret nomor-nomor mati.
function dropDeadSession(folder, numbersString) {
  try {
    const sock = sessions.get(folder);
    if (sock) { try { sock.ws?.close(); } catch {} }
    sessions.delete(folder);
  } catch {}

  try {
    const dir = path.join(process.cwd(), folder);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`[cleanup] gagal hapus folder ${folder}:`, err.message);
  }

  updateJadibot(numbersString, "stop").catch(() => {});
  console.log(`[cleanup] Sesi mati ${folder} dibersihkan. User harus Start manual.`);
}

async function getTimeStamp() {
  const now = new Date();
  const options = { timeZone: "Asia/Jakarta", hour12: false };
  const timeString = now.toLocaleTimeString("id-ID", options);
  return `[${timeString}]`;
}

// ----------------------------------------------------
// BATASAN GRUP PAKET FREE
// ----------------------------------------------------
// Dulu di sini ada aturan TERSENDIRI: begitu tersambung, bot Free yang
// ikut lebih dari 2 grup langsung di-logout & sesinya dihapus tanpa
// peringatan, dan pesannya masih menyebut paket lama "Nitro". Aturan itu
// bertentangan dengan lib/tier-enforcer.js (1 grup bebas / 2 grup < 15
// member, peringatan + tenggang 10 menit) yang dijelaskan di website.
// Sekarang satu sumber aturan saja: tier-enforcer.
async function enforceGroupLimit(sock, botNumber) {
  try {
    await enforceForSession(botNumber, sock);
  } catch (err) {
    console.error("Gagal mengecek limit grup:", err.message);
  }
  return true;
}
// ----------------------------------------------------

// Socket pengganti untuk penjadwalan saat sebuah sesi putus:
// bot utama kalau hidup, kalau tidak sesi lain mana pun yang masih hidup.
function pilihSocketJadwal(putus) {
  const utama = sessions.get("session");
  if (utama?.user && utama !== putus) return utama;
  for (const s of sessions.values()) {
    if (s?.user && s !== putus) return s;
  }
  return null;
}

async function connectToWhatsApp(folder = "session") {
  let phone_number_bot = "";
  const numbersString = extractNumbers(folder);

  const dataSession = await getJadibot(numbersString);
  if (dataSession) {
    phone_number_bot = numbersString;
    if (dataSession.status == "stop" || dataSession.status == "logout") {
      return;
    }
  }

  for (const { key, validValues, validate, errorMessage } of validations) {
    const value = config[key]?.toLowerCase();
    if (validValues && !validValues.includes(value)) {
      return danger("Error config.js", errorMessage);
    }
    if (validate && !validate(config[key])) {
      return danger("Error config.js", errorMessage);
    }
  }

  const sessionDir = path.join(process.cwd(), folder);

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: logger,
    printQRInTerminal: false,
    auth: state,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
  });
  
  sessions.set(folder, sock);

  if (
    !sock.authState.creds.registered &&
    config.type_connection.toLowerCase() == "pairing"
  ) {
    if (folder != "session" && !numbersString) {
      logWithTime("Jadibot", `Koneksi "${folder}" terputus`, "merah");
      return false;
    }
    const phoneNumber = folder === "session" ? config.phone_number_bot : numbersString;
    await delay(4000);
    
    try {
      const code = await sock.requestPairingCode(phoneNumber.trim());
      const formattedCode = code.slice(0, 4) + "-" + code.slice(4);

      console.log(chalk.blue("PHONE NUMBER: "), chalk.yellow(phoneNumber));
      console.log(chalk.blue("CODE PAIRING: "), chalk.yellow(formattedCode));
      
      eventBus.emit("pairing", {
        number: phoneNumber,
        code: formattedCode,
        folder
      });
      eventBus.emit("bot_log", { number: phoneNumber, message: `Pairing Code diterima: ${formattedCode}` });
    } catch (err) {
      console.error("Gagal meminta pairing code:", err);
      eventBus.emit("bot_log", { number: phoneNumber, message: `Gagal meminta pairing code: ${err.message}` });
    }
  }

  sock.ev.on("creds.update", saveCreds);

  try {
    setupSessionDirectory(sessionDir);
  } catch {}

  sock.ev.on("contacts.update", (contacts) => {
    contacts.forEach((contact) => {
      store.contacts[contact.id] = contact;
    });
  });

  sock.ev.on("messages.upsert", async (m) => {
    try {
      eventBus.emit("contactsUpdated", store.contacts);
      const result = serializeMessage(m, sock);
      if (!result) return;

      const { id, message, remoteJid, command } = result;
      const key = message.key;

      try {
        if (config.autoread) {
          await sock.readMessages([key]);
        }
        const validPresenceUpdates = [
          "unavailable",
          "available",
          "composing",
          "recording",
          "paused",
        ];
        if (validPresenceUpdates.includes(config?.PresenceUpdate)) {
          await sock.sendPresenceUpdate(config.PresenceUpdate, remoteJid);
        }
        await processMessage(sock, result);
      } catch (error) {
        console.log(`Terjadi kesalahan saat memproses pesan: ${error}`);
      }
    } catch (error) {
      console.log(chalk.redBright(`Error dalam message upsert: ${error.message}`));
    }
  });

  sock.ev.on("group-participants.update", async (m) => {
    if (!m || !m.id || !m.participants || !m.action) {
      logWithTime("System", `Participant tidak valid`);
      return;
    }
    const messageInfo = { id: m.id, participants: m.participants, action: m.action, store };
    try {
      await participantUpdate(sock, messageInfo);
    } catch (error) {
      console.log(chalk.redBright(`Terjadi kesalahan di participant Update: ${error}`));
    }
  });

  sock.ev.on("call", async (calls) => {
    if (!config.anticall) return; 
    for (let call of calls) {
      if (!call.isGroup && call.status === "offer") {
        const callType = call.isVideo ? "VIDEO" : "SUARA";
        const userTag = `@${call.from.split("@")[0]}`;
        const statusJid = getSenderType(call.from);
        const messageText = `⚠️ _BOT TIDAK DAPAT MENERIMA PANGGILAN ${callType}._\n\n_MAAF ${userTag}, KAMU AKAN DI *BLOCK*._\n_Website: ${config.web_url}_`;

        logWithTime("System", `Call from ${call.from}`);

        await sendMessageWithMentionNotQuoted(sock, call.from, messageText, statusJid);
        await sleep(2000);
        await sock.updateBlockStatus(call.from, "block");
      }
    }
  });

  sock.ev.on("connection.update", async (update) => {
    if (sock && sock.user && sock.user.id) {
      global.phone_number_bot = getnumberbot(sock.user.id);
    }

    const { connection, lastDisconnect, qr } = update;
    
    if (qr != null && config.type_connection.toLowerCase() == "qr") {
      if (folder != "session") {
        logWithTime("Jadibot", `Koneksi "${folder}" terputus`, "merah");
        return false;
      }
      qrCount++; 
      qrcode.generate(qr, { small: true }, (qrcodeStr) => console.log(qrcodeStr));
      success("QR", `Silakan scan melalui aplikasi whatsapp!. (Try ${qrCount}/5)`);

      if (qrCount >= 5) {
        // JANGAN process.exit(): ini mematikan SELURUH aplikasi termasuk
        // web server, padahal masalahnya hanya satu sesi yang gagal pairing.
        // Cukup tutup sesi ini dan biarkan proses utama tetap hidup.
        danger("Timeout", "Terlalu banyak menampilkan qr, sesi dihentikan.");
        qrCount = 0;
        try { sock.ws?.close(); } catch {}
        sessions.delete(folder);
        eventBus.emit("bot_log", { number: numbersString, message: "Gagal pairing 5x. Sesi dihentikan, silakan coba lagi." });
        return false;
      }
    }

    if (connection === "close") {
      setStatusConnected(numbersString || config.phone_number_bot, false);
      sessions.delete(folder);

      // Jadwal grup (buka/tutup, waktu sholat) dipindah ke sesi lain yang
      // MASIH HIDUP. Dulu dijadwalkan ulang memakai socket yang baru saja
      // putus, sehingga semua jadwal berhenti jalan.
      const pengganti = pilihSocketJadwal(sock);
      if (pengganti) {
        try { await updateSocket(pengganti); } catch {}
      }

      let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
      eventBus.emit("bot_log", { number: numbersString, message: `Connection Closed (Reason: ${reason}). Reconnecting...` });
      
      switch (reason) {
        case DisconnectReason.badSession:
        case DisconnectReason.connectionClosed:
        case DisconnectReason.connectionLost:
        case DisconnectReason.restartRequired:
        case DisconnectReason.timedOut:
          scheduleReconnect(folder, numbersString);
          return;
          
        case DisconnectReason.connectionReplaced:
          if (sock) { try { await sock.logout(); } catch {} }
          scheduleReconnect(folder, numbersString);
          return;

        case DisconnectReason.loggedOut:
          // Logout itu final: jangan coba sambung ulang lagi.
          resetReconnect(folder);
          if (folder != "session" && phone_number_bot) {
            await updateJadibot(phone_number_bot, "logout");
            if (folder != "session") deleteFolderRecursive(folder);
            
            const sockSesi = sessions.get(folder);
            if (sockSesi) await sockSesi.ws.close(); 
            return;
          }
          break;

        default:
          if (folder != "session" && phone_number_bot) {
            await updateJadibot(phone_number_bot, "baned");
          }
          const now = Date.now();

          if (reason === 403) {
            error403Timestamps.push(now);
            error403Timestamps = error403Timestamps.filter((ts) => now - ts < 60000);

            if (error403Timestamps.length > 3) {
              eventBus.emit("bot_log", { number: numbersString, message: `[BLOCKED] Terlalu banyak error 403. Stop otomatis.` });
              resetReconnect(folder);
              return; 
            }
            scheduleReconnect(folder, numbersString);
            return;
          }
          scheduleReconnect(folder, numbersString);
          return;
      }
    } else if (connection === "open") {
      // Sambungan berhasil: nolkan hitungan percobaan supaya jeda
      // backoff tidak terus bertambah di gangguan berikutnya.
      resetReconnect(folder);
      setStatusConnected(numbersString || config.phone_number_bot, true);
      const isSession = folder === "session";
      success(isSession ? "System" : "Jadibot", "Koneksi Terhubung");
      
      eventBus.emit("bot_log", { number: numbersString, message: `WhatsApp Connected Successfully!` });

      if (!isSession && phone_number_bot) {
        await updateJadibot(phone_number_bot, "active");
        
        // Pemeriksaan kuota grup paket Free (peringatan dulu, bukan
        // langsung hapus). Tidak di-await supaya sambungan tidak tertahan.
        enforceGroupLimit(sock, phone_number_bot);
      }

      // Notifikasi ke nomor bot utama sendiri. Nomornya diambil dari sesi
      // yang tersambung (BOT_NUMBER di .env boleh kosong). Dulu kalau
      // BOT_NUMBER kosong, pesan dikirim ke "@s.whatsapp.net", melempar
      // error, dan langkah penjadwalan di bawahnya tidak pernah jalan.
      try {
        const isRestart = await restaring();
        const nomorSendiri = getnumberbot(sock.user?.id || "") || config.phone_number_bot;
        if (isRestart && isSession) {
          await sock.sendMessage(isRestart, { text: "_Bot Berhasil di restart_" });
        } else if (isSession && nomorSendiri) {
          await sock.sendMessage(`${nomorSendiri}@s.whatsapp.net`, { text: "_Bot Connected_" });
        }
      } catch (err) {
        console.error("Gagal kirim notifikasi tersambung:", err.message);
      }

      // Penjadwalan memakai SATU socket. Utamakan bot utama; sesi jadibot
      // hanya mengambil alih kalau bot utama tidak aktif. Dulu setiap
      // jadibot yang tersambung merebut semua jadwal grup, padahal bot user
      // belum tentu ada (atau jadi admin) di grup-grup tersebut.
      const utama = sessions.get("session");
      if (isSession || !utama?.user) {
        try { await updateSocket(sock); } catch (error) {}
      }
    }
  });

  return sock;
}

export { connectToWhatsApp };