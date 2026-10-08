/**
 * lib/monitor.js — STUB antarmuka (akan diisi penuh oleh tim backend).
 *
 * Pusat pemantauan real-time: performa server, kapasitas bot, dan log
 * command yang dipakai (nomor bot disensor untuk publik).
 *
 * Antarmuka yang dipakai modul lain (JANGAN diubah tanda tangannya):
 *   recordTraffic({ bot, isGroup })                       -> per pesan masuk
 *   logCommand({ bot, command, isGroup, ok, ms, plugin }) -> per command selesai dijalankan
 *   maskNumber(number)                                    -> "6285xxxx026"
 */

export function maskNumber(number) {
  const n = String(number || "").replace(/\D/g, "");
  if (n.length < 8) return n ? `${n.slice(0, 2)}xxxx` : "";
  return `${n.slice(0, 4)}xxxx${n.slice(-3)}`;
}

// eslint-disable-next-line no-unused-vars
export function recordTraffic({ bot, isGroup = false } = {}) {}

// eslint-disable-next-line no-unused-vars
export function logCommand({ bot, command, isGroup = false, ok = true, ms = 0, plugin = "" } = {}) {}

export default { maskNumber, recordTraffic, logCommand };
