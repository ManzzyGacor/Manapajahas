// lib/bot-prefix.js — prefix & alias command per bot.
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalkanPrefix, normalkanPerintah, normalkanAlias, prefixUntukBot, prefixTampilan,
  terapkanAlias, petaAliasDariConfig, uraikanPesan, ALIAS_DILINDUNGI, PREFIX_SIMBOL,
} from "../lib/bot-prefix.js";

test("normalkanPrefix: hanya simbol pendek, unik, maksimal 5", () => {
  assert.deepEqual(normalkanPrefix("."), ["."]);
  assert.deepEqual(normalkanPrefix([".", "..", "...", "a", "", "  #  ", ".", null, 7]), [".", "..", "#"]);
  assert.deepEqual(normalkanPrefix("a"), [], "huruf bukan prefix (obrolan biasa tidak boleh jadi command)");
  assert.deepEqual(normalkanPrefix("1"), []);
  assert.equal(normalkanPrefix(PREFIX_SIMBOL).length, 5);
  assert.deepEqual(normalkanPrefix(undefined), []);
  assert.deepEqual(normalkanPrefix({ 0: "." }), []);
});

test("normalkanPerintah & normalkanAlias membersihkan input user", () => {
  assert.equal(normalkanPerintah(".Menu"), "menu");
  assert.equal(normalkanPerintah("!!tik tok<script>"), "tiktokscript");
  assert.equal(normalkanPerintah("x".repeat(50)).length, 30);
  assert.equal(normalkanPerintah(null), "");
  assert.equal(normalkanAlias("..."), "");
  assert.equal(normalkanAlias("-_-"), "");
  assert.equal(normalkanAlias("dl2"), "dl2");
});

test("prefixUntukBot: setelan bot sendiri, lalu prefix bawaan config", () => {
  const sebelum = globalThis.configPrefix;
  try {
    globalThis.configPrefix = [".", "!"];
    const cache = { 628111: { config: { prefix: ["#"] } }, 628222: { config: { prefix: ["abc"] } } };
    const getJadibotCache = () => cache;
    assert.deepEqual(prefixUntukBot("628111", { getJadibotCache }), ["#"]);
    assert.deepEqual(prefixUntukBot("628222", { getJadibotCache }), [".", "!"], "setelan tidak valid -> bawaan");
    assert.deepEqual(prefixUntukBot("628333", { getJadibotCache }), [".", "!"]);
    assert.deepEqual(prefixUntukBot("628111", { getJadibotCache: () => { throw new Error("cache rusak"); } }), [".", "!"]);
    assert.deepEqual(prefixUntukBot("628111"), [".", "!"]);
    globalThis.configPrefix = undefined;
    assert.deepEqual(prefixUntukBot("628333", { getJadibotCache }), ["."], "tanpa config -> titik");
    assert.equal(prefixTampilan([]), ".");
    assert.equal(prefixTampilan(["!", "."]), "!");
  } finally {
    globalThis.configPrefix = sebelum;
  }
});

test("terapkanAlias: alias dialihkan, command inti tidak bisa dibajak", () => {
  const peta = { dl: "tiktok", menu: "jahat", help: "jahat" };
  assert.equal(terapkanAlias("DL", peta), "tiktok");
  assert.equal(terapkanAlias("menu", peta), "menu");
  for (const c of ALIAS_DILINDUNGI) assert.equal(terapkanAlias(c, { [c]: "jahat" }), c, c);
  assert.equal(terapkanAlias("play", peta), "play");
  assert.equal(terapkanAlias("dl", null), "dl");
  assert.equal(terapkanAlias("", peta), "");
});

test("terapkanAlias tidak mengikuti prototype Object", () => {
  for (const c of ["constructor", "__proto__", "tostring", "hasownproperty"]) {
    assert.equal(terapkanAlias(c, {}), c, c);
  }
});

test("petaAliasDariConfig: entri rusak dibuang, maksimal 100", () => {
  const alias = { "!DL": "tiktok", sticker: { cmd: ".S" }, "...": "menu", kosong: "", rusak: { cmd: null } };
  for (let i = 0; i < 150; i++) alias[`a${i}`] = "menu";
  const peta = petaAliasDariConfig({ alias });
  assert.equal(peta.dl, "tiktok");
  assert.equal(peta.sticker, "s");
  assert.ok(!("kosong" in peta) && !("rusak" in peta));
  assert.equal(Object.keys(peta).length, 100);
  assert.deepEqual(petaAliasDariConfig(null), {});
  assert.deepEqual(petaAliasDariConfig({ alias: "bukan-objek" }), {});
});

test("uraikanPesan: prefix, command, sisa teks", () => {
  assert.deepEqual(uraikanPesan("  !Menu   halo dunia ", ["!"]), { prefix: "!", command: "menu", sisa: "halo dunia", prefixDipakai: true });
  assert.deepEqual(uraikanPesan("!menu", ["!"]), { prefix: "!", command: "menu", sisa: "", prefixDipakai: true });
  assert.deepEqual(uraikanPesan("! menu x", ["!"]), { prefix: "!", command: "menu", sisa: "x", prefixDipakai: true });
  assert.equal(uraikanPesan(".menu", ["!"]).command, "", "prefix bot lain tidak diterima");
  assert.equal(uraikanPesan("menu", ["."]).command, "", "tanpa prefix ditolak secara bawaan");
  assert.deepEqual(uraikanPesan("Menu satu", ["."], { statusPrefix: false }), { prefix: "", command: "menu", sisa: "satu", prefixDipakai: false });
  assert.equal(uraikanPesan(null, ["."]).command, "");
  assert.equal(uraikanPesan(".menu", []).command, "", "daftar kosong = tidak ada prefix");
});
