import { createCanvas, loadImage } from "canvas";

function parseDurationToSeconds(text) {
  if (!text) return 0;
  const parts = String(text).split(":").map((v) => parseInt(v || "0", 10));
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m);
  const ss = s < 10 ? "0" + s : String(s);
  return mm + ":" + ss;
}

export async function generateNowPlayingCanvas(track) {
  const width = 1400;
  const height = 700;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, width, height);

  let coverImg = null;
  if (track.cover) {
    try {
      coverImg = await loadImage(track.cover);
    } catch (e) {}
  }

  if (coverImg) {
    const scale = Math.max(width / coverImg.width, height / coverImg.height);
    const iw = coverImg.width * scale;
    const ih = coverImg.height * scale;
    const ix = (width - iw) / 2;
    const iy = (height - ih) / 2;
    ctx.globalAlpha = 0.45;
    ctx.drawImage(coverImg, ix, iy, iw, ih);
    ctx.globalAlpha = 1;
  }

  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, "rgba(15,23,42,0.98)");
  bgGrad.addColorStop(0.5, "rgba(15,23,42,0.97)");
  bgGrad.addColorStop(1, "rgba(15,23,42,0.98)");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  const glowGrad = ctx.createRadialGradient(
    width * 0.15,
    height * 0.2,
    20,
    width * 0.3,
    height * 0.4,
    420
  );
  glowGrad.addColorStop(0, "rgba(34,197,94,0.25)");
  glowGrad.addColorStop(0.4, "rgba(56,189,248,0.18)");
  glowGrad.addColorStop(1, "rgba(15,23,42,0)");
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, width, height);

  const cardX = 70;
  const cardY = 70;
  const cardW = width - cardX * 2;
  const cardH = height - cardY * 2;

  ctx.save();
  const r = 40;
  ctx.beginPath();
  ctx.moveTo(cardX + r, cardY);
  ctx.lineTo(cardX + cardW - r, cardY);
  ctx.quadraticCurveTo(cardX + cardW, cardY, cardX + cardW, cardY + r);
  ctx.lineTo(cardX + cardW, cardY + cardH - r);
  ctx.quadraticCurveTo(cardX + cardW, cardY + cardH, cardX + cardW - r, cardY + cardH);
  ctx.lineTo(cardX + r, cardY + cardH);
  ctx.quadraticCurveTo(cardX, cardY + cardH, cardX, cardY + cardH - r);
  ctx.lineTo(cardX, cardY + r);
  ctx.quadraticCurveTo(cardX, cardY, cardX + r, cardY);
  ctx.closePath();
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "rgba(10,16,32,0.98)";
  ctx.fill();
  ctx.restore();

  const topGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + 120);
  topGrad.addColorStop(0, "rgba(15,23,42,0.98)");
  topGrad.addColorStop(1, "rgba(15,23,42,0.94)");
  ctx.fillStyle = topGrad;
  ctx.fillRect(cardX, cardY, cardW, 120);

  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 22px 'Segoe UI', sans-serif";
  ctx.fillText("NOW PLAYING", cardX + 40, cardY + 44);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "16px 'Segoe UI', sans-serif";
  ctx.fillText("Spotify • VARESA MD", cardX + 40, cardY + 70);

  const pillX = cardX + cardW - 190;
  const pillY = cardY + 30;
  const pillW = 150;
  const pillH = 32;
  const pr = 16;

  ctx.beginPath();
  ctx.moveTo(pillX + pr, pillY);
  ctx.lineTo(pillX + pillW - pr, pillY);
  ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + pr);
  ctx.lineTo(pillX + pillW, pillY + pillH - pr);
  ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - pr, pillY + pillH);
  ctx.lineTo(pillX + pr, pillY + pillH);
  ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - pr);
  ctx.lineTo(pillX, pillY + pr);
  ctx.quadraticCurveTo(pillX, pillY, pillX + pr, pillY);
  ctx.closePath();
  ctx.fillStyle = "rgba(15,118,110,0.35)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(pillX + 18, pillY + pillH / 2, 7, 0, Math.PI * 2);
  ctx.fillStyle = "#22c55e";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(pillX + 15, pillY + pillH / 2 - 4);
  ctx.lineTo(pillX + 15, pillY + pillH / 2 + 4);
  ctx.lineTo(pillX + 20, pillY + pillH / 2);
  ctx.closePath();
  ctx.fillStyle = "#020617";
  ctx.fill();

  ctx.fillStyle = "#a7f3d0";
  ctx.font = "13px 'Segoe UI', sans-serif";
  ctx.fillText("LIVE SESSION", pillX + 34, pillY + 21);

  const coverSize = 310;
  const coverX = cardX + 40;
  const coverY = cardY + 150;

  const ringCx = coverX + coverSize / 2;
  const ringCy = coverY + coverSize / 2;
  const ringR = coverSize / 2 + 22;

  ctx.save();
  const ringGrad = ctx.createRadialGradient(ringCx, ringCy, 10, ringCx, ringCy, ringR);
  ringGrad.addColorStop(0, "rgba(34,197,94,0.35)");
  ringGrad.addColorStop(0.75, "rgba(56,189,248,0.05)");
  ringGrad.addColorStop(1, "rgba(15,23,42,0)");
  ctx.fillStyle = ringGrad;
  ctx.beginPath();
  ctx.arc(ringCx, ringCy, ringR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  const cr = 26;
  ctx.beginPath();
  ctx.moveTo(coverX + cr, coverY);
  ctx.lineTo(coverX + coverSize - cr, coverY);
  ctx.quadraticCurveTo(coverX + coverSize, coverY, coverX + coverSize, coverY + cr);
  ctx.lineTo(coverX + coverSize, coverY + coverSize - cr);
  ctx.quadraticCurveTo(coverX + coverSize, coverY + coverSize, coverX + coverSize - cr, coverY + coverSize);
  ctx.lineTo(coverX + cr, coverY + coverSize);
  ctx.quadraticCurveTo(coverX, coverY + coverSize, coverX, coverY + coverSize - cr);
  ctx.lineTo(coverX, coverY + cr);
  ctx.quadraticCurveTo(coverX, coverY, coverX + cr, coverY);
  ctx.closePath();
  ctx.clip();

  if (coverImg) {
    ctx.drawImage(coverImg, coverX, coverY, coverSize, coverSize);
  } else {
    const altGrad = ctx.createLinearGradient(coverX, coverY, coverX + coverSize, coverY + coverSize);
    altGrad.addColorStop(0, "#22c55e");
    altGrad.addColorStop(1, "#0ea5e9");
    ctx.fillStyle = altGrad;
    ctx.fillRect(coverX, coverY, coverSize, coverSize);
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(15,23,42,0.85)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(coverX, coverY + coverSize + 20);
  ctx.lineTo(coverX + coverSize, coverY + coverSize + 20);
  ctx.stroke();
  ctx.restore();

  const textX = coverX + coverSize + 60;
  const textY = coverY + 10;

  ctx.fillStyle = "#f9fafb";
  ctx.font = "bold 40px 'Segoe UI', sans-serif";
  const title = track.title || "Unknown Title";
  const maxTitleWidth = cardX + cardW - textX - 60;
  let shownTitle = title;
  if (ctx.measureText(title).width > maxTitleWidth) {
    while (ctx.measureText(shownTitle + "...").width > maxTitleWidth && shownTitle.length > 0) {
      shownTitle = shownTitle.slice(0, -1);
    }
    shownTitle += "...";
  }
  ctx.fillText(shownTitle, textX, textY + 10);

  ctx.fillStyle = "#e5e7eb";
  ctx.font = "bold 24px 'Segoe UI', sans-serif";
  const artist = track.artist || "Unknown Artist";
  ctx.fillText(artist, textX, textY + 48);

  const albumText = track.album || "";
  if (albumText) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = "18px 'Segoe UI', sans-serif";
    ctx.fillText(albumText, textX, textY + 76);
  }

  if (track.url) {
    const btnX = textX;
    const btnY = textY + 96;
    const btnW = 200;
    const btnH = 32;
    const br = 16;

    ctx.beginPath();
    ctx.moveTo(btnX + br, btnY);
    ctx.lineTo(btnX + btnW - br, btnY);
    ctx.quadraticCurveTo(btnX + btnW, btnY, btnX + btnW, btnY + br);
    ctx.lineTo(btnX + btnW, btnY + btnH - br);
    ctx.quadraticCurveTo(btnX + btnW, btnY + btnH, btnX + btnW - br, btnY + btnH);
    ctx.lineTo(btnX + br, btnY + btnH);
    ctx.quadraticCurveTo(btnX, btnY + btnH, btnX, btnY + btnH - br);
    ctx.lineTo(btnX, btnY + br);
    ctx.quadraticCurveTo(btnX, btnY, btnX + br, btnY);
    ctx.closePath();
    ctx.fillStyle = "rgba(15,118,110,0.32)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(btnX + 18, btnY + btnH / 2, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#22c55e";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(btnX + 15, btnY + btnH / 2 - 4);
    ctx.lineTo(btnX + 15, btnY + btnH / 2 + 4);
    ctx.lineTo(btnX + 20, btnY + btnH / 2);
    ctx.closePath();
    ctx.fillStyle = "#020617";
    ctx.fill();

    ctx.fillStyle = "#a7f3d0";
    ctx.font = "15px 'Segoe UI', sans-serif";
    ctx.fillText("Open in Spotify", btnX + 34, btnY + 22);
  }

  const totalSeconds = parseDurationToSeconds(track.duration);
  const totalText = totalSeconds ? formatTime(totalSeconds) : track.duration || "0:00";
  const currentSeconds = 0;
  const currentText = formatTime(currentSeconds);

  const barX = textX;
  const barY = cardY + cardH - 150;
  const barW = cardX + cardW - textX - 80;
  const barH = 10;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.moveTo(barX, barY + barH / 2);
  ctx.lineTo(barX + barW, barY + barH / 2);
  ctx.lineWidth = barH;
  ctx.strokeStyle = "#020617";
  ctx.stroke();
  ctx.restore();

  const progress = totalSeconds > 0 ? currentSeconds / totalSeconds : 0;
  const filledW = barW * progress;

  ctx.beginPath();
  ctx.moveTo(barX, barY + barH / 2);
  ctx.lineTo(barX + filledW, barY + barH / 2);
  ctx.lineWidth = barH;
  ctx.strokeStyle = "#22c55e";
  ctx.stroke();

  const knobX = barX + filledW;
  const knobY = barY + barH / 2;
  ctx.beginPath();
  ctx.arc(knobX, knobY, 11, 0, Math.PI * 2);
  ctx.fillStyle = "#22c55e";
  ctx.fill();

  ctx.fillStyle = "#94a3b8";
  ctx.font = "14px 'Segoe UI', sans-serif";
  ctx.fillText(currentText, barX, barY + 26);
  ctx.textAlign = "right";
  ctx.fillText(totalText, barX + barW, barY + 26);
  ctx.textAlign = "left";

  const ctrY = barY + 70;
  const centerX = textX + 120;

  ctx.fillStyle = "#e5e7eb";
  ctx.beginPath();
  ctx.moveTo(centerX - 60, ctrY);
  ctx.lineTo(centerX - 44, ctrY - 12);
  ctx.lineTo(centerX - 44, ctrY + 12);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(centerX + 60, ctrY);
  ctx.lineTo(centerX + 44, ctrY - 12);
  ctx.lineTo(centerX + 44, ctrY + 12);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(centerX, ctrY, 26, 0, Math.PI * 2);
  ctx.fillStyle = "#22c55e";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(centerX - 6, ctrY - 10);
  ctx.lineTo(centerX - 6, ctrY + 10);
  ctx.lineTo(centerX + 8, ctrY);
  ctx.closePath();
  ctx.fillStyle = "#020617";
  ctx.fill();

  const eqX = cardX + cardW - 80;
  const eqBaseY = cardY + cardH - 120;
  const bars = [
    { h: 34 },
    { h: 18 },
    { h: 26 },
    { h: 42 }
  ];
  bars.forEach((b, i) => {
    const bx = eqX + i * 10;
    ctx.fillStyle = "rgba(34,197,94,0.7)";
    ctx.fillRect(bx, eqBaseY - b.h, 6, b.h);
  });

  ctx.fillStyle = "#475569";
  ctx.font = "13px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  const footer = "Generated by VARESA MD • " + (track.generatedAt || "");
  ctx.fillText(footer, width / 2, height - 28);

  return canvas.toBuffer("image/png");
}