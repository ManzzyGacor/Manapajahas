import { doLookup } from '../../lib/mlbb-api.js';
import { createCanvas } from 'canvas';
import { guardTier, upgradeUrl } from '../../lib/tier-guard.js';
import { hasActiveAddon } from '../../lib/addons.js';
import { isPremiumUser, findUser, updateUser } from '../../lib/users.js';

function cleanText(str) {
  return str.replace(/[*_`]/g, '')
            .replace(/[^\x20-\x7E\u2500-\u257F\u2022]/g, '')
            .trim();
}

function drawLiquidGlass(ctx, width, height, title) {
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#020205'); 
  bg.addColorStop(0.5, '#0a192f'); 
  bg.addColorStop(1, '#050a15'); 
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.beginPath();
  ctx.arc(width * 0.8, height * 0.2, 250, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(14, 165, 233, 0.1)'; 
  ctx.fill();

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
  ctx.font = 'bold 180px "Helvetica Neue", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VARESA', 0, 0);
  ctx.restore();

  const pad = 25, r = 35; 
  ctx.beginPath();
  ctx.roundRect(pad, pad, width - pad * 2, height - pad * 2, r);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.035)'; 
  ctx.fill();

  ctx.lineWidth = 1.5;
  const border = ctx.createLinearGradient(pad, pad, width - pad, height - pad);
  border.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
  border.addColorStop(0.3, 'rgba(255, 255, 255, 0.05)');
  border.addColorStop(1, 'rgba(255, 255, 255, 0.1)');
  ctx.strokeStyle = border;
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.beginPath();
  ctx.roundRect(pad, pad, width - pad * 2, 60, { tl: r, tr: r, bl: 0, br: 0 });
  ctx.fill();
  
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px "Helvetica Neue", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, width / 2, pad + 30);
}

function drawIcon(ctx, type, x, y) {
  ctx.save();
  ctx.translate(x, y);
  const size = 6;
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.fill();
  ctx.restore();
}

async function createMLBBCanvas(text, title) {
  const lines = text.split('\n');
  const lineHeight = 36;
  const startY = 130; 
  const width = 900; 
  const height = startY + (lines.length * lineHeight) + 40;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  drawLiquidGlass(ctx, width, height, title.toUpperCase());

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let y = startY;

  for (const originalLine of lines) {
    if (originalLine.includes('━━━━━━━━━━━━━━━━━━━━')) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(50, y - 18, width - 100, 1.5);
      continue;
    }
    let cleanLine = cleanText(originalLine);
    if (!cleanLine) continue;

    let isTreeBranch = cleanLine.includes('┣') || cleanLine.includes('┗');
    let textX = isTreeBranch ? 60 : 75;

    if (!isTreeBranch) drawIcon(ctx, 'dot', 50, y);

    if (cleanLine.includes(':')) {
      const splitIdx = cleanLine.indexOf(':');
      const key = cleanLine.substring(0, splitIdx + 1);
      const val = cleanLine.substring(splitIdx + 1);

      ctx.font = '500 20px "Helvetica Neue", "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'; 
      ctx.fillText(key, textX, y);

      ctx.font = 'bold 22px "Helvetica Neue", "Segoe UI", sans-serif';
      ctx.fillStyle = isTreeBranch ? '#fde047' : '#ffffff'; 
      const keyWidth = ctx.measureText(key).width;
      ctx.fillText(val, textX + keyWidth + 5, y);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px "Helvetica Neue", "Segoe UI", sans-serif';
      ctx.fillText(cleanLine, textX, y);
    }
    y += lineHeight;
  }
  return canvas.toBuffer();
}

function formatNeatCaption(text, title, isPremium, sisaLimit, limitMax) {
  const lines = text.split('\n').filter(l => l.trim() !== '' && !l.includes('━━━━━━━━━━━━━━━━━━━━'));
  let neat = `╭─── [ *${title}* ] ───\n`;
  for (const line of lines) {
    neat += `│ ${line}\n`;
  }
  neat += `╰────────────────────\n\n`;
  if (isPremium) {
    neat += `🌟 _Status Premium: Sisa Limit Harian ${sisaLimit}/${limitMax}_`;
  } else {
    neat += `💡 _Sisa limit harian: ${sisaLimit}/${limitMax}_\n⭐ _Mau tanpa batas? Pemilik bot bisa aktifkan add-on Unlimited Access di ${upgradeUrl()}_`;
  }
  return neat;
}

const cooldowns = new Map();
const COOLDOWN_TIME = 45 * 1000;

async function handle(sock, messageInfo) {
  // Fitur MLBB khusus paket Zenith.
  if (await guardTier(sock, messageInfo, 'booster', 'Cek MLBB')) return;

  // Add-on "Unlimited": membebaskan jeda anti-spam DAN limit harian.
  // Nilainya sudah dihitung sekali di autoresbot.js; kalau tidak ada,
  // dicek sendiri lewat nomor bot sebagai cadangan.
  const botNum = (sock.user?.id || '').split(':')[0].replace(/\D/g, '');
  const unlimited = messageInfo.hasUnlimitedAddon
    ?? await hasActiveAddon(botNum, 'mlbb_unlimited');

  const { remoteJid, message, command, content, senderLid, sender } = messageInfo;
  const userJid = senderLid || sender || remoteJid;
  const now = Date.now();

  const channelContext = {
    forwardingScore: 999,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
      newsletterJid: '120363425345196924@newsletter',
      newsletterName: 'VARESA OFFICIAL',
      serverMessageId: -1
    }
  };

  if (!unlimited && cooldowns.has(userJid)) {
    const lastUsed = cooldowns.get(userJid);
    if (now - lastUsed < COOLDOWN_TIME) {
      const timeLeft = Math.ceil((COOLDOWN_TIME - (now - lastUsed)) / 1000);
      return await sock.sendMessage(
        remoteJid,
        { text: `⏳ *JEDA ANTI-SPAM*\n\nMohon tunggu *${timeLeft} detik* lagi.` },
        { quoted: message }
      );
    }
  }
  cooldowns.set(userJid, now);

  // messageInfo.isPremium juga memuat premium PER BOT (diberikan owner bot
  // ini lewat .addprem), yang tidak tercatat di users.json.
  const isPremium = isPremiumUser(userJid) || messageInfo.isPremium === true;
  const todayDate = new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
  
  let userData = {};
  try {
    userData = findUser(userJid) || {};
  } catch(e) {}

  let currentLimit = 0;
  let lastReset = '';
  
  if (Array.isArray(userData)) {
    currentLimit = userData[1]?.lookup_count || 0;
    lastReset = userData[1]?.lookup_last_reset || '';
  } else {
    currentLimit = userData?.lookup_count || 0;
    lastReset = userData?.lookup_last_reset || '';
  }

  if (lastReset !== todayDate) {
    currentLimit = 0;
  }

  const MAX_FREE = 2;
  const MAX_PREMIUM = 15;
  const limitMax = isPremium ? MAX_PREMIUM : MAX_FREE;

  if (!unlimited && currentLimit >= limitMax) {
    cooldowns.delete(userJid);
    let limitMsg = `❌ *LIMIT LOOKUP HABIS*\n\nBatas maksimal cek profil harian Anda (${limitMax}/${limitMax}) telah tercapai.\n_Reset otomatis jam 00:00 WIB._`;
    if (!isPremium) {
      limitMsg += `\n\n⭐ _Premium: limit hingga ${MAX_PREMIUM}x/hari. Add-on *Unlimited Access*: tanpa batas._\n🌐 Aktifkan di ${upgradeUrl()} • info: *.premium*`;
    }
    return await sock.sendMessage(
      remoteJid, 
      { text: limitMsg, contextInfo: channelContext }, 
      { quoted: message }
    );
  }

  const params = content.trim().split(/\s+/);
  const roleId = params[0];
  const zoneId = params[1];

  if (!roleId || !zoneId) {
    cooldowns.delete(userJid);
    return await sock.sendMessage(remoteJid, { text: `🔍 *DATA KURANG LENGKAP*\n\n*Format:* .${command} [role_id] [zone_id]` }, { quoted: message });
  }

  await sock.sendMessage(remoteJid, { react: { text: "⏳", key: message.key } });
  
  try {
    const result = await doLookup(roleId, zoneId);
    
    currentLimit += 1;
    updateUser(userJid, { lookup_count: currentLimit, lookup_last_reset: todayDate });

    const canvasBuffer = await createMLBBCanvas(result, 'INFO PROFIL MLBB');
    const sisa = limitMax - currentLimit;
    const neatCaption = formatNeatCaption(result, 'DETAIL PROFIL', isPremium, sisa, limitMax);

    await sock.sendMessage(remoteJid, { react: { text: "✅", key: message.key } });
    await sock.sendMessage(
      remoteJid, 
      { 
        image: canvasBuffer, 
        caption: neatCaption,
        contextInfo: channelContext
      }, 
      { quoted: message }
    );
  } catch (err) {
    cooldowns.delete(userJid);
    await sock.sendMessage(remoteJid, { react: { text: "❌", key: message.key } });
    await sock.sendMessage(remoteJid, { text: `❌ *Error:* ${err.message}` }, { quoted: message });
  }
}

export default { handle, Commands: ["lookup", "ceklookup", "info"], OnlyPremium: false, OnlyOwner: false };