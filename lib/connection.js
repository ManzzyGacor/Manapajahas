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
import { updateJadibot, getJadibot, getBotConfig } from "./jadibot.js"; 
import { enforceForSession } from "./tier-enforcer.js";
import { notifyBotOwner, flushNotifierQueue, resetNotifyDedupe } from "./notifier.js";
import mongoose from "mongoose";

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
// Hitungan error 403 PER SESI (folder -> [timestamp]). Dulu satu daftar
// untuk semua bot: 403 dari beberapa bot berbeda saling menjumlah, sehingga
// bot lain yang sehat ikut "Stop otomatis".
const error403Timestamps = new Map();

// ── Pemberitahuan "bot terputus" ke pemilik bot user ─────────────
// Hanya untuk akhir sesi yang memang butuh tindakan pemilik (logout dari HP,
// sesi rusak, gagal menyambung berkali-kali, dihentikan sistem) — BUKAN
// untuk putus-sambung biasa (428, 515, 408) yang pulih sendiri. Dikirim
// lewat bot utama (lib/notifier.js) ke nomor bot itu sendiri = HP pemilik.
const KUNCI_PUTUS = "bot-terputus";

// Folder sesi yang SUDAH tertaut ke WhatsApp (kredensial terdaftar, atau
// pernah tersambung). Pemberitahuan "terputus" hanya untuk sesi ini: nomor
// yang pairing-nya tidak pernah selesai (salah ketik nomor, kode tidak
// dimasukkan) tidak boleh dikirimi pesan — bisa jadi itu nomor orang lain.
const sesiTertaut = new Set();

async function labelBot(number) {
  // Label dari dashboard (dokumen Bot di MongoDB). Modelnya didaftarkan
  // webserver.js; dibaca lewat mongoose.models supaya tidak mengimpor
  // webserver (impor sirkular). DB putus = langsung pakai cadangan, jangan
  // menunggu buffer Mongoose ~10 detik.
  try {
    const Bot = mongoose.models?.Bot;
    if (Bot && mongoose.connection?.readyState === 1) {
      const doc = await Bot.findOne({ number: String(number) }).select("label").maxTimeMS(3000).lean();
      const label = String(doc?.label || "").trim();
      if (label) return label;
    }
  } catch {
    /* pakai cadangan */
  }
  try {
    const cfg = await getBotConfig(number);
    const nama = String(cfg?.botName || "").trim();
    if (nama) return nama;
  } catch {
    /* pakai nomor */
  }
  return "";
}

/**
 * Kabari pemilik bot user bahwa bot-nya terputus dan perlu disambungkan
 * lagi dari dashboard. Sekali per kejadian (dedupe di notifier; kuncinya
 * dilepas lagi saat bot tersambung). Tidak pernah melempar error.
 */
async function kabariBotTerputus(number, sebab, folder = `session-${number}`) {
  try {
    if (!/^\d{8,15}$/.test(String(number || ""))) return;
    const tertaut = sesiTertaut.has(folder);
    sesiTertaut.delete(folder);
    if (!tertaut) return;
    const label = await labelBot(number);
    const nama = label ? `"${label}" (${number})` : number;
    const teks =
      `⚠️ Bot ${nama} terputus dari WhatsApp.\n\n` +
      `Masuk ke ${config.web_url}/dashboard untuk menyambungkan lagi.`;
    const ok = await notifyBotOwner(number, teks, { dedupeKey: KUNCI_PUTUS });
    eventBus.emit("bot_log", {
      number,
      message: ok
        ? `Sesi berakhir (${sebab}). Pemberitahuan dikirim ke WhatsApp pemilik bot.`
        : `Sesi berakhir (${sebab}). Silakan sambungkan lagi dari dashboard.`,
    });
  } catch (err) {
    console.error("[notifier] gagal mengabari pemilik bot:", err?.message || err);
  }
}

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
// `fatal` = sesi memang sudah tidak bisa dipakai (kredensial rusak), jadi
// folder kredensialnya boleh dihapus saat percobaan habis. Untuk gangguan
// biasa (jaringan, 440, server WhatsApp) kredensial DIPERTAHANKAN supaya
// user bisa Start ulang tanpa pairing lagi.
function scheduleReconnect(folder, numbersString, fatal = false) {
  // Bot utama ("session") tetap disambung ulang otomatis — itu milik
  // operator, bukan user.
  const isMainBot = folder === "session";

  const st = reconnectState.get(folder) || { attempts: 0, timer: null, fatal: false };
  st.fatal = st.fatal || fatal;
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
    if (!isMainBot) dropDeadSession(folder, numbersString, st.fatal);
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
// `hapusKredensial` = true hanya kalau sesinya memang sudah tidak bisa
// dipakai (badSession). Untuk 440 / gangguan jaringan, folder kredensial
// DIPERTAHANKAN: menghapusnya memaksa user pairing ulang padahal
// kredensialnya masih sah — itu yang dulu membuat bot "hilang" dari website.
function dropDeadSession(folder, numbersString, hapusKredensial = false) {
  try {
    const sock = sessions.get(folder);
    if (sock) { try { sock.ws?.close(); } catch {} }
    sessions.delete(folder);
  } catch {}

  try {
    const dir = path.join(process.cwd(), folder);
    if (hapusKredensial && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`[cleanup] gagal hapus folder ${folder}:`, err.message);
  }

  updateJadibot(numbersString, "stop").catch(() => {});
  console.log(`[cleanup] Sesi mati ${folder} dibersihkan. User harus Start manual.`);
  // Bot berhenti untuk seterusnya sampai pemiliknya Start lagi: kabari.
  kabariBotTerputus(numbersString, hapusKredensial ? "sesi rusak" : "gagal menyambung ulang", folder);
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

// ── Penjaga persiapan ganda ─────────────────────────────────────
// Penjaga sesi ganda di bawah hanya melihat socket yang SUDAH terdaftar di
// `sessions`. Antara awal connectToWhatsApp dan sessions.set() ada beberapa
// await (baca kredensial, cek versi WhatsApp Web) — kalau di jeda itu ada
// panggilan kedua untuk folder yang sama (Start di dashboard bersamaan
// dengan pemulihan otomatis saat boot, atau klik Start dua kali), dua
// socket dengan kredensial sama lahir dan saling menendang (440).
const sedangDisiapkan = new Set();

/**
 * Apakah folder sesi ini sedang dipakai (socket hidup/menyambung, atau
 * sedang disiapkan)? Dipakai pemulihan sesi saat boot supaya tidak
 * menyambung ulang bot yang sudah dinyalakan dari dashboard.
 */
function isSessionBusy(folder) {
  if (sedangDisiapkan.has(folder)) return true;
  const s = sessions.get(folder);
  if (!s) return false;
  if (s.user) return true;
  const rs = s.ws?.readyState;
  return rs === 0 || rs === 1 || rs === undefined;
}

// Versi WhatsApp Web di-cache: fetchLatestBaileysVersion() mengambil berkas
// dari GitHub. Tanpa cache, memulihkan puluhan bot saat boot berarti
// puluhan request yang sama. Hanya hasil sukses yang di-cache.
let versiCache = null; // { version, at }
const VERSI_TTL_MS = 6 * 60 * 60 * 1000;
async function versiBaileys() {
  if (versiCache && Date.now() - versiCache.at < VERSI_TTL_MS) return versiCache.version;
  const { version, error } = await fetchLatestBaileysVersion();
  if (!error && Array.isArray(version)) versiCache = { version, at: Date.now() };
  return version;
}

async function connectToWhatsApp(folder = "session") {
  if (sedangDisiapkan.has(folder)) {
    console.log(chalk.yellow(`[sesi] ${folder} sedang disiapkan — panggilan ganda diabaikan.`));
    return null;
  }
  sedangDisiapkan.add(folder);
  try {
    return await siapkanKoneksi(folder);
  } finally {
    sedangDisiapkan.delete(folder);
  }
}

async function siapkanKoneksi(folder) {
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

  // ── Penjaga SESI GANDA ───────────────────────────────────────────────
  // Satu folder kredensial hanya boleh punya SATU socket hidup. Kalau ada
  // socket lama yang masih terbuka (mis. tombol Start ditekan padahal bot
  // sudah jalan, atau ada proses kedua), dua socket dengan kredensial yang
  // sama akan saling mengambil alih sesi: WhatsApp mengirim 440
  // (connectionReplaced) dan sambungan jadi tidak stabil. Socket lama
  // ditutup di sini TANPA logout() supaya perangkat tidak ter-unlink.
  const sockLama = sessions.get(folder);
  if (sockLama && sockLama.ws && (sockLama.ws.readyState === 0 || sockLama.ws.readyState === 1)) {
    console.log(chalk.yellow(`[sesi] ${folder} masih tersambung — socket lama ditutup, lalu disambung ulang.`));
    sockLama.__digantikan = true;
    try { sockLama.ws.close(); } catch {}
    sessions.delete(folder);
    // Beri waktu WhatsApp menutup sambungan lama supaya socket baru tidak
    // langsung menerima 440.
    await delay(1500);
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  if (folder !== "session" && (state?.creds?.registered || state?.creds?.me?.id)) sesiTertaut.add(folder);
  const version = await versiBaileys();

  const sock = makeWASocket({
    version,
    logger: logger,
    printQRInTerminal: false,
    auth: state,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
  });
  
  // Penanda bot utama milik operator (dipakai autoresbot.js untuk
  // membedakan bot utama dari bot user tanpa bergantung pada jadibot.json).
  sock.isMainBot = folder === "session";
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
      // Socket yang sudah DIGANTIKAN socket baru (lihat penjaga sesi ganda
      // di connectToWhatsApp) tidak boleh mengurus apa pun. Kalau dia ikut
      // jalan, dia menghapus socket baru dari daftar sesi dan menjadwalkan
      // reconnect/logout — persis yang membuat bot mati setelah connect.
      const sockAktif = sessions.get(folder);
      if (sock.__digantikan || (sockAktif && sockAktif !== sock)) return;

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
          // Sesi benar-benar rusak: kredensial memang harus dibuang.
          scheduleReconnect(folder, numbersString, true);
          return;

        case DisconnectReason.connectionClosed:
        case DisconnectReason.connectionLost:
        case DisconnectReason.restartRequired:
        case DisconnectReason.timedOut:
          scheduleReconnect(folder, numbersString);
          return;
          
        case DisconnectReason.connectionReplaced:
          // 440 = ada socket LAIN yang memakai kredensial yang sama.
          // Dulu di sini dipanggil sock.logout(), dan itu MENCABUT tautan
          // perangkat di WhatsApp (unlink) sehingga sesi mati permanen:
          // reconnect berikutnya gagal, sesi dianggap mati, dan user harus
          // pairing ulang. Jangan logout di sini — cukup tutup socket ini
          // tanpa menyentuh kredensial, lalu sambung ulang. Penjaga sesi
          // ganda di connectToWhatsApp yang menutup socket lama lebih dulu.
          try { sock.ws?.close(); } catch {}
          scheduleReconnect(folder, numbersString);
          return;

        case DisconnectReason.loggedOut: {
          // Logout itu final: jangan coba sambung ulang lagi.
          resetReconnect(folder);
          if (folder != "session" && phone_number_bot) {
            await updateJadibot(phone_number_bot, "logout");
            if (folder != "session") deleteFolderRecursive(folder);
            
            const sockSesi = sessions.get(folder);
            if (sockSesi) await sockSesi.ws.close(); 

            // sock.logout() dari server sendiri (hapus bot di dashboard,
            // pelanggaran kuota Free) menghasilkan "Intentional Logout":
            // itu disengaja, bukan "terputus". Yang dikabari hanya logout
            // dari sisi WhatsApp (perangkat dicabut dari HP pemilik, dll).
            const pesanPutus = String(lastDisconnect?.error?.message || "");
            if (!/intentional logout/i.test(pesanPutus)) {
              kabariBotTerputus(phone_number_bot, "logout dari WhatsApp", folder);
            }
            return;
          }
          break;
        }

        default:
          if (folder != "session" && phone_number_bot) {
            await updateJadibot(phone_number_bot, "baned");
          }
          const now = Date.now();

          if (reason === 403) {
            const daftar403 = (error403Timestamps.get(folder) || []).filter((ts) => now - ts < 60000);
            daftar403.push(now);
            error403Timestamps.set(folder, daftar403);

            if (daftar403.length > 3) {
              eventBus.emit("bot_log", { number: numbersString, message: `[BLOCKED] Terlalu banyak error 403. Stop otomatis.` });
              resetReconnect(folder);
              error403Timestamps.delete(folder);
              // Bot user dihentikan sistem: tandai stop (supaya tidak
              // dipulihkan otomatis saat restart) dan kabari pemiliknya.
              if (folder != "session" && phone_number_bot) {
                dropDeadSession(folder, phone_number_bot, false);
              }
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
      if (folder !== "session") sesiTertaut.add(folder);
      setStatusConnected(numbersString || config.phone_number_bot, true);
      const isSession = folder === "session";

      if (isSession) {
        // Pemberitahuan yang tertahan selama bot utama offline dikirim
        // sekarang (berjeda, lihat lib/notifier.js).
        flushNotifierQueue().catch(() => {});
      } else if (phone_number_bot) {
        // Bot tersambung lagi: kejadian "terputus" berikutnya boleh
        // dikabarkan lagi.
        resetNotifyDedupe(phone_number_bot, KUNCI_PUTUS);
      }
      success(isSession ? "System" : "Jadibot", "Koneksi Terhubung");
      
      eventBus.emit("bot_log", { number: numbersString, message: `WhatsApp Connected Successfully!` });

      if (!isSession && phone_number_bot) {
        // Penulisan status ke dashboard tidak boleh menjatuhkan sesi yang
        // baru tersambung.
        try { await updateJadibot(phone_number_bot, "active"); } catch (err) {
          console.error("Gagal menandai bot aktif:", err?.message || err);
        }

        // Pemeriksaan kuota grup paket Free (peringatan dulu, bukan
        // langsung hapus). Tidak di-await supaya sambungan tidak tertahan,
        // tapi errornya tetap ditangkap.
        Promise.resolve(enforceGroupLimit(sock, phone_number_bot)).catch((err) =>
          console.error("Gagal mengecek limit grup:", err?.message || err)
        );
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

export { connectToWhatsApp, isSessionBusy };