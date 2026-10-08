import { createCanvas } from "canvas";

function drawRoundedRect(ctx, x, y, w, h, r) {
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

function drawGauge(ctx, cx, cy, radius, percent, colorBg, colorFg) {
  const value = Math.max(0, Math.min(1, percent / 100));
  const startAngle = Math.PI * 0.75;
  const endAngle = Math.PI * 2.25;

  ctx.save();
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.strokeStyle = colorBg;
  ctx.shadowColor = "rgba(0,0,0,0)";
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAngle, endAngle, false);
  ctx.stroke();
  ctx.restore();

  const sweep = startAngle + (endAngle - startAngle) * value;

  ctx.save();
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.strokeStyle = colorFg;
  ctx.shadowColor = colorFg;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAngle, sweep, false);
  ctx.stroke();
  ctx.restore();
}

function drawMainLogo(ctx) {
  ctx.save();
  ctx.translate(60, 58);
  ctx.rotate(Math.PI / 4);
  ctx.shadowColor = "rgba(56,189,248,0.9)";
  ctx.shadowBlur = 18;
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 4;
  ctx.strokeRect(-18, -18, 36, 36);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#0ea5e9";
  ctx.lineWidth = 2;
  ctx.strokeRect(-10, -10, 20, 20);
  ctx.restore();
}

function drawIcon(ctx, type, x, y) {
  if (type === "cpu") {
    ctx.save();
    drawRoundedRect(ctx, x, y, 26, 26, 6);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeRect(x + 7, y + 7, 12, 12);
    ctx.restore();
  } else if (type === "mem") {
    ctx.save();
    drawRoundedRect(ctx, x, y, 26, 26, 6);
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#22c55e";
    const bw = 3;
    const gap = 2;
    for (let i = 0; i < 4; i++) {
      const bx = x + 5 + i * (bw + gap);
      ctx.fillRect(bx, y + 6, bw, 14);
    }
    ctx.restore();
  } else if (type === "storage") {
    ctx.save();
    drawRoundedRect(ctx, x, y, 26, 26, 6);
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = "#a855f7";
    ctx.beginPath();
    ctx.arc(x + 13, y + 13, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 13, y + 13, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  } else if (type === "network") {
    ctx.save();
    drawRoundedRect(ctx, x, y, 26, 26, 6);
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = "#f97316";
    ctx.beginPath();
    ctx.arc(x + 13, y + 15, 3, Math.PI, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 13, y + 12, 6, Math.PI, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 13, y + 9, 9, Math.PI, 0);
    ctx.stroke();
    ctx.restore();
  } else if (type === "host") {
    ctx.save();
    drawRoundedRect(ctx, x, y, 26, 26, 6);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(x + 6, y + 8, 14, 6);
    ctx.fillRect(x + 6, y + 15, 14, 3);
    ctx.restore();
  } else if (type === "platform") {
    ctx.save();
    drawRoundedRect(ctx, x, y, 26, 26, 6);
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeRect(x + 6, y + 6, 14, 11);
    ctx.beginPath();
    ctx.moveTo(x + 9, y + 20);
    ctx.lineTo(x + 17, y + 20);
    ctx.stroke();
    ctx.restore();
  } else if (type === "bot") {
    ctx.save();
    drawRoundedRect(ctx, x, y, 26, 26, 6);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 13, y + 13, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 13, y + 13);
    ctx.lineTo(x + 13, y + 8);
    ctx.lineTo(x + 17, y + 13);
    ctx.stroke();
    ctx.restore();
  } else if (type === "server") {
    ctx.save();
    drawRoundedRect(ctx, x, y, 26, 26, 6);
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 13, y + 13, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 13, y + 13);
    ctx.lineTo(x + 13, y + 8);
    ctx.lineTo(x + 9, y + 13);
    ctx.stroke();
    ctx.restore();
  } else if (type === "node") {
    ctx.save();
    ctx.translate(x + 13, y + 13);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const px = Math.cos(angle) * 9;
      const py = Math.sin(angle) * 9;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}

export async function generateRuntimeCanvas(stats) {
  const width = 1400;
  const height = 760;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, "#020617");
  bgGrad.addColorStop(1, "#020617");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  const headerGrad = ctx.createLinearGradient(0, 0, width, 130);
  headerGrad.addColorStop(0, "#020617");
  headerGrad.addColorStop(1, "#020617");
  ctx.fillStyle = headerGrad;
  ctx.fillRect(0, 0, width, 130);

  drawMainLogo(ctx);

  ctx.fillStyle = "#e5e7eb";
  ctx.font = "bold 40px 'Segoe UI', Sans-serif";
  ctx.fillText("SYSTEM MONITOR", 95, 62);

  ctx.fillStyle = "#9ca3af";
  ctx.font = "14px 'Segoe UI', Sans-serif";
  ctx.fillText("Real-time Performance Dashboard", 95, 90);

  ctx.beginPath();
  ctx.moveTo(40, 112);
  ctx.lineTo(width - 40, 112);
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = "right";
  ctx.fillStyle = "#22c55e";
  ctx.font = "bold 26px 'Segoe UI', Sans-serif";
  ctx.fillText(stats.latencyText, width - 40, 55);

  ctx.fillStyle = "#64748b";
  ctx.font = "13px 'Segoe UI', Sans-serif";
  ctx.fillText("LATENCY", width - 40, 77);

  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 18px 'Segoe UI', Sans-serif";
  ctx.fillText("VARESA MD", width - 40, 100);

  ctx.textAlign = "left";

  const cardW = 310;
  const cardH = 210;
  const cardY = 140;
  const gap = 20;
  const baseX = 40;

  function drawCpuCard(index, percent) {
    const x = baseX + index * (cardW + gap);
    const y = cardY;

    ctx.save();
    ctx.shadowColor = "rgba(15,23,42,0.9)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    drawRoundedRect(ctx, x, y, cardW, cardH, 26);
    ctx.fillStyle = "rgba(15,23,42,0.97)";
    ctx.fill();
    ctx.restore();

    drawIcon(ctx, "cpu", x + 20, y + 18);

    ctx.fillStyle = "#e5e7eb";
    ctx.font = "bold 18px 'Segoe UI', Sans-serif";
    ctx.fillText("CPU USAGE", x + 54, y + 35);

    const cx = x + cardW / 2;
    const cy = y + 138;

    ctx.fillStyle = "#9ca3af";
    ctx.font = "13px 'Segoe UI', Sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(stats.cpuCores + " Cores", cx, y + 68);
    ctx.textAlign = "left";

    drawGauge(ctx, cx, cy, 52, percent, "#020617", "#38bdf8");

    const txt = isNaN(percent) ? "N/A" : Math.round(percent) + "%";
    const prevFont = ctx.font;
    const prevAlign = ctx.textAlign;
    const prevBase = ctx.textBaseline;
    ctx.fillStyle = "#e5e7eb";
    ctx.font = "bold 32px 'Segoe UI', Sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(txt, cx, cy);
    ctx.font = prevFont;
    ctx.textAlign = prevAlign;
    ctx.textBaseline = prevBase;

    ctx.fillStyle = "#64748b";
    ctx.font = "13px 'Segoe UI', Sans-serif";
    const cpuLine =
      stats.cpuModel && stats.cpuModel.length > 32
        ? stats.cpuModel.slice(0, 32) + "..."
        : stats.cpuModel;
    ctx.fillText(cpuLine || "", x + 22, y + cardH - 20);
  }

  function drawGenericCard(index, title, percent, colorFg, iconType, lines) {
    const x = baseX + index * (cardW + gap);
    const y = cardY;

    ctx.save();
    ctx.shadowColor = "rgba(15,23,42,0.9)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    drawRoundedRect(ctx, x, y, cardW, cardH, 26);
    ctx.fillStyle = "rgba(15,23,42,0.97)";
    ctx.fill();
    ctx.restore();

    drawIcon(ctx, iconType, x + 20, y + 18);

    ctx.fillStyle = "#e5e7eb";
    ctx.font = "bold 18px 'Segoe UI', Sans-serif";
    ctx.fillText(title, x + 54, y + 35);

    ctx.fillStyle = "#9ca3af";
    ctx.font = "13px 'Segoe UI', Sans-serif";
    let ly = y + 58;
    for (const t of lines) {
      if (t) {
        ctx.fillText(t, x + 22, ly);
        ly += 18;
      }
    }

    const cx = x + cardW / 2;
    const cy = y + 138;
    drawGauge(ctx, cx, cy, 52, percent, "#020617", colorFg);

    const txt = isNaN(percent) ? "N/A" : Math.round(percent) + "%";
    const prevFont = ctx.font;
    const prevAlign = ctx.textAlign;
    const prevBase = ctx.textBaseline;
    ctx.fillStyle = "#e5e7eb";
    ctx.font = "bold 32px 'Segoe UI', Sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(txt, cx, cy);
    ctx.font = prevFont;
    ctx.textAlign = prevAlign;
    ctx.textBaseline = prevBase;

    return { x, y, cx, cy };
  }

  drawCpuCard(0, stats.cpuPercent);

  const memLines = [
    "Total: " + stats.totalRamLabel,
    stats.usedRamLabel + " Used",
    stats.freeRamLabel + " Free"
  ];
  drawGenericCard(1, "MEMORY", stats.memPercent, "#22c55e", "mem", memLines);

  const diskLines = [
    "Total: " + stats.totalDiskLabel,
    stats.usedDiskLabel + " Used",
    stats.freeDiskLabel + " Free"
  ];
  drawGenericCard(2, "STORAGE", stats.diskPercent, "#a855f7", "storage", diskLines);

  const netCard = drawGenericCard(
    3,
    "NETWORK",
    stats.netPercentValue,
    "#f97316",
    "network",
    []
  );

  const netX = netCard.x;
  const netY = netCard.y;

  ctx.fillStyle = "#9ca3af";
  ctx.font = "13px 'Segoe UI', Sans-serif";
  ctx.fillText("Interface: " + stats.netInterface, netX + 22, netY + 60);

  ctx.fillStyle = "#9ca3af";
  ctx.fillText("RX (Download)", netX + 22, netY + 80);
  ctx.fillStyle = "#22d3ee";
  ctx.font = "bold 15px 'Segoe UI', Sans-serif";
  ctx.fillText(stats.netRxText, netX + 150, netY + 80);

  ctx.fillStyle = "#9ca3af";
  ctx.font = "13px 'Segoe UI', Sans-serif";
  ctx.fillText("TX (Upload)", netX + 22, netY + 100);
  ctx.fillStyle = "#f472b6";
  ctx.font = "bold 15px 'Segoe UI', Sans-serif";
  ctx.fillText(stats.netTxText, netX + 150, netY + 100);

  const midY = cardY + cardH + 26;
  const miniW = 250;
  const miniH = 70;

  function drawMini(index, label, value, iconType) {
    const x = baseX + index * (miniW + 18);
    const y = midY;

    ctx.save();
    ctx.shadowColor = "rgba(15,23,42,0.9)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    drawRoundedRect(ctx, x, y, miniW, miniH, 18);
    ctx.fillStyle = "rgba(15,23,42,0.98)";
    ctx.fill();
    ctx.restore();

    drawIcon(ctx, iconType, x + 16, y + 18);

    ctx.fillStyle = "#9ca3af";
    ctx.font = "12px 'Segoe UI', Sans-serif";
    ctx.fillText(label, x + 46, y + 22);

    ctx.fillStyle = "#e5e7eb";
    ctx.font = "bold 15px 'Segoe UI', Sans-serif";
    ctx.fillText(value, x + 46, y + 45);
  }

  drawMini(0, "HOSTNAME", stats.hostname, "host");
  drawMini(1, "PLATFORM", stats.platformName, "platform");
  drawMini(2, "BOT UPTIME", stats.botUptimeLabel, "bot");
  drawMini(3, "SERVER UPTIME", stats.vpsUptimeLabel, "server");
  drawMini(4, "NODE.JS", stats.nodeVersion, "node");

  const panelX = baseX;
  const panelY = midY + miniH + 30;
  const panelW = width - baseX * 2;
  const panelH = 210;

  ctx.save();
  ctx.shadowColor = "rgba(15,23,42,0.9)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 8;
  drawRoundedRect(ctx, panelX, panelY, panelW, panelH, 24);
  ctx.fillStyle = "rgba(15,23,42,0.99)";
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#e5e7eb";
  ctx.font = "bold 20px 'Segoe UI', Sans-serif";
  ctx.fillText("SYSTEM PERFORMANCE", panelX + 24, panelY + 34);

  ctx.fillStyle = "#64748b";
  ctx.font = "14px 'Segoe UI', Sans-serif";
  ctx.fillText("Real-time resource monitoring", panelX + 24, panelY + 57);

  function perfBar(order, label, percent, color, valueText) {
    const px = panelX + 24;
    const py = panelY + 84 + order * 28;
    const barW = panelW / 2.8;
    const barH = 10;

    ctx.fillStyle = "#9ca3af";
    ctx.font = "13px 'Segoe UI', Sans-serif";
    ctx.fillText(label, px, py - 2);

    ctx.save();
    drawRoundedRect(ctx, px + 140, py - 8, barW, barH, 5);
    ctx.fillStyle = "#020617";
    ctx.fill();
    ctx.restore();

    const val = Math.max(0, Math.min(1, percent / 100));
    const w2 = barW * val;

    ctx.save();
    drawRoundedRect(ctx, px + 140, py - 8, w2, barH, 5);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#e5e7eb";
    ctx.font = "13px 'Segoe UI', Sans-serif";
    ctx.fillText(valueText, px + 140 + barW + 12, py + 3);
  }

  perfBar(0, "CPU Load", stats.cpuPercent, "#38bdf8", Math.round(stats.cpuPercent) + "%");
  perfBar(1, "Memory Usage", stats.memPercent, "#22c55e", Math.round(stats.memPercent) + "%");
  perfBar(2, "Disk Usage", stats.diskPercent, "#a855f7", Math.round(stats.diskPercent) + "%");
  const latencyBarPercent = Math.min(100, stats.latencyMs / 5);
  const latencyLabelText = stats.latencyMs.toFixed(2) + " ms";
  perfBar(3, "Network Latency", latencyBarPercent, "#f97316", latencyLabelText);

  const infoX = panelX + panelW / 2 + 90;
  const infoY = panelY + 84;

  ctx.fillStyle = "#9ca3af";
  ctx.font = "14px 'Segoe UI', Sans-serif";
  ctx.fillText("OS Release", infoX, infoY);
  ctx.fillText("CPU Cores", infoX, infoY + 22);
  ctx.fillText("Total Memory", infoX, infoY + 44);
  ctx.fillText("Free Memory", infoX, infoY + 66);
  ctx.fillText("DB Size", infoX, infoY + 88);

  ctx.fillStyle = "#e5e7eb";
  ctx.font = "14px 'Segoe UI', Sans-serif";
  ctx.fillText(stats.osRelease, infoX + 140, infoY);
  ctx.fillText(String(stats.cpuCores), infoX + 140, infoY + 22);
  ctx.fillText(stats.totalRamLabel, infoX + 140, infoY + 44);
  ctx.fillText(stats.freeRamLabel, infoX + 140, infoY + 66);
  ctx.fillText(stats.dbSizeLabel, infoX + 140, infoY + 88);

  ctx.fillStyle = "#475569";
  ctx.font = "12px 'Segoe UI', Sans-serif";
  const footer = "Dashboard Generated: " + stats.generatedAt;
  const fw = ctx.measureText(footer).width;
  ctx.fillText(footer, width / 2 - fw / 2, height - 18);

  return canvas.toBuffer("image/png");
}