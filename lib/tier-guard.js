/**
 * lib/tier-guard.js
 *
 * Pembatas akses fitur berdasarkan paket (tier) bot.
 * Paket berlaku PER BOT (bukan per akun): tier dibaca lewat getBotConfig()
 * dari dokumen Bot milik nomor ini, lalu di-inject ke
 * messageInfo.sessionConfig oleh autoresbot.js.
 */
import config from "../config.js";

export const TIER_LABEL = {
  free: "Free",
  basic: "Core",
  plus: "Prime",
  booster: "Zenith",
};

const TIER_RANK = { free: 0, basic: 1, plus: 2, booster: 3 };

// Batas per paket — HARUS sama dengan lib/webserver.js
// (OWNER_LIMIT_BY_TIER, AUTOREPLY_QUOTA, CUSTOMCMD_QUOTA) dan app.js.
export const TIER_CAPS = {
  free:    { owners: 0, autoReply: 0,   customCommands: 0,  customize: false, menuImage: false },
  basic:   { owners: 1, autoReply: 10,  customCommands: 0,  customize: true,  menuImage: false },
  plus:    { owners: 3, autoReply: 30,  customCommands: 15, customize: true,  menuImage: false },
  booster: { owners: 5, autoReply: 100, customCommands: 50, customize: true,  menuImage: true  },
};

/**
 * Terapkan batas paket ke config bot SAAT DIBACA bot.
 *
 * Kenapa perlu: config di jadibot.json bisa basi. Tier dibaca live dari
 * database (getBotConfig), tapi isi config lama tidak selalu ikut
 * dibersihkan — mis. perintah kustom tidak dihapus saat paket habis,
 * atau admin menurunkan paket lewat panel. Tanpa ini, bot yang paketnya
 * sudah turun ke Free tetap menjalankan fitur berbayar.
 *
 * Mengembalikan objek baru; config asli tidak diubah.
 */
export function applyTierCaps(cfg = {}) {
  const tier = TIER_CAPS[cfg.tier] ? cfg.tier : "free";
  const caps = TIER_CAPS[tier];
  const out = { ...cfg, tier };

  const owners = String(cfg.ownerNumber || "")
    .split(",")
    .map((n) => n.replace(/\D/g, ""))
    // Nomor lokal "08xx" disamakan ke format internasional "628xx",
    // karena WhatsApp selalu mengirim pengirim dalam format 62.
    .map((n) => (n.startsWith("0") ? `62${n.slice(1)}` : n))
    // Minimal 8 digit: mencegah entri pendek (mis. "62") yang dulu
    // dicocokkan dengan .includes() dan membuat SEMUA orang jadi owner.
    .filter((n) => n.length >= 8)
    .slice(0, caps.owners);
  out.ownerNumber = owners.join(",");
  out.owners = owners;

  if (!caps.customize) {
    out.botName = "";
    out.watermark = "";
    out.footer = "";
    out.customMenu = "";
    // Teks .sewa / .premium buatan owner juga kustomisasi berbayar; bot Free
    // memakai teks bawaan per bot (nama & kontak owner bot itu sendiri).
    out.sewaText = "";
    out.premiumText = "";
  } else {
    // Tetap dibatasi walau server sudah memvalidasi: config bisa diedit
    // manual / dipulihkan dari backup lama.
    out.sewaText = typeof cfg.sewaText === "string" ? cfg.sewaText.slice(0, 1500) : "";
    out.premiumText = typeof cfg.premiumText === "string" ? cfg.premiumText.slice(0, 1500) : "";
  }
  if (!caps.menuImage) out.menuImage = "";

  out.autoReply = Array.isArray(cfg.autoReply) ? cfg.autoReply.slice(0, caps.autoReply) : [];
  out.customCommands = Array.isArray(cfg.customCommands)
    ? cfg.customCommands
        .slice(0, caps.customCommands)
        // Gambar di perintah kustom khusus Zenith (sama seperti di server).
        .map((c) => (caps.menuImage ? c : { ...c, image: "" }))
    : [];

  // Prefix bot ini (bot A memakai "!", bot B memakai "."). Divalidasi ulang
  // di sini karena config bisa diedit manual / dipulihkan dari backup lama:
  // hanya simbol pendek non-huruf, maksimal 5. Kosong = pakai bawaan
  // config.prefix.
  const prefixBersih = (Array.isArray(cfg.prefix) ? cfg.prefix : [])
    .map((p) => String(p ?? "").trim())
    .filter((p) => p && p.length <= 2 && !/^[a-zA-Z0-9]/.test(p))
    .slice(0, 5);
  // Kalau tidak ada satu pun yang lolos validasi (mis. prefix bawaan
  // config.js bukan simbol), JANGAN dikosongkan: pertahankan nilai
  // aslinya supaya command bot tetap bisa dipanggil.
  out.prefix = prefixBersih.length ? prefixBersih : (Array.isArray(cfg.prefix) ? cfg.prefix : []);

  // Alias perintah: { alias: perintah }. Nama dibersihkan agar tidak ada
  // karakter aneh yang masuk ke jalur pencocokan command.
  const aliasMasuk = cfg.alias && typeof cfg.alias === "object" && !Array.isArray(cfg.alias) ? cfg.alias : {};
  const aliasKeluar = {};
  for (const [a, t] of Object.entries(aliasMasuk)) {
    const nama = String(a || "").toLowerCase().replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9_+.-]/g, "").slice(0, 30);
    const ke = String((t && typeof t === "object" ? t.cmd : t) || "")
      .toLowerCase().replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9_+.-]/g, "").slice(0, 30);
    if (!nama || !ke || !/[a-z0-9]/.test(nama)) continue;
    aliasKeluar[nama] = ke;
    if (Object.keys(aliasKeluar).length >= 100) break;
  }
  out.alias = aliasKeluar;

  // Kategori fitur yang dimatikan owner bot ini (semua paket — ini
  // membatasi, bukan membuka fitur). Dibersihkan ulang di sini karena
  // config bisa diedit manual / dipulihkan dari backup lama.
  out.disabledCategories = sanitizeDisabledCategories(cfg.disabledCategories);

  return out;
}

// ── Saklar kategori fitur per bot ──────────────────────────────
// Kunci kategori SAMA PERSIS dengan /api/public/features (lib/webserver.js):
// nama folder plugin, huruf besar, selain huruf/angka jadi "_"
// ("KERANG AJAIB" → "KERANG_AJAIB"); plugin langsung di plugins/ (menu.js,
// owner.js) masuk "LAINNYA". lib/plugins.js menamai kategori itu "main"
// (huruf kecil), jadi dua bentuk itu disamakan di sini.
export const KATEGORI_TERLINDUNG = new Set(["OWNER"]);
// Perintah inti yang tetap jalan walau kategorinya dimatikan: tanpa ini
// owner bisa "mengunci" bot-nya sendiri (menu & kontak owner hilang, prefix
// tidak bisa dikembalikan).
export const PERINTAH_TERLINDUNG = new Set(["menu", "help", "allmenu", "owner", "prefix", "alias"]);
export const MAX_KATEGORI_MATI = 40;

const NAMA_KATEGORI = {
  ADMIN: "Admin Grup",
  AI: "AI",
  ANIME: "Anime",
  BERITA: "Berita",
  DOWNLOAD: "Downloader",
  EDITOR: "Editor Foto",
  GAMES: "Game",
  GROUP: "Grup",
  INFORMATION: "Informasi",
  ISLAMI: "Islami",
  KERANG_AJAIB: "Kerang Ajaib",
  MAKER: "Maker & Stiker",
  MLBB: "Mobile Legends",
  MORE: "Utilitas Bot",
  OWNER: "Owner",
  PREMIUM: "Premium",
  RANDOM: "Random",
  STORE: "Toko",
  TEXTPRO: "Text Pro",
  TOOLS: "Tools",
  LAINNYA: "Umum",
};

/** Kunci kategori ("DOWNLOAD", "KERANG_AJAIB", "LAINNYA") dari nama mentah. */
export function categoryKey(raw) {
  const s = String(raw ?? "").trim();
  if (!s || /^(main|lainnya)$/i.test(s)) return "LAINNYA";
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "LAINNYA";
}

/** Nama kategori yang ramah dibaca ("GAMES" → "Game"). */
export function categoryName(raw) {
  const key = categoryKey(raw);
  if (NAMA_KATEGORI[key]) return NAMA_KATEGORI[key];
  const t = key.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Bersihkan daftar kategori yang dimatikan: hanya kunci huruf besar/angka/_
 * (maks 40 karakter), tanpa duplikat, tanpa kategori terlindung, maks 40.
 */
export function sanitizeDisabledCategories(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const k = categoryKey(item);
    if (!/^[A-Z0-9_]{1,40}$/.test(k) || KATEGORI_TERLINDUNG.has(k) || out.includes(k)) continue;
    out.push(k);
    if (out.length >= MAX_KATEGORI_MATI) break;
  }
  return out;
}

/**
 * Apakah perintah ini (dari plugin berkategori `category`) dimatikan owner
 * bot ini? Perintah inti & kategori terlindung tidak pernah dimatikan.
 * Mengembalikan kunci kategori yang mati, atau null.
 */
export function disabledCategoryFor(sessionConfig, category, command = "") {
  const daftar = Array.isArray(sessionConfig?.disabledCategories) ? sessionConfig.disabledCategories : [];
  if (!daftar.length) return null;
  if (PERINTAH_TERLINDUNG.has(String(command || "").toLowerCase())) return null;
  const key = categoryKey(category);
  if (KATEGORI_TERLINDUNG.has(key)) return null;
  return daftar.includes(key) ? key : null;
}

/** Link upgrade paket di web dashboard. */
export function upgradeUrl() {
  return `${config.web_url}/dashboard`;
}

const channelContext = {
  forwardingScore: 999,
  isForwarded: true,
  forwardedNewsletterMessageInfo: {
    newsletterJid: "120363425345196924@newsletter",
    newsletterName: "VARESA OFFICIAL",
    serverMessageId: -1,
  },
};

/** Ambil tier aktif dari messageInfo. Default 'free' kalau belum diset. */
export function getTier(messageInfo) {
  return messageInfo?.sessionConfig?.tier || "free";
}

/**
 * Cek apakah tier bot memenuhi minimal yang dibutuhkan.
 * @returns {boolean}
 */
export function hasTier(messageInfo, minimumTier = "booster") {
  const current = TIER_RANK[getTier(messageInfo)] ?? 0;
  const needed = TIER_RANK[minimumTier] ?? 0;
  return current >= needed;
}

/**
 * Guard untuk dipakai di awal handle() sebuah plugin.
 * Kalau tier kurang, dia kirim notifikasi lalu balikin `true` (artinya:
 * plugin harus berhenti / `return`). Kalau cukup, balikin `false`.
 *
 * Contoh pakai:
 *   if (await guardTier(sock, messageInfo, 'booster', 'Cek MLBB')) return;
 */
export async function guardTier(sock, messageInfo, minimumTier = "booster", featureName = "Fitur ini") {
  if (hasTier(messageInfo, minimumTier)) return false;

  const { remoteJid, message } = messageInfo;
  const currentLabel = TIER_LABEL[getTier(messageInfo)] || "Free";
  const neededLabel = TIER_LABEL[minimumTier] || "Zenith";

  const text =
    `🔒 *AKSES TERKUNCI*\n\n` +
    `Bot ini berada di akses *${currentLabel}*.\n` +
    `Upgrade paket bot ini ke *${neededLabel}* untuk mendapatkan akses ${featureName}.\n\n` +
    `🌐 Upgrade di: ${upgradeUrl()}`;

  try {
    await sock.sendMessage(remoteJid, { text, contextInfo: channelContext }, { quoted: message });
  } catch (err) {
    console.error("[tier-guard] gagal kirim notifikasi:", err.message);
  }
  return true;
}

export default {
  getTier,
  hasTier,
  guardTier,
  applyTierCaps,
  upgradeUrl,
  TIER_CAPS,
  TIER_LABEL,
  categoryKey,
  categoryName,
  sanitizeDisabledCategories,
  disabledCategoryFor,
  KATEGORI_TERLINDUNG,
  PERINTAH_TERLINDUNG,
};
