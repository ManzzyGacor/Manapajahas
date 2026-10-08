import os from "os";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { generateRuntimeCanvas } from "../../lib/canvas/runtime.js";

const Commands = ["runtime", "rt"];
const Description = "Menampilkan dashboard runtime sistem.";
const OnlyGroup = false;
const OnlyOwner = false;
const limitDeduction = 0;

const botStartTime = Date.now();

function getUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  seconds %= 86400;
  const h = Math.floor(seconds / 3600);
  seconds %= 3600;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

function getPlatformName() {
  const p = os.platform();
  if (p === "win32") return "Windows";
  if (p === "linux") return "Linux";
  if (p === "darwin") return "macOS";
  return p;
}

function formatGB(bytes) {
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function getDiskInfo() {
  try {
    if (os.platform() === "win32") {
      const stdout = execSync("wmic logicaldisk get size,freespace,caption").toString();
      const lines = stdout.trim().split("\n").filter((l) => l.trim());
      const diskData = lines.slice(1).map((line) => {
        const parts = line.trim().split(/\s+/);
        const drive = parts[0];
        const free = parseInt(parts[1] || "0", 10);
        const total = parseInt(parts[2] || "0", 10);
        const used = total - free;
        return { drive, total, free, used };
      });
      const d = diskData.find((x) => x.drive === "C:") || diskData[0];
      if (!d) return { totalBytes: 0, usedBytes: 0, freeBytes: 0 };
      return { totalBytes: d.total, usedBytes: d.used, freeBytes: d.free };
    } else {
      const out = execSync("df -k --output=size,used,avail / | tail -1").toString().trim();
      const parts = out.split(/\s+/);
      const totalKB = parseInt(parts[0] || "0", 10);
      const usedKB = parseInt(parts[1] || "0", 10);
      const freeKB = parseInt(parts[2] || "0", 10);
      return {
        totalBytes: totalKB * 1024,
        usedBytes: usedKB * 1024,
        freeBytes: freeKB * 1024
      };
    }
  } catch (e) {
    return { totalBytes: 0, usedBytes: 0, freeBytes: 0 };
  }
}

function getDbSizeMB() {
  let totalSize = 0;
  const folderPath = "./session";
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach((file) => {
      const filePath = path.join(folderPath, file);
      const stats = fs.statSync(filePath);
      if (stats.isFile()) totalSize += stats.size;
    });
  }
  return (totalSize / (1024 * 1024)).toFixed(2);
}

function formatPercent(val) {
  if (!isFinite(val)) return "0%";
  return `${val.toFixed(0)}%`;
}

function getNetworkUsage() {
  try {
    if (os.platform() !== "linux") {
      return { rxBytes: 0, txBytes: 0, iface: "N/A" };
    }
    const content = fs.readFileSync("/proc/net/dev").toString();
    const lines = content.split("\n").slice(2);
    let rx = 0;
    let tx = 0;
    let ifaceName = "N/A";
    lines.forEach((line) => {
      const parts = line.trim().split(/[:\s]+/).filter((v) => v.length > 0);
      if (parts.length < 10) return;
      const name = parts[0];
      if (name === "lo") return;
      const r = parseInt(parts[1] || "0", 10);
      const t = parseInt(parts[9] || "0", 10);
      rx += r;
      tx += t;
      if (ifaceName === "N/A") ifaceName = name;
    });
    return { rxBytes: rx, txBytes: tx, iface: ifaceName };
  } catch (e) {
    return { rxBytes: 0, txBytes: 0, iface: "N/A" };
  }
}

async function handle(sock, messageInfo) {
  const { remoteJid, message } = messageInfo;

  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, 15));
  const t1 = performance.now();
  const latencyMs = t1 - t0;
  const latencyText = latencyMs.toFixed(2) + " ms";

  const platformName = getPlatformName();
  const hostname = os.hostname();
  const cpuInfo = os.cpus()[0] || {};
  const cpuModel = cpuInfo.model || "Unknown CPU";
  const cpuCores = os.cpus().length;
  const load = os.loadavg()[0] || 0;
  const cpuPercent = Math.max(0, Math.min(100, (load / Math.max(1, cpuCores)) * 100));

  const totalRamBytes = os.totalmem();
  const freeRamBytes = os.freemem();
  const usedRamBytes = totalRamBytes - freeRamBytes;
  const memPercent = Math.max(0, Math.min(100, (usedRamBytes / totalRamBytes) * 100));

  const disk = getDiskInfo();
  const diskPercent = disk.totalBytes > 0 ? Math.max(0, Math.min(100, (disk.usedBytes / disk.totalBytes) * 100)) : 0;
  const freeDiskBytes = disk.freeBytes || (disk.totalBytes - disk.usedBytes);

  const totalDiskLabel = disk.totalBytes ? formatGB(disk.totalBytes) : "N/A";
  const usedDiskLabel = disk.usedBytes ? formatGB(disk.usedBytes) : "N/A";
  const freeDiskLabel = freeDiskBytes ? formatGB(freeDiskBytes) : "N/A";

  const totalRamLabel = formatGB(totalRamBytes);
  const usedRamLabel = formatGB(usedRamBytes);
  const freeRamLabel = formatGB(freeRamBytes);

  const vpsUptimeLabel = getUptime(os.uptime());
  const botUptimeLabel = getUptime((Date.now() - botStartTime) / 1000);

  const dbSizeLabel = getDbSizeMB() + " MB";

  const net = getNetworkUsage();
  const rxGB = net.rxBytes / (1024 * 1024 * 1024);
  const txGB = net.txBytes / (1024 * 1024 * 1024);
  const netRxText = rxGB > 0 ? rxGB.toFixed(2) + " GB" : "0 GB";
  const netTxText = txGB > 0 ? txGB.toFixed(2) + " GB" : "0 GB";
  const netTotalGB = rxGB + txGB;
  const netPercentValue = Math.max(0, Math.min(100, netTotalGB * 5));

  const stats = {
    latencyMs,
    latencyText,
    platformName,
    hostname,
    cpuModel,
    cpuCores,
    cpuSpeedText: cpuInfo.speed ? cpuInfo.speed + " MHz" : "",
    cpuPercent,
    totalRamLabel,
    usedRamLabel,
    freeRamLabel,
    memPercent,
    diskPercent,
    totalDiskLabel,
    usedDiskLabel,
    freeDiskLabel,
    netPercentValue,
    netRxText,
    netTxText,
    netInterface: net.iface,
    vpsUptimeLabel,
    botUptimeLabel,
    nodeVersion: process.version,
    osRelease: os.release(),
    dbSizeLabel,
    generatedAt: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
  };

  const buffer = await generateRuntimeCanvas(stats);

  const caption = `
*SYSTEM RUNTIME DASHBOARD – VARESA MD*

📡 Latency: ${latencyText}
🧠 CPU: ${formatPercent(stats.cpuPercent)}
💾 RAM: ${formatPercent(stats.memPercent)} (${usedRamLabel} / ${totalRamLabel})
🗄 Disk: ${formatPercent(stats.diskPercent)} (${usedDiskLabel} / ${totalDiskLabel})
🟢 Bot Uptime: ${botUptimeLabel}
⏱ Server Uptime: ${vpsUptimeLabel}
🌐 Network: RX ${netRxText} | TX ${netTxText}
📦 DB Size: ${dbSizeLabel}
`.trim();

  await sock.sendMessage(
    remoteJid,
    { image: buffer, caption },
    { quoted: message }
  );
}

export default {
  handle,
  Commands,
  Description,
  OnlyGroup,
  OnlyOwner,
  limitDeduction
};