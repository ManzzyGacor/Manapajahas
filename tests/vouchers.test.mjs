// lib/vouchers.js — validasi & pembuatan kode voucher (tanpa MongoDB).
// Mengimpor modul ini aman tanpa database: model Mongoose baru menyentuh
// database saat dipakai, dan test di sini hanya memakai fungsi murninya.
import test from "node:test";
import assert from "node:assert/strict";
import { HARI_MS } from "./_helpers.mjs";
import {
  VOUCHER_TIERS, VOUCHER_CODE_RE, normalizeVoucherCode, isValidVoucherCode, generateVoucherCode,
  parseVoucherExpiry, parseVoucherCreate, isVoucherExpired, voucherView, createAttemptGuard,
} from "../lib/vouchers.js";

test("paket voucher: hanya Core/Prime/Zenith (basic/plus/booster)", () => {
  assert.deepEqual(VOUCHER_TIERS, ["basic", "plus", "booster"]);
});

test("normalizeVoucherCode: spasi dibuang, huruf besar, format dicek", () => {
  assert.equal(normalizeVoucherCode(" vrs - ab12 "), "VRS-AB12");
  assert.equal(normalizeVoucherCode("abcd"), "ABCD");
  assert.equal(normalizeVoucherCode("A".repeat(24)), "A".repeat(24));
  for (const buruk of ["", "ABC", "A".repeat(25), "AB_12", "AB.12", "ÄBCD", "<script>", "AB\u0000CD", null, undefined, 1234, ["ABCD"], { code: "ABCD" }]) {
    assert.equal(normalizeVoucherCode(buruk), "", JSON.stringify(buruk));
  }
});

test("isValidVoucherCode: hanya bentuk final (huruf besar), tanpa normalisasi", () => {
  assert.equal(isValidVoucherCode("VRS-AB12"), true);
  assert.equal(isValidVoucherCode("vrs-ab12"), false);
  assert.equal(isValidVoucherCode(" VRS1"), false);
  assert.equal(isValidVoucherCode(1234), false);
});

test("generateVoucherCode: acak, valid, tanpa huruf yang mudah tertukar", () => {
  const banyak = new Set();
  for (let i = 0; i < 2000; i++) {
    const c = generateVoucherCode();
    assert.equal(c.length, 8);
    assert.ok(VOUCHER_CODE_RE.test(c), c);
    assert.ok(!/[01OIL]/.test(c), `huruf ambigu di ${c}`);
    banyak.add(c);
  }
  assert.equal(banyak.size, 2000, "kode acak bentrok — sumber acak lemah?");
});

test("generateVoucherCode dengan awalan: dibersihkan, dipisah '-', maks. 24 karakter", () => {
  assert.match(generateVoucherCode("promo"), /^PROMO-[A-Z2-9]{8}$/);
  assert.match(generateVoucherCode("LEBARAN-"), /^LEBARAN-[A-Z2-9]{8}$/);
  assert.match(generateVoucherCode("a b!c"), /^ABC-[A-Z2-9]{8}$/);
  const panjang = generateVoucherCode("ABCDEFGHIJKLMNOP"); // dipotong 12
  assert.ok(panjang.length <= 24 && isValidVoucherCode(panjang), panjang);
  assert.ok(panjang.startsWith("ABCDEFGHIJKL-"));
  assert.equal(generateVoucherCode("", 2).length, 4); // minimal 4
});

test("parseVoucherExpiry: tanggal saja = akhir hari WIB; kosong = tanpa batas", () => {
  assert.equal(parseVoucherExpiry(""), "");
  assert.equal(parseVoucherExpiry(undefined), "");
  assert.equal(parseVoucherExpiry(null), "");
  assert.equal(parseVoucherExpiry("   "), "");
  assert.equal(parseVoucherExpiry("2026-12-31"), "2026-12-31T16:59:59.000Z");
  assert.equal(parseVoucherExpiry("2027-01-02T10:00:00Z"), "2027-01-02T10:00:00.000Z");
  assert.equal(parseVoucherExpiry("31/12/2026"), null);
  assert.equal(parseVoucherExpiry("besok"), null);
  assert.equal(parseVoucherExpiry(123), null);
});

const NOW = Date.parse("2026-10-15T00:00:00Z");
const dasar = { tier: "plus", days: 30 };

test("parseVoucherCreate: satu kode khusus", () => {
  const r = parseVoucherCreate({ ...dasar, code: " vrs-hemat ", maxUses: 5, expiresAt: "2026-12-31", note: "untuk giveaway" }, NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    tier: "plus", days: 30, maxUses: 5, expiresAt: "2026-12-31T16:59:59.000Z",
    note: "untuk giveaway", codes: ["VRS-HEMAT"], count: 1, prefix: "",
  });
});

test("parseVoucherCreate: banyak kode acak (count + awalan)", () => {
  const r = parseVoucherCreate({ tier: "booster", days: "7", count: "25", prefix: "promo" }, NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.codes, []);
  assert.equal(r.value.count, 25);
  assert.equal(r.value.prefix, "PROMO");
  assert.equal(r.value.days, 7);
  assert.equal(r.value.maxUses, 1); // bawaan
  assert.equal(r.value.expiresAt, "");
});

test("parseVoucherCreate: semua batas ditolak dengan pesan bahasa Indonesia", () => {
  const tolak = (body, pola) => {
    const r = parseVoucherCreate(body, NOW);
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.match(r.message, pola, JSON.stringify(body));
  };
  tolak({ ...dasar, tier: "free" }, /Core, Prime, atau Zenith/);
  tolak({ ...dasar, tier: "__proto__" }, /Core, Prime, atau Zenith/);
  tolak({ days: 30 }, /Core, Prime, atau Zenith/);
  for (const days of [0, 366, 1.5, "abc", -1, null]) tolak({ ...dasar, days }, /1–365 hari/);
  for (const maxUses of [0, 10001, 2.5, "x"]) tolak({ ...dasar, maxUses }, /1–10000/);
  tolak({ ...dasar, expiresAt: "kemarin" }, /tidak valid/);
  tolak({ ...dasar, expiresAt: "2026-10-01" }, /masa depan/);
  tolak({ ...dasar, note: { $gt: "" } }, /teks/);
  tolak({ ...dasar, code: "AB" }, /4–24 karakter/);
  tolak({ ...dasar, code: ["ABCD"] }, /4–24 karakter/);
  tolak({ ...dasar, code: "ABCD", count: 5 }, /Kode khusus hanya untuk satu voucher/);
  for (const count of [0, 101, 1.5]) tolak({ ...dasar, count }, /1–100/);
  tolak({ ...dasar, prefix: "terlalu-panjang-sekali" }, /12 karakter/);
  tolak({ ...dasar, prefix: "a b" }, /12 karakter/);
  assert.equal(parseVoucherCreate(null, NOW).ok, false);
  assert.equal(parseVoucherCreate("tier=plus", NOW).ok, false);
});

test("parseVoucherCreate: catatan dibersihkan dari tag/karakter kontrol dan dipotong 200", () => {
  const r = parseVoucherCreate({ ...dasar, note: "<b>halo</b>\n\tdunia\u0000" + "x".repeat(300) }, NOW);
  assert.equal(r.ok, true);
  assert.ok(!/[<>\u0000-\u001f]/.test(r.value.note), r.value.note);
  assert.ok(r.value.note.startsWith(" b halo /b dunia".trim()));
  assert.equal(r.value.note.length, 200);
});

test("parseVoucherCreate: kode khusus mengabaikan awalan; count 1 boleh bersama kode", () => {
  const r = parseVoucherCreate({ ...dasar, code: "SATU1", prefix: "abc", count: 1 }, NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.codes, ["SATU1"]);
  assert.equal(r.value.prefix, "");
});

test("isVoucherExpired & voucherView: status untuk panel admin", () => {
  const v = { code: "VRS-1", tier: "booster", days: 30, maxUses: 3, usedCount: 1, expiresAt: "", active: true, note: "n", createdBy: "admin", createdAt: "2026-10-01T00:00:00.000Z" };
  assert.equal(isVoucherExpired(v, NOW), false);
  assert.deepEqual(voucherView(v, NOW), {
    code: "VRS-1", tier: "booster", tierName: "Zenith", days: 30, maxUses: 3, usedCount: 1, remaining: 2,
    expiresAt: "", expired: false, active: true, status: "aktif", note: "n", createdBy: "admin", createdAt: "2026-10-01T00:00:00.000Z",
  });
  const lewat = { ...v, expiresAt: new Date(NOW - 1000).toISOString() };
  assert.equal(isVoucherExpired(lewat, NOW), true);
  assert.equal(voucherView(lewat, NOW).status, "kedaluwarsa");
  assert.equal(voucherView({ ...v, usedCount: 3 }, NOW).status, "habis");
  assert.equal(voucherView({ ...v, usedCount: 9 }, NOW).remaining, 0);
  // Nonaktif menang atas status lain.
  assert.equal(voucherView({ ...lewat, active: false }, NOW).status, "nonaktif");
  assert.equal(voucherView({ ...v, tier: "plus" }, NOW).tierName, "Prime");
  assert.equal(voucherView({ ...v, tier: "basic" }, NOW).tierName, "Core");
});

test("penjaga tebak kode: maks. 5 gagal per 10 menit per user", () => {
  const g = createAttemptGuard();
  const t0 = 1_000_000;
  for (let i = 0; i < 4; i++) g.fail("u1", t0 + i);
  assert.equal(g.retryAfterSec("u1", t0 + 10), 0);
  g.fail("u1", t0 + 5);
  const tunggu = g.retryAfterSec("u1", t0 + 10);
  assert.ok(tunggu > 590 && tunggu <= 600, String(tunggu));
  assert.equal(g.retryAfterSec("u2", t0 + 10), 0, "user lain tidak ikut terkunci");
  assert.equal(g.retryAfterSec("u1", t0 + 10 * 60 * 1000 + 1), 0, "terbuka lagi setelah 10 menit");

  g.refund("u1");
  assert.equal(g.retryAfterSec("u1", t0 + 10), 0, "percobaan yang dikembalikan tidak dihitung");
  g.fail("u1", t0 + 6);
  assert.ok(g.retryAfterSec("u1", t0 + 10) > 0);
  g.reset("u1");
  assert.equal(g.retryAfterSec("u1", t0 + 10), 0);
});

test("penjaga tebak kode: jumlah user di memori dibatasi", () => {
  const g = createAttemptGuard({ max: 1, windowMs: HARI_MS, maxKeys: 3 });
  const t = Date.now();
  for (const k of ["a", "b", "c", "d"]) g.fail(k, t);
  assert.equal(g.retryAfterSec("a", t), 0, "kunci paling lama dibuang");
  assert.ok(g.retryAfterSec("d", t) > 0);
  g.clear();
  assert.equal(g.retryAfterSec("d", t), 0);
});
