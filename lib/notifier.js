/**
 * lib/notifier.js
 *
 * Pesan pemberitahuan dari BOT UTAMA (milik operator) ke nomor WhatsApp
 * pelanggan: bot terputus, paket mau habis, dan sejenisnya.
 *
 * Kenapa lewat bot utama: bot milik user yang terputus jelas tidak bisa
 * mengirim kabar soal dirinya sendiri, dan nomor bot user itu memang nomor
 * HP pelanggan (WhatsApp di HP-nya yang ditautkan sebagai bot). Jadi bot
 * utama mengirim ke nomor bot tersebut.
 *
 * Aturan:
 * - Kalau bot utama sedang offline, pesan disimpan di antrean memori kecil
 *   (maks 200, yang paling lama dibuang) lalu dikirim saat bot utama
 *   tersambung lagi (connection.js memanggil flushNotifierQueue()).
 * - Jarak antar kiriman minimal 2 detik supaya nomor bot utama tidak
 *   dianggap spam oleh WhatsApp saat banyak pemberitahuan keluar bersamaan
 *   (mis. setelah restart, atau saat antrean dikirim sekaligus).
 * - notifyBotOwner memakai dedupe + cooldown (bawaan 6 jam): kejadian yang
 *   sama tidak dikirim dua kali dalam rentang itu.
 * - Tidak pernah melempar error ke pemanggil: pemberitahuan gagal tidak
 *   boleh menjatuhkan sesi bot atau request web.
 */
import config from "../config.js";
import { sessions } from "./cache.js";

const MAX_ANTREAN = 200;
const JEDA_KIRIM_MS = 2000;
const COOLDOWN_BAWAAN_MS = 6 * 60 * 60 * 1000;
const MAX_TEKS = 4000;
const MAX_PERCOBAAN = 3;
const MAX_KUNCI_DEDUPE = 5000;

// ── Status di memori ───────────────────────────────────────────
let antrean = []; // [{ jid, text, attempts, at }]
let terakhirKirim = 0; // timestamp kiriman terakhir (untuk jeda 2 detik)
let rantai = Promise.resolve(); // semua kiriman lewat satu rantai (berurutan)
let sedangFlush = false;
const dedupe = new Map(); // kunci -> { at, cooldownMs }

// Pengganti untuk pengujian (sesi bot utama & jam). Di produksi tidak dipakai.
let sumberSock = () => sessions.get("session");

function tunggu(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Nomor & JID ────────────────────────────────────────────────
/**
 * "628xx", "+62 8xx", "08xx", "628xx@s.whatsapp.net", "628xx:12@s.whatsapp.net"
 * → "628xx". Mengembalikan null kalau bukan nomor HP yang masuk akal.
 * Grup (@g.us), LID, dan broadcast ditolak: pemberitahuan hanya ke chat
 * pribadi nomor HP.
 */
export function normalizeNotifyNumber(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  if (s.includes("@")) {
    const [depan, domain] = s.split("@");
    if (domain !== "s.whatsapp.net") return null;
    s = depan;
  }
  if (s.includes(":")) s = s.split(":")[0];
  if (!/^[+\d\s().-]+$/.test(s)) return null;
  s = s.replace(/\D/g, "");
  if (s.startsWith("0")) s = `62${s.slice(1)}`;
  return /^\d{8,15}$/.test(s) ? s : null;
}

// Socket bot utama yang benar-benar tersambung (sock.user terisi saat
// login berhasil). Socket yang sedang digantikan (penjaga sesi ganda di
// connection.js) tidak dipakai.
function sockUtama() {
  try {
    const s = sumberSock();
    if (s && s.user && !s.__digantikan && typeof s.sendMessage === "function") return s;
  } catch {
    /* anggap offline */
  }
  return null;
}

/** Nomor bot utama (dari sesi yang tersambung, atau BOT_NUMBER di .env). */
function nomorBotUtama() {
  const s = sockUtama();
  const dariSesi = normalizeNotifyNumber(String(s?.user?.id || "").split(":")[0].split("@")[0]);
  return dariSesi || normalizeNotifyNumber(config.phone_number_bot) || "";
}

// ── Antrean ────────────────────────────────────────────────────
function masukAntrean(item, depan = false) {
  if (depan) {
    // Dikembalikan ke depan = pesan yang paling lama. Kalau antrean sudah
    // penuh, justru dia yang dibuang (aturan "buang yang paling lama").
    if (antrean.length >= MAX_ANTREAN) return;
    antrean.unshift(item);
    return;
  }
  antrean.push(item);
  // Penuh: buang yang PALING LAMA. Pemberitahuan terbaru lebih berguna.
  while (antrean.length > MAX_ANTREAN) antrean.shift();
}

// Kirim satu pesan dengan jeda minimal JEDA_KIRIM_MS dari kiriman
// sebelumnya. Dipanggil HANYA dari dalam rantai, jadi tidak pernah ada dua
// kiriman bersamaan.
// Hasil: "sent" | "queued" (bot utama offline / gagal sesaat, dicoba lagi
// nanti) | "failed" (sudah gagal berkali-kali, pesan dibuang).
async function kirimSatu(item) {
  if (!sockUtama()) {
    masukAntrean(item, true);
    return "queued";
  }
  const sisaJeda = terakhirKirim + JEDA_KIRIM_MS - Date.now();
  if (sisaJeda > 0) await tunggu(sisaJeda);
  // Bot utama bisa putus selama menunggu jeda.
  const sock = sockUtama();
  if (!sock) {
    masukAntrean(item, true);
    return "queued";
  }
  try {
    terakhirKirim = Date.now();
    await sock.sendMessage(item.jid, { text: item.text });
    return "sent";
  } catch (err) {
    item.attempts = (item.attempts || 0) + 1;
    // Nomor tujuan disamarkan di log (log server bisa dibaca banyak orang).
    console.error(
      `[notifier] gagal kirim ke ${item.jid.slice(0, 4)}xxx (percobaan ${item.attempts}):`,
      err?.message || err
    );
    // Gagal sesaat (socket sedang putus) dicoba lagi saat flush berikutnya;
    // setelah beberapa kali tetap gagal, pesannya dibuang.
    if (item.attempts < MAX_PERCOBAAN) {
      masukAntrean(item, true);
      return "queued";
    }
    return "failed";
  }
}

function lewatRantai(fn) {
  const hasil = rantai.then(fn, fn);
  // Rantai tidak boleh ikut "rusak" kalau satu langkah gagal.
  rantai = hasil.then(
    () => undefined,
    () => undefined
  );
  return hasil;
}

/**
 * Kirim isi antrean lewat bot utama (berurutan, berjeda). Dipanggil saat
 * bot utama tersambung. Aman dipanggil berkali-kali.
 * @returns {Promise<number>} jumlah pesan yang terkirim
 */
export function flushNotifierQueue() {
  if (sedangFlush) return Promise.resolve(0);
  sedangFlush = true;
  return lewatRantai(async () => {
    let terkirim = 0;
    try {
      while (antrean.length && sockUtama()) {
        const item = antrean.shift();
        const hasil = await kirimSatu(item);
        if (hasil === "sent") terkirim++;
        // Dikembalikan ke antrean (offline / gagal sesaat): berhenti dulu,
        // dicoba lagi saat flush berikutnya — jangan berputar terus.
        else if (hasil === "queued") break;
      }
    } finally {
      sedangFlush = false;
    }
    if (terkirim) console.log(`[notifier] ${terkirim} pemberitahuan tertunda terkirim.`);
    return terkirim;
  });
}

/**
 * Kirim teks dari bot utama ke nomor/JID ini.
 * @returns {Promise<boolean>} true = terkirim, atau disimpan di antrean karena
 *   bot utama sedang offline / gagal sesaat (akan dikirim saat tersambung atau
 *   dicoba lagi). false = nomor/teks tidak valid, atau pengiriman tetap gagal
 *   setelah beberapa percobaan.
 */
export async function sendFromMainBot(numberOrJid, text) {
  try {
    const nomor = normalizeNotifyNumber(numberOrJid);
    const isi = String(text ?? "").trim().slice(0, MAX_TEKS);
    if (!nomor || !isi) return false;
    const item = { jid: `${nomor}@s.whatsapp.net`, text: isi, attempts: 0, at: Date.now() };

    if (!sockUtama()) {
      masukAntrean(item);
      return true;
    }
    // Antrean lama dikirim dulu supaya urutan pemberitahuan tetap terjaga.
    if (antrean.length) {
      masukAntrean(item);
      flushNotifierQueue().catch(() => {});
      return true;
    }
    const hasil = await lewatRantai(() => kirimSatu(item));
    return hasil !== "failed";
  } catch (err) {
    console.error("[notifier] sendFromMainBot error:", err?.message || err);
    return false;
  }
}

// ── Dedupe ─────────────────────────────────────────────────────
function bersihkanDedupe(now) {
  if (dedupe.size <= MAX_KUNCI_DEDUPE) return;
  for (const [k, v] of dedupe) {
    if (now - v.at >= v.cooldownMs) dedupe.delete(k);
  }
  // Masih penuh (semua masih dalam cooldown): buang yang paling lama.
  while (dedupe.size > MAX_KUNCI_DEDUPE) {
    dedupe.delete(dedupe.keys().next().value);
  }
}

/**
 * Pemberitahuan untuk pemilik bot user: dikirim ke nomor WhatsApp bot itu
 * sendiri (= HP pelanggan), lewat bot utama. Tidak pernah dikirim ke nomor
 * bot utama.
 *
 * @param {string} botNumber nomor bot user
 * @param {string} text isi pesan
 * @param {{ dedupeKey?: string, cooldownMs?: number }} [opts]
 *   dedupeKey  — kunci kejadian (bawaan: nomor + isi teks). Kunci yang sama
 *                dalam cooldownMs dianggap sudah terkirim.
 *   cooldownMs — bawaan 6 jam; 0 = tanpa dedupe.
 * @returns {Promise<boolean>} true = terkirim / masuk antrean / sudah pernah
 *   dikirim dalam cooldown (tidak perlu dicoba lagi). false = nomor tidak
 *   valid, nomor bot utama sendiri, atau pengiriman gagal.
 */
export async function notifyBotOwner(botNumber, text, opts = {}) {
  try {
    const nomor = normalizeNotifyNumber(botNumber);
    if (!nomor) return false;
    // Bot utama tidak perlu (dan tidak boleh) mengirimi dirinya sendiri.
    const utama = nomorBotUtama();
    if (utama && utama === nomor) return false;

    const isi = String(text ?? "").trim();
    if (!isi) return false;

    const cdMentah = Number(opts?.cooldownMs);
    const cooldownMs = Number.isFinite(cdMentah) && cdMentah >= 0 ? cdMentah : COOLDOWN_BAWAAN_MS;
    const kunci = `${nomor}|${String(opts?.dedupeKey || isi).slice(0, 300)}`;
    const now = Date.now();

    if (cooldownMs > 0) {
      const lama = dedupe.get(kunci);
      if (lama && now - lama.at < lama.cooldownMs) return true;
      // Dicatat SEBELUM mengirim: dua pemanggilan bersamaan untuk kejadian
      // yang sama tidak boleh sama-sama lolos.
      dedupe.set(kunci, { at: now, cooldownMs });
      bersihkanDedupe(now);
    }

    const ok = await sendFromMainBot(nomor, isi);
    // Gagal kirim: lepas kunci dedupe supaya kejadian ini bisa dicoba lagi.
    if (!ok && cooldownMs > 0) dedupe.delete(kunci);
    return ok;
  } catch (err) {
    console.error("[notifier] notifyBotOwner error:", err?.message || err);
    return false;
  }
}

/**
 * Lepas kunci dedupe sebuah kejadian, mis. saat bot tersambung lagi:
 * kejadian "terputus" berikutnya memang kejadian baru dan boleh dikabarkan.
 */
export function resetNotifyDedupe(botNumber, dedupeKey) {
  const nomor = normalizeNotifyNumber(botNumber);
  if (!nomor || !dedupeKey) return false;
  return dedupe.delete(`${nomor}|${String(dedupeKey).slice(0, 300)}`);
}

/** Ringkasan kondisi notifier (untuk diagnosa / pengujian). */
export function getNotifierState() {
  return {
    queued: antrean.length,
    mainBotOnline: !!sockUtama(),
    dedupeKeys: dedupe.size,
    lastSendAt: terakhirKirim,
  };
}

/** KHUSUS PENGUJIAN: ganti sumber socket bot utama & kosongkan status. */
export function __setNotifierTestHooks({ getMainSock, reset } = {}) {
  if (typeof getMainSock === "function") sumberSock = getMainSock;
  if (reset) {
    antrean = [];
    terakhirKirim = 0;
    rantai = Promise.resolve();
    sedangFlush = false;
    dedupe.clear();
  }
}

// Jaring pengaman: kalau flush saat tersambung terlewat (mis. bot utama
// tersambung sebelum modul ini dimuat), antrean dicoba lagi tiap menit.
setInterval(() => {
  if (antrean.length && sockUtama()) flushNotifierQueue().catch(() => {});
}, 60 * 1000).unref?.();

export default {
  sendFromMainBot,
  notifyBotOwner,
  flushNotifierQueue,
  resetNotifyDedupe,
  normalizeNotifyNumber,
  getNotifierState,
};
