//recode manzzy
import nodeFetch from "node-fetch";

const API_BASE = "https://checkton.online/backend";
const API_KEY  = "x3Ft9ID6pGN4hOBDer0aWpF8d05antjyBkBn1veSsiA";
const TIMEOUT  = 30000;

const USER_AGENTS = [
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];
const ACCEPT_LANGS = [
  "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "en-US,en;q=0.9,id;q=0.8",
  "id,en-US;q=0.9,en;q=0.8",
];

const _rnd = arr => arr[Math.floor(Math.random() * arr.length)];
const _hex = n   => [...Array(n)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");

function getHeaders() {
  const h = {
    "Content-Type":    "application/json",
    "x-api-key":       API_KEY,
    "User-Agent":      _rnd(USER_AGENTS),
    "Accept":          "application/json, */*",
    "Accept-Language": _rnd(ACCEPT_LANGS),
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control":   "no-cache",
    "Connection":      "keep-alive",
    "X-Request-ID":    _hex(16),
  };
  if (Math.random() > 0.5) h["Origin"]  = "https://m.mobilelegends.com";
  if (Math.random() > 0.6) h["Referer"] = "https://m.mobilelegends.com/";
  return h;
}

async function postAPI(endpoint, payload) {
  // Jitter kecil 
  await new Promise(r => setTimeout(r, 100 + Math.floor(Math.random() * 500)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await nodeFetch(`${API_BASE}/${endpoint}`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error("Timeout: Server tidak merespons dalam 30 detik");
    throw err;
  }
}

async function apiInfo(payload)     { return postAPI("info", payload); }
async function apiInfoBan(roleId, zoneId) {
  try {
    const res = await postAPI("info", { role_id: roleId, zone_id: zoneId, type: "ban" });
    if (!res || res.status !== 0) return null;
    return res;
  } catch { return null; }
}
async function apiBanInfoById(roleId, zoneId) {
  const payloads = [
    { role_id: roleId, zone_id: zoneId, type: "ban"   },
    { role_id: roleId, zone_id: zoneId                 },
    { role_id: roleId, zone_id: zoneId, type: "check" },
    { openid:  roleId, server_id: zoneId, type: "ban" },
    { openid:  roleId, zone_id: zoneId,   type: "ban" },
  ];
  for (const p of payloads) {
    try {
      const res = await postAPI("getBanInfo", p);
      if (!res) continue;
      const ok = res.status === 0 || res.data != null ||
                 res.ban_status != null || res.is_banned != null || res.banned != null;
      if (ok) return res;
    } catch {}
  }
  return null;
}

// ══════════════════════════════════════════════════════════
//  HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════
function safe(v, fb = "N/A") {
  return (v == null || v === "") ? fb : String(v);
}
function escHTML(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function parseRankFull(tier, stars) {
  if (!tier) return "N/A";
  const s = String(tier).trim();
  return (stars && stars !== "0" && stars !== "") ? `${s} (${stars} stars)` : s;
}
function formatTTL(ttl) {
  if (!ttl) return { dateStr: "—", ageStr: "—", year: "—" };
  try {
    const d = new Date(ttl);
    if (isNaN(d)) return { dateStr: String(ttl), ageStr: "—", year: String(ttl).slice(0, 4) };
    const days   = Math.floor((Date.now() - d.getTime()) / 86400000);
    const years  = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    const ageStr = years > 0 ? `${years} tahun ${months} bulan (${days} hari)`
                 : months > 0 ? `${months} bulan (${days} hari)` : `${days} hari`;
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return { dateStr: `${d.getFullYear()}-${mo}-${da}`, ageStr, year: String(d.getFullYear()) };
  } catch { return { dateStr: String(ttl), ageStr: "—", year: String(ttl).slice(0, 4) }; }
}
function readBanStatus(d) {
  if (!d) return "unknown";
  const raw = d.ban_status ?? d.banStatus ?? d.is_banned ?? d.banned ?? d.isBanned ??
              d.account_status ?? d.accountStatus ?? d.user_status ?? d.userStatus ??
              d.status_ban ?? d.ban ?? d.is_block ?? d.isBlock ?? null;
  if (raw === null) return "unknown";
  const s = String(raw).toLowerCase().trim();
  const BANNED = new Set(["banned","ban","yes","1","true","suspended","blocked","suspend","restrict","restricted"]);
  const ACTIVE  = new Set(["normal","active","no","0","false","not_banned","ok","safe","clean","enabled"]);
  if (raw === true  || raw === 1  || BANNED.has(s)) return "banned";
  if (raw === false || raw === 0  || ACTIVE.has(s))  return "active";
  return "unknown";
}
function readBanDetail(d) {
  if (!d) return { reason: "—", expire: "—", type: "—" };
  return {
    reason: escHTML(safe(d.ban_reason || d.reason || d.banReason, "—")),
    expire: escHTML(safe(d.ban_expire_time || d.banExpireTime || d.expire_time, "—")),
    type:   escHTML(safe(d.ban_type || d.banType, "—")),
  };
}
// Bersihkan HTML tag → format WA (*bold*, _italic_, `code`)
function stripHtml(str) {
  return String(str ?? "")
    .replace(/<b>(.*?)<\/b>/gi, "*$1*")
    .replace(/<i>(.*?)<\/i>/gi, "_$1_")
    .replace(/<code>(.*?)<\/code>/gi, "`$1`")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .trim();
}

// ══════════════════════════════════════════════════════════
//  INTERNAL API WRAPPERS
// ══════════════════════════════════════════════════════════
async function callInfoAPI(payload) {
  const res = await apiInfo(payload);
  if (!res) throw new Error("Tidak ada respons dari server");
  if (res.status !== 0) throw new Error(res.message || "Data tidak ditemukan");
  if (!res.data) throw new Error("Data kosong dari server");
  return res.data;
}
async function callFindAPI(nickname) {
  const res = await apiInfo({ name: nickname, role_id: "null", type: "find" });
  if (!res) throw new Error("Tidak ada respons dari server");
  if (res.status !== 0) throw new Error(res.message || "Nickname tidak ditemukan");
  if (!res.data) throw new Error("Data kosong dari server");
  return res.data;
}

// ══════════════════════════════════════════════════════════
//  FEATURE: LOOKUP
// ══════════════════════════════════════════════════════════
async function doLookup(roleId, zoneId) {
  const d = await callInfoAPI({ role_id: roleId, zone_id: zoneId, type: "lookup" });

  const name      = escHTML(safe(d.name));
  const id        = safe(d.role_id, roleId);
  const zone      = safe(d.zone_id, zoneId);
  const level     = safe(d.level, "0");
  const credits   = safe(d.credits_score, "100");
  const followers = safe(d.followers, "0");
  const lastMatch = safe(d.last_match_date, "—");
  const lastLogin = safe(d.last_login, "—");

  const squadName   = escHTML(safe(d.squad_name, "None"));
  const squadId     = safe(d.squad_id, "None");
  const squadPrefix = escHTML(safe(d.squad_prefix, ""));

  const rankStr     = d.current_tier
    ? parseRankFull(safe(d.current_tier), safe(d.current_stars ?? d.current_tier_stars, "")) : "N/A";
  const highRankStr = d.max_tier
    ? parseRankFull(safe(d.max_tier), safe(d.max_stars ?? d.max_tier_stars, "")) : "N/A";

  const locs = Array.isArray(d.locations_logged) && d.locations_logged.length
    ? escHTML(d.locations_logged.join(", "))
    : safe(d.location || d.last_location, "—");

  const winRate    = safe(d.overall_win_rate || d.win_rate, "0%");
  const totalMatch = safe(d.total_match_played || d.total_match, "0");

  const heroes = Array.isArray(d.top_3_hero_details) ? d.top_3_hero_details : [];
  let heroLines = "";
  heroes.slice(0, 3).forEach((h, i) => {
    const pfx = i < 2 ? "┣" : "┗";
    heroLines += `${pfx} ${escHTML(safe(h.hero || h.name))}: ${safe(h.matches || h.match_count)} M (${safe(h.win_rate || h.wr)})\n`;
  });
  if (!heroLines) heroLines = "┗ Data hero tidak tersedia\n";

  const collTitle = escHTML(safe(d.collector_title, "N/A"));
  const achPoints = safe(d.achievement_points, "0");
  const skinCount = safe(d.skin_count, "0");
  const supSkin   = safe(d.supreme_skins, "0");
  const grandSkin = safe(d.grand_skins, "0");
  const exqSkin   = safe(d.exquisite_skins, "0");
  const delSkin   = safe(d.deluxe_skins, "0");
  const excSkin   = safe(d.exceptional_skins, "0");
  const comSkin   = safe(d.common_skins, "0");

  return (
    `🏷 *Name:* ${escHTML(safe(d.name))}\n` +
    `🆔 *ID:* ${id} (${zone})\n` +
    `💿 *Level:* ${level}\n` +
    `💳 *Creditscore:* ${credits}\n` +
    `👥 *Followers:* ${followers}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `⚔️ *Squad & Rank*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🎗️ *Squad:* ${squadPrefix ? `[${squadPrefix}] ${squadName}` : squadName}\n` +
    `🆔 *Sq ID:* ${squadId}\n` +
    `🏆 *Rank:* ${rankStr}\n` +
    `👑 *High Rank:* ${highRankStr}\n` +
    `🌐 *Location:* ${locs}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📈 *Battle Stats*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔥 *Win Rate:* ${winRate}\n` +
    `🎲 *Total Match:* ${totalMatch}\n` +
    `🌟 *Top 3 Hero*\n` +
    `${heroLines.trimEnd()}\n` +
    `🎳 *Last Match:* ${lastMatch}\n` +
    `⌛ *Last Login:* ${lastLogin}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🎨 *Skins & Collector*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🥇 *Collector Title:* ${collTitle}\n` +
    `🎖️ *Achievement Pts:* ${achPoints}\n` +
    `✨ *Skin Count:* ${skinCount}\n` +
    `• Supreme: ${supSkin} | Grand: ${grandSkin}\n` +
    `• Exquisite: ${exqSkin} | Deluxe: ${delSkin}\n` +
    `• Exceptional: ${excSkin} | Common: ${comSkin}\n` +
    `━━━━━━━━━━━━━━━━━━━━`
  );
}

// ══════════════════════════════════════════════════════════
//  FEATURE: BAN V1 — TANPA STATUS "TIDAK DIKETAHUI"
//  Jika server tidak return field ban → tampilkan TIDAK BANNED
//  (logika: server MLBB hanya return banned jika akun benar-benar kena ban)
// ══════════════════════════════════════════════════════════
async function doBanV1(roleId, zoneId) {
  const SEP = "━━━━━━━━━━━━━━━━━━━━";

  const [banRaw, infoBanRaw, lookupRaw] = await Promise.all([
    apiBanInfoById(roleId, zoneId),
    apiInfoBan(roleId, zoneId),
    callInfoAPI({ role_id: roleId, zone_id: zoneId, type: "lookup" }).catch(() => null),
  ]);

  // Cek semua sumber — prioritas: getBanInfo > infoBan > lookup
  const sources = [
    banRaw?.data    ?? banRaw    ?? null,
    infoBanRaw?.data            ?? null,
    lookupRaw                   ?? null,
  ];

  let isBanned  = false;
  let banDetail = { reason: "—", expire: "—", type: "—" };

  for (const src of sources) {
    if (!src) continue;
    const r = readBanStatus(src);
    if (r === "banned") {
      isBanned  = true;
      banDetail = readBanDetail(src);
      break;
    }
    if (r === "active") break;
    // "unknown" → lanjut ke sumber berikutnya; kalau semua unknown → anggap aktif
  }

  const id   = escHTML(safe(lookupRaw?.role_id ?? banRaw?.data?.role_id ?? roleId));
  const zone = escHTML(safe(lookupRaw?.zone_id ?? banRaw?.data?.zone_id ?? zoneId));

  if (isBanned) {
    const alasan = banDetail.reason !== "—"
      ? banDetail.reason
      : escHTML(safe(
          banRaw?.data?.ban_reason ?? banRaw?.ban_reason ??
          infoBanRaw?.data?.ban_reason ?? lookupRaw?.ban_reason,
          "Tidak diketahui"
        ));
    const expireLine = banDetail.expire !== "—" ? `\n${SEP}\n🕐 *Expire:* ${banDetail.expire}` : "";
    const typeLine   = banDetail.type   !== "—" ? `\n🔖 *Tipe:* ${banDetail.type}` : "";

    return (
      `🚫 *STATUS BAN AKUN*\n${SEP}\n` +
      `🪪 *ID:* ${id}\n` +
      `🌐 *Server:* ${zone}\n${SEP}\n` +
      `🔴 *Status: TERBANNED*\n${SEP}\n` +
      `📝 *Alasan*\n   ${alasan}${expireLine}${typeLine}\n${SEP}\n` +
      `⚠️ Akun ini sedang dalam masa banned.`
    );
  }

  // Tidak banned (termasuk unknown → dianggap aman)
  return (
    `🚫 *STATUS BAN AKUN*\n${SEP}\n` +
    `🪪 *ID:* ${id}\n` +
    `🌐 *Server:* ${zone}\n${SEP}\n` +
    `🟢 *Status: TIDAK BANNED*\n${SEP}\n` +
    `✅ Akun ini aman, tidak dalam masa banned.`
  );
}

// ══════════════════════════════════════════════════════════
//  FEATURE: BIND
// ══════════════════════════════════════════════════════════
async function doBind(roleId, zoneId) {
  const d       = await callInfoAPI({ role_id: roleId, zone_id: zoneId, type: "bind" });
  const name    = escHTML(safe(d.nickname || d.name));
  const id      = safe(d.role_id, roleId);
  const zone    = safe(d.zone_id, zoneId);
  const ttlInfo = formatTTL(d.ttl || d.creation_year);
  const binds   = Array.isArray(d.bind_accounts) ? d.bind_accounts : [];

  let bindLines = "";
  if (binds.length) {
    binds.forEach(b => {
      const platform = escHTML(safe(b.platform || b.type, "Unknown"));
      const details  = escHTML(safe(b.details  || b.account, "—"));
      bindLines += `${b.connected !== false ? "✅" : "❌"} *${platform}:* ${details}\n`;
    });
  } else {
    bindLines = "⚪ Tidak ada data bind\n";
  }

  const dv = d.devices || {};
  return (
    `🔗 *HASIL CEK BIND AKUN*\n` +
    `🏷 *Name:* ${name}\n` +
    `🆔 *ID:* ${id} (${zone})\n` +
    `📅 *Dibuat:* ${ttlInfo.year}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔐 *STATUS BIND PLATFORM*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${bindLines.trimEnd()}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📱 *INFO DEVICE LOGIN*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🤖 *Android:* Total ${safe(dv.android?.total, "0")} (Active ${safe(dv.android?.active, "0")})\n` +
    `🍎 *iOS:* Total ${safe(dv.ios?.total, "0")} (Active ${safe(dv.ios?.active, "0")})\n` +
    `📊 *Total Devices:* ${safe(dv.total_devices, "0")}\n` +
    `━━━━━━━━━━━━━━━━━━━━`
  );
}

// ══════════════════════════════════════════════════════════
//  FEATURE: FIND
// ══════════════════════════════════════════════════════════
async function doFind(nickname) {
  const list     = await callFindAPI(nickname);
  const accounts = Array.isArray(list) ? list : [list];
  if (!accounts.length) throw new Error("Tidak ada akun ditemukan");

  let rows = "";
  accounts.slice(0, 10).forEach((acc, i) => {
    const n    = escHTML(safe(acc.name));
    const rid  = safe(acc.role_id);
    const zid  = safe(acc.zone_id);
    const lv   = safe(acc.level);
    const ct   = safe(acc.current_tier, "");
    const cs   = safe(acc.current_stars ?? acc.current_tier_stars, "");
    const rank = ct ? parseRankFull(ct, cs) : "—";
    rows += `\n*${i + 1}. ${n}*\n   🆔 Role ID: \`${rid}\`\n   🌐 Zone ID: \`${zid}\`\n   ⭐ Level: ${lv} | 🏅 ${rank}\n`;
  });

  return (
    `🔎 *HASIL FIND NICKNAME*\n` +
    `🔍 Keyword: *${escHTML(nickname)}*\n` +
    `📊 Ditemukan: *${accounts.length} akun*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    rows +
    `\n━━━━━━━━━━━━━━━━━━━━`
  );
}

// ══════════════════════════════════════════════════════════
//  FEATURE: CREATION DATE
// ══════════════════════════════════════════════════════════
async function doCreation(roleId, zoneId) {
  const d       = await callInfoAPI({ role_id: roleId, zone_id: zoneId, type: "lookup" });
  const name    = escHTML(safe(d.name));
  const id      = safe(d.role_id, roleId);
  const zone    = safe(d.zone_id, zoneId);
  const level   = safe(d.level, "0");
  const ttlInfo = formatTTL(d.ttl);
  const ct      = safe(d.current_tier, "");
  const cs      = safe(d.current_stars ?? d.current_tier_stars, "");
  const rankStr = ct ? parseRankFull(ct, cs) : "—";

  return (
    `📅 *CEK CREATION DATE MLBB*\n` +
    `🏷 *Name:* ${name}\n` +
    `🆔 *ID:* ${id} (${zone})\n` +
    `💿 *Level:* ${level}\n` +
    `🏅 *Rank:* ${rankStr}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🗓️ *INFO TANGGAL PEMBUATAN*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📅 *Tanggal Dibuat:* ${ttlInfo.dateStr}\n` +
    `📆 *Tahun Dibuat:* ${ttlInfo.year}\n` +
    `⏳ *Umur Akun:* ${ttlInfo.ageStr}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ Data 100% akurat dari server MLBB`
  );
}

export { doLookup, doBanV1, doBind, doFind, doCreation };