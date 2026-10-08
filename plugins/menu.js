import { loadMenuOnce } from "../database/menu.js";
import config from "../config.js";
import { readFileAsBuffer } from "../lib/fileHelper.js";
import { style, getCurrentDate, readMore, readJsonFile } from "../lib/utils.js"; // <-- Tambahin import readJsonFile
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
        sessionConfig,
    } = messageInfo; 

    // Nama bot diambil dari config per-sesi (diatur di dashboard web) dan
    // hanya jatuh ke config global kalau belum diisi. Sebelumnya menu selalu
    // memakai config.bot_name global, jadi nama bot yang disimpan user di
    // dashboard tidak pernah muncul.
    const botName = (sessionConfig?.botName || "").trim() || config.bot_name;

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

    const roleUser = isOwner(sender) ? "Owner" : isPremiumUser(sender) ? "Premium" : "user";
    const date = getCurrentDate();
    
    // --- LOAD SETTINGAN GRUP ---
    const isGroup = remoteJid.endsWith("@g.us");
    const groupData = await readJsonFile("./database/group.json");
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
    
    const menuData = await loadMenuOnce();
    const totalFeatures = Object.values(menuData).flat().length;
    
    const { titleGreeting, emoji, audioFile } = getGreetingInfo();
    const runtime = getRuntime(process.uptime()); 

    const mediaMessage = IS_VIDEO_MEDIA 
        ? { video: { url: MENU_MEDIA_URL } } 
        : { image: { url: MENU_MEDIA_URL } };

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
                caption: style(response),
                gifPlayback: true, // Jadiin GIF selalu
            },
            { quoted: message }
        );
    
    } else if (command === "menu" && !category) {

        const vpsRuntime = getRuntime(os.uptime()); 
            
        const headerText = `*${titleGreeting}* ${emoji} *${pushName}*!
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

            const fullText = style(headerText) + listKategori;

            result = await sock.sendMessage(
                remoteJid,
                {
                    ...mediaMessage,
                    caption: fullText,
                    gifPlayback: true, // Diatur true biar jadi loop video muter-muter tanpa suara kaya GIF
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
                title: "Menu Utama",
                subtitle: `Total Fitur: ${totalFeatures}`,
                hasMediaAttachment: true,
                ...(IS_VIDEO_MEDIA 
                    ? { videoMessage: { url: MENU_MEDIA_URL } }
                    : { imageMessage: { url: MENU_MEDIA_URL } }
                )
            };

            result = await sendInteractiveMessage(sock, remoteJid, {
                text: style(headerText),
                footer: `${botName} • Created by ${config.owner_name}`, 
                header: headerConfig,
                interactiveButtons: interactiveButtons
            }, { quoted: message });
        }

    } else if (command === "allmenu" || (command === "menu" && category === "all")) {
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
                caption: style(allMenuResponse),
                gifPlayback: true, 
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