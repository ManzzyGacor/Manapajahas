/**
 * lib/health.js — pengecekan kesehatan fitur otomatis (auto-disable).
 *
 * Masalah yang diselesaikan: banyak plugin (downloader, AI, MLBB) bergantung
 * pada API pihak ketiga yang sering mati. Sebelum ini, satu-satunya cara tahu
 * adalah laporan user. Sekarang server mengetes sendiri command-command itu
 * secara berkala; kalau rusak, command OTOMATIS dinonaktifkan dengan pesan
 * "fitur sedang perbaikan" dan pemilik bot dapat laporan.
 *
 * Tiga sumber sinyal:
 *   1. PROAKTIF — probe HTTP berkala ke endpoint API yang dideklarasikan di
 *      lib/health-providers.js (atau di plugin lewat `export const health`).
 *   2. REAKTIF — hasil eksekusi nyata tiap command (autoresbot.js memanggil
 *      recordCommandResult setiap command selesai). Jadi walau probe lolos,
 *      command yang benar-benar gagal berulang tetap tercatat dan dinonaktifkan.
 *   3. MANUAL — admin dapat menonaktifkan/mengaktifkan satu command dari
 *      halaman "Error plugin" di dashboard.
 *
 * Aturan penting soal kapan fitur dianggap RUSAK:
 *   Banyak plugin punya rantai cadangan (mis. .tiktok memakai TikWM, lalu
 *   jatuh ke Botcahx kalau TikWM gagal). Fitur seperti itu baru dianggap
 *   rusak kalau SEMUA jalurnya gagal — bukan hanya jalur pertama. Karena itu
 *   satu command menyimpan DAFTAR probe (`probes`) dan sehat bila salah satu
 *   lolos.
 *
 * Data disimpan di database/runtime/health.json (di luar git). Modul ini tidak
 * pernah menyimpan isi pesan atau nomor pengguna. Ketergantungannya sengaja
 * dibatasi pada modul bawaan Node + berkas statis, supaya bisa diuji sendirian
 * lewat `node tools/health-probe.js` tanpa `npm install`.
 */
import fs from "fs";
import path from "path";
import { PROVIDERS, matchProviders, collectSource } from "./health-providers.js";

/* ------------------------------------------------------------------
   Konstanta
   ------------------------------------------------------------------ */
const RUNTIME_DIR = path.join(process.cwd(), "database", "runtime");
const STATE_FILE = path.join(RUNTIME_DIR, "health.json");

// Asia/Jakarta = UTC+7 tanpa daylight saving.
const JKT_OFFSET_MS = 7 * 3600 * 1000;
/** Kunci hari (YYYY-MM-DD) menurut waktu Jakarta. */
function jakartaDayKey(ts = Date.now()) {
  return new Date(ts + JKT_OFFSET_MS).toISOString().slice(0, 10);
}

// Kunci API dibaca langsung dari environment (bukan config.js) supaya modul
// ini bisa dites sendirian. Nama & nilai bawaannya sama dengan config.js.
const API_KEYS = {
  APIKEY: () => process.env.AUTORESBOT_APIKEY || "",
  ANABOT_APIKEY: () => process.env.ANABOT_APIKEY || "",
  APIBOTCAHX: () => process.env.APIBOTCAHX || "Varesa",
  JEREXD_APIKEY: () => process.env.JEREXD_APIKEY || "VaresaMD",
};

const PROBE_INTERVAL_MS = 30 * 60 * 1000; // sapu semua probe tiap 30 menit
const FIRST_PROBE_DELAY_MS = 2 * 60 * 1000; // jeda awal setelah startup
const PROBE_TIMEOUT_MS = 20000;
// Percobaan ulang untuk kegagalan yang bersifat sementara. Tanpa ini, satu
// gangguan jaringan sekejap sudah dihitung sebagai "API rusak" — tiga kali
// seperti itu (dalam 30 menit) cukup untuk menonaktifkan fitur yang sehat.
const PROBE_RETRY = 1;
const PROBE_RETRY_DELAY_MS = 1200;
const PROBE_CONCURRENCY = 6; // jangan membanjiri jaringan/DNS sekaligus

// Ambang "rusak": tiga kali gagal berurutan (dari probe atau eksekusi nyata).
const FAIL_THRESHOLD = 3;
// Lama command dinonaktifkan otomatis sebelum diuji ulang. Kalau tetap
// gagal, langsung dinonaktifkan lagi tanpa perlu 3 kegagalan baru.
const DISABLE_MS = 30 * 60 * 1000;
// Statistik kegagalan disimpan paling lama ini.
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
// Batas jumlah command yang dilacak (perintah kustom pengguna bisa banyak).
const MAX_ENTRIES = 800;

/* ------------------------------------------------------------------
   State
   ------------------------------------------------------------------ */
const state = {
  day: jakartaDayKey(),
  commands: new Map(), // command -> entri
};

let dirty = false;
let persistTimer = null;
let probeTimer = null;
let probeRunning = false;
let getPlugins = () => [];
let notifier = null; // dipasang autoresbot.js: async (teks) => void
const notifiedAt = new Map(); // command -> timestamp laporan terakhir

/* ------------------------------------------------------------------
   Helper
   ------------------------------------------------------------------ */
const now = () => Date.now();
const cmdKey = (c) => String(c || "").trim().toLowerCase().slice(0, 32);

function blankEntry(command) {
  return {
    command,
    plugin: "",
    label: "",
    // Daftar probe (endpoint API) milik command ini. Kosong = tidak bisa
    // dites berdiri sendiri; hanya statistiknya yang dilacak.
    probes: [],
    providers: [],
    // Statistik kegagalan
    failsToday: 0,
    failTotal: 0,
    okToday: 0,
    streak: 0, // kegagalan berurutan
    lastError: "",
    lastErrorAt: 0,
    // Sehat/rusak
    disabledUntil: 0,
    disabledReason: "",
    disabledBy: "", // "auto" | "admin"
    lastProbeAt: 0,
    lastProbeMs: 0,
    lastProbeError: "",
  };
}

function entry(command) {
  const key = cmdKey(command);
  if (!key) return null;
  let e = state.commands.get(key);
  if (!e) {
    if (state.commands.size >= MAX_ENTRIES) return null;
    e = blankEntry(key);
    state.commands.set(key, e);
  }
  return e;
}

/** Apakah command sedang dinonaktifkan (otomatis maupun oleh admin)? */
export function isCommandDisabled(command) {
  const e = state.commands.get(cmdKey(command));
  if (!e || !e.disabledUntil) return null;
  if (e.disabledUntil > now()) {
    return { reason: e.disabledReason || "sedang perbaikan", by: e.disabledBy || "auto" };
  }
  // Masa nonaktif habis: buka lagi supaya bisa diuji ulang.
  e.disabledUntil = 0;
  e.disabledReason = "";
  e.disabledBy = "";
  e.streak = 0;
  dirty = true;
  return null;
}

/* ------------------------------------------------------------------
   Normalisasi probe
   ------------------------------------------------------------------ */
function normalizeProbe(p) {
  if (!p || typeof p !== "object" || typeof p.url !== "string") return null;
  // Placeholder kunci API: {APIKEY} (autoresbot), {JEREXD_APIKEY},
  // {APIBOTCAHX}, {ANABOT_APIKEY}. Isinya diambil dari environment SAAT
  // PROBE DIJALANKAN, supaya kunci tidak pernah ditulis di file plugin.
  const url = p.url.replace(/\{(APIKEY|ANABOT_APIKEY|JEREXD_APIKEY|APIBOTCAHX)\}/g, (_, k) =>
    encodeURIComponent(String((API_KEYS[k] && API_KEYS[k]()) || ""))
  );
  if (!/^https?:\/\//i.test(url)) return null;
  const expect = Array.isArray(p.expect)
    ? p.expect.map((n) => Number(n)).filter((n) => Number.isInteger(n))
    : [200];
  return {
    url: url.slice(0, 2000),
    method: String(p.method || "GET").toUpperCase() === "POST" ? "POST" : "GET",
    body: typeof p.body === "string" ? p.body.slice(0, 4000) : "",
    headers: p.headers && typeof p.headers === "object" ? p.headers : null,
    // Status yang dianggap "sehat". API dengan parameter contoh wajar menjawab
    // 400/401/403/404 (kunci belum diisi) — itu tetap sehat. Yang menandakan
    // MATI adalah timeout, DNS gagal, 5xx, atau halaman gangguan Cloudflare.
    expect: expect.length ? expect : [200],
    bodyPattern: typeof p.bodyPattern === "string" ? p.bodyPattern.slice(0, 200) : "",
    bodyPatternFail: typeof p.bodyPatternFail === "string" ? p.bodyPatternFail.slice(0, 200) : "",
  };
}

/** Semua probe milik satu provider (probe utama + endpoint uji cadangan). */
function probesOfProvider(prov) {
  if (!prov) return [];
  const out = [];
  const utama = normalizeProbe(prov.probe);
  if (utama) out.push({ ...utama, provider: prov.id });
  for (const u of Array.isArray(prov.probeUlang) ? prov.probeUlang : []) {
    const p = normalizeProbe(typeof u === "string" ? { ...prov.probe, url: u } : u);
    if (p) out.push({ ...p, provider: prov.id });
  }
  return out;
}

/* ------------------------------------------------------------------
   Sinkronisasi dari plugin
   ------------------------------------------------------------------ */
/**
 * Kumpulkan data kesehatan dari plugin yang sudah dimuat.
 *
 * Dua sumber, digabung:
 *  1. Deklarasi eksplisit: `export const health = { label, probe }` di plugin.
 *  2. Tabel provider API (lib/health-providers.js): kalau plugin (atau modul
 *     lokal yang diimpornya) memakai salah satu API yang dikenal, pengecekan
 *     API itu otomatis ditempelkan — TANPA menyentuh file plugin.
 *
 * @param {Array} plugins daftar plugin yang dimuat (punya Commands & __file)
 * @param {Function} readSource (opsional) pembaca isi berkas plugin
 */
export function syncFromPlugins(plugins = [], readSource = null) {
  const seen = new Set();
  for (const p of plugins) {
    const cmds = Array.isArray(p?.Commands) ? p.Commands : [];
    const h = p?.health && typeof p.health === "object" ? p.health : null;
    const berkas = p.__file ? String(p.__file).replace(/^plugins[\\/]/, "") : "";

    // Isi berkas plugin sendiri untuk mencocokkan provider API.
    //
    // SENGAJA hanya berkas plugin, bukan modul bersama yang diimpornya
    // (lib/utils.js dsb): hampir semua plugin mengimpor lib/utils.js, dan di
    // sana ada satu url api.autoresbot.com — kalau impor ikut ditelusuri,
    // SELURUH 500+ command akan dianggap "butuh autoresbot" dan bisa
    // dinonaktifkan beramai-ramai hanya karena satu API rusak. Yang dinilai
    // harus benar-benar API yang disebut plugin itu sendiri.
    let src = typeof p.__source === "string" ? p.__source : "";
    if (!src && readSource && p.__file) {
      try { src = readSource(p.__file) || ""; } catch { src = ""; }
    }

    const ketemu = src ? matchProviders(src) : [];
    const providerIds = [...new Set(ketemu.map((x) => x.id))];
    // Probe eksplisit di plugin menang; kalau tidak ada, pakai tabel provider.
    const probeEksplisit = h?.probe ? normalizeProbe(h.probe) : null;
    const probes = [];
    if (probeEksplisit) probes.push({ ...probeEksplisit, provider: "khusus" });
    for (const prov of ketemu) {
      for (const pr of probesOfProvider(prov)) {
        if (!probes.some((x) => x.url === pr.url && x.method === pr.method)) probes.push(pr);
      }
    }

    for (const raw of cmds) {
      const key = cmdKey(raw);
      if (!key) continue;
      seen.add(key);
      const e = entry(key);
      if (!e) continue;
      e.plugin = berkas || (p.Name || "");
      e.probes = probes;
      e.providers = providerIds;
      e.label =
        (typeof h?.label === "string" && h.label.slice(0, 60)) ||
        (ketemu[0] ? ketemu[0].label : "");
    }
  }
  // Entri lama tanpa plugin (mis. perintah kustom) dibiarkan; mereka tetap
  // dilacak dari kegagalan nyata.
  dirty = true;
  return seen.size;
}

/* ------------------------------------------------------------------
   Probe HTTP
   ------------------------------------------------------------------ */
/** Satu percobaan HTTP untuk sebuah probe. */
async function probeSekali(probe, fetchImpl) {
  const t0 = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(probe.url, {
      method: probe.method,
      headers: { "user-agent": "Mozilla/5.0 (compatible; VaresaHealth/1.0)", ...(probe.headers || {}) },
      body: probe.method === "POST" ? (probe.body || "") : undefined,
      signal: controller.signal,
      redirect: "follow",
    });
    const status = res.status;
    let ok = probe.expect.includes(status);
    // Body diperiksa kalau ada pola yang harus muncul ATAU pola yang
    // menandakan gangguan (mis. halaman "Just a moment" Cloudflare).
    if (ok && (probe.bodyPattern || probe.bodyPatternFail)) {
      const teks = await res.text().catch(() => "");
      if (probe.bodyPatternFail && new RegExp(probe.bodyPatternFail, "i").test(teks)) {
        return { ok: false, ms: now() - t0, error: "endpoint menjawab gangguan (bukan jawaban aplikasi)" };
      }
      if (probe.bodyPattern) ok = new RegExp(probe.bodyPattern, "i").test(teks);
      if (!ok) return { ok: false, ms: now() - t0, error: "respons tidak sesuai harapan" };
    } else {
      // Body tidak dipakai: dibuang supaya koneksi tidak menggantung.
      try { res.body?.cancel?.()?.catch?.(() => {}); } catch { /* abaikan */ }
    }
    return { ok, ms: now() - t0 };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      ok: false,
      ms: now() - t0,
      error: aborted ? "timeout" : (err?.message || "gagal terhubung"),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe dengan satu percobaan ulang. Kegagalan SEMENTARA (timeout sekejap,
 * DNS tersendat, 5xx dari proxy) tidak langsung dihitung sebagai API rusak.
 */
async function probeOnce(probe, fetchImpl) {
  let hasil = await probeSekali(probe, fetchImpl);
  for (let i = 0; i < PROBE_RETRY && !hasil.ok; i++) {
    await new Promise((r) => setTimeout(r, PROBE_RETRY_DELAY_MS).unref?.());
    const ulang = await probeSekali(probe, fetchImpl);
    hasil = { ...ulang, ms: hasil.ms + ulang.ms };
  }
  return hasil;
}

/**
 * Jalankan semua probe satu command. Sehat kalau SALAH SATU jalur lolos —
 * inilah yang membuat fitur dengan rantai cadangan tidak ikut dimatikan
 * hanya karena sumber pertamanya sedang tumbang.
 */
async function probeCommand(e, fetchImpl, cache) {
  if (!e.probes.length) return { skipped: true };
  const t0 = now();
  let gagalTerakhir = null;
  for (const pr of e.probes) {
    // Satu URL hanya dihubungi sekali per sapuan (banyak command berbagi API
    // yang sama), lalu hasilnya dipakai ulang.
    const kunci = `${pr.method} ${pr.url}`;
    let hasil = cache?.get(kunci);
    if (!hasil) {
      hasil = await probeOnce(pr, fetchImpl);
      cache?.set(kunci, hasil);
    }
    if (hasil.ok) return { ok: true, ms: now() - t0 };
    gagalTerakhir = hasil;
  }
  return { ok: false, ms: now() - t0, error: gagalTerakhir?.error || "semua jalur gagal" };
}

/* ------------------------------------------------------------------
   Penilaian sehat/rusak
   ------------------------------------------------------------------ */
function applyResult(e, ok, { ms = 0, error = "" } = {}) {
  rollDay();
  if (ok) {
    e.okToday++;
    e.streak = 0;
    if (e.disabledUntil && e.disabledBy === "auto") {
      // Sembuh sendiri: aktifkan kembali tanpa menunggu admin.
      e.disabledUntil = 0;
      e.disabledReason = "";
      e.disabledBy = "";
      dirty = true;
    }
    return;
  }
  // Kegagalan
  e.failsToday++;
  e.failTotal++;
  e.streak++;
  e.lastError = String(error || "gagal").slice(0, 200);
  e.lastErrorAt = now();
  dirty = true;

  if (e.disabledUntil && e.disabledUntil > now()) return; // sudah nonaktif
  // Command tanpa probe TIDAK pernah dinonaktifkan otomatis: pesan galatnya
  // bisa datang dari input user yang salah, bukan API yang mati. Statistiknya
  // tetap tampil di halaman "Error plugin".
  if (!e.probes.length && e.disabledBy !== "admin") return;
  if (e.streak >= FAIL_THRESHOLD) {
    e.disabledUntil = now() + DISABLE_MS;
    e.disabledReason = e.lastError;
    e.disabledBy = "auto";
    laporKePemilik(e);
  }
}

/** Catat hasil eksekusi command dari pemakaian nyata (setiap bot). */
export function recordCommandResult({ command, ok = true, ms = 0, error = "" } = {}) {
  try {
    const e = entry(command);
    if (!e) return;
    applyResult(e, ok !== false, { ms, error });
  } catch {
    /* statistik tidak boleh mengganggu pemrosesan pesan */
  }
}

/* ------------------------------------------------------------------
   Laporan ke pemilik
   ------------------------------------------------------------------ */
async function laporKePemilik(e) {
  if (!notifier) return;
  const t = now();
  if (t - (notifiedAt.get(e.command) || 0) < DISABLE_MS) return; // anti-banjir
  notifiedAt.set(e.command, t);
  const nama = e.label || e.plugin || e.command;
  const teks =
    `🔧 *LAPORAN FITUR*\n\n` +
    `Fitur *${e.command}* (${nama}) dinonaktifkan sementara.\n` +
    `Alasan: ${e.lastError || "API luar tidak merespons"} (${e.streak}x gagal berturut-turut).\n\n` +
    `Bot akan mengetes ulang otomatis dalam ${Math.round(DISABLE_MS / 60000)} menit. ` +
    `Rinciannya ada di dashboard admin → Error Plugin.`;
  try {
    await notifier(teks);
  } catch (err) {
    console.error("[health] gagal kirim laporan:", err?.message || err);
  }
}

/** Dipasang autoresbot.js — fungsi pengirim pesan ke owner utama. */
export function setNotifier(fn) {
  notifier = typeof fn === "function" ? fn : null;
}

/* ------------------------------------------------------------------
   Reset harian
   ------------------------------------------------------------------ */
function rollDay() {
  const day = jakartaDayKey();
  if (day === state.day) return;
  state.day = day;
  for (const e of [...state.commands.values()]) {
    e.failsToday = 0;
    e.okToday = 0;
    // Statistik lama yang sudah tidak dipakai dibuang supaya file tetap kecil.
    if (e.failTotal === 0 && !e.disabledUntil && now() - (e.lastProbeAt || 0) > KEEP_MS) {
      state.commands.delete(e.command);
    }
  }
  dirty = true;
}

/* ------------------------------------------------------------------
   Penjadwalan probe
   ------------------------------------------------------------------ */
/**
 * Jalankan probe untuk semua command (atau satu command saja).
 * Setiap URL unik hanya dihubungi sekali per sapuan.
 */
export async function runHealthChecks({ only = null, fetchImpl, plugins = null } = {}) {
  if (probeRunning) return { skipped: true };
  probeRunning = true;
  try {
    const f = fetchImpl || globalThis.fetch;
    if (typeof f !== "function") return { skipped: true, error: "fetch tidak tersedia" };

    // Segarkan daftar command dari plugin dulu, supaya plugin yang baru
    // dimuat/diubah ikut terpantau.
    if (Array.isArray(plugins) && plugins.length) syncFromPlugins(plugins);

    const targets = [...state.commands.values()].filter(
      (e) => e.probes.length && (!only || cmdKey(only) === e.command)
    );
    const cache = new Map(); // "METHOD url" -> hasil, per sapuan
    const hasil = { diperiksa: 0, sehat: 0, rusak: 0 };

    // Dikerjakan bergiliran dalam beberapa batch supaya tidak membanjiri jaringan.
    for (let i = 0; i < targets.length; i += PROBE_CONCURRENCY) {
      const batch = targets.slice(i, i + PROBE_CONCURRENCY);
      await Promise.all(
        batch.map(async (e) => {
          const r = await probeCommand(e, f, cache);
          if (r.skipped) return;
          hasil.diperiksa++;
          if (r.ok) hasil.sehat++; else hasil.rusak++;
          e.lastProbeAt = now();
          e.lastProbeMs = r.ms;
          e.lastProbeError = r.ok ? "" : (r.error || "probe gagal");
          applyResult(e, r.ok, { ms: r.ms, error: r.error });
        })
      );
    }
    saveNow();
    return hasil;
  } finally {
    probeRunning = false;
  }
}

export function startHealthMonitor({ plugins } = {}) {
  if (typeof plugins === "function") getPlugins = plugins;
  ensurePersistence();

  const jalan = async (label) => {
    try {
      const list = getPlugins();
      await runHealthChecks({ plugins: Array.isArray(list) ? list : null });
    } catch (err) {
      console.error(`[health] ${label} gagal:`, err.message);
    }
  };

  setTimeout(() => jalan("probe awal"), FIRST_PROBE_DELAY_MS).unref?.();
  probeTimer = setInterval(() => jalan("probe berkala"), PROBE_INTERVAL_MS);
  probeTimer.unref?.();
  return true;
}

export function stopHealthMonitor() {
  if (probeTimer) clearInterval(probeTimer);
  probeTimer = null;
  if (persistTimer) clearInterval(persistTimer);
  persistTimer = null;
  saveNow();
}

/* ------------------------------------------------------------------
   Tindakan admin
   ------------------------------------------------------------------ */
export function setManualState(command, { disabled, reason = "" } = {}) {
  const e = entry(command);
  if (!e) return { ok: false, message: "Nama command tidak valid." };
  if (disabled) {
    e.disabledUntil = now() + 100 * 365 * 24 * 3600 * 1000; // praktis permanen
    e.disabledReason = String(reason || "dinonaktifkan admin").slice(0, 200);
    e.disabledBy = "admin";
  } else {
    e.disabledUntil = 0;
    e.disabledReason = "";
    e.disabledBy = "";
    e.streak = 0;
  }
  dirty = true;
  saveNow();
  return { ok: true, command: e.command, disabled: !!disabled };
}

/** Tes ulang satu command sekarang (tombol "Cek sekarang" di dashboard). */
export async function forceCheck(command, { fetchImpl } = {}) {
  const e = entry(command);
  if (!e) return { ok: false, message: "Command tidak ditemukan." };
  if (!e.probes.length) {
    return { ok: false, message: "Command ini tidak punya pengecekan otomatis (hanya statistik)." };
  }
  const f = fetchImpl || globalThis.fetch;
  const r = await probeCommand(e, f, new Map());
  e.lastProbeAt = now();
  e.lastProbeMs = r.ms;
  e.lastProbeError = r.ok ? "" : (r.error || "probe gagal");
  // Tes manual yang berhasil langsung membuka kembali command nonaktif-otomatis.
  if (r.ok && e.disabledBy === "auto") {
    e.streak = 0;
    e.disabledUntil = 0;
    e.disabledReason = "";
    e.disabledBy = "";
    dirty = true;
    saveNow();
    return { ok: true, sehat: true, ms: r.ms, aktif: true };
  }
  applyResult(e, r.ok, { ms: r.ms, error: r.error });
  saveNow();
  return { ok: true, sehat: !!r.ok, ms: r.ms, aktif: !e.disabledUntil, error: r.error || "" };
}

export function resetStats(command) {
  const e = entry(command);
  if (!e) return { ok: false, message: "Command tidak ditemukan." };
  e.failsToday = 0;
  e.failTotal = 0;
  e.okToday = 0;
  e.streak = 0;
  e.lastError = "";
  e.lastErrorAt = 0;
  dirty = true;
  saveNow();
  return { ok: true };
}

/** Ringkasan untuk halaman "Error plugin" di dashboard admin. */
export function getHealthReport() {
  rollDay();
  const semua = [...state.commands.values()];
  const items = semua
    .filter((e) => e.failTotal > 0 || e.failsToday > 0 || e.probes.length || e.disabledUntil)
    .map((e) => {
      const aktif = !e.disabledUntil || e.disabledUntil <= now();
      return {
        command: e.command,
        plugin: e.plugin || "",
        label: e.label || "",
        providers: e.providers || [],
        failsToday: e.failsToday,
        failTotal: e.failTotal,
        okToday: e.okToday,
        streak: e.streak,
        lastError: e.lastError,
        lastErrorAt: e.lastErrorAt,
        disabled: !aktif,
        disabledBy: e.disabledBy,
        disabledReason: aktif ? "" : (e.disabledReason || "sedang perbaikan"),
        disabledUntil: aktif ? 0 : e.disabledUntil,
        hasProbe: e.probes.length > 0,
        lastProbeAt: e.lastProbeAt,
        lastProbeMs: e.lastProbeMs,
        lastProbeError: e.lastProbeError,
      };
    })
    .sort((a, b) =>
      (b.failsToday - a.failsToday) ||
      (b.failTotal - a.failTotal) ||
      a.command.localeCompare(b.command)
    );

  return {
    day: state.day,
    total: items.length,
    disabled: items.filter((x) => x.disabled).length,
    dipantau: semua.filter((e) => e.probes.length).length,
    konfigurasi: {
      intervalMenit: Math.round(PROBE_INTERVAL_MS / 60000),
      ambangGagal: FAIL_THRESHOLD,
      nonaktifMenit: Math.round(DISABLE_MS / 60000),
      jumlahApi: PROVIDERS.length,
    },
    items: items.slice(0, 300),
  };
}

/** Daftar API yang dipantau (untuk keterangan di dashboard). */
export function getProviders() {
  return PROVIDERS.map((p) => ({ id: p.id, label: p.label, host: p.host }));
}

/**
 * Segarkan pemetaan command -> API dari plugin yang sedang termuat.
 * Dipakai dashboard admin supaya halaman "Error plugin" tidak kosong
 * sesaat setelah restart.
 */
export function refreshPluginMap() {
  try {
    const list = getPlugins();
    if (Array.isArray(list) && list.length) syncFromPlugins(list);
  } catch (err) {
    console.error("[health] gagal menyegarkan peta plugin:", err.message);
  }
  return state.commands.size;
}

/* ------------------------------------------------------------------
   Persistensi
   ------------------------------------------------------------------ */
function saveNow() {
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    const data = {
      v: 1,
      savedAt: new Date().toISOString(),
      day: state.day,
      commands: [...state.commands.values()].map((e) => ({
        // Probe tidak disimpan; dimuat ulang dari plugin saat startup.
        command: e.command, plugin: e.plugin, label: e.label,
        providers: e.providers, hasProbe: e.probes.length > 0,
        failsToday: e.failsToday, failTotal: e.failTotal, okToday: e.okToday,
        streak: e.streak, lastError: e.lastError, lastErrorAt: e.lastErrorAt,
        disabledUntil: e.disabledUntil, disabledReason: e.disabledReason,
        disabledBy: e.disabledBy, lastProbeAt: e.lastProbeAt,
        lastProbeMs: e.lastProbeMs, lastProbeError: e.lastProbeError,
      })),
    };
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, STATE_FILE);
    dirty = false;
  } catch (err) {
    console.error("[health] gagal menyimpan health.json:", err.message);
  }
}

export function saveHealthState() {
  if (dirty) saveNow();
}

function loadState() {
  try {
    const raw = fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE, "utf8") : "";
    if (!raw) return;
    const s = JSON.parse(raw);
    state.day = jakartaDayKey();
    const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);
    for (const c of Array.isArray(s.commands) ? s.commands : []) {
      const key = cmdKey(c?.command);
      if (!key) continue;
      const e = blankEntry(key);
      e.plugin = typeof c.plugin === "string" ? c.plugin.slice(0, 120) : "";
      e.label = typeof c.label === "string" ? c.label.slice(0, 60) : "";
      e.providers = Array.isArray(c.providers)
        ? c.providers.filter((x) => typeof x === "string").slice(0, 8) : [];
      e.failTotal = num(c.failTotal);
      e.okToday = s.day === state.day ? num(c.okToday) : 0;
      e.failsToday = s.day === state.day ? num(c.failsToday) : 0;
      e.streak = num(c.streak);
      e.lastError = typeof c.lastError === "string" ? c.lastError.slice(0, 200) : "";
      e.lastErrorAt = num(c.lastErrorAt);
      e.disabledUntil = num(c.disabledUntil);
      e.disabledReason = typeof c.disabledReason === "string" ? c.disabledReason.slice(0, 200) : "";
      e.disabledBy = c.disabledBy === "admin" || c.disabledBy === "auto" ? c.disabledBy : "";
      e.lastProbeAt = num(c.lastProbeAt);
      e.lastProbeMs = num(c.lastProbeMs);
      e.lastProbeError = typeof c.lastProbeError === "string" ? c.lastProbeError.slice(0, 200) : "";
      state.commands.set(key, e);
    }
  } catch (err) {
    console.error("[health] gagal memuat health.json (mulai dari nol):", err.message);
  }
}

function ensurePersistence() {
  if (persistTimer) return;
  persistTimer = setInterval(() => { if (dirty) saveNow(); }, 60000);
  persistTimer.unref?.();
  process.once("exit", saveHealthState);
}

loadState();

export default {
  isCommandDisabled,
  recordCommandResult,
  syncFromPlugins,
  startHealthMonitor,
  stopHealthMonitor,
  runHealthChecks,
  getHealthReport,
  getProviders,
  refreshPluginMap,
  setManualState,
  forceCheck,
  resetStats,
  setNotifier,
  saveHealthState,
};