/**
 * lib/bot-stats.js
 *
 * Pelacak statistik hidup per sesi bot: jumlah pesan masuk, perintah yang
 * dijalankan, jumlah grup, dan aktivitas terakhir.
 *
 * Disimpan di memori saja (bukan database) — ini data ringan yang berubah
 * sangat sering, dan kalau server restart wajar kalau hitungannya mulai lagi
 * dari nol. Menulisnya ke MongoDB tiap pesan masuk justru akan membebani
 * database tanpa manfaat berarti.
 */

// number -> { messages, commands, groupMessages, privateMessages, startedAt, lastActivity, groups, recent[] }
const stats = new Map();

const MAX_RECENT = 30; // cukup untuk terminal; lebih dari ini tidak terbaca juga

function blank() {
  return {
    messages: 0,
    commands: 0,
    groupMessages: 0,
    privateMessages: 0,
    groups: 0,
    startedAt: Date.now(),
    lastActivity: null,
    recent: [],
  };
}

export function ensureStats(number) {
  if (!stats.has(number)) stats.set(number, blank());
  return stats.get(number);
}

/** Dipanggil tiap kali bot memproses satu pesan. */
export function recordMessage(number, { isGroup = false, command = null, pushName = "", text = "" } = {}) {
  if (!number) return;
  const s = ensureStats(number);
  s.messages++;
  if (isGroup) s.groupMessages++; else s.privateMessages++;
  if (command) s.commands++;
  s.lastActivity = Date.now();

  s.recent.unshift({
    at: Date.now(),
    isGroup,
    command: command || null,
    // Nama & cuplikan pesan dipotong pendek: terminal cuma perlu gambaran
    // aktivitas, bukan menyimpan isi percakapan pengguna.
    from: String(pushName || "").slice(0, 24),
    preview: String(text || "").slice(0, 40),
  });
  if (s.recent.length > MAX_RECENT) s.recent.length = MAX_RECENT;
}

/** Perbarui jumlah grup (dipanggil berkala, bukan tiap pesan). */
export function setGroupCount(number, count) {
  if (!number) return;
  ensureStats(number).groups = count;
}

export function getStats(number) {
  const s = stats.get(number);
  if (!s) return null;
  return {
    ...s,
    uptimeMs: Date.now() - s.startedAt,
  };
}

export function resetStats(number) {
  stats.delete(number);
  groupCache.delete(number);
}

/* ------------------------------------------------------------------
   Cache daftar grup
   groupFetchAllParticipating() itu panggilan berat ke WhatsApp. Sebelum
   ada cache ini, fungsi tersebut dipanggil dari tier-enforcer (tiap 5
   menit DAN tiap kali ada anggota masuk/keluar grup), dari interval
   statistik tiap 60 detik, dan dari endpoint statistik — di grup ramai
   bisa ratusan panggilan per menit dan bikin server berat.
   Sekarang semuanya lewat satu cache ber-TTL.
   ------------------------------------------------------------------ */
const groupCache = new Map(); // number -> { at, groups }
const GROUP_TTL_MS = 60 * 1000;

export async function getGroupsCached(number, sock, { force = false } = {}) {
  if (!sock?.user) return [];

  const hit = groupCache.get(number);
  if (!force && hit && Date.now() - hit.at < GROUP_TTL_MS) return hit.groups;

  try {
    const meta = await sock.groupFetchAllParticipating();
    const groups = Object.values(meta || {}).map((g) => ({
      id: g.id,
      subject: g.subject || "Tanpa Nama",
      size: Array.isArray(g.participants) ? g.participants.length : (g.size || 0),
    }));
    groupCache.set(number, { at: Date.now(), groups });
    setGroupCount(number, groups.length);
    return groups;
  } catch (err) {
    // Kalau gagal, pakai hasil terakhir daripada bikin pemanggil error.
    return hit?.groups || [];
  }
}

export function invalidateGroups(number) {
  groupCache.delete(number);
}

export default { ensureStats, recordMessage, setGroupCount, getStats, resetStats, getGroupsCached, invalidateGroups };
