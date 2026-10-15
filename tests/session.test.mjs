// lib/session.js — token sesi login bertanda tangan (cookie vrs_sid).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pindahKeFolderSementara, HARI_MS } from "./_helpers.mjs";

// Rahasia otomatis disimpan di <cwd>/database/runtime/session-secret:
// pindah ke folder sementara dulu supaya test tidak membuat/membaca rahasia
// asli milik server.
const FOLDER = pindahKeFolderSementara("sesi");
delete process.env.SESSION_SECRET;
const S = await import("../lib/session.js");

const RAHASIA = "r".repeat(48);
const pakaiRahasia = (v = RAHASIA) => S.setSessionSecret(v);

// Tanda tangan dibuat sendiri (dengan rahasia yang sama), untuk menguji
// cabang validasi yang hanya bisa dicapai dengan tanda tangan "sah".
const tandaTangan = (body, secret = RAHASIA) => crypto.createHmac("sha256", secret).update(body).digest("base64url");

test("sign -> verify: uid, versi sesi, dan masa berlaku 30 hari", () => {
  pakaiRahasia();
  const now = Date.now();
  const token = S.signSession("1234567890", 3, { now });
  assert.match(token, /^v1\.[A-Za-z0-9_-]+\.3\.\d+\.[A-Za-z0-9_-]{43}$/);
  const p = S.verifySession(token, { now });
  assert.equal(p.uid, "1234567890");
  assert.equal(p.sv, 3);
  // exp disimpan dalam detik -> selisih < 1 detik dari 30 hari.
  assert.ok(Math.abs(p.exp - (now + S.SESSION_TTL_MS)) < 1000);
  assert.equal(S.SESSION_TTL_MS, 30 * HARI_MS);
});

test("uid berisi titik/unicode tetap utuh (dikodekan base64url)", () => {
  pakaiRahasia();
  for (const uid of ["a.b.c", "user@mail.test", "pengguna-ünïcödé", "x".repeat(256)]) {
    const p = S.verifySession(S.signSession(uid));
    assert.equal(p?.uid, uid, uid);
  }
});

test("signSession menolak uid kosong / bukan teks / terlalu panjang", () => {
  pakaiRahasia();
  for (const uid of ["", null, undefined, 123, {}, "x".repeat(257)]) {
    assert.throws(() => S.signSession(uid), /uid sesi tidak valid/, String(uid));
  }
});

test("versi sesi yang aneh dianggap 0", () => {
  pakaiRahasia();
  for (const sv of [-1, 1.5, "2", NaN, null]) {
    assert.equal(S.verifySession(S.signSession("u1", sv)).sv, 0, String(sv));
  }
});

test("token yang diubah sedikit pun ditolak", () => {
  pakaiRahasia();
  const token = S.signSession("korban", 0);
  const [v, uid, sv, exp, sig] = token.split(".");
  const lain = Buffer.from("penyerang").toString("base64url");
  const kasus = {
    "uid diganti": [v, lain, sv, exp, sig],
    "versi sesi diganti": [v, uid, "1", exp, sig],
    "exp diperpanjang": [v, uid, sv, String(Number(exp) + 86400 * 365), sig],
    "versi token diganti": ["v2", uid, sv, exp, sig],
    "tanda tangan diganti satu huruf": [v, uid, sv, exp, (sig[0] === "A" ? "B" : "A") + sig.slice(1)],
    "tanda tangan dipotong": [v, uid, sv, exp, sig.slice(0, 42)],
  };
  for (const [nama, parts] of Object.entries(kasus)) {
    assert.equal(S.verifySession(parts.join(".")), null, nama);
  }
});

test("token dari rahasia lain ditolak", () => {
  pakaiRahasia("rahasia-server-lain-".repeat(3));
  const asing = S.signSession("u1");
  pakaiRahasia();
  assert.equal(S.verifySession(asing), null);
  assert.ok(S.verifySession(S.signSession("u1")));
});

test("token kedaluwarsa ditolak", () => {
  pakaiRahasia();
  const now = Date.now();
  const lama = S.signSession("u1", 0, { now: now - 31 * HARI_MS });
  assert.equal(S.verifySession(lama, { now }), null);
  const pendek = S.signSession("u1", 0, { now, ttlMs: 60000 });
  assert.ok(S.verifySession(pendek, { now: now + 30000 }));
  assert.equal(S.verifySession(pendek, { now: now + 61000 }), null);
});

test("bentuk token rusak -> null, bukan error", () => {
  pakaiRahasia();
  for (const t of [undefined, null, 42, {}, "", "v1", "v1.a.b.c", "v1.a.0.1.sig.extra", "x".repeat(601), "v1.YQ.0.99999999999.!!!"]) {
    assert.equal(S.verifySession(t), null, String(t).slice(0, 30));
  }
});

test("uid base64url yang tidak kanonik ditolak walau tanda tangannya sah", () => {
  pakaiRahasia();
  // "YR" dan "YQ" sama-sama terbaca "a"; hanya "YQ" bentuk resmi.
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const kanonik = `v1.YQ.0.${exp}`;
  assert.equal(S.verifySession(`${kanonik}.${tandaTangan(kanonik)}`)?.uid, "a");
  const nyeleneh = `v1.YR.0.${exp}`;
  assert.equal(S.verifySession(`${nyeleneh}.${tandaTangan(nyeleneh)}`), null);
});

test("shouldRefresh: diperbarui hanya kalau sisa < 7 hari", () => {
  const now = Date.now();
  assert.equal(S.shouldRefresh({ exp: now + 6 * HARI_MS }, { now }), true);
  assert.equal(S.shouldRefresh({ exp: now + 8 * HARI_MS }, { now }), false);
  assert.equal(S.shouldRefresh(null, { now }), false);
  assert.equal(S.SESSION_REFRESH_MS, 7 * HARI_MS);
});

test("parseCookies: banyak cookie, kutip, encoding rusak, nama ganda", () => {
  const c = S.parseCookies('a=1; vrs_sid="v1.x"; b=%E0%A4%A; a=2; =kosong; tanpa-sama; c=x%20y');
  assert.equal(c.a, "1"); // yang pertama menang
  assert.equal(c.vrs_sid, "v1.x");
  assert.equal(c.b, "%E0%A4%A"); // gagal decode -> nilai mentah
  assert.equal(c.c, "x y");
  assert.equal(Object.keys(c).length, 4);
  assert.deepEqual(Object.keys(S.parseCookies(undefined)), []);
  assert.deepEqual(Object.keys(S.parseCookies(123)), []);
});

test("parseCookies tidak mencemari prototype Object", () => {
  const c = S.parseCookies("__proto__=jahat; constructor=x; toString=y");
  assert.equal(Object.getPrototypeOf(c), null);
  assert.equal(c.__proto__, "jahat"); // eslint-disable-line no-proto
  assert.equal({}.jahat, undefined);
  assert.equal(typeof {}.toString, "function");
});

test("readSessionToken membaca cookie vrs_sid dari request", () => {
  assert.equal(S.SESSION_COOKIE, "vrs_sid");
  assert.equal(S.readSessionToken({ headers: { cookie: "x=1; vrs_sid=v1.abc" } }), "v1.abc");
  assert.equal(S.readSessionToken({ headers: {} }), "");
  assert.equal(S.readSessionToken(undefined), "");
});

test("cookie sesi: HttpOnly, SameSite=Lax, Path=/, Max-Age 30 hari, Secure hanya di HTTPS", () => {
  const biasa = S.buildSessionCookie("TOKEN");
  assert.match(biasa, /^vrs_sid=TOKEN; /);
  for (const bagian of ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${30 * 86400}`]) {
    assert.ok(biasa.split("; ").includes(bagian), bagian);
  }
  assert.ok(!biasa.includes("Secure"));
  assert.ok(S.buildSessionCookie("T", { secure: true }).split("; ").includes("Secure"));

  const hapus = S.clearSessionCookie({ secure: true });
  assert.match(hapus, /^vrs_sid=; /);
  assert.ok(hapus.includes("Max-Age=0") && hapus.includes("HttpOnly") && hapus.includes("Secure"));
});

test("rahasia dari env SESSION_SECRET dipakai apa adanya", () => {
  process.env.SESSION_SECRET = "s".repeat(40);
  try {
    S.setSessionSecret(null);
    const token = S.signSession("u-env");
    const body = token.split(".").slice(0, 4).join(".");
    assert.equal(token.split(".")[4], tandaTangan(body, "s".repeat(40)));
  } finally {
    delete process.env.SESSION_SECRET;
    S.setSessionSecret(null);
  }
});

test("tanpa env: rahasia 48 byte dibuat sekali di database/runtime/session-secret (izin 0600)", () => {
  delete process.env.SESSION_SECRET;
  S.setSessionSecret(null);
  assert.equal(S.SECRET_FILE, path.join(FOLDER, "database", "runtime", "session-secret"));
  assert.ok(!fs.existsSync(S.SECRET_FILE));

  const pertama = S.getSessionSecret();
  assert.equal(pertama.length, 48);
  assert.ok(fs.existsSync(S.SECRET_FILE));
  assert.match(fs.readFileSync(S.SECRET_FILE, "utf8").trim(), /^[0-9a-f]{96}$/);
  if (process.platform !== "win32") assert.equal(fs.statSync(S.SECRET_FILE).mode & 0o777, 0o600);

  // "Restart server": rahasia dibaca ulang dari file -> token lama tetap sah.
  const token = S.signSession("u-file");
  S.setSessionSecret(null);
  assert.ok(pertama.equals(S.getSessionSecret()));
  assert.equal(S.verifySession(token)?.uid, "u-file");

  // File rusak/kosong diganti rahasia baru.
  fs.writeFileSync(S.SECRET_FILE, "rusak\n");
  S.setSessionSecret(null);
  const baru = S.getSessionSecret();
  assert.equal(baru.length, 48);
  assert.ok(!baru.equals(pertama));
  S.setSessionSecret(null);
});
