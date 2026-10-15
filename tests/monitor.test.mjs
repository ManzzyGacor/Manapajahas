// lib/monitor.js — estimateCapacity: rumus berapa bot yang muat di server.
// Fungsi murni: semua angka disuntikkan, jadi bisa diuji dengan "server"
// palsu berbagai ukuran.
import test from "node:test";
import assert from "node:assert/strict";
import { pindahKeFolderSementara } from "./_helpers.mjs";

// Modul ini membaca/menulis <cwd>/database/runtime/monitor.json.
pindahKeFolderSementara("monitor");
const { estimateCapacity } = await import("../lib/monitor.js");

test("contoh di dokumentasi: 2048 MB, PM2 1200 MB, 70 MB/bot, cadangan 15% -> 12 bot", () => {
  const c = estimateCapacity({ limitMB: 2048, pm2CapMB: 1200, baselineMB: 160, perBotMB: 70, reservePercent: 15, cores: 2 });
  assert.equal(c.max, 12);
  assert.equal(c.basis, "memory");
  assert.equal(c.detail.limitMB, 1200, "batas PM2 lebih kecil dari container -> PM2 yang berlaku");
  assert.equal(c.detail.memCap, 12);
  assert.equal(c.detail.cpuCap, 50);
  assert.equal(c.status, "available");
  assert.equal(c.remaining, 12);
  assert.equal(c.percent, 0);
});

test("CPU membatasi: 25 bot per core", () => {
  const c = estimateCapacity({ limitMB: 64000, baselineMB: 160, perBotMB: 50, reservePercent: 10, cores: 2 });
  assert.equal(c.max, 50);
  assert.equal(c.basis, "cpu");
  assert.equal(estimateCapacity({ limitMB: 64000, cores: 0.5, perBotMB: 50 }).max, 12, "core pecahan (cgroup) dibulatkan ke bawah");
});

test("batas admin ikut dibandingkan, tapi tidak bisa menaikkan kapasitas", () => {
  const base = { limitMB: 2048, pm2CapMB: 1200, baselineMB: 160, perBotMB: 70, reservePercent: 15, cores: 2 };
  const turun = estimateCapacity({ ...base, maxBots: 5 });
  assert.equal(turun.max, 5);
  assert.equal(turun.basis, "admin");
  const naik = estimateCapacity({ ...base, maxBots: 500 });
  assert.equal(naik.max, 12, "angka admin yang lebih besar diabaikan");
  assert.equal(naik.basis, "memory");
  assert.equal(estimateCapacity({ ...base, maxBots: 12 }).basis, "admin", "seri -> admin didahulukan");
  assert.equal(estimateCapacity({ ...base, maxBots: 0 }).basis, "memory", "0 = otomatis");
});

test("status: available -> limited (sisa <= 10%) -> full", () => {
  const base = { limitMB: 64000, baselineMB: 0, perBotMB: 10, reservePercent: 0, cores: 4, maxBots: 100 };
  assert.equal(estimateCapacity({ ...base, used: 50 }).status, "available");
  const hampir = estimateCapacity({ ...base, used: 90 });
  assert.equal(hampir.status, "limited");
  assert.equal(hampir.remaining, 10);
  assert.equal(hampir.percent, 90);
  const penuh = estimateCapacity({ ...base, used: 140 });
  assert.equal(penuh.status, "full");
  assert.equal(penuh.remaining, 0);
  assert.equal(penuh.percent, 100);
});

test("input aneh tidak membuat server menolak SEMUA bot (minimal 1)", () => {
  const c = estimateCapacity({ limitMB: 0, cores: 0, perBotMB: 0, reservePercent: 500, used: -5 });
  assert.ok(c.max >= 1, JSON.stringify(c));
  assert.equal(c.used, 0);
  assert.equal(c.detail.reservePercent, 50, "cadangan dibatasi 0–50%");
  assert.ok(estimateCapacity({ limitMB: 100, baselineMB: 500, perBotMB: 70 }).max >= 1);
  assert.ok(estimateCapacity().max >= 1);
});

test("cadangan RAM lebih besar = slot lebih sedikit", () => {
  const base = { limitMB: 4096, baselineMB: 200, perBotMB: 60, cores: 16 };
  const a = estimateCapacity({ ...base, reservePercent: 0 }).max;
  const b = estimateCapacity({ ...base, reservePercent: 30 }).max;
  assert.ok(a > b, `${a} > ${b}`);
  assert.equal(a, Math.floor((4096 - 200) / 60));
  assert.equal(b, Math.floor((4096 * 0.7 - 200) / 60));
});
