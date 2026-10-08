// List command tanpa registrasi
export const commandWithoutRegister = ["list", "owner", "menu", "claim"];

// Import ESM
import chokidar from "chokidar";
import config from "./config.js";
const mode = config.mode;

import { findGroup } from "./lib/group.js";
import chalk from "chalk";
import handler from "./lib/handler.js";
import mess from "./strings.js";
import { updateParticipant } from "./lib/cache.js";

import path from "path";
import { handleActiveFeatures } from "./lib/participant_update.js";

import {
  logWithTime,
  log,
  danger,
  findClosestCommand,
  logTracking,
  getnumberbot
} from "./lib/utils.js";

import {
  isOwner,
  isPremiumUser,
  updateUser,
  findUser,
  isUserRegistered,
} from "./lib/users.js";

import { reloadPlugins } from "./lib/plugins.js";
import { logCustom } from "./lib/logger.js"; 

import { cekJawabanAsahOtak } from "./lib/game_asahotak.js";
import { cekJawabanSiapakahAku } from "./lib/game_siapakahaku.js";

import {
  isUserPlaying,
  getGameSession,
  removeUser
} from "./database/temporary_db/game_session.js";

// Import sistem Multi-Tenant
import { getBotConfig } from "./lib/jadibot.js";
import { enforceForSession } from "./lib/tier-enforcer.js";
import { recordMessage } from "./lib/bot-stats.js";
import { hasActiveAddon } from "./lib/addons.js";

// Pembatas frekuensi pemeriksaan kuota grup (botNumber -> timestamp).
const lastQuotaCheck = new Map();
// ==========================================================

handler.initHandlers();

// Variabel global
const lastMessageTime = {};
const pluginsPath = path.join(process.cwd(), "plugins");
const lastSent_participantUpdate = {};
let plugins = [];

// Load plugin awal
reloadPlugins()
  .then((loadedPlugins) => {
    plugins = loadedPlugins;
    console.log(`[✔] Load All Plugins done...`);
  })
  .catch((error) => {
    console.error("❌ ERROR: Gagal memuat plugins:", error);
  });

// Hot reload hanya di development
if (mode === "development") {
  const watcher = chokidar.watch(pluginsPath, {
    persistent: true,
    ignoreInitial: true,
    ignored: /(^|[\/\\])\../, // Abaikan file tersembunyi
  });

  watcher.on("change", (filePath) => {
    if (filePath.endsWith(".js")) {
      logWithTime("System", `File changed: ${filePath}`);

      reloadPlugins()
        .then((loadedPlugins) => {
          plugins = loadedPlugins;
        })
        .catch((error) => {
          console.error("❌ ERROR: Gagal memuat plugins:", error);
        });
    }
  });

  logWithTime("System", "Hot reload active in development mode.");
} else {
  logWithTime("System", "Hot reload disabled in production mode.");
}

// Fungsi utama untuk memproses pesan
async function processMessage(sock, messageInfo) {
  const {
    remoteJid,
    isGroup,
    message,
    sender,
    pushName,
    fullText,
    prefix,
    command,
  } = messageInfo;

  // --- MULTI-TENANT CONFIGURATION ---
  const botNumber = getnumberbot(sock.user?.id || "");
  const sessionConfig = botNumber ? await getBotConfig(botNumber) : {};
  const isFreeTier = sessionConfig.tier === 'free' || !sessionConfig.tier;

  // Add-on unlimited dicek sekali per pesan (bukan per plugin) supaya
  // tidak memukul database berulang kali dalam satu pemrosesan.
  const hasUnlimitedAddon = botNumber
    ? await hasActiveAddon(botNumber, "mlbb_unlimited")
    : false;
  messageInfo.hasUnlimitedAddon = hasUnlimitedAddon;

  // Catat aktivitas untuk statistik & terminal langsung di dashboard.
  if (botNumber) {
    recordMessage(botNumber, { isGroup, command, pushName, text: fullText });
  }

  // Sisipkan sessionConfig ke messageInfo agar bisa diakses oleh semua plugin
  messageInfo.sessionConfig = sessionConfig;
  messageInfo.isFreeTier = isFreeTier;

  const isPremiumUsers = isPremiumUser(sender);
  let isOwnerUsers = isOwner(sender);

  // Override owner jika disetting di dashboard web (mendukung multi-nomor,
  // dipisah koma, sesuai limit tier: Basic 1, Plus 3, Booster 5).
  if (sessionConfig.ownerNumber) {
    const dashboardOwners = sessionConfig.ownerNumber.split(',').map(n => n.trim()).filter(Boolean);
    if (dashboardOwners.some(ownerNum => sender.includes(ownerNum))) {
      isOwnerUsers = true;
    }
  }

  // --- INJEKSI IKLAN OTOMATIS (KHUSUS FREE TIER) ---
  if (isFreeTier && !sock.sendMessageInjected) {
    const originalSendMessage = sock.sendMessage;
    sock.sendMessage = async (jid, content, options) => {
      // Cuma tambah iklan kalau pesannya berupa teks dan dikirim ke grup
      if (content && content.text && jid.endsWith("@g.us")) { 
        const adText = "\n\n---\n*🤖 Bot ini ditenagai oleh JadiVaresa. Gratis buat bot WhatsApp kamu sekarang di varesa.mom!*";
        if (!content.text.includes("JadiVaresa")) {
          content.text += adText;
        }
      }
      return originalSendMessage.call(sock, jid, content, options);
    };
    sock.sendMessageInjected = true;
  }

  try {
    const shouldContinue = await handler.preProcess(sock, messageInfo);
    if (!shouldContinue) return; 

    // ============================================================
    // 🧠 CEK JAWABAN GAMES 
    // ============================================================
    
    // 1. Asah Otak
    const isAsahOtakAnswer = await cekJawabanAsahOtak(sock, messageInfo);
    if (isAsahOtakAnswer) return; 

    // 2. Siapakah Aku 
    const isSiapakahAkuAnswer = await cekJawabanSiapakahAku(sock, messageInfo);
    if (isSiapakahAkuAnswer) return;

    // ============================================================

    // Pengecekan Game Session Bawaan 
    if (isUserPlaying(remoteJid)) {
      const session = getGameSession(remoteJid);

      // Cek apakah pesan user sama dengan kunci jawaban yang disimpan (case-insensitive)
      if (fullText && fullText.toLowerCase().trim() === session.answer.toLowerCase().trim()) {

        // --- JAWABAN BENAR DITEMUKAN ---
        clearTimeout(session.timer); 

        await sock.sendMessage(remoteJid, {
          text: `🎉 *SELAMAT! JAWABAN BENAR* 🎉\n\nJawaban: *${session.answer.toUpperCase()}*\nHadiah: Rp ${session.hadiah.toLocaleString('id-ID')}\n\nGame telah selesai.`
        }, { quoted: message });

        removeUser(remoteJid); 
        return; 
      }
    }

    // Rate limiter
    let truncatedContent =
      fullText.length > 20 ? fullText.slice(0, 20) + "..." : fullText;

    const currentTime = Date.now();
    if (
      lastMessageTime[remoteJid] &&
      currentTime - lastMessageTime[remoteJid] < config.rate_limit &&
      prefix &&
      !isOwnerUsers
    ) {
      danger(pushName, `Rate limit : ${truncatedContent}`);
      return;
    }
    if (prefix) {
      lastMessageTime[remoteJid] = currentTime;
    }

    if (truncatedContent.trim() && prefix) {
      const logMessage = async () => {
        // 1. Mode Production (Log Hemat)
        if (config.mode === "production") {
          log(pushName, truncatedContent);
          return;
        }

        // --- A. Persiapan Data (Async) ---
        let groupName = "Private Chat";
        if (isGroup) {
          try {
            const metadata = await sock.groupMetadata(remoteJid);
            groupName = metadata.subject || "Unknown";
          } catch {
            groupName = "Unknown Group";
          }
        }

        // --- B. Deteksi Negara ---
        const senderNum = sender.split("@")[0];
        let negara = "International 🌍";
        if (senderNum.startsWith("62")) negara = "Indonesia 🇮🇩";
        else if (senderNum.startsWith("60")) negara = "Malaysia 🇲🇾";
        else if (senderNum.startsWith("1")) negara = "USA/Canada 🇺🇸";
        else if (senderNum.startsWith("55")) negara = "Brazil 🇧🇷";
        else if (senderNum.startsWith("91")) negara = "India 🇮🇳";
        else if (senderNum.startsWith("44")) negara = "UK 🇬🇧";
        else if (senderNum.startsWith("966")) negara = "Arab Saudi 🇸🇦";
        else if (senderNum.startsWith("7")) negara = "Russia 🇷🇺";

        // --- C. Deteksi Device ---
        let deviceModel = "Desktop 🖥️";
        const msgId = message.key.id || "";
        if (msgId.startsWith("3A")) deviceModel = "iOS (iPhone) 🍎";
        else if (msgId.startsWith("3EB0") && msgId.length >= 22) deviceModel = "WhatsApp Web 💻";
        else if (msgId.startsWith("BAE5") || msgId.length > 21) deviceModel = "Android 🤖";

        // --- D. Waktu Saat Ini ---
        const now = new Date();
        const timeString = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

        // --- E. Design System 
        const border = chalk.cyan;      // Warna garis tepi
        const key = chalk.yellow.bold;  // Warna label 
        const val = chalk.white;        // Warna isi data
        const cmdColor = chalk.greenBright.bold; // Warna pesan/command

        // --- F. Cetak Dashboard ---
        console.log(border(`\n╭─── [ ${chalk.white.bold(timeString)} ] ──────────────────────────────`));
        console.log(border("│") + key(" 👤 User   : ") + val(`${pushName} `) + chalk.gray(`(${senderNum})`));
        console.log(border("│") + key(" 📍 Source : ") + val(isGroup ? groupName : "Private Chat"));
        console.log(border("│") + key(" 📱 Device : ") + val(deviceModel));
        console.log(border("│") + key(" 🏳️ From   : ") + val(negara));
        console.log(border("│") + chalk.gray("─────────────────────────────────────────────"));
        console.log(border("│") + key(" 💬 Cmd    : ") + cmdColor(truncatedContent));
        console.log(border(`╰─────────────────────────────────────────────\n`));
      };

      logMessage();
    }
    // ================================================================= 

    // Handle Destination
    const dest = sessionConfig.modePublik !== undefined ? (sessionConfig.modePublik ? "both" : "group") : config.bot_destination.toLowerCase();
    
    if ((dest === "private" && isGroup) || (dest === "group" && !isGroup)) {
      if (!isOwnerUsers) {
        logWithTime(
          "SYSTEM",
          `Destination handle only - ${dest} chat`
        );
        return;
      }
    }

    // ===== PESAN OTOMATIS (AUTO-REPLY) =====
    // Dicek sebelum plugin: balasan ini tidak butuh prefix titik.
    if (Array.isArray(sessionConfig.autoReply) && sessionConfig.autoReply.length) {
      const teks = (fullText || "").trim().toLowerCase();
      if (teks) {
        const hit = sessionConfig.autoReply.find((r) => {
          const k = (r.keyword || "").toLowerCase();
          if (!k) return false;
          if (r.match === "exact") return teks === k;
          if (r.match === "startsWith") return teks.startsWith(k);
          return teks.includes(k);
        });
        if (hit) {
          await sock.sendMessage(remoteJid, { text: hit.reply }, { quoted: message });
          return;
        }
      }
    }

    // ===== PERINTAH KUSTOM (Prime & Zenith) =====
    // Dibaca dari sessionConfig, yang berasal dari config NOMOR BOT INI.
    // Itu sebabnya perintah buatan satu user tidak pernah bisa muncul
    // di bot user lain — isolasinya otomatis, bukan aturan terpisah.
    // Dicek sebelum plugin bawaan, tapi TIDAK boleh menimpa perintah
    // inti (menu, jadibot, dll) supaya bot tidak bisa dirusak sendiri.
    const LINDUNGI = ['menu', 'jadibot', 'owner', 'ping', 'stop', 'start', 'delete'];
    if (command && Array.isArray(sessionConfig.customCommands) && sessionConfig.customCommands.length) {
      const cmdLower = String(command).toLowerCase();
      if (!LINDUNGI.includes(cmdLower)) {
        const custom = sessionConfig.customCommands.find(
          (c) => (c.cmd || '').toLowerCase() === cmdLower
        );
        if (custom) {
          const teksBalasan = custom.response
            .replace(/{pushname}/gi, pushName || 'Kak')
            .replace(/{prefix}/gi, prefix || '.');
          try {
            if (custom.image) {
              await sock.sendMessage(
                remoteJid,
                { image: { url: custom.image }, caption: teksBalasan },
                { quoted: message }
              );
            } else {
              await sock.sendMessage(remoteJid, { text: teksBalasan }, { quoted: message });
            }
          } catch (err) {
            // Gambar gagal dimuat: tetap kirim teksnya, jangan diam saja.
            console.error('[custom-cmd] gagal kirim:', err.message);
            await sock.sendMessage(remoteJid, { text: teksBalasan }, { quoted: message }).catch(() => {});
          }
          return;
        }
      }
    }

    let commandFound = false;

    // Iterasi melalui semua plugin untuk menemukan perintah yang sesuai
    for (const plugin of plugins) {
      if (plugin.Commands.includes(command)) {
        commandFound = true;

        // Cek apakah perintah ini hanya untuk pengguna premium
        if (plugin.OnlyPremium && !isPremiumUsers && !isOwnerUsers) {
          logTracking(`Handler - Bukan premium (${command})`);
          await sock.sendMessage(
            remoteJid,
            { text: mess.general.isPremium },
            { quoted: message }
          );
          return;
        }

        // Cek apakah perintah ini hanya untuk owner
        if (plugin.OnlyOwner && !isOwnerUsers) {
          logTracking(`Handler - Bukan Owner (${command})`);
          await sock.sendMessage(
            remoteJid,
            { text: mess.general.isOwner },
            { quoted: message }
          );
          return;
        }

        // Cek apakah perintah ini menggunakan limit.
        // Add-on "Unlimited" membebaskan bot ini dari pemotongan limit
        // untuk SEMUA perintah, bukan cuma MLBB — sama efeknya seperti
        // premium, tapi berlaku per-bot dan ada masa berlakunya.
        if (!isPremiumUsers && !isOwnerUsers && !hasUnlimitedAddon && plugin.limitDeduction) {
          try {
            const dataUsers = await findUser(sender);
            if (!dataUsers) return;

            const [docId, userData] = dataUsers;

            const isLimitExceeded =
              userData.limit < plugin.limitDeduction || userData.limit < 1;
            if (isLimitExceeded) {
              logTracking("Handler - Limit habis ");
              await sock.sendMessage(
                remoteJid,
                { text: mess.general.limit },
                { quoted: message }
              );
              return;
            }

            // Kurangi limit pengguna jika masih cukup
            await updateUser(sender, {
              limit: userData.limit - plugin.limitDeduction,
            });
          } catch (error) {
            console.error(
              `Terjadi kesalahan saat mengurangi limit pengguna: ${error.message}`
            );
          }
        }

        const pluginResult = await plugin.handle(sock, messageInfo);

        logTracking(`Plugins - ${command} dijalankan oleh ${sender}`);

        // Cek apakah plugin meminta untuk menghentikan eksekusi
        if (pluginResult === false) {
          return;
        }
      }
    }

    // sampai sini command tidak di temukan
    if (config.commandSimilarity && !commandFound) {
      const closestCommand = findClosestCommand(command, plugins);
      if (closestCommand && command != "" && fullText.length < 20 && prefix) {
        logTracking(`Handler - Command tidak ditemukan (${command})`);
        logCustom(
          "info",
          `_Command *${command}* tidak ditemukan_ \n\n_Apakah maksud Anda *.${closestCommand}*?_`,
          `ERROR-COMMAND-NOT-FOUND.txt`
        );
        return await sock.sendMessage(
          remoteJid,
          {
            text: `_Command *${command}* tidak ditemukan_ \n\n_Apakah maksud Anda *.${closestCommand}*?_`,
          },
          { quoted: message }
        );
      }
    }
  } catch (error) {
    logCustom("info", error, `ERROR-processMessage.txt`);
    danger(command, `Kesalahan di processMessage: ${error}`);
  }
}

async function participantUpdate(sock, messageInfo) {
  const { id, action, participants } = messageInfo;
  const now = Date.now();

  // Kuota grup paket Free diperiksa ulang saat ada member masuk/keluar,
  // tapi DIBATASI 1x per 2 menit per bot. Tanpa jeda ini, grup ramai
  // memicu pemeriksaan ratusan kali per menit dan membebani server.
  try {
    const botNum = getnumberbot(sock.user?.id || "");
    if (botNum) {
      const last = lastQuotaCheck.get(botNum) || 0;
      if (Date.now() - last > 120000) {
        lastQuotaCheck.set(botNum, Date.now());
        enforceForSession(botNum, sock);
      }
    }
  } catch (e) {
    console.error("Gagal cek kuota grup:", e.message);
  }

  try {
    const settingGroups = await findGroup(id);
    const validActions = ["promote", "demote", "add", "remove"];

    if (validActions.includes(action)) {
      try {
        updateParticipant(sock, id, participants, action);
      } catch (e) {
        console.log("error updateParticipant ", e);
      }
    } else {
      return console.log("action tidak valid :", action);
    }
    // Jika grup ditemukan
    if (settingGroups) {
      if (lastSent_participantUpdate[id]) {
        if (now - lastSent_participantUpdate[id] < config.rate_limit) {
          return console.log(chalk.redBright(`Rate limit : ${id}`));
        }
      }
      lastSent_participantUpdate[id] = now;

      await handleActiveFeatures(sock, messageInfo, settingGroups.fitur);
    }
  } catch (error) {
    logCustom("info", error, `ERROR-participantUpdate.txt`);
    console.error(chalk.redBright(`Error: ${error.message}`));
  }
}

export { processMessage, participantUpdate };