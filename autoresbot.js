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
import { getGroupMetadata } from "./lib/cache.js";

import { cekJawabanAsahOtak } from "./lib/game_asahotak.js";
import { cekJawabanSiapakahAku } from "./lib/game_siapakahaku.js";

import {
  isUserPlaying,
  getGameSession,
  removeUser
} from "./database/temporary_db/game_session.js";

// Import sistem Multi-Tenant
import { getBotConfig, isJadibot } from "./lib/jadibot.js";
import { enforceForSession } from "./lib/tier-enforcer.js";
import { recordMessage } from "./lib/bot-stats.js";
import { hasActiveAddon } from "./lib/addons.js";
import { applyTierCaps } from "./lib/tier-guard.js";
import { logCommand } from "./lib/monitor.js";

// Pembatas frekuensi pemeriksaan kuota grup (botNumber -> timestamp).
const lastQuotaCheck = new Map();

// ── Owner utama vs owner bot ───────────────────────────────────
// Owner UTAMA = operator Varesa (OWNER_NUMBERS di .env + database/owner.json).
// Owner BOT   = nomor owner yang diisi pelanggan di dashboard untuk bot
//               miliknya sendiri, plus nomor bot itu sendiri.
//
// BUG KEAMANAN SEBELUMNYA: owner bot diperlakukan sama persis dengan owner
// utama. Pelanggan paket Core cukup mengisi nomornya di dashboard, lalu
// bisa menjalankan .addplugin (menulis file .js ke server), .resetmoney
// (mereset saldo SEMUA user), .addprem, .blacklist, .self (mematikan
// SEMUA bot), dan perintah sewa — semuanya mengubah data bersama seluruh
// server, bukan cuma bot miliknya.
//
// Perintah di bawah ini mengubah data global, jadi khusus owner utama.
// Perintah owner lain (setname, setppbot, join, outgrup, jpm, dll) bekerja
// pada socket bot itu sendiri, jadi tetap boleh dipakai owner bot.
const PERINTAH_OWNER_UTAMA = new Set([
  // file plugin di server
  "addplugin", "addplugins", "delplugin", "delplugins",
  // database user bersama (limit/money/level/premium/status)
  "addlimit", "addmoney", "addlevel",
  "addprem", "addpremium", "delprem", "delpremium", "listprem",
  "addpremgrub", "addpremiumgrub", "delpremgrub", "delpremiumgrub",
  "block", "unblock", "listblock",
  "blacklist", "unblacklist", "listblacklist",
  "reset", "resetlimit", "resetmoney", "resetlevel",
  // kata kasar & respon global
  "addglobalbadword", "delglobalbadword",
  "addrespon", "delrespon", "deleterespon", "listrespon",
  // sistem sewa bot utama
  "sewabot", "sewabotid", "tambahsewa", "delsewa", "kompensasi",
  "listsewa", "listsewa2", "listnosewa", "outnosewa", "totalsewa",
  "excelsewa", "listsewaexcel",
  // status apikey autoresbot milik operator
  "apikey",
]);

// Iklan paket Free. Penanda dipakai supaya pesan yang sudah memuat alamat
// web (mis. ajakan upgrade) tidak ditempeli iklan dua kali.
const WEB_HOST = config.web_url.replace(/^https?:\/\//, "");
const IKLAN_FREE =
  `\n\n---\n*🤖 Bot ini ditenagai oleh Varesa. Bikin bot WhatsApp kamu sendiri gratis di ${WEB_HOST}*`;

// Bungkus sock.sendMessage SEKALI per socket. Keputusan menempel iklan
// dibaca dari sock.__varesaAds yang diperbarui setiap pesan masuk.
// BUG SEBELUMNYA: pembungkus dipasang permanen saat bot masih Free dan
// tidak pernah dilepas — bot yang sudah upgrade tetap menempelkan iklan
// sampai sesinya di-restart. Objek pesan pemanggil juga ikut diubah.
function pasangIklanFree(sock) {
  if (sock.__varesaAdsWrapped) return;
  const kirimAsli = sock.sendMessage;
  sock.sendMessage = async (jid, content, options) => {
    if (
      sock.__varesaAds &&
      typeof jid === "string" &&
      jid.endsWith("@g.us") &&
      content &&
      typeof content.text === "string" &&
      !content.edit &&
      !content.text.includes(WEB_HOST)
    ) {
      content = { ...content, text: content.text + IKLAN_FREE };
    }
    return kirimAsli.call(sock, jid, content, options);
  };
  sock.__varesaAdsWrapped = true;
}

// Catat command ke monitor (log aktivitas & top command di website).
// Tidak boleh melempar error atau memperlambat jalur pesan.
function catatCommand(data) {
  try {
    logCommand(data);
  } catch {
    /* statistik tidak boleh mengganggu bot */
  }
}

// Nama plugin untuk log monitor: "DOWNLOAD/tiktok.js".
function namaPlugin(plugin, command) {
  if (plugin?.Name) return String(plugin.Name);
  if (plugin?.__file) return plugin.__file.replace(/^plugins[\\/]/, "");
  return command || "";
}
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
    fromMe,
  } = messageInfo;

  // --- MULTI-TENANT CONFIGURATION ---
  // Nomor bot diambil dari socket sesi ini ("628xx:12@s.whatsapp.net" ->
  // "628xx"), sama persis dengan kunci di database/jadibot.json yang
  // ditulis dashboard. Semua setelan per-bot dibaca lewat kunci ini.
  const botNumber = getnumberbot(sock.user?.id || "");
  const isJadibotSession = botNumber ? await isJadibot(botNumber) : false;

  // getBotConfig sudah di-cache (file & tier). applyTierCaps memastikan
  // fitur berbayar yang tersimpan tidak jalan lagi kalau paketnya turun.
  const sessionConfig = applyTierCaps(botNumber ? await getBotConfig(botNumber) : {});
  const isFreeTier = sessionConfig.tier === "free";

  // Add-on unlimited dicek sekali per pesan (bukan per plugin) supaya
  // tidak memukul database berulang kali dalam satu pemrosesan.
  // Add-on bisa tercatat ke nomor bot ATAU ke akun pemiliknya (kalau
  // dibeli tanpa memilih nomor), jadi keduanya diperiksa.
  let hasUnlimitedAddon = false;
  if (botNumber) {
    hasUnlimitedAddon =
      (await hasActiveAddon(botNumber, "mlbb_unlimited")) ||
      (sessionConfig.ownerId
        ? await hasActiveAddon(sessionConfig.ownerId, "mlbb_unlimited")
        : false);
  }
  messageInfo.hasUnlimitedAddon = hasUnlimitedAddon;

  // Catat aktivitas untuk statistik & terminal langsung di dashboard.
  if (botNumber) {
    recordMessage(botNumber, { isGroup, command, pushName, text: fullText });
  }

  // Sisipkan sessionConfig ke messageInfo agar bisa diakses oleh semua plugin
  messageInfo.sessionConfig = sessionConfig;
  messageInfo.isFreeTier = isFreeTier;
  messageInfo.botNumber = botNumber;
  messageInfo.isJadibot = isJadibotSession;

  const isPremiumUsers = isPremiumUser(sender);

  // Owner utama (operator) — berlaku di semua bot.
  // Pesan yang diketik dari HP/perangkat bot utama sendiri juga owner utama.
  const isMainOwner = isOwner(sender) || (!!fromMe && !isJadibotSession);

  // Owner bot ini: nomor dari dashboard (sudah dibatasi sesuai paket oleh
  // applyTierCaps) + pemilik nomor bot itu sendiri (pesan fromMe = diketik
  // pemilik akun WhatsApp bot dari HP-nya). Dicocokkan persis per nomor;
  // dulu memakai sender.includes() yang bisa salah cocok dengan nomor lain.
  const senderNumber = String(sender || "").split("@")[0].split(":")[0];
  const isBotOwner =
    !!fromMe || (senderNumber && sessionConfig.owners.includes(senderNumber));

  const isOwnerUsers = isMainOwner || isBotOwner;
  messageInfo.isOwner = isOwnerUsers;
  messageInfo.isMainOwner = isMainOwner;
  messageInfo.isBotOwner = isBotOwner;
  messageInfo.isPremium = isPremiumUsers;

  // --- IKLAN OTOMATIS (KHUSUS BOT USER PAKET FREE) ---
  // Bot utama milik operator tidak pernah ditempeli iklan.
  if (isJadibotSession) {
    pasangIklanFree(sock);
  }
  sock.__varesaAds = isJadibotSession && isFreeTier;

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

    // Kunci per bot + per chat. Dulu hanya per chat: kalau dua bot Varesa
    // ada di grup yang sama, bot kedua selalu menganggap pesan yang sama
    // sebagai "spam" (karena bot pertama baru saja mencatatnya) lalu diam.
    const rateKey = `${botNumber}|${remoteJid}`;
    const currentTime = Date.now();
    if (
      lastMessageTime[rateKey] &&
      currentTime - lastMessageTime[rateKey] < config.rate_limit &&
      prefix &&
      !isOwnerUsers
    ) {
      danger(pushName, `Rate limit : ${truncatedContent}`);
      return;
    }
    if (prefix) {
      lastMessageTime[rateKey] = currentTime;
    }

    if (truncatedContent.trim() && prefix) {
      const logMessage = async () => {
        // 1. Mode Production (Log Hemat)
        if (config.mode === "production") {
          log(pushName, truncatedContent);
          return;
        }

        // --- A. Persiapan Data (Async) ---
        // Lewat cache metadata (lib/cache.js). Dulu memanggil
        // sock.groupMetadata() langsung = satu request ke WhatsApp untuk
        // SETIAP command di grup, hanya demi menulis log terminal.
        let groupName = "Private Chat";
        if (isGroup) {
          try {
            const metadata = await getGroupMetadata(sock, remoteJid);
            groupName = metadata?.subject || "Unknown";
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

      logMessage().catch(() => {});
    }
    // ================================================================= 

    // Handle Destination
    // Mode Publik dari dashboard: aktif = grup & chat pribadi, mati = grup
    // saja. Dashboard menampilkan Mode Publik AKTIF untuk bot yang belum
    // pernah menyimpan setelan (cfg.modePublik ?? true), jadi bot user
    // juga harus menganggapnya aktif. Dulu bot jatuh ke config.bot_destination
    // ("group") sehingga bot baru diam di chat pribadi padahal dashboard
    // bilang publik. Bot utama tetap mengikuti config.js.
    let dest;
    if (typeof sessionConfig.modePublik === "boolean") {
      dest = sessionConfig.modePublik ? "both" : "group";
    } else if (isJadibotSession) {
      dest = "both";
    } else {
      dest = String(config.bot_destination || "both").toLowerCase();
    }
    
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
    // Pesan yang diketik pemilik bot sendiri (fromMe) tidak dibalas —
    // bot tidak perlu menjawab pemiliknya, dan ini mencegah balasan
    // berantai kalau teks balasan memuat kata kunci yang sama.
    if (!fromMe && sessionConfig.autoReply.length) {
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
    const LINDUNGI = ['menu', 'allmenu', 'help', 'jadibot', 'owner', 'ping', 'stop', 'start', 'delete'];
    if (command && sessionConfig.customCommands.length) {
      const cmdLower = String(command).toLowerCase();
      if (!LINDUNGI.includes(cmdLower)) {
        const custom = sessionConfig.customCommands.find(
          (c) => (c.cmd || '').toLowerCase() === cmdLower
        );
        if (custom) {
          const mulai = Date.now();
          let terkirim = true;
          const teksBalasan = String(custom.response || "")
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
            terkirim = await sock
              .sendMessage(remoteJid, { text: teksBalasan }, { quoted: message })
              .then(() => true)
              .catch(() => false);
          }
          catatCommand({
            bot: botNumber,
            command: cmdLower,
            isGroup,
            ok: terkirim,
            ms: Date.now() - mulai,
            plugin: "custom",
          });
          return;
        }
      }
    }

    let commandFound = false;
    // Data untuk log monitor: diisi saat handle() plugin pertama kali
    // dipanggil, lalu dicatat SEKALI di blok finally (sukses maupun error).
    let eksekusi = null;

    try {
      // Iterasi melalui semua plugin untuk menemukan perintah yang sesuai
      for (const plugin of plugins) {
        if (!command || !plugin.Commands.includes(command)) continue;
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

        // Perintah yang mengubah data seluruh server: khusus owner utama.
        if (
          (plugin.OnlyMainOwner || PERINTAH_OWNER_UTAMA.has(String(command).toLowerCase())) &&
          !isMainOwner
        ) {
          logTracking(`Handler - Bukan Owner utama (${command})`);
          await sock.sendMessage(
            remoteJid,
            {
              text: mess.general.isMainOwner.replace(
                "@dashboard",
                `${config.web_url}/dashboard`
              ),
            },
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

        if (!eksekusi) {
          eksekusi = { mulai: Date.now(), ok: true, plugin: namaPlugin(plugin, command) };
        }

        let pluginResult;
        try {
          pluginResult = await plugin.handle(sock, messageInfo);
        } catch (error) {
          eksekusi.ok = false;
          eksekusi.plugin = namaPlugin(plugin, command);
          throw error;
        }

        // Satu command bisa dipakai beberapa plugin (mis. ".tebak angka" /
        // ".tebak kata"); plugin yang bukan sasarannya mengembalikan true.
        // Yang dicatat adalah plugin yang benar-benar menangani.
        if (pluginResult !== true) {
          eksekusi.plugin = namaPlugin(plugin, command);
        }

        logTracking(`Plugins - ${command} dijalankan oleh ${sender}`);

        // Cek apakah plugin meminta untuk menghentikan eksekusi
        if (pluginResult === false) {
          return;
        }
      }
    } finally {
      if (eksekusi) {
        catatCommand({
          bot: botNumber,
          command: String(command).toLowerCase(),
          isGroup,
          ok: eksekusi.ok,
          ms: Date.now() - eksekusi.mulai,
          plugin: eksekusi.plugin,
        });
      }
    }

    // sampai sini command tidak di temukan
    // Pencarian kemiripan (levenshtein ke ~1000 perintah) hanya dijalankan
    // untuk pesan berprefix. Dulu dihitung untuk SETIAP pesan, termasuk
    // obrolan biasa — CPU terbuang di grup ramai.
    if (config.commandSimilarity && !commandFound && prefix && command && fullText.length < 20) {
      const closestCommand = findClosestCommand(command, plugins);
      if (closestCommand) {
        logTracking(`Handler - Command tidak ditemukan (${command})`);
        logCustom(
          "info",
          `_Command *${command}* tidak ditemukan_ \n\n_Apakah maksud Anda *.${closestCommand}*?_`,
          `ERROR-COMMAND-NOT-FOUND.txt`
        );
        return await sock.sendMessage(
          remoteJid,
          {
            text: `_Command *${command}* tidak ditemukan_ \n\n_Apakah maksud Anda *${prefix}${closestCommand}*?_`,
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