import { doBanV1 } from '../../lib/mlbb-api.js';
import { createCanvas } from 'canvas';
import { guardTier } from '../../lib/tier-guard.js';
import { hasActiveAddon } from '../../lib/addons.js';

function cleanText(str) {
  return str.replace(/[*_`]/g, '')
            .replace(/[^\x20-\x7E\u2500-\u257F\u2022]/g, '')
            .trim();
}

function drawLiquidGlass(ctx, width, height, title) {
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#020205'); 
  bg.addColorStop(0.5, '#120b1e'); 
  bg.addColorStop(1, '#050a15'); 
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.beginPath();
  ctx.arc(width * 0.8, height * 0.2, 250, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(236, 72, 153, 0.12)'; 
  ctx.fill();

  ctx.beginPath();
  ctx.arc(width * 0.2, height * 0.85, 300, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(56, 189, 248, 0.12)'; 
  ctx.fill();

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
  ctx.font = 'bold 180px "Helvetica Neue", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VARESA', 0, 0);
  ctx.restore();

  const pad = 25;
  const r = 35; 
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
  if (type === 'dot') {
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fill();
  }
  ctx.restore();
}

async function createMLBBCanvas(text, title) {
  const lines = text.split('\n');
  const lineHeight = 36;
  const startY = 130; 
  const width = 800;
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

    drawIcon(ctx, 'dot', 50, y);

    if (cleanLine.includes(':')) {
      const splitIdx = cleanLine.indexOf(':');
      const key = cleanLine.substring(0, splitIdx + 1);
      const val = cleanLine.substring(splitIdx + 1);

      ctx.font = '500 20px "Helvetica Neue", "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'; 
      ctx.fillText(key, 75, y);

      ctx.font = 'bold 22px "Helvetica Neue", "Segoe UI", sans-serif';
      const keyWidth = ctx.measureText(key).width;
      
      if (val.includes('TERBANNED')) ctx.fillStyle = '#ff453a'; 
      else if (val.includes('TIDAK BANNED') || val.includes('aman')) ctx.fillStyle = '#32d74b'; 
      else ctx.fillStyle = '#ffffff';
      
      ctx.fillText(val, 75 + keyWidth + 5, y);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px "Helvetica Neue", "Segoe UI", sans-serif';
      ctx.fillText(cleanLine, 75, y);
    }
    y += lineHeight;
  }
  return canvas.toBuffer();
}

function formatNeatCaption(text, title) {
  const lines = text.split('\n').filter(l => l.trim() !== '' && !l.includes('━━━━━━━━━━━━━━━━━━━━'));
  let neat = `╭─── [ *${title}* ] ───\n`;
  for (const line of lines) {
    neat += `│ ${line}\n`;
  }
  neat += `╰────────────────────`;
  return neat;
}

const cooldowns = new Map();
const COOLDOWN_TIME = 45 * 1000;

async function handle(sock, messageInfo) {
  // Fitur MLBB khusus paket Zenith.
  if (await guardTier(sock, messageInfo, 'booster', 'Cek Ban MLBB')) return;

  // Add-on "Unlimited": membebaskan jeda anti-spam DAN limit harian.
  // Nilainya sudah dihitung sekali di autoresbot.js; kalau tidak ada,
  // dicek sendiri lewat nomor bot sebagai cadangan.
  const botNum = (sock.user?.id || '').split(':')[0].replace(/\D/g, '');
  const unlimited = messageInfo.hasUnlimitedAddon
    ?? await hasActiveAddon(botNum, 'mlbb_unlimited');

  const { remoteJid, message, command, content, senderLid, sender } = messageInfo;
  
  // Konteks Saluran (Promosi)
  const channelContext = {
    forwardingScore: 999,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
      newsletterJid: '120363425345196924@newsletter',
      newsletterName: 'VARESA OFFICIAL',
      serverMessageId: -1
    }
  };

  // KUNCI MAINTENANCE
  return await sock.sendMessage(
    remoteJid,
    { 
      text: "🛠️ *CEK BAN MAINTENANCE*",
      contextInfo: channelContext 
    },
    { quoted: message }
  );

  // --- KODE DI BAWAH INI TIDAK AKAN TEREKSEKUSI SAAT MAINTENANCE AKTIF ---
  
  const userJid = senderLid || sender || remoteJid;
  const now = Date.now();

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

  const params = content.trim().split(/\s+/);
  const roleId = params[0];
  const zoneId = params[1];

  if (!roleId || !zoneId) {
    cooldowns.delete(userJid); 
    return await sock.sendMessage(
      remoteJid,
      { text: `🚫 *DATA KURANG LENGKAP*\n\n*Format:* .${command} [role_id] [zone_id]\n*Contoh:* .${command} 43044442 5205` },
      { quoted: message }
    );
  }

  await sock.sendMessage(remoteJid, { react: { text: "⏳", key: message.key } });
  
  try {
    const result = await doBanV1(roleId, zoneId);
    const canvasBuffer = await createMLBBCanvas(result, 'STATUS BAN AKUN');
    const neatCaption = formatNeatCaption(result, 'HASIL PENGECEKAN BAN');
    
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

export default { handle, Commands: ["cekban"], OnlyPremium: false, OnlyOwner: false };