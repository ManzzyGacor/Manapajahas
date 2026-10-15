// lib/bot-scope.js — premium, bonus limit & sewa grup PER BOT.
//
// Modul ini menyimpan datanya di <folder modul>/../database/bot-scope.json
// (bukan relatif ke cwd). Supaya test tidak pernah menyentuh data asli,
// salinan lib/bot-scope.js dijalankan dari folder sementara dengan
// config.js tiruan (satu-satunya impor lokal modul itu). Yang diuji tetap
// kode lib/bot-scope.js apa adanya — disalin saat test berjalan.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, tempDir, HARI_MS } from "./_helpers.mjs";

const KOTAK = tempDir("bot-scope");
fs.mkdirSync(path.join(KOTAK, "lib"));
fs.mkdirSync(path.join(KOTAK, "database"));
fs.copyFileSync(path.join(ROOT, "lib", "bot-scope.js"), path.join(KOTAK, "lib", "bot-scope.js"));
fs.writeFileSync(
  path.join(KOTAK, "config.js"),
  'export default { bot_name: "Varesa", owner_number: ["6280000000001"], web_url: "https://contoh.test" };\n'
);
const FILE = path.join(KOTAK, "database", "bot-scope.json");

// File "jahat" sebelum modul dimuat: kunci prototype, tipe salah, angka
// di luar batas. Semuanya harus dibuang saat dibaca.
const BOT = "6281234567890";
fs.writeFileSync(FILE, `{
  "__proto__": { "tercemar": true },
  "constructor": { "prototype": { "tercemar": true } },
  "bukan-nomor": { "premium": { "6289999999": "2099-01-01T00:00:00Z" } },
  "${BOT}": {
    "premium": { "__proto__": "2099-01-01T00:00:00Z", "6281111111": "2099-01-01T00:00:00Z", "6282222222": "bukan-tanggal", "62": "2099-01-01" },
    "limitBonus": { "6281111111": 25, "6282222222": -5, "6283333333": 1.5, "constructor": 9 },
    "sewa": {
      "120363-1234@g.us": { "expired": 4102444800000, "linkGrub": "${"x".repeat(500)}", "addedBy": "jahat" },
      "abc@g.us": { "expired": 4102444800000 },
      "99999-1@g.us": { "expired": -1 }
    }
  }
}`);

const M = await import(pathToFileURL(path.join(KOTAK, "lib", "bot-scope.js")).href);
// Tulis sisa perubahan SEBELUM folder sementara dihapus saat proses keluar
// (kalau tidak, handler "exit" modul akan membuat ulang foldernya).
after(() => M.flushBotScope());

test("validasi kunci: nomor 5–20 digit, grup angka@g.us", () => {
  assert.equal(M.isValidBotKey("6281234567890"), true);
  assert.equal(M.isValidBotKey("1234"), false);
  assert.equal(M.isValidBotKey("1".repeat(21)), false);
  assert.equal(M.isValidBotKey("__proto__"), false);
  assert.equal(M.isValidBotKey(null), false);
  assert.equal(M.isValidUserKey("62812345"), true);
  assert.equal(M.isValidGroupId("120363-1234@g.us"), true);
  assert.equal(M.isValidGroupId("abc@g.us"), false);
  assert.equal(M.isValidGroupId("12345@s.whatsapp.net"), false);
});

test("normalizeUserNumber: 08xx -> 628xx, JID/LID -> digit", () => {
  assert.equal(M.normalizeUserNumber("0812-3456-7890"), "6281234567890");
  assert.equal(M.normalizeUserNumber("+62 812 3456 7890"), "6281234567890");
  assert.equal(M.normalizeUserNumber("6281234567890:12@s.whatsapp.net"), "6281234567890");
  assert.equal(M.normalizeUserNumber("123456789012345@lid"), "123456789012345");
  assert.equal(M.normalizeUserNumber("12@lid"), null);
  assert.equal(M.normalizeUserNumber("abc"), null);
  assert.equal(M.normalizeUserNumber(""), null);
  assert.equal(M.normalizeUserNumber(undefined), null);
});

test("file rusak/jahat dibersihkan saat dibaca, prototype Object tidak tercemar", () => {
  assert.equal({}.tercemar, undefined);
  assert.equal(Object.prototype.tercemar, undefined);
  assert.deepEqual(M.listBotPremium(BOT).map((x) => x.user), ["6281111111"]);
  assert.equal(M.getLimitBonus(BOT, "6281111111"), 25);
  assert.equal(M.getLimitBonus(BOT, "6282222222"), 0);
  assert.equal(M.getLimitBonus(BOT, "6283333333"), 0);
  assert.equal(M.getLimitBonus(BOT, "constructor"), 0);
  const sewa = M.getBotSewa(BOT, "120363-1234@g.us");
  assert.equal(sewa.linkGrub.length, M.BATAS.maxLinkLen);
  assert.equal(sewa.addedBy, "");
  assert.equal(M.getBotSewa(BOT, "99999-1@g.us"), null);
  assert.deepEqual(M.listBotSewa("bukan-nomor"), []);
  assert.equal(M.hasBotScope("__proto__"), false);
});

test("kunci berbahaya ditolak saat menulis", () => {
  assert.deepEqual(M.addBotPremium("__proto__", "6281111111", 5), { ok: false, error: "bot" });
  assert.deepEqual(M.addBotPremium(BOT, "__proto__", 5), { ok: false, error: "user" });
  assert.deepEqual(M.addBotPremium(BOT, "constructor", 5), { ok: false, error: "user" });
  assert.deepEqual(M.addLimitBonus("constructor", "6281111111", 5), { ok: false, error: "bot" });
  assert.deepEqual(M.addBotSewa(BOT, "__proto__", { expired: Date.now() + HARI_MS }), { ok: false, error: "group" });
  assert.equal(M.getBotPremium("__proto__", "6281111111"), null);
  assert.equal({}.tercemar, undefined);
});

test("batas angka: hari 1–3650, limit 1–100000", () => {
  for (const d of [0, 3651, 1.5, "x", -3]) assert.deepEqual(M.addBotPremium(BOT, "6284444444", d), { ok: false, error: "days" }, String(d));
  for (const n of [0, 100001, 2.5, "x"]) assert.deepEqual(M.addLimitBonus(BOT, "6284444444", n), { ok: false, error: "amount" }, String(n));
});

test("premium per bot: tambah, perpanjang dari tanggal lama, hapus", () => {
  const u = "6285555555";
  const a = M.addBotPremium(BOT, u, 10);
  assert.equal(a.ok, true);
  assert.ok(M.isBotPremium(BOT, u));
  assert.equal(M.isBotPremium("6289876543210", u), false, "premium tidak bocor ke bot lain");
  const b = M.addBotPremium(BOT, u, 5);
  const selisih = Date.parse(b.expiredAt) - Date.parse(a.expiredAt);
  assert.ok(Math.abs(selisih - 5 * HARI_MS) < 1000, String(selisih));
  // Maksimal 3650 hari dari sekarang walau ditambah berkali-kali.
  M.addBotPremium(BOT, u, 3650);
  assert.ok(Date.parse(M.getBotPremium(BOT, u)) <= Date.now() + 3650 * HARI_MS + 1000);
  assert.equal(M.delBotPremium(BOT, u), true);
  assert.equal(M.isBotPremium(BOT, u), false);
});

test("bonus limit: dipakai dulu sebelum limit global", () => {
  const u = "6286666666";
  assert.deepEqual(M.addLimitBonus(BOT, u, 3), { ok: true, total: 3 });
  assert.equal(M.useLimitBonus(BOT, u, 2), 2);
  assert.equal(M.useLimitBonus(BOT, u, 5), 1, "hanya sisa bonus yang bisa dipakai");
  assert.equal(M.getLimitBonus(BOT, u), 0);
  assert.equal(M.useLimitBonus(BOT, u, 1), 0);
});

test("perubahan ditulis atomik ke file dan bisa dibaca ulang", () => {
  const u = "6287777777";
  M.addBotPremium(BOT, u, 3);
  M.flushBotScope();
  const disk = JSON.parse(fs.readFileSync(FILE, "utf8"));
  assert.ok(disk[BOT].premium[u]);
  assert.ok(!Object.prototype.hasOwnProperty.call(disk, "__proto__"), "kunci jahat tidak ikut tersimpan");
  assert.ok(!("bukan-nomor" in disk));
  assert.ok(!fs.readdirSync(path.dirname(FILE)).some((f) => f.includes(".tmp-")), "file sementara tidak tertinggal");
  const segar = M.reloadBotScope();
  assert.equal(Object.getPrototypeOf(segar), null);
  assert.ok(M.isBotPremium(BOT, u));
});

test("purgeBot menghapus semua data bot itu", () => {
  const lain = "6281000000001";
  M.addLimitBonus(lain, "6288888888", 4);
  assert.equal(M.hasBotScope(lain), true);
  assert.equal(M.purgeBot(lain), true);
  assert.equal(M.hasBotScope(lain), false);
  assert.equal(M.purgeBot("__proto__"), false);
});

test("scopeFor: owner utama global, owner bot hanya botnya, selain itu ditolak", () => {
  assert.deepEqual(M.scopeFor({ isMainOwner: true }), { mode: "global" });
  assert.deepEqual(M.scopeFor({ isJadibot: true, isBotOwner: true, botNumber: BOT }), { mode: "bot", bot: BOT });
  assert.equal(M.scopeFor({ isJadibot: true, isBotOwner: true, botNumber: "__proto__" }), null);
  assert.equal(M.scopeFor({ isJadibot: false, isBotOwner: true, botNumber: BOT }), null);
  assert.equal(M.scopeFor({ isJadibot: true, isBotOwner: false, botNumber: BOT }), null);
  assert.equal(M.scopeFor(), null);
});

test("renderBotText: placeholder diganti sekali jalan, panjang dibatasi", () => {
  const t = M.renderBotText("Hai {pushname}, owner {OWNER} di {weburl} pakai {prefix}menu {lain}", {
    pushname: "{owner}", owner: "62811",
  });
  assert.equal(t, "Hai {owner}, owner 62811 di https://contoh.test pakai .menu {lain}");
  assert.equal(M.renderBotText("x".repeat(5000)).length, M.MAX_TEKS_EDIT);
  assert.equal(M.renderBotText(null), "");
});

test("getBotIdentity: bot user tidak pernah menampilkan nomor operator", () => {
  const user = M.getBotIdentity({ isJadibot: true, botNumber: "628123", sessionConfig: {} });
  assert.equal(user.owner, "628123");
  assert.equal(user.name, "Varesa");
  const dgnOwner = M.getBotIdentity({ isJadibot: true, botNumber: "628123", sessionConfig: { owners: ["62899"], botName: "Toko" } });
  assert.deepEqual(dgnOwner, { isUserBot: true, name: "Toko", owner: "62899", ownerLink: "https://wa.me/62899" });
  assert.equal(M.getBotIdentity({ isJadibot: false }).owner, "6280000000001");
  assert.equal(M.formatTanggalWIB("bukan tanggal"), "-");
  assert.match(M.formatTanggalWIB("2026-10-15T00:00:00Z"), /WIB$/);
});
