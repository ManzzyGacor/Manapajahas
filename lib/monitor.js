/**
 * lib/monitor.js — pusat pemantauan real-time Varesa.
 *
 * Isinya tiga hal yang ditampilkan di halaman depan, halaman status, dan
 * panel admin:
 *   1. Performa server (CPU, RAM, event-loop lag) — diambil tiap 5 detik.
 *   2. Lalu lintas & log command (nomor bot disensor untuk publik).
 *   3. Perkiraan kapasitas: berapa bot lagi yang masih muat di server ini.
 *
 * Antarmuka yang dipakai modul lain (JANGAN diubah tanda tangannya):
 *   recordTraffic({ bot, isGroup })                       -> per pesan masuk
 *   logCommand({ bot, command, isGroup, ok, ms, plugin }) -> per command selesai dijalankan
 *   maskNumber(number)                                    -> "6285xxxx026"
 *
 * Prinsip privasi: modul ini TIDAK PERNAH menyimpan isi pesan atau nomor
 * pengirim. Yang dicatat hanya nomor BOT (milik pelanggan kita sendiri,
 * disensor di endpoint publik), nama command, jenis chat, durasi, dan
 * berhasil/gagal.
 *
 * Kenapa CPU/RAM dibaca dari cgroup: aplikasi ini jalan di container
 * Pterodactyl (Docker). Di dalam container, os.cpus() dan os.totalmem()
 * melaporkan angka MESIN INDUK (mis. 64 core, 128 GB) — bukan jatah
 * container (mis. 2 core, 2 GB). Angka dari os.* saja akan membuat server
 * terlihat "selalu sepi" padahal jatahnya sudah hampir habis.
 *
 * Modul ini sengaja tidak mengimpor webserver.js (menghindari impor
 * sirkular). Hal yang butuh database (jumlah user, status DB) dan data
 * statistik per bot disuntikkan lewat configureMonitor().
 */
import fs from "fs";
import os from "os";
import path from "path";
import { monitorEventLoopDelay } from "perf_hooks";
import { sessions } from "./cache.js";
import { listJadibot } from "./jadibot.js";
import { getCapacitySettings, getServerName } from "./site-settings.js";

/* ------------------------------------------------------------------
   Konstanta
   ------------------------------------------------------------------ */
const SAMPLE_MS = 5000;          // jarak antar sampel performa
const HISTORY_MAX = 120;         // 120 x 5 detik = 10 menit grafik
const LOG_MAX = 200;             // log command yang disimpan di memori
const LOG_PERSIST = 50;          // yang ikut disimpan ke file (biar panel tidak kosong setelah restart)
const PUBLIC_LOG_MAX = 30;       // maksimal log per respons
const RATE_WINDOW_S = 10;        // jendela hitung pesan/detik
const PERSIST_MS = 60 * 1000;    // simpan penghitung tiap 1 menit
const SNAPSHOT_TTL_MS = 2000;    // cache respons live (dipolling tiap 3 detik oleh banyak tab)
const USERS_TTL_MS = 60 * 1000;  // hitung ulang jumlah user paling cepat tiap 1 menit
const USERS_STALE_MS = 10 * 60 * 1000;
const TOP_MAX_KEYS = 2000;       // batas jenis command per hari (perintah kustom bisa macam-macam)
const TOP_SHOWN = 6;
const ELD_RESOLUTION_MS = 20;

// Perkiraan awal sebelum ada pengukuran nyata di server ini.
const DEFAULT_BASELINE_MB = 160;  // RSS proses tanpa sesi bot sama sekali
const DEFAULT_PER_BOT_MB = 70;    // tambahan RSS rata-rata per sesi bot
const PER_BOT_MIN_MB = 35;
const PER_BOT_MAX_MB = 250;
const BOTS_PER_CORE = 25;
// ecosystem.config.cjs memasang max_memory_restart 1200M. Kalau RSS lewat
// batas itu PM2 me-restart proses (semua bot putus), jadi batas ini lebih
// penting daripada batas container.
const PM2_DEFAULT_CAP_MB = 1200;

// Asia/Jakarta = UTC+7 tanpa daylight saving, jadi cukup digeser tetap.
const JKT_OFFSET_MS = 7 * 3600 * 1000;

const RUNTIME_DIR = path.join(process.cwd(), "database", "runtime");
const STATE_FILE = path.join(RUNTIME_DIR, "monitor.json");

/* ------------------------------------------------------------------
   Util kecil
   ------------------------------------------------------------------ */
const round = (n, d = 1) => {
  const f = 10 ** d;
  return Math.round((Number(n) || 0) * f) / f;
};
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const MB = 1048576;

function readText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return null; }
}

function readNumber(file) {
  const t = readText(file);
  if (t === null || t === "" || t === "max") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function statField(text, key) {
  if (!text) return null;
  const m = new RegExp(`^${key}\\s+(\\d+)`, "m").exec(text);
  return m ? Number(m[1]) : null;
}

export function maskNumber(number) {
  const n = String(number || "").replace(/\D/g, "");
  if (n.length < 8) return n ? `${n.slice(0, 2)}xxxx` : "";
  return `${n.slice(0, 4)}xxxx${n.slice(-3)}`;
}

/** Kunci hari (YYYY-MM-DD) menurut waktu Jakarta. */
export function jakartaDayKey(ts = Date.now()) {
  return new Date(ts + JKT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Tengah malam Jakarta berikutnya, dalam ms dan ISO dengan offset +07:00. */
export function nextJakartaMidnight(ts = Date.now()) {
  const next = Date.parse(`${jakartaDayKey(ts)}T00:00:00+07:00`) + 86400000;
  return { ts: next, iso: `${jakartaDayKey(next)}T00:00:00+07:00` };
}

// Nama command dibersihkan: hanya huruf kecil, angka, dan _ + - . (titik
// untuk "api.text"). Mencegah teks bebas (bisa berisi data pribadi atau
// HTML) ikut tercatat dan tampil di halaman publik.
function sanitizeCommand(command) {
  const c = String(command || "")
    .toLowerCase()
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9_+.-]/g, "")
    .slice(0, 24);
  return c || "unknown";
}

/* ------------------------------------------------------------------
   Hook dari luar (disuntikkan webserver.js)
   ------------------------------------------------------------------ */
const hooks = {
  countUsers: null,   // async () => number
  isDbUp: null,       // () => boolean
  listBotStats: null, // () => [{ number, messages, commands, groups, lastActivity }]
};

export function configureMonitor({ countUsers, isDbUp, listBotStats } = {}) {
  if (typeof countUsers === "function") hooks.countUsers = countUsers;
  if (typeof isDbUp === "function") hooks.isDbUp = isDbUp;
  if (typeof listBotStats === "function") hooks.listBotStats = listBotStats;
  refreshUsers();
}

function dbUp() {
  try { return hooks.isDbUp ? !!hooks.isDbUp() : true; } catch { return false; }
}

/* ------------------------------------------------------------------
   Penghitung lalu lintas & command (disimpan ke file)
   ------------------------------------------------------------------ */
const state = {
  day: jakartaDayKey(),
  totalMessages: 0,
  totalCommands: 0,
  messagesToday: 0,
  commandsToday: 0,
  peakMsgPerSec: 0,
  top: new Map(),       // command -> jumlah hari ini
  lastId: 0,
  baselineMB: null,     // EWMA RSS saat 0 sesi
  perBotMB: null,       // EWMA tambahan RSS per sesi
};
const logs = []; // urutan lama -> baru; dipotong dari depan
let dirty = false;

// Ember per detik untuk menghitung pesan/detik dalam 10 detik terakhir
// tanpa menyimpan timestamp tiap pesan (hemat memori di grup ramai).
const bucketSec = new Array(RATE_WINDOW_S).fill(-1);
const bucketCount = new Array(RATE_WINDOW_S).fill(0);

function currentRate(nowSec = Math.floor(Date.now() / 1000)) {
  let sum = 0;
  for (let i = 0; i < RATE_WINDOW_S; i++) {
    if (bucketSec[i] >= 0 && nowSec - bucketSec[i] < RATE_WINDOW_S) sum += bucketCount[i];
  }
  return sum / RATE_WINDOW_S;
}

// Angka "hari ini" direset saat lewat tengah malam WIB. Dicek malas (saat
// ada aktivitas atau saat dibaca) supaya tidak perlu timer tersendiri.
function rollDay(now = Date.now()) {
  const day = jakartaDayKey(now);
  if (day === state.day) return;
  state.day = day;
  state.messagesToday = 0;
  state.commandsToday = 0;
  state.peakMsgPerSec = 0;
  state.top.clear();
  dirty = true;
}

export function recordTraffic({ bot, isGroup = false } = {}) { // eslint-disable-line no-unused-vars
  // Dipanggil untuk SETIAP pesan masuk: harus murah dan tidak boleh
  // melempar error ke pemroses pesan.
  try {
    const now = Date.now();
    rollDay(now);
    const sec = Math.floor(now / 1000);
    const i = sec % RATE_WINDOW_S;
    if (bucketSec[i] !== sec) { bucketSec[i] = sec; bucketCount[i] = 0; }
    bucketCount[i]++;
    state.totalMessages++;
    state.messagesToday++;
    const rate = currentRate(sec);
    if (rate > state.peakMsgPerSec) state.peakMsgPerSec = rate;
    dirty = true;
    ensurePersistence();
  } catch { /* statistik tidak boleh mengganggu bot */ }
}

export function logCommand({ bot, command, isGroup = false, ok = true, ms = 0, plugin = "" } = {}) { // eslint-disable-line no-unused-vars
  try {
    const now = Date.now();
    rollDay(now);
    const cmd = sanitizeCommand(command);
    const botFull = String(bot || "").replace(/\D/g, "").slice(0, 20);

    state.totalCommands++;
    state.commandsToday++;
    if (state.top.has(cmd) || state.top.size < TOP_MAX_KEYS) {
      state.top.set(cmd, (state.top.get(cmd) || 0) + 1);
    }

    const dur = Number(ms);
    logs.push({
      id: ++state.lastId,
      at: now,
      bot: maskNumber(botFull),
      botFull,
      cmd,
      chat: isGroup ? "group" : "private",
      ok: ok !== false,
      ms: Number.isFinite(dur) ? Math.round(clamp(dur, 0, 600000)) : 0,
    });
    if (logs.length > LOG_MAX) logs.splice(0, logs.length - LOG_MAX);
    dirty = true;
    ensurePersistence();
  } catch { /* idem */ }
}

function topCommands() {
  return [...state.top.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_SHOWN)
    .map(([cmd, count]) => ({ cmd, count }));
}

/* ------------------------------------------------------------------
   Simpan & muat penghitung
   ------------------------------------------------------------------ */
function loadState() {
  try {
    const raw = readText(STATE_FILE);
    if (!raw) return;
    const s = JSON.parse(raw);
    const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
    state.totalMessages = num(s.totalMessages);
    state.totalCommands = num(s.totalCommands);
    state.lastId = Math.floor(num(s.lastId));
    if (Number(s.baselineMB) > 0) state.baselineMB = Number(s.baselineMB);
    if (Number(s.perBotMB) > 0) state.perBotMB = Number(s.perBotMB);
    // Angka harian hanya dipulihkan kalau masih hari yang sama.
    if (s.day === state.day) {
      state.messagesToday = num(s.messagesToday);
      state.commandsToday = num(s.commandsToday);
      state.peakMsgPerSec = num(s.peakMsgPerSec);
      for (const [k, v] of Object.entries(s.top || {})) {
        if (state.top.size >= TOP_MAX_KEYS) break;
        state.top.set(sanitizeCommand(k), num(v));
      }
    }
    if (Array.isArray(s.logs)) {
      for (const l of s.logs.slice(-LOG_PERSIST)) {
        if (!l || !Number.isFinite(l.id) || l.id > state.lastId) continue;
        const botFull = String(l.botFull || "").replace(/\D/g, "").slice(0, 20);
        logs.push({
          id: l.id, at: Number(l.at) || 0, bot: maskNumber(botFull), botFull,
          cmd: sanitizeCommand(l.cmd), chat: l.chat === "group" ? "group" : "private",
          ok: l.ok !== false, ms: Math.round(num(l.ms)),
        });
      }
    }
  } catch (err) {
    console.error("[monitor] gagal memuat monitor.json (mulai dari nol):", err.message);
  }
}

export function flushMonitorState() {
  if (!dirty) return;
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    const data = {
      v: 1,
      savedAt: new Date().toISOString(),
      day: state.day,
      totalMessages: state.totalMessages,
      totalCommands: state.totalCommands,
      messagesToday: state.messagesToday,
      commandsToday: state.commandsToday,
      peakMsgPerSec: round(state.peakMsgPerSec, 2),
      top: Object.fromEntries(state.top),
      lastId: state.lastId,
      baselineMB: state.baselineMB ? round(state.baselineMB, 1) : null,
      perBotMB: state.perBotMB ? round(state.perBotMB, 1) : null,
      logs: logs.slice(-LOG_PERSIST),
    };
    // Tulis ke file sementara lalu rename, supaya file tidak pernah
    // setengah tertulis kalau proses dimatikan di tengah jalan.
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, STATE_FILE);
    dirty = false;
  } catch (err) {
    console.error("[monitor] gagal menyimpan monitor.json:", err.message);
  }
}

let persistTimer = null;
function ensurePersistence() {
  if (persistTimer) return;
  // unref: timer ini tidak boleh menahan proses tetap hidup (mis. saat
  // test atau saat semua pekerjaan lain sudah selesai).
  persistTimer = setInterval(flushMonitorState, PERSIST_MS);
  persistTimer.unref?.();
  // 'exit' terpicu juga oleh process.exit() di handler SIGTERM/SIGINT
  // index.js (PM2 restart / panel stop), jadi penghitung tidak hilang.
  // Sengaja TIDAK memasang listener SIGTERM sendiri: itu akan mengubah
  // perilaku default proses yang tidak memakai index.js.
  process.once("exit", flushMonitorState);
}

loadState();

/* ------------------------------------------------------------------
   Pembacaan sumber daya (container-aware)
   ------------------------------------------------------------------ */
const HOST_CORES = (typeof os.availableParallelism === "function" ? os.availableParallelism() : 0) || os.cpus().length || 1;

let coresCache = { at: 0, value: HOST_CORES };
// Jumlah core efektif = kuota CPU container (quota/period). Tanpa kuota,
// dipakai core yang terlihat proses ini.
function effectiveCores() {
  if (Date.now() - coresCache.at < 60000) return coresCache.value;
  let cores = HOST_CORES;
  const v2 = readText("/sys/fs/cgroup/cpu.max");
  if (v2) {
    const [q, p] = v2.split(/\s+/);
    if (q !== "max" && Number(q) > 0 && Number(p) > 0) cores = Math.min(HOST_CORES, Number(q) / Number(p));
  } else {
    const q = readNumber("/sys/fs/cgroup/cpu/cpu.cfs_quota_us") ?? readNumber("/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_quota_us");
    const p = readNumber("/sys/fs/cgroup/cpu/cpu.cfs_period_us") ?? readNumber("/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_period_us");
    if (q > 0 && p > 0) cores = Math.min(HOST_CORES, q / p);
  }
  coresCache = { at: Date.now(), value: Math.max(0.1, cores) };
  return coresCache.value;
}

// Pemakaian CPU kumulatif container. Urutan: cgroup v2 -> v1 -> os.cpus().
function readCpuCounter() {
  const v2 = statField(readText("/sys/fs/cgroup/cpu.stat"), "usage_usec");
  if (v2 !== null) return { src: "cgroup2", usageUs: v2 };
  const v1 = readNumber("/sys/fs/cgroup/cpuacct/cpuacct.usage") ?? readNumber("/sys/fs/cgroup/cpu,cpuacct/cpuacct.usage");
  if (v1 !== null) return { src: "cgroup1", usageUs: v1 / 1000 };
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { src: "os", idle, total };
}

// RAM container. Batas "max"/tidak masuk akal (lebih besar dari RAM mesin)
// berarti container tidak dibatasi -> pakai angka mesin.
function readMemory() {
  const hostTotal = os.totalmem();
  let used = null, limit = null, src = "host";

  const cur2 = readNumber("/sys/fs/cgroup/memory.current");
  if (cur2 !== null) {
    limit = readNumber("/sys/fs/cgroup/memory.max");
    const inactive = statField(readText("/sys/fs/cgroup/memory.stat"), "inactive_file") || 0;
    used = Math.max(0, cur2 - inactive);
    src = "cgroup2";
  } else {
    const cur1 = readNumber("/sys/fs/cgroup/memory/memory.usage_in_bytes");
    if (cur1 !== null) {
      limit = readNumber("/sys/fs/cgroup/memory/memory.limit_in_bytes");
      const stat = readText("/sys/fs/cgroup/memory/memory.stat");
      const inactive = statField(stat, "total_inactive_file") ?? statField(stat, "inactive_file") ?? 0;
      used = Math.max(0, cur1 - inactive);
      src = "cgroup1";
    }
  }

  // Page cache (inactive_file) sengaja dikurangkan — sama seperti
  // `docker stats` — karena kernel bisa membebaskannya kapan saja.
  if (!(limit > 32 * MB && limit < hostTotal) || used === null) {
    limit = hostTotal;
    used = hostTotal - os.freemem();
    src = "host";
  }
  return { usedMB: used / MB, limitMB: limit / MB, src };
}

let osNameCache = null;
function osName() {
  if (osNameCache) return osNameCache;
  const rel = readText("/etc/os-release");
  const m = rel && /^PRETTY_NAME="?([^"\n]+)"?/m.exec(rel);
  osNameCache = m ? m[1].trim() : `${os.type()} ${os.release()}`;
  return osNameCache;
}

let cpuModelCache = null;
function cpuModel() {
  if (cpuModelCache) return cpuModelCache;
  const m = os.cpus()[0]?.model || "";
  cpuModelCache = m.replace(/\(R\)|\(TM\)|CPU|@.*$/gi, "").replace(/\s+/g, " ").trim() || "Tidak diketahui";
  return cpuModelCache;
}

/* ------------------------------------------------------------------
   Sampler performa (tiap 5 detik)
   ------------------------------------------------------------------ */
const history = []; // { t, cpu, ram, mps } lama -> baru
let latest = null;  // sampel terakhir lengkap
let cpuPrev = null;
let sampler = null;
let eld = null;

function liveSessionCount() {
  // Socket di Map sessions = sesi yang tersambung ATAU sedang menyambung;
  // keduanya sudah memakan RAM.
  return sessions.size;
}

function ewma(prev, value, alpha) {
  return prev === null || prev === undefined ? value : prev + alpha * (value - prev);
}

function takeSample() {
  try {
    const nowNs = process.hrtime.bigint();
    const counter = readCpuCounter();
    const cores = effectiveCores();

    let cpu = latest?.cpuPercent ?? 0;
    let haveDelta = false;
    if (cpuPrev && cpuPrev.src === counter.src) {
      if (counter.src === "os") {
        const dIdle = counter.idle - cpuPrev.idle;
        const dTotal = counter.total - cpuPrev.total;
        if (dTotal > 0) { cpu = (1 - dIdle / dTotal) * 100; haveDelta = true; }
      } else {
        const elapsedUs = Number(nowNs - cpuPrev.ns) / 1000;
        if (elapsedUs > 0) {
          cpu = ((counter.usageUs - cpuPrev.usageUs) / (elapsedUs * cores)) * 100;
          haveDelta = true;
        }
      }
    }
    cpuPrev = { ...counter, ns: nowNs };
    cpu = clamp(Number.isFinite(cpu) ? cpu : 0, 0, 100);

    const mem = readMemory();
    const mu = process.memoryUsage();
    const rssMB = mu.rss / MB;

    let lag = 0;
    if (eld) {
      // Histogram mencatat jarak antar-tick timer internalnya, jadi rata-
      // ratanya sudah termasuk interval resolusi itu sendiri (±20 ms saat
      // loop santai). Yang disebut "lag" adalah kelebihannya.
      const mean = eld.mean / 1e6; // ns -> ms
      lag = Number.isFinite(mean) ? Math.max(0, mean - ELD_RESOLUTION_MS) : 0;
      eld.reset();
    }

    const mps = currentRate();
    const live = liveSessionCount();

    // Belajar pemakaian RAM nyata di server ini. Baseline hanya diukur saat
    // tidak ada sesi; per-bot diukur setelah proses agak tenang (2 menit)
    // supaya lonjakan saat start tidak dianggap pemakaian normal.
    if (live === 0) {
      state.baselineMB = clamp(ewma(state.baselineMB, rssMB, 0.1), 60, 400);
    } else if (process.uptime() > 120) {
      const base = state.baselineMB ?? DEFAULT_BASELINE_MB;
      const per = clamp((rssMB - base) / live, PER_BOT_MIN_MB, PER_BOT_MAX_MB);
      state.perBotMB = clamp(ewma(state.perBotMB, per, 0.05), PER_BOT_MIN_MB, PER_BOT_MAX_MB);
    }

    latest = {
      at: Date.now(),
      cpuPercent: cpu,
      cpuSrc: counter.src,
      cores,
      load1: os.loadavg()[0] || 0,
      usedMB: mem.usedMB,
      limitMB: mem.limitMB,
      ramPercent: mem.limitMB > 0 ? clamp((mem.usedMB / mem.limitMB) * 100, 0, 100) : 0,
      memSrc: mem.src,
      processMB: rssMB,
      heapMB: mu.heapUsed / MB,
      lagMs: lag,
      mps,
    };

    if (haveDelta) {
      history.push({ t: latest.at, cpu: round(cpu, 1), ram: round(latest.ramPercent, 1), mps: round(mps, 2) });
      if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);
    }
    dirty = true; // EWMA ikut disimpan
  } catch (err) {
    console.error("[monitor] gagal mengambil sampel:", err.message);
  }
  return latest;
}

/**
 * Mulai sampler. Aman dipanggil berkali-kali. Semua timer di-unref supaya
 * mengimpor/menjalankan monitor tidak menahan proses tetap hidup.
 */
export function startMonitor() {
  if (sampler) return;
  try {
    eld = monitorEventLoopDelay({ resolution: ELD_RESOLUTION_MS });
    eld.enable();
  } catch { eld = null; }
  takeSample(); // sampel pertama hanya untuk titik awal selisih CPU
  const first = setTimeout(takeSample, 1000);
  first.unref?.();
  sampler = setInterval(takeSample, SAMPLE_MS);
  sampler.unref?.();
  ensurePersistence();
}

export function stopMonitor() {
  if (sampler) clearInterval(sampler);
  sampler = null;
  try { eld?.disable(); } catch {}
  eld = null;
  if (persistTimer) clearInterval(persistTimer);
  persistTimer = null;
  process.removeListener("exit", flushMonitorState);
  flushMonitorState();
}

// Angka cadangan kalau sampel pertama pun gagal dibaca (mis. /proc tidak
// bisa diakses): endpoint tetap menjawab dengan angka mesin, bukan 500.
function fallbackPerf() {
  return {
    at: Date.now(), cpuPercent: 0, cpuSrc: "none", cores: HOST_CORES, load1: os.loadavg()[0] || 0,
    usedMB: (os.totalmem() - os.freemem()) / MB, limitMB: os.totalmem() / MB, ramPercent: 0,
    memSrc: "host", processMB: process.memoryUsage().rss / MB, heapMB: 0, lagMs: 0, mps: currentRate(),
  };
}

function perf() {
  if (!sampler) startMonitor();
  return latest || takeSample() || fallbackPerf();
}

/** Angka performa terakhir (sinkron, murah) — dipakai SSE & health log. */
export function getPerf() {
  const p = perf();
  return {
    cpuPercent: round(p?.cpuPercent, 1),
    cores: round(p?.cores, 2),
    ramPercent: round(p?.ramPercent, 1),
    ramUsedMB: Math.round(p?.usedMB || 0),
    ramLimitMB: Math.round(p?.limitMB || 0),
    processMB: Math.round(p?.processMB || 0),
    heapMB: Math.round(p?.heapMB || 0),
    lagMs: round(p?.lagMs, 1),
    msgPerSec: round(currentRate(), 2),
  };
}

/* ------------------------------------------------------------------
   Kapasitas
   ------------------------------------------------------------------ */
function pm2CapMB() {
  const env = Number(process.env.MAX_MEMORY_MB);
  if (Number.isFinite(env) && env > 0) return env;
  if (process.env.pm_id !== undefined) return PM2_DEFAULT_CAP_MB;
  return null;
}

const CAPACITY_NOTE = {
  memory: "Perkiraan dari RAM tersisa & rata-rata pemakaian per bot",
  cpu: `Dibatasi jumlah core CPU (±${BOTS_PER_CORE} bot per core)`,
  admin: "Batas maksimal bot ditetapkan admin",
};

const posNum = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

/**
 * RUMUS KAPASITAS BOT — fungsi murni: semua angka disuntikkan pemanggil,
 * jadi bisa diuji dengan batas container palsu tanpa server sungguhan.
 *
 *   batasRAM  = min(batas container/mesin, batas PM2 max_memory_restart)
 *   bisaPakai = batasRAM x (1 - cadangan%) - baseline
 *   kapRAM    = floor(bisaPakai / rata2PerBot)          (minimal 1)
 *   kapCPU    = floor(coreEfektif x 25)                 (minimal 1)
 *   kapAdmin  = settings.capacity.maxBots               (0 = otomatis, tidak ikut)
 *   max       = yang TERKECIL dari kapasitas yang berlaku
 *               (kalau seri: admin > memory > cpu)
 *   sisa      = max(0, max - sesiHidup)
 *   status    = full (sisa 0) | limited (sisa <= 10% max) | available
 *
 * Contoh: container 2048 MB, PM2 1200 MB, baseline 160 MB, 70 MB per bot,
 * cadangan 15%  ->  (1200 x 0,85 - 160) / 70 = 12,3  ->  12 bot.
 *
 * Kenapa batas PM2 ikut dihitung: kalau RSS melewati max_memory_restart,
 * PM2 me-restart proses dan SEMUA bot putus — itu batas yang benar-benar
 * berlaku, walaupun container sendiri masih punya sisa RAM.
 * Kenapa minimal 1: salah baca batas memori (mis. cgroup aneh) tidak boleh
 * membuat server menolak SEMUA bot.
 */
export function estimateCapacity({
  limitMB,
  pm2CapMB = null,
  baselineMB = DEFAULT_BASELINE_MB,
  perBotMB = DEFAULT_PER_BOT_MB,
  reservePercent = 15,
  cores = 1,
  maxBots = 0,
  used = 0,
} = {}) {
  const container = posNum(limitMB) ?? 0;
  const pm2 = posNum(pm2CapMB);
  const effLimit = pm2 && container ? Math.min(container, pm2) : (pm2 || container);
  const baseline = posNum(baselineMB) ?? DEFAULT_BASELINE_MB;
  const perBot = clamp(posNum(perBotMB) ?? DEFAULT_PER_BOT_MB, 1, Infinity);
  const reserve = clamp(Number(reservePercent) || 0, 0, 50);
  const adminCap = Math.max(0, Math.floor(Number(maxBots) || 0));

  const usable = effLimit * (1 - reserve / 100) - baseline;
  const memCap = Math.max(1, Math.floor(usable / perBot));
  const cpuCap = Math.max(1, Math.floor((posNum(cores) ?? 1) * BOTS_PER_CORE));

  const options = [];
  if (adminCap > 0) options.push({ basis: "admin", cap: adminCap });
  options.push({ basis: "memory", cap: memCap }, { basis: "cpu", cap: cpuCap });
  // Urutan di atas menentukan pemenang saat seri (admin didahulukan).
  const pick = options.reduce((a, b) => (b.cap < a.cap ? b : a));

  const max = pick.cap;
  const inUse = Math.max(0, Math.floor(Number(used) || 0));
  const remaining = Math.max(0, max - inUse);
  const status = remaining <= 0 ? "full" : remaining <= max * 0.1 ? "limited" : "available";

  return {
    max,
    used: inUse,
    remaining,
    percent: max > 0 ? round(clamp((inUse / max) * 100, 0, 100), 1) : 100,
    perBotMB: Math.round(perBot),
    basis: pick.basis,
    status,
    note: CAPACITY_NOTE[pick.basis],
    detail: {
      memCap, cpuCap, adminCap,
      limitMB: Math.round(effLimit),
      containerLimitMB: Math.round(container),
      pm2CapMB: pm2,
      baselineMB: Math.round(baseline),
      usableMB: Math.round(usable),
      reservePercent: reserve,
    },
  };
}

/** Kapasitas saat ini: rumus di atas + angka nyata dari server ini. */
export function getCapacity({ detail = false } = {}) {
  const p = perf();
  const { maxBots, reservePercent } = getCapacitySettings();
  const est = estimateCapacity({
    limitMB: p.limitMB,
    pm2CapMB: pm2CapMB(),
    baselineMB: state.baselineMB ?? DEFAULT_BASELINE_MB,
    perBotMB: state.perBotMB ?? DEFAULT_PER_BOT_MB,
    reservePercent,
    cores: p.cores,
    maxBots,
    used: liveSessionCount(),
  });

  const { detail: d, ...out } = est;
  if (detail) {
    out.detail = {
      ...d,
      cores: round(p.cores, 2),
      cpuSource: p.cpuSrc,
      memSource: p.memSrc,
      measured: { baseline: state.baselineMB !== null, perBot: state.perBotMB !== null },
    };
  }
  return out;
}

/**
 * Keputusan penjaga kapasitas untuk POST /api/bot/start (kontrak #5).
 *
 *  - Nomor yang sesinya MASIH ada di memori (online/menyambung) selalu
 *    boleh: restart tidak menambah beban RAM.
 *  - Masih ada sisa kapasitas -> boleh.
 *  - Penuh -> hanya admin yang boleh (penanganan darurat).
 *
 * `isAdmin` berupa fungsi (boleh async) supaya query database HANYA
 * dijalankan saat server benar-benar penuh — start normal tidak menambah
 * query apa pun. Kalau pengecekan admin gagal (mis. DB putus), dianggap
 * bukan admin: lebih aman menolak satu start daripada membuat RAM jebol.
 *
 * Hasil: { allowed, reason: "existing-session"|"available"|"admin"|"full", capacity? }
 */
export async function checkStartCapacity({ hasSession = false, capacity = null, isAdmin = null } = {}) {
  if (hasSession) return { allowed: true, reason: "existing-session" };
  const cap = capacity || getCapacity();
  if (cap.remaining > 0) return { allowed: true, reason: "available", capacity: cap };
  let admin = false;
  try {
    admin = typeof isAdmin === "function" ? !!(await isAdmin()) : !!isAdmin;
  } catch {
    admin = false;
  }
  return admin
    ? { allowed: true, reason: "admin", capacity: cap }
    : { allowed: false, reason: "full", capacity: cap };
}

/* ------------------------------------------------------------------
   Jumlah user (dari MongoDB, di-cache)
   ------------------------------------------------------------------ */
const usersCache = { value: null, at: 0, pending: false };

// Tidak pernah ditunggu oleh respons: nilai lama dipakai sambil hitungan
// baru berjalan di belakang. Query hanya dijalankan saat DB tersambung,
// supaya tidak menumpuk di antrean buffer mongoose saat DB putus.
function refreshUsers() {
  if (!hooks.countUsers || usersCache.pending) return;
  if (Date.now() - usersCache.at < USERS_TTL_MS && usersCache.value !== null) return;
  if (!dbUp()) return;
  usersCache.pending = true;
  Promise.resolve()
    .then(() => hooks.countUsers())
    .then((n) => {
      if (Number.isFinite(Number(n))) {
        usersCache.value = Number(n);
        usersCache.at = Date.now();
      }
    })
    .catch(() => {})
    .finally(() => { usersCache.pending = false; });
}

function usersValue() {
  refreshUsers();
  if (usersCache.value === null) return null;
  if (!dbUp() && Date.now() - usersCache.at > USERS_STALE_MS) return null;
  return usersCache.value;
}

/* ------------------------------------------------------------------
   Snapshot live (#1 / #2 di kontrak API)
   ------------------------------------------------------------------ */
function botStatsList() {
  try { return hooks.listBotStats ? hooks.listBotStats() || [] : []; } catch { return []; }
}

function serverStatus(p) {
  if (!dbUp()) return "degraded";
  if (p.cpuPercent > 85 || p.ramPercent > 90 || p.lagMs > 200) return "busy";
  return "operational";
}

async function buildBase() {
  const p = perf();
  rollDay();

  let online = 0, connecting = 0;
  const onlineNumbers = new Set();
  for (const [key, sock] of sessions.entries()) {
    if (sock?.user) {
      online++;
      onlineNumbers.add(String(key).replace("session-", ""));
    } else connecting++;
  }

  let registered = 0;
  try { registered = Object.keys((await listJadibot()) || {}).length; } catch {}

  // Jumlah grup hanya dari bot yang sedang online: angka bot yang mati
  // bisa sudah basi berhari-hari.
  let groups = 0;
  for (const s of botStatsList()) {
    if (onlineNumbers.has(String(s.number))) groups += Number(s.groups) || 0;
  }

  return {
    server: {
      name: getServerName(),
      host: process.env.WEB_HOST || "varesa.mom",
      region: process.env.SERVER_REGION || "Indonesia",
      cpu: { percent: round(p.cpuPercent, 1), cores: round(p.cores, 2), model: cpuModel(), load1: round(p.load1, 2) },
      ram: {
        usedMB: Math.round(p.usedMB),
        limitMB: Math.round(p.limitMB),
        percent: round(p.ramPercent, 1),
        processMB: Math.round(p.processMB),
      },
      heapMB: Math.round(p.heapMB),
      eventLoopLagMs: round(p.lagMs, 1),
      uptimeSec: Math.round(process.uptime()),
      os: osName(),
      node: process.version,
      status: serverStatus(p),
    },
    traffic: {
      msgPerSec: round(currentRate(), 2),
      peakMsgPerSec: round(state.peakMsgPerSec, 2),
      messagesToday: state.messagesToday,
      commandsToday: state.commandsToday,
      totalMessages: state.totalMessages,
      totalCommands: state.totalCommands,
      topCommands: topCommands(),
    },
    bots: { online, connecting, registered: Math.max(registered, online), groups },
    users: usersValue(),
  };
}

function cached(slot, ttl, build) {
  if (slot.value && Date.now() - slot.at < ttl) return Promise.resolve(slot.value);
  if (slot.promise) return slot.promise;
  slot.promise = build().then(
    (v) => { slot.value = v; slot.at = Date.now(); slot.promise = null; return v; },
    (err) => { slot.promise = null; throw err; }
  );
  return slot.promise;
}

const baseSlot = { value: null, at: 0, promise: null };
const perBotSlot = { value: null, at: 0, promise: null };
const capSlot = { value: null, at: 0, promise: null };

async function buildPerBot() {
  let jadibots = {};
  try { jadibots = (await listJadibot()) || {}; } catch {}
  const stats = new Map(botStatsList().map((s) => [String(s.number), s]));
  const numbers = new Set(Object.keys(jadibots));
  for (const key of sessions.keys()) {
    if (String(key).startsWith("session-")) numbers.add(String(key).slice(8));
  }
  const rows = [];
  for (const number of numbers) {
    const sock = sessions.get(`session-${number}`);
    const s = stats.get(number) || {};
    rows.push({
      number,
      online: !!sock?.user,
      connecting: !!sock && !sock.user,
      status: jadibots[number]?.status || (sock ? "connecting" : "stop"),
      messages: s.messages || 0,
      commands: s.commands || 0,
      groups: s.groups || 0,
      lastActivity: s.lastActivity || null,
    });
  }
  rows.sort((a, b) => Number(b.online) - Number(a.online) || b.messages - a.messages);
  return rows;
}

function selectLogs(since, admin) {
  let from = Number.parseInt(since, 10);
  // ID di depan lastId berarti klien membawa ID dari sebelum data monitor
  // di-reset — kirim saja log terbaru daripada diam selamanya.
  if (!Number.isFinite(from) || from < 0 || from > state.lastId) from = null;
  const out = [];
  for (let i = logs.length - 1; i >= 0 && out.length < PUBLIC_LOG_MAX; i--) {
    const l = logs[i];
    if (from !== null && l.id <= from) break;
    out.push(admin
      ? { ...l }
      : { id: l.id, at: l.at, bot: l.bot, cmd: l.cmd, chat: l.chat, ok: l.ok, ms: l.ms });
  }
  return out;
}

/**
 * Respons /api/public/live dan /api/admin/live.
 * Bagian yang agak mahal di-cache 2 detik; log & riwayat dipotong per
 * permintaan (murah: array di memori maksimal 200/120 elemen).
 */
export async function getLiveSnapshot({ since = null, history: withHistory = false, admin = false } = {}) {
  const base = await cached(baseSlot, SNAPSHOT_TTL_MS, buildBase);
  const capacity = await cached(capSlot, SNAPSHOT_TTL_MS, async () => getCapacity({ detail: true }));

  const { detail, ...capPublic } = capacity;
  const out = {
    success: true,
    now: Date.now(),
    server: base.server,
    traffic: base.traffic,
    bots: base.bots,
    users: base.users,
    capacity: admin ? { ...capPublic, detail } : capPublic,
    logs: selectLogs(since, admin),
    lastId: state.lastId,
  };
  if (withHistory) out.history = history.slice();
  if (admin) out.perBot = await cached(perBotSlot, SNAPSHOT_TTL_MS, buildPerBot);
  return out;
}

/**
 * Buang cache snapshot (mis. setelah admin mengubah nama server atau batas
 * kapasitas) supaya perubahan langsung terlihat, tidak menunggu 2 detik.
 */
export function invalidateLiveCache() {
  baseSlot.value = null;
  capSlot.value = null;
  perBotSlot.value = null;
}

/** Ringkasan untuk /healthz & /api/status. */
export function getMonitorSummary() {
  const p = getPerf();
  const c = getCapacity();
  return {
    cpuPercent: p.cpuPercent,
    ramPercent: p.ramPercent,
    lagMs: p.lagMs,
    capacity: { max: c.max, used: c.used, remaining: c.remaining, status: c.status, basis: c.basis },
  };
}

export default {
  maskNumber,
  recordTraffic,
  logCommand,
  configureMonitor,
  startMonitor,
  stopMonitor,
  getPerf,
  getCapacity,
  estimateCapacity,
  checkStartCapacity,
  getLiveSnapshot,
  getMonitorSummary,
  invalidateLiveCache,
  flushMonitorState,
  jakartaDayKey,
  nextJakartaMidnight,
};
