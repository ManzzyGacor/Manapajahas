import { findUser, isOwner, isPremiumUser } from "../../lib/users.js";
import { getProfilePictureUrl } from "../../lib/cache.js";
import { getBuffer, formatNumber } from "../../lib/utils.js";
import { getLimitBonusAny } from "../../lib/bot-scope.js";
import { createCanvas, loadImage } from "canvas";

// --- Metadata Plugin ---
const Commands = ["profile", "p"];
const Description = "Menampilkan kartu profil ala Spotify menggunakan Canvas.";
const OnlyGroup = false;
const limitDeduction = 1;

// Background & default asset
const PROFILE_BG =
  "https://raw.githubusercontent.com/ManzzyGacor/Urlmanzzy/main/file_1764852574488_761.jpg";
const DEFAULT_AVATAR = "https://i.ibb.co/Yj1kTdQ/default-avatar.png";
const DEFAULT_BADGE = "https://i.ibb.co/K5w21S5/gamers.png";

// Badge sesuai achievement user
const getAchievementBadgeUrl = (achievement) => {
  const badgeMap = {
    gamers: "https://i.ibb.co/K5w21S5/gamers.png",
    coding: "https://i.ibb.co/2WFF1pY/coding.png",
  };
  return badgeMap[achievement] || DEFAULT_BADGE;
};

// Helper: load image aman dari URL (pakai getBuffer → loadImage(Buffer))
async function loadImageSafe(url, fallbackUrl) {
  const candidates = [url, fallbackUrl].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const buf = await getBuffer(candidate);
      if (!buf) continue;
      const img = await loadImage(buf);
      return img;
    } catch (e) {
      console.warn("Gagal load image:", candidate, e.message);
    }
  }
  return null;
}

// Helper: rounded rect
function roundRect(ctx, x, y, w, h, r) {
  const radius = typeof r === "number" ? { tl: r, tr: r, br: r, bl: r } : r;
  ctx.beginPath();
  ctx.moveTo(x + radius.tl, y);
  ctx.lineTo(x + w - radius.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius.tr);
  ctx.lineTo(x + w, y + h - radius.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius.br, y + h);
  ctx.lineTo(x + radius.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius.bl);
  ctx.lineTo(x, y + radius.tl);
  ctx.quadraticCurveTo(x, y, x + radius.tl, y);
  ctx.closePath();
}

/* --------------------------
   CANVAS PROFILE GENERATOR
--------------------------- */
async function generateProfileCanvas({
  avatarUrl,
  badgeUrl,
  username,
  role,
  level,
  money,
  limit,
  bonusLimit = 0,
}) {
  const width = 900;
  const height = 450;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Background
  const bg = await loadImageSafe(PROFILE_BG);
  if (bg) {
    ctx.drawImage(bg, 0, 0, width, height);
  } else {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);
  }

  // Overlay gradasi gelap hijau ala Spotify
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "rgba(0,0,0,0.75)");
  gradient.addColorStop(0.5, "rgba(0,0,0,0.55)");
  gradient.addColorStop(1, "rgba(0,0,0,0.9)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Kartu utama
  const cardX = 50;
  const cardY = 70;
  const cardW = width - 100;
  const cardH = height - 130;

  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, 28);
  ctx.fillStyle = "rgba(15,23,42,0.78)";
  ctx.fill();
  ctx.restore();

  // Avatar / cover
  const coverSize = 220;
  const coverX = cardX + 35;
  const coverY = cardY + 40;
  const avatar = await loadImageSafe(avatarUrl, DEFAULT_AVATAR);

  if (avatar) {
    ctx.save();
    roundRect(ctx, coverX, coverY, coverSize, coverSize, 24);
    ctx.clip();
    ctx.drawImage(avatar, coverX, coverY, coverSize, coverSize);
    ctx.restore();
  }

  // Badge kecil
  const badgeImg = await loadImageSafe(badgeUrl, DEFAULT_BADGE);
  if (badgeImg) {
    const badgeSize = 70;
    const badgeX = coverX + coverSize - badgeSize + 10;
    const badgeY = coverY + coverSize - badgeSize + 10;
    ctx.save();
    roundRect(ctx, badgeX, badgeY, badgeSize, badgeSize, 18);
    ctx.clip();
    ctx.drawImage(badgeImg, badgeX, badgeY, badgeSize, badgeSize);
    ctx.restore();
  }

  // Area teks kanan
  const textX = coverX + coverSize + 40;
  const baseY = coverY + 5;

  // Label kecil
  ctx.fillStyle = "#9ca3af";
  ctx.font = "18px Sans-serif";
  ctx.fillText("PROFILE SESSION", textX, baseY + 10);

  // Username (judul besar)
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 40px Sans-serif";
  ctx.fillText(username, textX, baseY + 55);

  // Role + level
  ctx.fillStyle = "#d1d5db";
  ctx.font = "24px Sans-serif";
  ctx.fillText(`@${role} • Level ${level}`, textX, baseY + 95);

  // Info Money & Limit
  ctx.fillStyle = "#9ca3af";
  ctx.font = "20px Sans-serif";
  ctx.fillText(`Money : ${formatNumber(money)}`, textX, baseY + 135);
  ctx.fillText(
    bonusLimit > 0 ? `Limit  : ${limit} (+${bonusLimit} bonus bot ini)` : `Limit  : ${limit}`,
    textX,
    baseY + 165
  );

  // Now Playing bar
  const barY = cardY + cardH - 75; // lebih ke bawah biar nggak nabrak

  ctx.fillStyle = "#9ca3af";
  ctx.font = "18px Sans-serif";
  ctx.fillText("Now Playing • Your Bot Profile", textX, barY - 18);

  const barWidth = cardW - (textX - cardX) - 40;
  const barHeight = 8;
  const barX = textX;
  const progress =
    Math.max(0.1, Math.min(1, (Number(level) || 1) / 50)); // 1–50

  // Bar background
  ctx.fillStyle = "#374151";
  roundRect(ctx, barX, barY, barWidth, barHeight, 4);
  ctx.fill();

  // Progress hijau
  ctx.fillStyle = "#1DB954";
  roundRect(ctx, barX, barY, barWidth * progress, barHeight, 4);
  ctx.fill();

  // Knob
  const knobX = barX + barWidth * progress;
  const knobY = barY + barHeight / 2;
  ctx.beginPath();
  ctx.arc(knobX, knobY, 7, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#1DB954";
  ctx.stroke();

  // Kontrol player
  const controlsY = barY + 40;
  const centerX = barX + barWidth / 4;

  ctx.fillStyle = "#ffffff";

  // Previous
  ctx.beginPath();
  ctx.moveTo(centerX - 60, controlsY);
  ctx.lineTo(centerX - 40, controlsY - 12);
  ctx.lineTo(centerX - 40, controlsY + 12);
  ctx.closePath();
  ctx.fill();

  // Play
  ctx.beginPath();
  ctx.moveTo(centerX, controlsY - 16);
  ctx.lineTo(centerX + 22, controlsY);
  ctx.lineTo(centerX, controlsY + 16);
  ctx.closePath();
  ctx.fill();

  // Next
  ctx.beginPath();
  ctx.moveTo(centerX + 60, controlsY);
  ctx.lineTo(centerX + 40, controlsY - 12);
  ctx.lineTo(centerX + 40, controlsY + 12);
  ctx.closePath();
  ctx.fill();

  // Logo Spotify mini
  const logoR = 18;
  const logoX = cardX + cardW - logoR - 18;
  const logoY = cardY + cardH - logoR - 18;
  ctx.beginPath();
  ctx.arc(logoX, logoY, logoR, 0, Math.PI * 2);
  ctx.fillStyle = "#1DB954";
  ctx.fill();

  ctx.strokeStyle = "#0b1014";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(logoX, logoY + 1, 9, 0.25 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(logoX, logoY + 4, 7, 0.25 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(logoX, logoY + 7, 5, 0.25 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();

  return canvas.toBuffer("image/png");
}

/* --------------------------
   MAIN HANDLER (PROFILE)
--------------------------- */
async function handle(sock, messageInfo) {
  const { remoteJid, message, sender, pushName } = messageInfo;

  try {
    await sock.sendMessage(remoteJid, {
      react: { text: "🎧", key: message.key },
    });

    const user = await findUser(sender);
    if (!user) {
      return sock.sendMessage(
        remoteJid,
        // Pendaftaran otomatis di handle/usersHandle.js — perintah .daftar
        // tidak pernah ada, jadi cukup minta user mencoba lagi.
        { text: "_Data kamu belum tersimpan. Coba ketik perintah ini sekali lagi, ya._" },
        { quoted: message }
      );
    }

    const [userId, userData] = user;

    // Owner bot dari dashboard juga tampil sebagai Owner (lihat autoresbot.js).
    // messageInfo.isPremium sudah memuat premium global + premium per bot.
    const role = (messageInfo.isOwner ?? isOwner(sender))
      ? "Owner"
      : (messageInfo.isPremium ?? isPremiumUser(sender))
      ? "Premium"
      : "User";

    // Bonus limit dari owner bot ini (.addlimit) — hanya berlaku di bot ini,
    // dipakai duluan sebelum limit biasa.
    const bonusLimit =
      messageInfo.isJadibot && messageInfo.botNumber
        ? getLimitBonusAny(
            messageInfo.botNumber,
            messageInfo.userKeys || [String(sender || "").split("@")[0].split(":")[0]]
          )
        : 0;

    const ppUser = await getProfilePictureUrl(sock, sender);
    const avatarUrl = ppUser || DEFAULT_AVATAR;
    const badgeUrl = getAchievementBadgeUrl(userData.achievement);

    // 🔹 Display name logic: pakai pushName kalau username auto `user_...`
    const rawUsername = userData.username || "";
    const isAutoUsername = rawUsername.startsWith("user_");
    const displayName = !rawUsername || isAutoUsername
      ? (pushName || sender.split("@")[0])
      : rawUsername;

    const buffer = await generateProfileCanvas({
      avatarUrl,
      badgeUrl,
      username: displayName,
      role,
      level: userData.level || 1,
      money: userData.money || 0,
      limit: userData.limit || 0,
      bonusLimit,
    });

    const caption = `
*───[ 🎧 VARESA PROFILE ]───*

✨ *Nama*  : ${displayName}
👑 *Role*  : ${role}
🎖️ *Level* : ${userData.level || 1}
💰 *Money* : ${formatNumber(userData.money || 0)}
💎 *Limit* : ${userData.limit || 0}${
      bonusLimit > 0 ? `\n🎁 *Bonus limit (bot ini)* : ${formatNumber(bonusLimit)}` : ""
    }
`.trim();

    await sock.sendMessage(
      remoteJid,
      { image: buffer, caption },
      { quoted: message }
    );
  } catch (err) {
    console.error("Error Canvas Profile:", err);
    await sock.sendMessage(
      remoteJid,
      {
        text: `❌ Terjadi kesalahan saat membuat profile: ${
          err.message || err
        }`,
      },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands,
  Description,
  OnlyGroup,
  limitDeduction,
};