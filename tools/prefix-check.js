/**
 * tools/prefix-check.js — uji logika prefix & alias per bot tanpa jaringan.
 *
 *   node tools/prefix-check.js
 *
 * Memakai lib/bot-prefix.js apa adanya (modul itu hanya bergantung pada
 * fs/path + config.js), jadi bisa dijalankan di server yang belum
 * `npm install`.
 */
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  normalkanPrefix,
  normalkanAlias,
  normalkanPerintah,
  uraikanPesan,
  terapkanAlias,
  petaAliasDariConfig,
  prefixTampilan,
  ALIAS_DILINDUNGI,
} from "../lib/bot-prefix.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

let gagal = 0;
const cek = (nama, kondisi, extra = "") => {
  console.log(`${kondisi ? "✅" : "❌"} ${nama}${extra ? " — " + extra : ""}`);
  if (!kondisi) gagal++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── Normalisasi prefix ──────────────────────────────────────────────
cek("prefix '.' diterima", eq(normalkanPrefix("."), ["."]));
cek("prefix '!' diterima", eq(normalkanPrefix("!"), ["!"]));
cek("daftar campuran dibersihkan", eq(normalkanPrefix([".", "..xx", "a", "", "#"]), [".", "#"]));
cek("huruf ditolak (tidak dianggap prefix)", eq(normalkanPrefix("a"), []));
cek("maksimal 5 prefix", normalkanPrefix([".", "!", "#", "/", ",", "?", "*"]).length === 5);

// ── Uraian pesan ────────────────────────────────────────────────────
let u = uraikanPesan("!menu halo", ["!"], { statusPrefix: true });
cek("prefix bot dipakai", u.prefixDipakai && u.prefix === "!" && u.command === "menu" && u.sisa === "halo",
  JSON.stringify(u));

u = uraikanPesan("!menu", ["!"], {});
cek("tanpa argumen sisa kosong", u.command === "menu" && u.sisa === "");

u = uraikanPesan(".menu", ["!"], { statusPrefix: true });
cek("prefix lain tidak diterima", !u.prefixDipakai && u.command === "");

u = uraikanPesan("menu", ["!"], { statusPrefix: false });
cek("tanpa prefix diterima kalau status_prefix false", !u.prefixDipakai && u.command === "menu");

u = uraikanPesan("menu", ["!"], { statusPrefix: true });
cek("tanpa prefix ditolak kalau status_prefix true", u.command === "");

u = uraikanPesan("!  menu   a b", ["!"], {});
cek("spasi berlebih dirapikan", u.command === "menu" && u.sisa === "a b", JSON.stringify(u));

// ── Alias ───────────────────────────────────────────────────────────
cek("alias dialihkan", terapkanAlias("ss", { ss: "sticker" }) === "sticker");
cek("command tanpa alias tetap", terapkanAlias("menu", { ss: "sticker" }) === "menu");
cek("perintah inti tidak bisa dialihkan", terapkanAlias("menu", { menu: "delete" }) === "menu");
cek("ALIAS_DILINDUNGI memuat menu/ping",
  ALIAS_DILINDUNGI.has("menu") && ALIAS_DILINDUNGI.has("ping"));
cek("peta alias membuang entri rusak",
  eq(petaAliasDariConfig({ alias: { ss: "sticker", "!!": "", "^": "menu" } }), { ss: "sticker" }));
cek("alias bentuk {cmd} juga didukung",
  eq(petaAliasDariConfig({ alias: { ss: { cmd: "sticker" } } }), { ss: "sticker" }));
cek("nama alias dibersihkan", normalkanAlias("  SS!! ") === "ss");
cek("tujuan perintah dibersihkan", normalkanPerintah(".Sticker") === "sticker");

// ── Tampilan ────────────────────────────────────────────────────────
cek("prefix tampilan dari daftar", prefixTampilan(["!", "."]) === "!");

// ── Pemetaan per bot (cache jadibot tiruan) ─────────────────────────
const { prefixUntukBot } = await import("../lib/bot-prefix.js");
const cache = {
  "628111": { config: { prefix: ["!"] } },
  "628222": { config: { prefix: ["#"] } },
  "628333": { config: { prefix: [] } },
};
const getCache = () => cache;
cek("bot A memakai '!'", eq(prefixUntukBot("628111", { getJadibotCache: getCache }), ["!"]));
cek("bot B memakai '#'", eq(prefixUntukBot("628222", { getJadibotCache: getCache }), ["#"]));
cek("bot tanpa setelan jatuh ke bawaan", prefixUntukBot("628333", { getJadibotCache: getCache }).includes("."));
cek("nomor tak dikenal jatuh ke bawaan", prefixUntukBot("628999", { getJadibotCache: getCache }).includes("."));
cek("bot utama (tanpa nomor) jatuh ke bawaan", prefixUntukBot("", { getJadibotCache: getCache }).includes("."));
cek("prefix bot tidak bocor ke bot lain",
  prefixUntukBot("628111", { getJadibotCache: getCache })[0] !== prefixUntukBot("628222", { getJadibotCache: getCache })[0]);

// Modul ini harus tetap bisa dimuat tanpa node_modules (dipakai jalur pesan).
const src = readFileSync(path.join(ROOT, "lib", "bot-prefix.js"), "utf8");
const imporNpm = [...src.matchAll(/from\s+["']([^"']+)["']/g)]
  .map((m) => m[1])
  .filter((n) => !n.startsWith(".") && !n.startsWith("/") && !n.startsWith("node:"));
cek("modul tidak mengimpor dependensi npm", imporNpm.length === 0, imporNpm.join(", "));

console.log(gagal ? `\n${gagal} uji GAGAL` : "\nSemua uji prefix/alias lulus.");
process.exit(gagal ? 1 : 0);