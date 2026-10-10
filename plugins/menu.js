import { loadMenuOnce } from "../database/menu.js";
import config from "../config.js";
import { readFileAsBuffer } from "../lib/fileHelper.js";
import { style, getCurrentDate, readMore } from "../lib/utils.js";
import { readGroup } from "../lib/group.js";
import { isOwner, isPremiumUser } from "../lib/users.js";
import moment from "moment-timezone";
import path from "path";
import fs from "fs/promises";
import os from "os";

import BaileysHelper from "baileys_helper";
const { sendInteractiveMessage } = BaileysHelper;

const linkGroup = "https://chat.whatsapp.com/G3eLNFmrWQEBzQfI4RsrLJ?mode=hqrt1";
const AUDIO_MENU = true;

const MENU_MEDIA_URL = config.bot_media; 
const IS_VIDEO_MEDIA = true; 

// Media menu: foto/GIF milik bot (dashboard, khusus Zenith) atau bawaan.
// Link .mp4/.webm/.mov dikirim sebagai video berulang (gifPlayback),
// selain itu sebagai gambar.
function resolveMenuMedia(menuImage) {
    let url = String(menuImage || "").trim();
    // Path file di website sendiri ("/uploads/...") dijadikan link penuh
    // ke web Varesa, supaya file yang diunggah lewat website juga bisa dipakai.
    if (url.startsWith("/") && !url.startsWith("//")) url = `${config.web_url}${url}`;
    if (!/^https?:\/\//i.test(url)) {
        return { url: MENU_MEDIA_URL, isVideo: IS_VIDEO_MEDIA };
    }
    const isVideo = /\.(mp4|webm|mov)$/i.test(url.split("?")[0]);
    return { url, isVideo };
}

// Isi placeholder menu kustom dari dashboard ({pushname}, {prefix}, dst).
function renderCustomMenu(template, data) {
    let out = String(template || "");
    for (const [key, value] of Object.entries(data)) {
        out = out.replace(new RegExp(`\\{${key}\\}`, "gi"), String(value ?? ""));
    }
    return out.trim();
}

const soundPagi = "pagi.opus";
const soundSiang = "siang.opus";
const soundSore = "sore.opus";
const soundPetang = "petang.opus";
const soundMalam = "malam.opus";

function getRuntime(seconds) {
    const days = Math.floor(seconds / (24 * 3600));
    seconds %= 24 * 3600;
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    
    let result = [];
    if (days > 0) result.push(`${days}h`);
    if (hours > 0) result.push(`${hours}j`);
    if (minutes > 0) result.push(`${minutes}m`);
    result.push(`${secs}d`);

    return result.join(' ');
}

function getGreetingInfo() {
    const now = moment.tz("Asia/Jakarta");
    const wibHours = now.hour();

    let text, emoji, fileName;

    if (wibHours >= 4 && wibHours < 11) {
        text = "Selamat Pagi";
        emoji = "🌅";
        fileName = soundPagi;
    } else if (wibHours >= 11 && wibHours < 15) {
        text = "Selamat Siang";
        emoji = "☀️";
        fileName = soundSiang;
    } else if (wibHours >= 15 && wibHours < 18) {
        text = "Selamat Sore";
        emoji = "🌇";
        fileName = soundSore;
    } else if (wibHours >= 18 && wibHours < 24) {
        text = "Selamat Malam";
        emoji = "🌃";
        fileName = soundMalam;
    } else {
        text = "Selamat Subuh";
        emoji = "🌌";
        fileName = soundPetang;
    }

    return { 
        titleGreeting: `${text}`, 
        emoji: emoji,              
        bodyStatus: `Waktu Server: ${now.format("HH:mm:ss")} WIB`, 
        audioFile: fileName 
    };
}

const formatMenuCategory = (title, items) => {
    const prefix = Array.isArray(config.prefix) ? config.prefix[0] : config.prefix || ".";
    const formattedItems = items.map((item) => {
        if (typeof item === "string") return `┣⌬ ${prefix}${item}`;
        if (typeof item === "object" && item.command)
            return `┣⌬ ${prefix}${item.command}${item.description ? ` - ${item.description}` : ''}`;
        return "┣⌬ [Invalid item]";
    });

    return `┏━『 *${title.toUpperCase()}* 』\n┃\n${formattedItems.join("\n")}\n┗━━━━━━━◧`;
};

function formatAllCommands(title, commands) {
    const prefix = Array.isArray(config.prefix) ? config.prefix[0] : config.prefix || ".";
    return `*» ${title}*\n${commands.map(cmd => {
        if (typeof cmd === 'string') return `  ${prefix}${cmd}`;
        if (typeof cmd === 'object' && cmd.command) return `  ${prefix}${cmd.command}${cmd.description ? ` - ${cmd.description}` : ''}`;
        return '  [Invalid Command]';
    }).join('\n')}`;
}

async function getAudioBuffer(fileName) {
    try {
        let buffer = await readFileAsBuffer(`@assets/audio/${fileName}`); 
        if (buffer) return buffer;
    } catch (e) {
        try {
            const manualPath = path.join(process.cwd(), "database", "audio", fileName);
            return await fs.readFile(manualPath);
        } catch (err) {
            return null;
        }
    }
    return null;
}

// --- MAIN HANDLE ---
async function handle(sock, messageInfo) {
    let {
        remoteJid,
        message, 
        command,
        content,
        pushName,
        sender,
        prefix,
        sessionConfig = {},
        isJadibot,
    } = messageInfo; 

    // Nama bot diambil dari config per-sesi (diatur di dashboard web) dan
    // hanya jatuh ke config global kalau belum diisi. Sebelumnya menu selalu
    // memakai config.bot_name global, jadi nama bot yang disimpan user di
    // dashboard tidak pernah muncul.
    const botName = (sessionConfig?.botName || "").trim() || config.bot_name;

    // Footer menu: teks footer dari dashboard (Core ke atas). Bot user tanpa
    // footer menampilkan "Powered by Varesa" + alamat web; bot utama tetap
    // memakai kredit owner seperti sebelumnya.
    const webHost = config.web_url.replace(/^https?:\/\//, "");
    const footerMenu = (sessionConfig?.footer || "").trim()
        || (isJadibot ? `Powered by Varesa • ${webHost}` : `Created by ${config.owner_name}`);

    // Foto/GIF menu dari dashboard (Zenith) — applyTierCaps di autoresbot.js
    // sudah mengosongkannya untuk paket lain.
    const menuMedia = resolveMenuMedia(sessionConfig?.menuImage);

    // Perintah kustom milik NOMOR BOT INI saja. Diambil dari sessionConfig,
    // jadi bot lain tidak akan pernah menampilkannya.
    const perintahKustom = Array.isArray(sessionConfig?.customCommands)
        ? sessionConfig.customCommands.filter(c => c && c.cmd && c.showInMenu !== false)
        : [];

    const prefixMenu = Array.isArray(config.prefix) ? config.prefix[0] : (config.prefix || '.');
    const daftarPerintahKustom = perintahKustom.length
        ? `\n\n┏━『 *PERINTAH KHUSUS* 』\n┃\n` +
          perintahKustom.map(c => `┣⌬ ${prefixMenu}${c.cmd}`).join('\n') +
          `\n┗━━━━━━━◧`
        : '';

    // Owner bot dari dashboard juga dihitung owner (dihitung di autoresbot.js).
    const roleUser = (messageInfo.isOwner ?? isOwner(sender))
        ? "Owner"
        : (messageInfo.isPremium ?? isPremiumUser(sender)) ? "Premium" : "user";
    const date = getCurrentDate();
    
    // --- LOAD SETTINGAN GRUP ---
    const isGroup = remoteJid.endsWith("@g.us");
    // Dibaca dari memori lib/group.js (sumber yang sama dengan .setmenu),
    // bukan dari file yang bisa tertinggal sampai 30 detik.
    const groupData = (await readGroup()) || {};
    // Default-nya kita bikin 'button', kalau ada settingan text, kita pake 'text'
    const menuMode = (isGroup && groupData[remoteJid]?.menu_mode) ? groupData[remoteJid].menu_mode : "button";

    const selectedId = message?.message?.listResponseMessage?.singleSelectReply?.selectedRowId;
    
    if (selectedId) {
        const idLower = selectedId.toLowerCase().trim();
        if (idLower.startsWith(`${prefix}menu `)) {
            command = 'menu';
            content = idLower.slice(`${prefix}menu `.length).trim();
        } 
        else if (idLower === `${prefix}allmenu`) {
            command = 'allmenu';
            content = 'all'; 
        } 
        else if (idLower === `${prefix}owner`) {
            command = 'owner';
            content = '';
        }
    } else {
        if (command && command.toLowerCase().startsWith(`${prefix}menu `)) {
            content = command.slice(`${prefix}menu `.length).trim(); 
            command = 'menu'; 
        } 
        else if (content && content.toLowerCase().startsWith(`${prefix}menu `)) {
            command = 'menu';
            content = content.slice(`${prefix}menu `.length).trim();
        }
    }
    
    const category = (content || "").toLowerCase().trim();
    
    // Menu bawaan (dikelompokkan per folder plugin oleh database/menu.js)
    // ditambah kategori "perintah khusus" berisi perintah kustom bot ini,
    // supaya ikut muncul di daftar tombol, .menu perintah_khusus, dan
    // .allmenu — bukan cuma di kepala menu.
    const menuBawaan = await loadMenuOnce();
    const menuData = perintahKustom.length
        ? { "perintah khusus": perintahKustom.map(c => c.cmd), ...menuBawaan }
        : menuBawaan;
    const totalFeatures = Object.values(menuData).flat().length;
    // Baris penutup yang sama di semua tampilan menu (nama bot + footer
    // dari dashboard), bukan cuma di menu tombol.
    const penutupMenu = `\n\n_${botName} • ${footerMenu}_`;
    
    const { titleGreeting, emoji, audioFile } = getGreetingInfo();
    const runtime = getRuntime(process.uptime()); 

    const mediaMessage = menuMedia.isVideo
        ? { video: { url: menuMedia.url }, gifPlayback: true }
        : { image: { url: menuMedia.url } };

    const matchedKey = Object.keys(menuData).find(key => 
        key.toLowerCase().replace(/\s+/g, '_') === category
    );

    let result; 

    if (category && matchedKey) {
        const response = formatMenuCategory(matchedKey.toUpperCase(), menuData[matchedKey]);
        result = await sock.sendMessage(
            remoteJid,
            {
                ...mediaMessage,
                caption: style(response) + penutupMenu,
            },
            { quoted: message }
        );
    
    } else if (
        // ".help" dulu tidak masuk cabang mana pun sehingga bot diam.
        // Kategori yang tidak dikenal juga jatuh ke menu utama, bukan diam.
        (command === "menu" || command === "help") &&
        (!category || (!matchedKey && category !== "all"))
    ) {

        const vpsRuntime = getRuntime(os.uptime()); 

        // Menu kustom dari dashboard (Core ke atas). Placeholder yang didukung:
        // {ucapanWaktu} {pushname} {statusUser} {date} {time} {prefix}
        // {botname} {runtime} {totalfitur}
        const customMenuText = renderCustomMenu(sessionConfig?.customMenu, {
            ucapanWaktu: `${titleGreeting} ${emoji}`,
            pushname: pushName || "Kak",
            statusUser: roleUser.toUpperCase(),
            date,
            time: `${moment.tz("Asia/Jakarta").format("HH:mm:ss")} WIB`,
            prefix,
            botname: botName,
            runtime,
            totalfitur: totalFeatures,
        });
            
        const headerText = customMenuText
            ? `${customMenuText}${daftarPerintahKustom}`
            : `*${titleGreeting}* ${emoji} *${pushName}*!
Selamat datang di *${botName}*.

---
👤 *USER INFO*
 • Nama: *${pushName || "Guest"}*
 • Status: *${roleUser.toUpperCase()}*

---
⚙️ *BOT STATUS*
 • Total Fitur: ${totalFeatures}
 • Runtime Bot: ${runtime}
 • Runtime VPS: ${vpsRuntime} 
 • Waktu Server: ${moment.tz("Asia/Jakarta").format("HH:mm:ss")} WIB
 • Tanggal: ${date}

Silahkan pilih kategori di bawah, atau ketik ${prefix}allmenu.${daftarPerintahKustom}`;

        // Menu kustom ditampilkan apa adanya (tanpa diubah gaya hurufnya),
        // persis seperti yang ditulis pemilik bot di dashboard.
        const headerTampil = customMenuText ? headerText : style(headerText);

        // --- CEK MODE DISPLAY MENU ---
        if (menuMode === "text") {
            // ======================================
            // TAMPILAN MODE TEXT (GIF + TEXT KATEGORI)
            // ======================================
            let listKategori = `\n\n┏━『 *DAFTAR KATEGORI* 』\n┃\n`;
            
            Object.keys(menuData).forEach((key) => {
                const sanitizedKey = key.toLowerCase().replace(/\s+/g, '_'); 
                listKategori += `┣⌬ ${prefix}menu ${sanitizedKey}\n`;
            });
            
            listKategori += `┣⌬ ${prefix}allmenu\n┗━━━━━━━◧`;

            const fullText = headerTampil + listKategori + penutupMenu;

            result = await sock.sendMessage(
                remoteJid,
                {
                    ...mediaMessage,
                    caption: fullText,
                },
                { quoted: message }
            );

        } else {
            // ======================================
            // TAMPILAN MODE BUTTON (BAWAAN LAMA)
            // ======================================
            const menuRows = Object.keys(menuData).map((key) => {
                const sanitizedKey = key.toLowerCase().replace(/\s+/g, '_'); 
                const cmdCount = menuData[key].length;
                return {
                    header: "", 
                    title: key.toUpperCase(),
                    description: `${cmdCount} Fitur`,
                    id: `${prefix}menu ${sanitizedKey}` 
                };
            });

            menuRows.push({
                header: "ALL",
                title: "TAMPILKAN SEMUA",
                description: "Menampilkan semua fitur dalam satu pesan",
                id: `${prefix}allmenu`
            });
            
            const sections = [{ title: "DAFTAR KATEGORI", rows: menuRows }];

            const interactiveButtons = [
                {
                    name: 'single_select',
                    buttonParamsJson: JSON.stringify({
                        title: 'KLIK DISINI', 
                        sections: sections
                    })
                },
                {
                     name: 'quick_reply',
                     buttonParamsJson: JSON.stringify({ display_text: 'Owner Bot', id: `${prefix}owner` })
                }
            ];

            const headerConfig = {
                title: botName,
                subtitle: `Total Fitur: ${totalFeatures}`,
                hasMediaAttachment: true,
                ...(menuMedia.isVideo
                    ? { videoMessage: { url: menuMedia.url } }
                    : { imageMessage: { url: menuMedia.url } }
                )
            };

            try {
                result = await sendInteractiveMessage(sock, remoteJid, {
                    text: headerTampil,
                    footer: `${botName} • ${footerMenu}`, 
                    header: headerConfig,
                    interactiveButtons: interactiveButtons
                }, { quoted: message });
            } catch (err) {
                // Pesan tombol bisa ditolak WhatsApp (mis. klien lama /
                // media gagal diunduh). Jangan biarkan .menu diam: kirim
                // versi teks berisi daftar kategori.
                console.error("[menu] gagal kirim menu tombol:", err?.message || err);
                const kategori = Object.keys(menuData)
                    .map((key) => `┣⌬ ${prefix}menu ${key.toLowerCase().replace(/\s+/g, '_')}`)
                    .join("\n");
                result = await sock.sendMessage(
                    remoteJid,
                    {
                        text: `${headerTampil}\n\n┏━『 *DAFTAR KATEGORI* 』\n┃\n${kategori}\n┣⌬ ${prefix}allmenu\n┗━━━━━━━◧${penutupMenu}`,
                    },
                    { quoted: message }
                );
            }
        }

    } else if (command === "allmenu" || ((command === "menu" || command === "help") && category === "all")) {
        const allMenuResponse = `
👑 *USER: ${pushName || "Guest"}*
 • Status: ${roleUser}
 • Tanggal: ${date}

---
📜 *ALL COMMANDS* (${totalFeatures} Fitur)
${readMore()}

${Object.keys(menuData)
  .map((key) => formatAllCommands(key.toUpperCase(), menuData[key]))
  .join("\n\n")}`;
        
        result = await sock.sendMessage(
            remoteJid, 
            {
                ...mediaMessage,
                caption: style(allMenuResponse) + penutupMenu,
            }, 
            { quoted: message }
        );
    }

    if (AUDIO_MENU && audioFile && result) {
        const audioBuffer = await getAudioBuffer(audioFile);
        if (audioBuffer) {
            await sock.sendMessage(
                remoteJid, 
                { audio: audioBuffer, mimetype: "audio/mp4", ptt: true }, 
                { quoted: result }
            );
        }
    }
}

export default {
    handle,
    Commands: ["menu", "help", "allmenu"],
    OnlyPremium: false,
    OnlyOwner: false,
};