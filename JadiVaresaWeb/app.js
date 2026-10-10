let currentUser = { tier: 'free', username: 'Guest', role: 'user' };
let activeBotNumber = localStorage.getItem('active_bot_num') || '';

// Kapabilitas tiap tier. HARUS selalu sinkron dengan OWNER_LIMIT_BY_TIER
// & pengecekan tier di lib/webserver.js (POST /api/bot/config).
const TIER_CAPS = {
    free:    { maxOwners: 0, customize: false, menuImage: false },
    basic:   { maxOwners: 1, customize: true,  menuImage: false },
    plus:    { maxOwners: 3, customize: true,  menuImage: false },
    booster: { maxOwners: 5, customize: true,  menuImage: true  }
};
const OWNER_LIMIT_BY_TIER = { free: 0, basic: 1, plus: 3, booster: 5 };
// Kuota aturan pesan otomatis per paket.
const AUTOREPLY_QUOTA = { free: 0, basic: 10, plus: 30, booster: 100 };
let autoReplies = [];
// Biaya admin diisi dari server; jangan pernah ditebak di sisi browser
// supaya total yang ditampilkan selalu sama dengan yang ditagih.
let adminFee = 0;
// Kuota perintah kustom per paket. Harus sinkron dengan CUSTOMCMD_QUOTA
// di lib/webserver.js.
const CUSTOMCMD_QUOTA = { free: 0, basic: 0, plus: 15, booster: 50 };
let customCommands = [];

const TIER_NAME = { free: 'Free', basic: 'Core', plus: 'Prime', booster: 'Zenith' };
const tierName = (t) => TIER_NAME[t] || 'Free';
const TIER_RANK = { free: 0, basic: 1, plus: 2, booster: 3 };
const NO_BOT_MSG = 'Belum ada bot dipilih. Tambah & jalankan bot dulu di Dashboard.';
const DEFAULT_MENU = `{ucapanWaktu}\n\n*User:* {pushname}\n*Status:* {statusUser}\n*Date:* {date}\n\n*MAIN*\n- {prefix}jadibot\n- {prefix}statistik\n- {prefix}ping\n`;

// ==========================================
// PAKET PER BOT
// ==========================================
// Paket (Free/Core/Prime/Zenith) sekarang melekat ke BOT, bukan ke akun.
// Satu akun boleh punya beberapa bot dengan paket berbeda, jadi semua
// penguncian fitur di halaman bot memakai paket BOT YANG DIPILIH.
// Sumber datanya GET /api/bots/mine (lihat loadMyBots di bawah).
let myBots = [];          // [{ number, label, tier, tierExpiredAt, daysLeft, status, groups, messages, commands }]
let botLimits = null;     // { maxBots, maxFree, used, freeUsed } — null di backend lama
let pendingPkg = null;    // paket tersimpan yang menunggu bot berikutnya, atau null
let botsLoaded = false;   // daftar bot sudah pernah didapat (dari server/cache)
let botsLegacy = false;   // backend lama tanpa /api/bots/mine: paket masih per akun

// Paket yang masa aktifnya sudah lewat dianggap Free walau server belum
// sempat menurunkannya (penegak kedaluwarsa berjalan berkala).
function effectiveTier(b) {
    const t = b?.tier || 'free';
    if (t === 'free' || !b.tierExpiredAt) return TIER_NAME[t] ? t : 'free';
    const exp = new Date(b.tierExpiredAt);
    return !isNaN(exp) && exp <= new Date() ? 'free' : (TIER_NAME[t] ? t : 'free');
}
const activeBot = () => myBots.find(b => b.number === activeBotNumber) || null;

// Paket yang dipakai untuk penguncian fitur & kuota di halaman bot.
// Belum tahu botnya (data belum dimuat) -> pakai paket akun dari server
// (yang sekarang = paket tertinggi) hanya di backend lama; selain itu Free,
// supaya tombol berbayar tidak sempat terbuka untuk bot Free.
function botTier() {
    const b = activeBot();
    if (b) return effectiveTier(b);
    return botsLegacy || !botsLoaded ? (currentUser.tier || 'free') : 'free';
}

// Paket tertinggi di antara semua bot akun — hanya untuk hiasan akun
// (cincin avatar, banner profil, ringkasan di top bar).
function accountTopTier() {
    if (!myBots.length) return botsLoaded ? 'free' : (currentUser.tier || 'free');
    return myBots.reduce((top, b) => {
        const t = effectiveTier(b);
        return TIER_RANK[t] > TIER_RANK[top] ? t : top;
    }, 'free');
}

// 6285126440026 -> "+62 851-2644-0026" supaya nomor panjang mudah dibaca.
function fmtBotNumber(n) {
    const d = String(n || '').replace(/\D/g, '');
    if (!d) return '';
    if (!d.startsWith('62') || d.length < 10) return '+' + d;
    const r = d.slice(2);
    return `+62 ${r.slice(0, 3)}-${r.slice(3, 7)}-${r.slice(7)}`;
}
const botName = (b) => (b && b.label) ? b.label : 'Bot tanpa nama';
// Nama pendek untuk kalimat: label kalau ada, kalau tidak nomornya.
const botRef = (b) => (b && b.label) ? b.label : (b ? fmtBotNumber(b.number) : 'bot ini');

function daysLeftOf(b) {
    if (!b || effectiveTier(b) === 'free' || !b.tierExpiredAt) return null;
    const exp = new Date(b.tierExpiredAt);
    if (isNaN(exp)) return null;
    return Math.max(0, Math.ceil((exp - new Date()) / 86400000));
}
// "Zenith · sisa 34 hari" / "Free · tanpa masa aktif"
function planText(b) {
    const t = effectiveTier(b);
    if (t === 'free') return 'Free · tanpa masa aktif';
    const d = daysLeftOf(b);
    return d == null ? `${tierName(t)} · tanpa batas waktu` : `${tierName(t)} · sisa ${d} hari`;
}

// Salinan terakhir daftar bot di browser ini, supaya saat halaman dibuka
// paket bot terpilih langsung benar (tanpa kedip "terkunci" -> terbuka)
// sebelum server menjawab. Hanya kenyamanan; server tetap sumber kebenaran.
const BOTS_CACHE_KEY = 'vrs_bots';
function restoreBotsCache() {
    try {
        const c = JSON.parse(localStorage.getItem(BOTS_CACHE_KEY) || 'null');
        if (!c || !currentUser?.id || c.uid !== currentUser.id || !Array.isArray(c.bots)) return false;
        myBots = c.bots;
        botLimits = c.limits || null;
        pendingPkg = c.pending || null;
        botsLoaded = true;
        return true;
    } catch { return false; }
}
function saveBotsCache() {
    try {
        localStorage.setItem(BOTS_CACHE_KEY, JSON.stringify({ uid: currentUser?.id, at: Date.now(), bots: myBots, limits: botLimits, pending: pendingPkg }));
    } catch { /* storage penuh/diblokir: abaikan */ }
}

// Backend lama (belum ada /api/bots/mine) atau server gagal sebelum daftar
// bot pernah didapat: susun daftar dari botNumbers akun dengan paket akun —
// persis perilaku lama (1 akun = 1 paket).
function useLegacyBots() {
    if (botsLoaded && !botsLegacy) return; // data per bot yang sudah ada jangan ditimpa
    const nums = (Array.isArray(currentUser.botNumbers) ? currentUser.botNumbers : []).map(String);
    // Nomor yang sedang dipakai di browser ini ikut dihitung: botNumbers di
    // localStorage bisa belum memuat bot yang baru saja di-start.
    if (activeBotNumber && !nums.includes(activeBotNumber)) nums.push(activeBotNumber);
    myBots = nums.map(number => ({
        number, label: '', tier: currentUser.tier || 'free',
        tierExpiredAt: currentUser.tierExpiredAt || '', status: '', legacy: true
    }));
    botLimits = null;
    pendingPkg = null;
    botsLegacy = true;
    botsLoaded = true;
}

// "3 bot · tertinggi Zenith" untuk top bar & menu profil.
function accountSummaryHTML() {
    const n = myBots.length;
    if (!n) return `<span class="acct-sum">${botsLoaded ? 'belum ada bot' : 'memuat…'}</span>`;
    const top = accountTopTier();
    // Spasi di teks sengaja ada (untuk pembaca layar); jarak visual dari CSS gap.
    return `<span class="acct-sum" title="${n} bot · paket tertinggi ${tierName(top)}"><b>${n}</b> bot <i class="acct-sum__sep">·</i> <span class="acct-sum__top">tertinggi </span><em class="tier-txt tier-txt--${top}">${tierName(top)}</em></span>`;
}

function nitroBadgeHTML(tier) {
    if (tier === 'basic') return `<span class="tier-badge core"><i class="fa-solid fa-bolt"></i> Core</span>`;
    if (tier === 'plus') return `<span class="tier-badge prime"><i class="fa-solid fa-gem"></i> Prime</span>`;
    if (tier === 'booster') return `<span class="tier-badge zenith"><i class="fa-solid fa-crown"></i> Zenith</span>`;
    return `<span class="tier-badge free">Free</span>`;
}

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const $id = (id) => document.getElementById(id);

// Pesan singkat ke user. Dulu semuanya alert() yang membekukan layar;
// sekarang toast yang tidak menghalangi. confirm()/prompt() tetap dipakai
// untuk keputusan yang memang harus dijawab dulu.
function say(msg, kind = 'info') {
    if (window.VLive?.toast) window.VLive.toast(msg, kind);
    else alert(msg);
}

// Pesan gagal dari server. Untuk 4xx teks server penting (mis. "maksimal 3
// nomor owner") jadi ditampilkan apa adanya. Untuk 5xx isinya biasanya teks
// teknis (error Mongo, stack) yang membingungkan user — diganti kalimat ramah.
function serverMsg(res, data, fallback) {
    if (res && res.status >= 500) return 'Server lagi bermasalah. Coba lagi sebentar lagi, ya.';
    return (data && data.message) || fallback;
}

// Tombol "sedang memproses": spinner + teks, lalu dikembalikan persis
// seperti semula (termasuk ikonnya) saat selesai.
function busy(btn, label) {
    if (!btn) return () => {};
    const html = btn.innerHTML;
    const wasDisabled = btn.disabled;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${label}`;
    btn.disabled = true;
    return () => { btn.innerHTML = html; btn.disabled = wasDisabled; };
}

// Render ulang semua elemen UI yang bergantung pada data profil user.
function applyProfileToUI() {
    const name = currentUser.username || 'Guest';
    const initial = name.charAt(0).toUpperCase();
    // Paket ada di tiap bot; untuk hiasan akun dipakai paket tertingginya.
    const tier = accountTopTier();
    const email = currentUser.email || '';

    // Foto dari akun Google (field `avatar`) dipakai kalau user belum
    // mengisi URL foto sendiri, supaya avatar tidak selalu berupa inisial.
    const avatarSrc = currentUser.avatarUrl || currentUser.avatar || '';
    const avatarHTML = avatarSrc
        ? `<img src="${escapeHtml(avatarSrc)}" alt="" referrerpolicy="no-referrer">`
        : escapeHtml(initial);

    document.querySelectorAll('.avatar-circle').forEach(el => { el.innerHTML = avatarHTML; });

    const dropName = $id('dropName');
    if (dropName) dropName.textContent = name;
    const dropSum = $id('dropSum');
    if (dropSum) dropSum.innerHTML = accountSummaryHTML();
    // Tampilkan email asli dari akun Google; jangan pakai alamat contoh.
    const dropEmail = $id('dropEmail');
    if (dropEmail) {
        dropEmail.innerText = email;
        dropEmail.style.display = email ? '' : 'none';
    }

    const chipName = $id('chipName');
    if (chipName) chipName.textContent = name;
    // Bukan lagi satu badge paket akun, tapi ringkasan semua bot.
    const chipTier = $id('chipTier');
    if (chipTier) chipTier.innerHTML = accountSummaryHTML();
    const helloName = $id('helloName');
    if (helloName) helloName.textContent = name;

    const setVal = (id, v) => { const el = $id(id); if (el) el.value = v || ''; };
    setVal('inputProfileName', name);
    setVal('cfgAvatarUrl', currentUser.avatarUrl);

    const prevAvatar = $id('profileAvatarPreview');
    if (prevAvatar) prevAvatar.innerHTML = avatarHTML;

    const prevName = $id('previewName');
    if (prevName) prevName.innerText = name;

    const prevEmail = $id('previewEmail');
    if (prevEmail) prevEmail.innerText = email || 'Belum ada email terhubung';

    // Banner berganti warna mengikuti paket aktif.
    const banner = $id('profileBanner');
    if (banner) banner.className = `profile-banner tier-${tier}`;
    const bannerTier = $id('bannerTier');
    if (bannerTier) bannerTier.innerText = tierName(tier);
}

// Ambil profil & tier terkini dari server (sumber kebenaran).
async function refreshUserFromServer() {
    if (!currentUser?.id) return;
    try {
        const res = await fetch(`/api/user/me/${encodeURIComponent(currentUser.id)}`);
        const result = await res.json();
        if (!result.success) return;

        currentUser = { ...currentUser, ...result.user };
        localStorage.setItem('currentUser', JSON.stringify(currentUser));

        applyProfileToUI();
        syncAdminLinks();
        initNotifButton();
        // Daftar bot (beserta paket tiap bot) dimuat terpisah oleh
        // loadMyBots(). Di backend lama paketnya masih per akun, jadi
        // tampilan disegarkan dari data akun ini.
        // (Perangkat baru tanpa nomor bot di localStorage juga tertangani:
        // daftar bot memilih bot pertama secara otomatis.)
        if (botsLegacy) {
            useLegacyBots();
            window.refreshBotsUI?.();
        }
    } catch (err) { /* offline: pakai data localStorage */ }
}

// Tautan ke /admin hanya untuk admin. Elemennya (#btnAdminPanel di menu
// profil, #sideAdminLink di sidebar) sengaja TIDAK ada di HTML: dibuat di
// sini saat role admin, dan dibuang lagi kalau server bilang bukan admin.
// /admin sendiri tetap memverifikasi role ke server.
function syncAdminLinks() {
    const isAdmin = currentUser?.role === 'admin';
    const dropItem = $id('btnAdminPanel');
    const sideItem = $id('sideAdminLink');
    if (!isAdmin) { dropItem?.remove(); sideItem?.remove(); return; }

    const profileDropList = document.querySelector('.profile-dropdown-list');
    if (profileDropList && !dropItem) {
        const adminLi = document.createElement('li');
        adminLi.id = 'btnAdminPanel';
        adminLi.className = 'is-admin';
        adminLi.innerHTML = `<i class="fa-solid fa-shield-halved"></i> Konsol admin`;
        adminLi.addEventListener('click', () => { window.location.href = '/admin'; });
        profileDropList.insertBefore(adminLi, profileDropList.firstChild);
    }
    // Pintasan yang sama di sidebar supaya admin tidak perlu membuka menu profil.
    const sideNav = document.querySelector('.side__nav');
    if (sideNav && !sideItem) {
        const a = document.createElement('a');
        a.id = 'sideAdminLink';
        a.href = '/admin';
        a.className = 'side__item is-admin';
        a.innerHTML = '<i class="fa-solid fa-shield-halved"></i><span>Konsol admin</span>';
        sideNav.appendChild(a);
    }
}

// Kunci / buka fitur sesuai paket BOT YANG DIPILIH (bukan paket akun).
function applyTierGating() {
    const tier = botTier();
    const caps = TIER_CAPS[tier] || TIER_CAPS.free;

    // Tandai paket di <body> supaya CSS bisa memberi hiasan khusus
    // (cincin avatar, banner profil, dsb) tanpa perlu JS tambahan. Hiasan
    // akun mengikuti paket tertinggi; data-bot-tier = paket bot terpilih.
    const top = accountTopTier();
    document.body.classList.remove('t-free', 't-basic', 't-plus', 't-booster');
    document.body.classList.add(`t-${top}`);
    document.body.dataset.botTier = tier;

    const identityLock = $id('identityLockOverlay');
    if (identityLock) identityLock.style.display = caps.customize ? 'none' : 'flex';
    [$id('cfgBotName'), $id('cfgOwnerNumber'), $id('cfgWatermark'), $id('cfgFooter')]
        .forEach(el => { if (el) el.disabled = !caps.customize; });

    // Teks sewa & premium: sama dengan identitas (Core ke atas). Pratinjau
    // ikut digambar ulang karena nama/owner bot bergantung paket.
    const ownerTextLock = $id('ownerTextLockOverlay');
    if (ownerTextLock) ownerTextLock.style.display = caps.customize ? 'none' : 'flex';
    document.querySelectorAll('#cfgSewaText, #cfgPremiumText, [data-otext-reset]')
        .forEach(el => { el.disabled = !caps.customize; });
    renderOwnerText();

    const menuLock = $id('menuLockOverlay');
    if (menuLock) menuLock.style.display = caps.customize ? 'none' : 'flex';
    const cfgCustomMenu = $id('cfgCustomMenu');
    if (cfgCustomMenu) cfgCustomMenu.disabled = !caps.customize;

    const boosterImageBox = $id('boosterImageBox');
    if (boosterImageBox) boosterImageBox.style.display = caps.menuImage ? 'block' : 'none';

    const messLock = $id('messLockOverlay');
    if (messLock) messLock.style.display = caps.customize ? 'none' : 'flex';
    ['arKeyword', 'arReply', 'arMatch', 'btnAddAutoReply'].forEach(id => {
        const el = $id(id);
        if (el) el.disabled = !caps.customize;
    });
    const messQuotaText = $id('messQuotaText');
    if (messQuotaText) messQuotaText.innerText = AUTOREPLY_QUOTA[tier] ?? 0;

    const welcomeLock = $id('welcomeLockOverlay');
    if (welcomeLock) welcomeLock.style.display = caps.customize ? 'none' : 'flex';
    ['welcomeEnabled', 'welcomeText', 'leaveText', 'welcomeMode', 'btnSaveWelcome'].forEach(id => {
        const el = $id(id);
        if (el) el.disabled = !caps.customize;
    });
    // Opsi "Foto/GIF sendiri" cuma untuk Zenith.
    const customOpt = document.querySelector('#welcomeMode option[value="custom"]');
    if (customOpt) customOpt.disabled = !caps.menuImage;

    // Perintah kustom: Prime ke atas.
    const cmdAllowed = (CUSTOMCMD_QUOTA[tier] ?? 0) > 0;
    const cmdLock = $id('cmdLockOverlay');
    if (cmdLock) cmdLock.style.display = cmdAllowed ? 'none' : 'flex';
    ['cmdName', 'cmdResponse', 'cmdImage', 'cmdShowMenu', 'btnAddCmd', 'btnSaveCmd'].forEach(id => {
        const el = $id(id);
        if (el) el.disabled = !cmdAllowed;
    });
    const cmdQuotaText = $id('cmdQuotaText');
    if (cmdQuotaText) cmdQuotaText.innerText = CUSTOMCMD_QUOTA[tier] ?? 0;
    const cmdImageBox = $id('cmdImageBox');
    if (cmdImageBox) cmdImageBox.style.display = caps.menuImage ? 'block' : 'none';

    const broadcastLock = $id('broadcastLockOverlay');
    if (broadcastLock) broadcastLock.style.display = caps.customize ? 'none' : 'flex';
    ['broadcastText', 'btnSendBroadcast'].forEach(id => {
        const el = $id(id);
        if (el) el.disabled = !caps.customize;
    });

    // Banner Free hanya kalau memang ada bot yang dipilih dan bot itu Free.
    const bot = activeBot();
    const freeAlert = $id('freeAlert');
    if (freeAlert) freeAlert.style.display = tier === 'free' && (bot || (botsLegacy && activeBotNumber)) ? 'flex' : 'none';
    const freeWho = $id('freeAlertWho');
    if (freeWho) freeWho.textContent = bot?.label ? `Bot ${bot.label}` : 'Bot ini';

    const configTierText = $id('configTierText');
    if (configTierText) {
        const until = bot ? daysLeftOf(bot) : null;
        configTierText.innerHTML = `${nitroBadgeHTML(tier)} <span class="v-dim">${until != null ? `sisa ${until} hari` : tier === 'free' ? 'tanpa masa aktif' : ''}</span>`;
    }

    const ownerLimitHint = $id('ownerLimitHint');
    if (ownerLimitHint) {
        const maxOwners = OWNER_LIMIT_BY_TIER[tier] ?? 0;
        ownerLimitHint.innerText = maxOwners > 0
            ? `Paket ${tierName(tier)} bot ini: maks ${maxOwners} nomor owner.`
            : `Upgrade bot ini untuk bisa atur nomor owner sendiri.`;
    }

    // Kuota API harian: tandai baris paket yang sedang aktif.
    document.querySelectorAll('.quota-table li[data-tier]').forEach(li => {
        li.classList.toggle('is-current', li.dataset.tier === tier);
    });

    // Kartu harga: user langsung tahu paket mana yang sedang dipakai BOT
    // INI, dan tombolnya jadi "Perpanjang" (bukan "Pilih") untuk paket sama.
    document.querySelectorAll('.pricing-card[data-plan]').forEach(card => {
        const isCurrent = card.dataset.plan === tier && !!(bot || activeBotNumber);
        card.classList.toggle('is-current', isCurrent);
        const btn = card.querySelector('.btn-order');
        if (btn) {
            if (!btn.dataset.label) btn.dataset.label = btn.textContent.trim();
            btn.textContent = isCurrent ? `Perpanjang ${tierName(tier)}` : btn.dataset.label;
        }
    });
}

// Kartu "Paket bot ini" & "Kedaluwarsa": milik bot yang dipilih.
function renderExpiry() {
    const el = $id('statExpire');
    const sub = $id('statExpireSub');
    const bot = activeBot();
    const tier = botTier();
    const statRole = $id('statRole');
    if (statRole) statRole.innerHTML = (bot || activeBotNumber) ? nitroBadgeHTML(tier) : '<span class="v-dim">–</span>';
    const roleSub = $id('statRoleSub');
    if (roleSub) roleSub.innerText = bot ? botName(bot) : (activeBotNumber ? 'berlaku per bot' : 'belum ada bot');
    if (!el) return;
    const expAt = bot ? bot.tierExpiredAt : (botsLegacy ? currentUser.tierExpiredAt : '');
    if (!bot && !activeBotNumber) {
        el.innerText = '-';
        el.style.color = '';
        if (sub) sub.innerText = 'belum ada bot';
        return;
    }
    if (tier === 'free' || !expAt) {
        el.innerText = '-';
        el.style.color = '';
        if (sub) sub.innerText = tier === 'free' ? 'paket gratis' : 'tanpa batas';
        return;
    }
    const exp = new Date(expAt);
    if (isNaN(exp)) { el.innerText = '-'; return; }

    const daysLeft = Math.ceil((exp - new Date()) / 86400000);
    el.innerText = exp.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    el.style.color = daysLeft <= 3 ? 'var(--danger)' : '';
    if (sub) sub.innerText = daysLeft > 0 ? `${daysLeft} hari lagi` : 'sudah lewat';
}

// ==========================================
// TEKS SEWA & PREMIUM (per bot)
// ==========================================
// Balasan .sewa/.pricelist dan .premium milik bot yang dipilih (config
// sewaText/premiumText). Kosong = bot memakai teks otomatis. Placeholder
// diganti oleh BOT saat perintah dipanggil; di sini hanya untuk pratinjau,
// dengan aturan yang sama (lib/bot-scope.js renderBotText).
const OWNER_TEXT_MAX = 1500; // harus sama dengan OWNER_TEXT_MAX di lib/webserver.js
const OTEXT = {
    sewa: { input: 'cfgSewaText', count: 'sewaTextCount', state: 'sewaTextState', cmd: '.sewa' },
    premium: { input: 'cfgPremiumText', count: 'premiumTextCount', state: 'premiumTextState', cmd: '.premium' }
};
let otextTab = 'sewa';
// Salinan teks otomatis bot milik user (TEXT_SEWA_BOT di plugins/MORE/sewa.js
// & TEXT_PREMIUM_BOT di plugins/MORE/premium.js) — hanya untuk pratinjau.
// Kalau teks di plugin diubah, samakan juga di sini.
const OTEXT_AUTO = {
    sewa: '👋 *Halo Kak {pushname}!*\nMau grup kamu dijaga & diramaikan *{botname}*? 🤖\n\n✨ *Sewa {botname} untuk grup kamu:*\n• Moderasi grup: anti-link, sambutan member, dll\n• Game, stiker, downloader & ratusan fitur lainnya\n• Aktif 24 jam\n\n💬 *Cara sewa:* chat owner bot ini untuk harga & masa sewa:\n{ownerlink}\n\n_Lihat semua fitur: ketik *{prefix}menu*_',
    premium: '👋 *Halo Kak {pushname}!*\nMau jadi pengguna *Premium* di *{botname}*? 💎\n\n✨ *Keuntungan Premium:*\n• Bebas limit untuk fitur yang memakai limit\n• Bisa pakai fitur khusus Premium\n\n🛒 *Cara beli:* chat owner bot ini untuk harga & masa aktif:\n{ownerlink}\n\n_Premium dari owner bot ini berlaku di {botname} saja. Cek status kamu: *{prefix}cekpremium*_'
};
const OTEXT_SAMPLE_NAME = 'Budi';

// Nama & kontak owner yang dipakai bot ini — urutannya sama dengan bot:
// nama dari Config (paket berbayar) -> nama bawaan; owner pertama dari
// Config -> nomor bot sendiri. Isian form dipakai langsung supaya pratinjau
// ikut berubah saat user mengetik (sebelum disimpan).
function otextVars() {
    const caps = TIER_CAPS[botTier()] || TIER_CAPS.free;
    const name = caps.customize ? ($id('cfgBotName')?.value.trim() || '') : '';
    // Dinormalkan persis seperti lib/tier-guard.js (08xx → 628xx, entri < 8
    // digit dibuang), supaya pratinjau sama dengan yang dikirim bot.
    const firstOwner = caps.maxOwners > 0
        ? (($id('cfgOwnerNumber')?.value || '').split(',')
            .map(n => n.replace(/\D/g, ''))
            .map(n => n.startsWith('0') ? '62' + n.slice(1) : n)
            .find(n => n.length >= 8) || '')
        : '';
    const owner = firstOwner || String(activeBotNumber || '').replace(/\D/g, '');
    return {
        botname: name || 'Varesa',
        owner,
        ownerlink: owner ? `https://wa.me/${owner}` : '',
        prefix: '.',
        pushname: OTEXT_SAMPLE_NAME,
        weburl: location.origin
    };
}

// Ganti sekali jalan (bukan berantai), tidak peka huruf besar/kecil.
function fillOwnerText(tpl, vars) {
    return String(tpl || '').replace(/\{(botname|ownerlink|owner|prefix|pushname|weburl)\}/gi,
        (_, k) => vars[k.toLowerCase()] ?? '');
}

// Format WhatsApp sederhana (*tebal*, _miring_, ~coret~, ```mono```).
// Teks di-escape DULU, baru diberi tag — jadi isi user tidak bisa
// menyisipkan HTML ke dashboard.
function waFormatHTML(text) {
    return escapeHtml(text)
        .replace(/```([\s\S]+?)```/g, '<code>$1</code>')
        .replace(/\*([^\s*](?:[^*\n]*[^\s*])?)\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])_([^\s_](?:[^_\n]*[^\s_])?)_/g, '$1<em>$2</em>')
        .replace(/~([^\s~](?:[^~\n]*[^\s~])?)~/g, '<s>$1</s>');
}

function setOwnerTextTab(tab) {
    if (!OTEXT[tab]) return;
    otextTab = tab;
    document.querySelectorAll('[data-otext-tab]').forEach(b => {
        const on = b.dataset.otextTab === tab;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    renderOwnerText();
}

// Penghitung karakter, label "otomatis/teks sendiri", dan pratinjau.
function renderOwnerText() {
    for (const o of Object.values(OTEXT)) {
        const input = $id(o.input);
        if (!input) continue;
        const len = input.value.length;
        const count = $id(o.count);
        if (count) {
            count.textContent = `${len.toLocaleString('id-ID')} / ${OWNER_TEXT_MAX.toLocaleString('id-ID')}`;
            count.classList.toggle('is-near', len >= OWNER_TEXT_MAX * 0.9 && len < OWNER_TEXT_MAX);
            count.classList.toggle('is-full', len >= OWNER_TEXT_MAX);
        }
        const custom = input.value.trim().length > 0;
        const state = $id(o.state);
        if (state) {
            state.textContent = custom ? 'Teks sendiri' : 'Teks otomatis';
            state.classList.toggle('is-custom', custom);
        }
        input.closest('.otext__field')?.classList.toggle('is-custom', custom);
    }

    const box = $id('otextPreview');
    if (!box) return;
    const o = OTEXT[otextTab];
    const raw = ($id(o.input)?.value || '').trim();
    const vars = otextVars();
    box.innerHTML = waFormatHTML(fillOwnerText(raw || OTEXT_AUTO[otextTab], vars));
    const cmd = $id('otextPreviewCmd');
    if (cmd) cmd.textContent = o.cmd;
    const name = $id('otextPreviewName');
    if (name) name.textContent = vars.botname;
    const note = $id('otextPreviewNote');
    if (note) {
        note.textContent = raw
            ? `Contoh dengan {pushname} = ${OTEXT_SAMPLE_NAME}. Nama & owner diambil dari isian di atas.`
            : `Belum diisi — kira-kira begini teks otomatis bot ini (contoh {pushname} = ${OTEXT_SAMPLE_NAME}).`;
    }
}

// ==========================================
// NOTIFIKASI & PWA
// ==========================================
let swReg = null;

// Daftarkan service worker. Ini yang membuat situs bisa "Install app"
// di HP sekaligus menampilkan notifikasi saat tab tidak aktif.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => { swReg = reg; })
            .catch(() => { /* tanpa SW situs tetap jalan normal */ });
    });
}

// Tampilkan notifikasi. Lewat service worker kalau ada (tetap muncul saat
// tab di latar belakang), kalau tidak pakai Notification biasa.
function notify(title, body, { tag = 'jv', url = '/dashboard' } = {}) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
        if (swReg?.active) {
            swReg.active.postMessage({ type: 'notify', title, body, tag, url });
        } else {
            new Notification(title, { body, icon: '/icons/icon-192.png', tag });
        }
    } catch (err) { /* jangan sampai notifikasi menjatuhkan halaman */ }
}

// Izin notifikasi diminta lewat tombol, BUKAN otomatis saat halaman dibuka.
// Permintaan izin yang muncul tiba-tiba hampir selalu ditolak user, dan
// sekali ditolak browser tidak akan menanyakannya lagi.
let notifBtnBound = false;
function initNotifButton() {
    const btn = $id('btnEnableNotif');
    if (!btn || !('Notification' in window)) return;

    const sync = () => {
        const p = Notification.permission;
        if (p === 'granted') {
            btn.innerHTML = '<i class="fa-solid fa-bell"></i> Notifikasi aktif';
            btn.disabled = true;
        } else if (p === 'denied') {
            btn.innerHTML = '<i class="fa-solid fa-bell-slash"></i> Notifikasi diblokir browser';
            btn.disabled = true;
        } else {
            btn.innerHTML = '<i class="fa-regular fa-bell"></i> Aktifkan notifikasi';
            btn.disabled = false;
        }
    };

    // Fungsi ini dipanggil lagi setelah profil disegarkan; listener cukup
    // dipasang sekali supaya satu klik tidak memicu dua permintaan izin.
    if (!notifBtnBound) {
        notifBtnBound = true;
        btn.addEventListener('click', async () => {
            const p = await Notification.requestPermission();
            sync();
            if (p === 'granted') notify('Notifikasi aktif', 'Kamu akan dikabari saat bot terputus atau pembayaran masuk.');
        });
    }
    sync();
}

// Tombol "Pasang aplikasi". Browser memunculkan event ini hanya kalau
// situs memenuhi syarat PWA (HTTPS, manifest, service worker) dan belum
// terpasang — jadi tombolnya disembunyikan sampai benar-benar bisa dipakai.
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    const box = $id('installBox');
    if (box) box.style.display = 'block';
});

window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    const box = $id('installBox');
    if (box) box.style.display = 'none';
});

document.addEventListener("DOMContentLoaded", () => {

    // --- 1. AUTH GUARD ---
    const userStr = localStorage.getItem('currentUser');
    if (!userStr && !window.location.pathname.endsWith('/login')) {
        window.location.href = '/login';
        return;
    }

    if (userStr) {
        try { currentUser = JSON.parse(userStr) || currentUser; } catch { currentUser = { tier: 'free', username: 'Guest', role: 'user' }; }
        if (!currentUser.tier) currentUser.tier = 'free';
        // Daftar bot terakhir dari browser ini (kalau ada) dulu, server menyusul.
        restoreBotsCache();

        applyProfileToUI();

        // Ambil data terbaru dari server: tier bisa saja sudah naik setelah
        // pembayaran (webhook), sementara localStorage masih data lama.
        refreshUserFromServer();

        applyTierGating();
        renderExpiry();
        initNotifButton();

        syncAdminLinks();
    }

    $id('btnInstallApp')?.addEventListener('click', async () => {
        if (!deferredInstall) return;
        deferredInstall.prompt();
        await deferredInstall.userChoice;
        deferredInstall = null;
        const box = $id('installBox');
        if (box) box.style.display = 'none';
    });

    // --- STATUS BOT & TERMINAL ---
    const terminalLogs = $id('terminalLogs');
    let botState = 'offline';
    // Diisi di akhir (setelah semua fungsi siap). Dideklarasikan di sini
    // supaya pemanggilan lebih awal tidak kena ReferenceError (TDZ).
    let liveWidgets = null;
    let currentView = 'dashboard';

    const nowClock = () => new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\./g, ':');

    function termLine(text, cls = '') {
        if (!terminalLogs) return;
        const div = document.createElement('div');
        div.className = `log-line ${cls}`.trim();
        div.innerHTML = `<span class="t-time">${nowClock()}</span>${escapeHtml(text)}`;
        terminalLogs.appendChild(div);
        // Batasi jumlah baris supaya tab yang dibiarkan berjam-jam tetap ringan.
        while (terminalLogs.children.length > 300) terminalLogs.firstElementChild.remove();
        terminalLogs.scrollTop = terminalLogs.scrollHeight;
    }

    function termReset(text, cls = 't-info') {
        if (!terminalLogs) return;
        terminalLogs.innerHTML = '';
        termLine(text, cls);
    }

    // Satu tempat untuk semua tampilan status bot (kartu statistik, badge
    // kontrol, header terminal) supaya tidak pernah saling bertentangan.
    const BOT_STATES = {
        online:     { label: 'Online',     cls: 'is-online',     dot: 'v-dot v-dot--live', term: 'connected' },
        connecting: { label: 'Connecting', cls: 'is-connecting', dot: 'v-dot v-dot--warn', term: 'connecting' },
        pairing:    { label: 'Pairing',    cls: 'is-connecting', dot: 'v-dot v-dot--warn', term: 'menunggu pairing' },
        offline:    { label: 'Offline',    cls: 'is-offline',    dot: 'v-dot v-dot--danger', term: 'disconnected' }
    };
    // sync=false: hanya tampilan (dipakai saat ganti bot) — status bot di
    // daftar "Bot saya" tidak ikut diubah.
    function setBotState(state, { sync = true } = {}) {
        const s = BOT_STATES[state] || BOT_STATES.offline;
        botState = state;
        const statStatus = $id('statStatus');
        if (statStatus) {
            statStatus.innerText = s.label;
            statStatus.className = `v-stat__value statstrip__status ${s.cls}`;
        }
        const header = $id('termHeaderTitle');
        if (header) header.innerHTML = `<span class="${s.dot}"></span> ${s.term}`;
        const badge = $id('ctlStateBadge');
        if (badge) {
            badge.className = `v-badge ${state === 'online' ? 'v-badge--ok' : state === 'offline' ? '' : 'v-badge--warn'}`;
            badge.innerHTML = `<span class="${s.dot}"></span> ${s.label.toLowerCase()}`;
        }
        // Kartu bot yang dipilih ikut berubah (titik status & tombol Start/Stop).
        const b = sync ? activeBot() : null;
        if (b) {
            const next = state === 'online' ? 'online'
                : (state === 'connecting' || state === 'pairing') ? 'connecting'
                : (b.status === 'online' || b.status === 'connecting') ? 'offline' : b.status;
            if (next !== b.status) { b.status = next; window.refreshBotsUI?.({ light: true }); }
        }
    }

    function syncBotNumberUI() {
        const b = activeBot();
        const statNumber = $id('statNumber');
        if (statNumber) statNumber.innerText = activeBotNumber
            ? (b?.label ? `${b.label} · ${fmtBotNumber(activeBotNumber)}` : fmtBotNumber(activeBotNumber))
            : 'belum ada nomor';
        const termTitle = $id('termTitle');
        if (termTitle) termTitle.innerText = activeBotNumber ? `bot@varesa:~/${activeBotNumber}` : 'bot@varesa:~';
    }

    // Satu-satunya pintu untuk mengganti bot yang dipilih. SEMUA panel per
    // bot (config, menu, balasan otomatis, perintah kustom, sambutan,
    // siaran, token API, terminal, statistik, add-on) membaca activeBotNumber,
    // jadi cukup di sini semuanya dimuat ulang untuk bot yang baru.
    // load=false: dipakai saat bot baru sedang didaftarkan (belum milik akun,
    // config-nya pasti ditolak server) — cukup pindahkan terminal & SSE.
    window.setActiveBotNumber = (num, { load = true } = {}) => {
        const prev = activeBotNumber;
        activeBotNumber = String(num || '');
        if (activeBotNumber) localStorage.setItem('active_bot_num', activeBotNumber);
        else localStorage.removeItem('active_bot_num');
        syncBotNumberUI();
        if (prev !== activeBotNumber) {
            // Log & status bot sebelumnya jangan sampai terbaca sebagai bot ini.
            const b = activeBot();
            setBotState(b?.status === 'online' ? 'online' : b?.status === 'connecting' ? 'connecting' : 'offline', { sync: false });
            if (activeBotNumber) termReset(`$ Bot dipilih: ${b?.label ? `${b.label} · ` : ''}${activeBotNumber}. Menunggu log…`, 't-dim');
            else termReset('$ Belum ada bot. Tambah bot dulu lewat tombol "Tambah bot".', 't-dim');
            showStartNotice('');
            // Daftar milik bot sebelumnya dikosongkan dulu; isi bot ini
            // datang dari loadBotConfig() di bawah.
            autoReplies = []; customCommands = [];
            renderAutoReplies(); renderCustomCommands();
            // Teks sewa/premium juga milik bot — jangan sampai teks bot lama
            // terlihat (atau tersimpan) sebagai teks bot ini.
            ['cfgSewaText', 'cfgPremiumText'].forEach(id => { const el = $id(id); if (el) el.value = ''; });
            renderOwnerText();
        }
        window.reconnectBotStream?.();
        liveWidgets?.feed?.render();
        window.refreshBotsUI?.();
        if (!load) return;
        if (activeBotNumber) loadBotStats();
        loadBotConfig({ quiet: true });
        if (currentView === 'api') loadApiToken();
        if (currentView === 'addons') loadAddons();
    };

    setBotState('offline', { sync: false });
    syncBotNumberUI();

    // --- TEMA ---
    const themeToggle = $id('themeToggleBtn');
    const syncThemeIcon = () => {
        if (!themeToggle) return;
        const light = document.body.classList.contains('light-mode');
        themeToggle.innerHTML = light ? '<i class="fa-regular fa-moon"></i>' : '<i class="fa-regular fa-sun"></i>';
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f4f5f6' : '#08090a');
    };
    if (localStorage.getItem('theme') === 'light') document.body.classList.add('light-mode');
    syncThemeIcon();
    themeToggle?.addEventListener('click', () => {
        document.body.classList.toggle('light-mode');
        localStorage.setItem('theme', document.body.classList.contains('light-mode') ? 'light' : 'dark');
        syncThemeIcon();
    });

    // --- MODAL UMUM ---
    const openModal = (m) => m?.classList.add('active');
    const closeModal = (m) => m?.classList.remove('active');
    document.querySelectorAll('[data-close-modal]').forEach(b =>
        b.addEventListener('click', () => closeModal(b.closest('.modal-overlay'))));
    document.querySelectorAll('.modal-overlay').forEach(m =>
        m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); }));
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        document.querySelectorAll('.modal-overlay.active').forEach(closeModal);
        $id('mobileMenu')?.classList.remove('active');
        $id('profileDropdown')?.classList.remove('active');
    });

    const updateModal = $id('updateModal');
    const chkHideUpdate = $id('chkHideUpdate');
    const hideUntil = localStorage.getItem('hideUpdateUntil');
    if (updateModal && (!hideUntil || Date.now() > parseInt(hideUntil))) openModal(updateModal);
    chkHideUpdate?.addEventListener('change', (e) => {
        if (e.target.checked) localStorage.setItem('hideUpdateUntil', Date.now() + (24 * 60 * 60 * 1000));
        else localStorage.removeItem('hideUpdateUntil');
    });
    $id('btnNotif')?.addEventListener('click', () => openModal(updateModal));

    const profileAvatarBtn = $id('profileAvatarBtn');
    const profileDropdown = $id('profileDropdown');
    profileAvatarBtn?.addEventListener('click', (e) => { e.stopPropagation(); profileDropdown.classList.toggle('active'); });
    document.addEventListener('click', (e) => { if (!profileDropdown?.contains(e.target) && !profileAvatarBtn?.contains(e.target)) profileDropdown?.classList.remove('active'); });

    const btnHamburger = $id('btnHamburger');
    const mobileMenu = $id('mobileMenu');
    btnHamburger?.addEventListener('click', () => mobileMenu.classList.add('active'));
    $id('btnTabMore')?.addEventListener('click', () => mobileMenu.classList.add('active'));
    mobileMenu?.addEventListener('click', (e) => { if (e.target === mobileMenu) mobileMenu.classList.remove('active'); });

    const logout = () => { localStorage.removeItem('currentUser'); window.location.href = '/login'; };
    $id('btnLogoutDrop')?.addEventListener('click', logout);
    $id('btnLogoutSetting')?.addEventListener('click', logout);

    // --- NAVIGASI ANTAR HALAMAN (SPA) ---
    function showView(targetView, { scroll = true } = {}) {
        const targetEl = $id('view-' + targetView);
        if (!targetEl) return false;
        currentView = targetView;
        document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
        targetEl.classList.add('active');

        // Tandai item menu yang sedang dibuka supaya user tahu posisinya.
        document.querySelectorAll('.side__item[data-target], .tabbar__item[data-target]').forEach(li => {
            li.classList.toggle('active', li.dataset.target === targetView);
        });
        const title = $id('viewTitle');
        if (title) title.textContent = targetEl.dataset.title || 'Dashboard';
        const eyebrow = $id('viewEyebrow');
        if (eyebrow) eyebrow.textContent = targetEl.dataset.group || 'Ringkasan';
        document.title = `${targetEl.dataset.title || 'Dashboard'} · Varesa`;

        // Halaman tersimpan di URL (#config, #api, ...) supaya bisa
        // di-bookmark dan tidak kembali ke Dashboard saat di-refresh.
        try {
            history.replaceState(null, '', targetView === 'dashboard'
                ? location.pathname + location.search
                : `${location.pathname}${location.search}#${targetView}`);
        } catch { /* abaikan */ }

        // Bar "bot yang diatur" ikut pindah ke halaman per bot yang dibuka.
        placeBotCtx(targetView);
        if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
        // 'mess' ikut memuat config: tanpa ini daftar balasan otomatis tampil
        // kosong, dan menekan Simpan akan MENIMPA aturan yang ada di server.
        if (['config', 'menu', 'cmd', 'mess'].includes(targetView)) loadBotConfig();
        if (targetView === 'statistik') loadBotStats();
        if (targetView === 'upgrade') loadLeaderboard();
        if (targetView === 'addons') loadAddons();
        if (targetView === 'referral') loadReferral();
        if (targetView === 'invoice') loadOrderHistory();
        if (targetView === 'api') loadApiToken();
        return true;
    }

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetView = btn.getAttribute('data-target');
            if (!targetView) return;
            showView(targetView);
            if (mobileMenu) mobileMenu.classList.remove('active');
            if (profileDropdown) profileDropdown.classList.remove('active');
        });
    });

    // --- FAQ ACCORDION ---
    document.querySelectorAll('.faq-question').forEach(q => {
        q.addEventListener('click', () => {
            const item = q.closest('.faq-item');
            const wasActive = item.classList.contains('active');
            document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('active'));
            if (!wasActive) item.classList.add('active');
        });
    });

    // --- MODAL BENEFIT ---
    document.querySelectorAll('.trigger-modal').forEach(link => {
        link.addEventListener('click', (e) => {
            const paketName = e.currentTarget.getAttribute('data-paket');
            $id('modalTitle').innerText = `${paketName} — semua manfaat`;
            const list = $id('modalFeatureList');
            let features = [];
            if (paketName === 'Core') {
                features = ["Badge Core animasi", "Nama bot bisa diganti sendiri", "1 nomor owner", "Bebas watermark iklan", "Balasan otomatis sampai 10 aturan", "Sambutan anggota grup", "Siaran pesan ke semua grup", "API gateway 1.000 pesan/hari"];
            } else if (paketName === 'Prime') {
                features = ["Badge Prime animasi", "Semua fitur Core", "3 nomor owner", "Balasan otomatis sampai 30 aturan", "15 perintah kustom", "API gateway 5.000 pesan/hari"];
            } else {
                features = ["Badge Zenith animasi", "Semua fitur Prime", "5 nomor owner", "Akses penuh fitur Cek MLBB (lookup, bind, cekban, creation, find)", "Balasan otomatis sampai 100 aturan & 50 perintah kustom", "Upload foto/GIF untuk menu bot", "API gateway 20.000 pesan/hari", "Dukungan & penanganan kendala prioritas"];
            }
            list.innerHTML = features.map(f => `<li><i class="fa-solid fa-check"></i> ${escapeHtml(f)}</li>`).join('');
            openModal($id('benefitModal'));
        });
    });

    const benefitModal = $id('benefitModal');
    $id('btnCloseModal')?.addEventListener('click', () => closeModal(benefitModal));
    $id('btnTutupModal')?.addEventListener('click', () => closeModal(benefitModal));

    // --- KAPASITAS SERVER (dari live.js) ---
    let lastCapacity = null;
    let liveOk = false;
    function renderSlotHint(cap) {
        const hint = $id('slotHint');
        const text = $id('slotHintText');
        if (!hint || !text) return;
        const dot = hint.querySelector('.v-dot');
        if (!cap || cap.max == null) {
            text.textContent = 'Slot server belum bisa dicek.';
            if (dot) dot.className = 'v-dot v-dot--off';
            return;
        }
        const info = window.VLive.capacityInfo(cap);
        if (info.tone === 'danger') {
            text.innerHTML = `Server penuh <b>${cap.used}/${cap.max}</b> — bot baru belum bisa di-start dulu.`;
        } else if (info.tone === 'warn') {
            text.innerHTML = `Sisa <b>${info.remaining}</b> slot dari ${cap.max} — buruan sebelum penuh.`;
        } else {
            text.innerHTML = `Slot server: <b>${info.remaining}</b> dari ${cap.max} masih kosong.`;
        }
        if (dot) dot.className = `v-dot ${info.tone === 'danger' ? 'v-dot--danger' : info.tone === 'warn' ? 'v-dot--warn' : ''}`;
    }
    window.addEventListener('varesa:live', (e) => {
        const d = e.detail || {};
        liveOk = true;
        lastCapacity = d.capacity || null;
        renderSlotHint(lastCapacity);
        // Sisa slot server juga tampil di form "Tambah bot" (kalau terbuka).
        if (!$id('addBotPanel')?.classList.contains('v-hide')) renderAddPanel();
        const statServer = $id('statServer');
        if (statServer && d.server) {
            const V = window.VLive;
            statServer.innerText = `${V.fmt1(d.server.cpu?.percent)}% · ${V.fmt1(d.server.ram?.percent)}%`;
            const sub = $id('statServerSub');
            if (sub) sub.innerText = `CPU · RAM · ${d.bots?.online ?? '–'} bot online`;
        }
    });
    window.addEventListener('varesa:live-error', (e) => {
        if ((e.detail?.failures || 0) >= 2) { liveOk = false; if (!lastCapacity) renderSlotHint(null); }
    });

    function showStartNotice(html) {
        const box = $id('startNotice');
        if (!box) return;
        if (!html) { box.classList.add('v-hide'); box.innerHTML = ''; return; }
        box.innerHTML = `<i class="fa-solid fa-server"></i><div>${html}</div>`;
        box.classList.remove('v-hide');
    }

    // ==========================================
    // BOT SAYA — daftar bot, tambah, ganti nama, hapus (paket per bot)
    // ==========================================
    const BOT_STATUS = {
        online:     { label: 'online',     dot: 'v-dot v-dot--live' },
        connecting: { label: 'menyambung', dot: 'v-dot v-dot--warn' },
        offline:    { label: 'offline',    dot: 'v-dot v-dot--danger' },
        stop:       { label: 'berhenti',   dot: 'v-dot v-dot--off' }
    };
    const statusOf = (b) => BOT_STATUS[b?.status] || { label: 'status belum dicek', dot: 'v-dot v-dot--off' };
    const fmtCount = (n) => (n == null || n === '') ? '–' : window.VLive.fmtCompact(Number(n) || 0);
    const fmtDate = (iso) => {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    };
    // Nomor dari form: 0812… -> 62812…, buang spasi/strip.
    const cleanNumber = (v) => String(v || '').trim().replace(/^0/, '62').replace(/\D/g, '');

    let addingNumber = '';    // bot baru yang sedang didaftarkan (jangan direset oleh refresh daftar)
    let renamingNumber = '';  // kartu yang sedang diganti namanya (jangan dirender ulang)
    let addNoticeSticky = false; // notice dari jawaban server bertahan sampai user mengubah input
    let botsCapacity = null;     // kapasitas dari /api/bots/mine (cadangan data live)

    function normalizeBot(b) {
        return {
            ...b,
            number: String(b.number || ''),
            label: String(b.label || '').slice(0, 32),
            tier: TIER_NAME[b.tier] ? b.tier : 'free',
            tierExpiredAt: b.tierExpiredAt || ''
        };
    }

    // Satu permintaan sekaligus: tombol, interval, dan fokus tab bisa
    // memanggil ini bersamaan.
    let botsReq = null;
    function loadMyBots() {
        if (!currentUser?.id) return Promise.resolve();
        if (botsReq) return botsReq;
        botsReq = (async () => {
            try {
                const res = await fetch(`/api/bots/mine?userId=${encodeURIComponent(currentUser.id)}`);
                let d = {};
                try { d = await res.json(); } catch { d = {}; }
                if (res.ok && d.success && Array.isArray(d.bots)) {
                    myBots = d.bots.map(normalizeBot);
                    botLimits = d.limits || null;
                    pendingPkg = d.pending && d.pending.tier ? d.pending : null;
                    // Sisa slot server ikut dikirim: cadangan kalau polling live belum jalan.
                    botsCapacity = d.capacity && d.capacity.max != null ? d.capacity : null;
                    botsLegacy = false;
                    botsLoaded = true;
                    saveBotsCache();
                } else if (res.status === 404 || !botsLoaded) {
                    // 404 = backend lama tanpa paket per bot. Gagal lain
                    // sebelum pernah dapat data: pakai data akun dulu supaya
                    // dashboard tetap bisa dipakai.
                    useLegacyBots();
                }
            } catch (err) {
                if (!botsLoaded) useLegacyBots();
            } finally {
                botsReq = null;
            }
            onBotsChanged();
        })();
        return botsReq;
    }

    // Pastikan bot yang dipilih memang ada di akun; kalau tidak (dihapus,
    // perangkat baru, pindah akun) pindah ke bot pertama atau kosong.
    function ensureSelection() {
        if (addingNumber) return false;
        if (activeBotNumber && myBots.some(b => b.number === activeBotNumber)) return false;
        const next = myBots[0]?.number || '';
        if (next === activeBotNumber) return false;
        window.setActiveBotNumber(next);
        return true;
    }

    // light: cukup kartu & bar konteks (dipanggil sering, mis. dari SSE).
    function onBotsChanged({ light = false } = {}) {
        if (!light && ensureSelection()) return; // setActiveBotNumber memanggil ini lagi
        renderFleet();
        renderBotCtx();
        renderCtlBot();
        if (light) return;
        syncBotNumberUI();
        applyProfileToUI();
        applyTierGating();
        renderExpiry();
        renderAddPanel();
        // Status di daftar = status dari server; samakan tampilan bot
        // terpilih kalau SSE belum memberi kabar.
        const b = activeBot();
        if (b && b.status === 'online' && botState === 'offline') setBotState('online', { sync: false });
        if (b && (b.status === 'stop' || b.status === 'offline') && botState === 'online') setBotState('offline', { sync: false });
    }
    window.refreshBotsUI = onBotsChanged;

    // --- Kartu bot ---
    function botCardHTML(b) {
        const t = effectiveTier(b);
        const st = statusOf(b);
        const sel = b.number === activeBotNumber;
        const d = daysLeftOf(b);
        const running = b.status === 'online' || b.status === 'connecting';
        const num = escapeHtml(b.number);
        const name = renamingNumber === b.number
            ? `<form class="botcard__rename-form" data-number="${num}">
                   <input class="v-input" name="label" maxlength="32" value="${escapeHtml(b.label)}" placeholder="Cth: Bot Toko" aria-label="Nama bot" autocomplete="off">
                   <button type="submit" class="icon-btn" aria-label="Simpan nama"><i class="fa-solid fa-check"></i></button>
                   <button type="button" class="icon-btn" data-act="rename-cancel" aria-label="Batal ganti nama"><i class="fa-solid fa-xmark"></i></button>
               </form>`
            : `<strong class="botcard__label${b.label ? '' : ' is-empty'}">${escapeHtml(botName(b))}</strong>
               <button type="button" class="botcard__rename" data-act="rename" aria-label="Ganti nama bot" title="Ganti nama"><i class="fa-solid fa-pen"></i></button>`;
        let plan;
        if (t === 'free') plan = `<i class="fa-regular fa-calendar"></i> Paket gratis · tanpa masa aktif`;
        else if (d == null) plan = `<i class="fa-regular fa-calendar-check"></i> ${tierName(t)} · tanpa batas waktu`;
        else plan = `<i class="fa-regular fa-calendar-check"></i> Aktif s/d ${fmtDate(b.tierExpiredAt)} · <b>sisa ${d} hari</b>`;
        const legacy = b.legacy && b.groups == null;
        return `
        <article class="botcard${sel ? ' is-active' : ''} tier-${t}" data-number="${num}">
            ${sel ? '<span class="botcard__sel"><i class="fa-solid fa-check"></i> Sedang diatur</span>' : ''}
            <div class="botcard__top">
                <span class="${st.dot}" title="${st.label}"></span>
                <div class="botcard__name">${name}</div>
                ${nitroBadgeHTML(t)}
            </div>
            <p class="botcard__num"><span class="v-mono">${fmtBotNumber(b.number)}</span><span class="botcard__state">${st.label}</span></p>
            <p class="botcard__plan${d != null && d <= 3 ? ' is-warn' : ''}">${plan}</p>
            ${legacy ? '' : `<div class="botcard__stats v-mono">
                <span><b>${fmtCount(b.groups)}</b> grup</span>
                <span><b>${fmtCount(b.messages)}</b> pesan</span>
                <span><b>${fmtCount(b.commands)}</b> command</span>
            </div>`}
            <div class="botcard__actions">
                <button type="button" class="v-btn v-btn--sm v-btn--outline" data-act="manage"><i class="fa-solid fa-sliders"></i> Kelola</button>
                <button type="button" class="v-btn v-btn--sm ${t === 'free' ? 'v-btn--primary' : 'v-btn--ghost'}" data-act="upgrade"><i class="fa-regular fa-gem"></i> ${t === 'free' ? 'Upgrade' : 'Perpanjang'}</button>
                <button type="button" class="v-btn v-btn--sm v-btn--ghost" data-act="${running ? 'stop' : 'start'}">${running ? '<i class="fa-solid fa-stop"></i> Stop' : '<i class="fa-solid fa-play"></i> Start'}</button>
                <button type="button" class="v-btn v-btn--sm v-btn--danger botcard__del" data-act="delete" aria-label="Hapus bot ${escapeHtml(botRef(b))}" title="Hapus bot"><i class="fa-regular fa-trash-can"></i></button>
            </div>
        </article>`;
    }

    function addBlock() {
        // Admin tidak dibatasi. Tanpa data batas (backend lama) server yang memutuskan.
        if (currentUser?.role === 'admin' || botLimits?.bypass || !botLimits) return null;
        const used = botLimits.used ?? myBots.length;
        const freeUsed = botLimits.freeUsed ?? myBots.filter(b => effectiveTier(b) === 'free').length;
        if (botLimits.maxBots && used >= botLimits.maxBots) return 'BOT_LIMIT';
        if (!pendingPkg && botLimits.maxFree != null && freeUsed >= botLimits.maxFree) return 'BOT_LIMIT_FREE';
        return null;
    }

    function renderFleet() {
        const list = $id('botList');
        if (!list) return;
        const count = $id('fleetCount');
        if (count) count.textContent = botLimits?.maxBots ? `${myBots.length}/${botLimits.maxBots}` : (myBots.length ? String(myBots.length) : '');

        // Paket tersimpan dari bot yang dihapus.
        const pend = $id('pendingNotice');
        if (pend) {
            if (pendingPkg) {
                const nm = pendingPkg.tierName || tierName(pendingPkg.tier);
                const left = pendingPkg.daysLeft != null ? ` (sisa ${Number(pendingPkg.daysLeft) || 0} hari)` : '';
                pend.innerHTML = `<i class="fa-solid fa-box-archive"></i><span><strong>Paket ${escapeHtml(nm)}${left} tersimpan.</strong> Otomatis dipasang ke bot berikutnya yang kamu tambahkan. <button type="button" class="link-btn" data-act="add">Tambah bot sekarang</button></span>`;
                pend.classList.remove('v-hide');
            } else pend.classList.add('v-hide');
        }

        if (renamingNumber && list.querySelector('.botcard__rename-form')) {
            // Sedang mengetik nama: jangan hancurkan input-nya. Cukup tandai
            // kartu terpilih supaya tetap sinkron.
            list.querySelectorAll('.botcard[data-number]').forEach(c => c.classList.toggle('is-active', c.dataset.number === activeBotNumber));
            return;
        }

        if (!botsLoaded) return; // biarkan skeleton
        const block = addBlock();
        const addCard = myBots.length
            ? `<button type="button" class="botcard botcard--add" data-act="add"${block === 'BOT_LIMIT' ? ' disabled' : ''}>
                   <span class="botcard__plus"><i class="fa-solid ${block === 'BOT_LIMIT' ? 'fa-lock' : 'fa-plus'}"></i></span>
                   <span class="botcard__addtext">
                       <strong>${block === 'BOT_LIMIT' ? 'Batas bot tercapai' : 'Tambah bot'}</strong>
                       <span class="v-mono">${botLimits?.maxBots ? `${myBots.length}/${botLimits.maxBots} terpakai · ` : ''}tiap bot beda paket</span>
                   </span>
               </button>`
            : `<div class="botcard botcard--empty">
                   <span class="botcard__plus"><i class="fa-brands fa-whatsapp"></i></span>
                   <div>
                       <strong>Belum ada bot</strong>
                       <p>${emptyFleetText()}</p>
                   </div>
                   <button type="button" class="v-btn v-btn--primary v-btn--sm" data-act="add"><i class="fa-solid fa-plus"></i> Tambah bot pertama</button>
               </div>`;
        list.innerHTML = myBots.map(botCardHTML).join('') + addCard;
    }

    // Ajakan bot pertama mengikuti keadaan akun: paket tersimpan langsung
    // terpasang ke bot pertama (jadi bukan "gratis"), dan jatah bot Free
    // bisa diubah admin — angka "1" tidak boleh ditulis mati.
    function emptyFleetText() {
        if (pendingPkg) {
            const nm = pendingPkg.tierName || tierName(pendingPkg.tier);
            return `Tambah nomor WhatsApp pertama kamu — paket ${escapeHtml(nm)} yang tersimpan langsung dipasang ke bot ini.`;
        }
        const maxFree = botLimits?.maxFree ?? 1;
        return maxFree > 0
            ? `Tambah nomor WhatsApp pertama kamu — gratis. Satu akun dapat ${maxFree} bot Free, bot berikutnya bisa pakai paket lain.`
            : 'Tambah nomor WhatsApp pertama kamu. Saat ini bot baru tidak bisa memakai paket Free — hubungi admin untuk paket awal.';
    }

    // --- Kartu Kontrol Bot (bot yang dipilih) ---
    function renderCtlBot() {
        const b = activeBot();
        const label = $id('ctlBotLabel');
        if (label) label.textContent = b ? botName(b) : (activeBotNumber ? 'Bot ini' : 'Belum ada bot');
        const num = $id('ctlBotNum');
        if (num) num.textContent = activeBotNumber ? fmtBotNumber(activeBotNumber) : 'tambah bot dulu';
        const tier = $id('ctlBotTier');
        if (tier) tier.innerHTML = activeBotNumber ? nitroBadgeHTML(botTier()) : '';
        $id('ctlBot')?.classList.toggle('is-empty', !activeBotNumber);
        // Start tetap bisa ditekan tanpa bot: membuka form "Tambah bot".
        ['btnStopBot', 'btnDeleteSession'].forEach(id => {
            const el = $id(id);
            if (el && !el.querySelector('.fa-spin')) el.disabled = !activeBotNumber;
        });
        const ref = $id('backupBotRef');
        if (ref) ref.textContent = activeBotNumber ? botRef(b || { number: activeBotNumber }) : '(belum ada bot)';
        const addonBot = $id('addonBotName');
        if (addonBot) addonBot.textContent = activeBotNumber ? `${b?.label ? b.label + ' · ' : ''}${fmtBotNumber(activeBotNumber)}` : 'Belum ada bot — tambah dulu di Dashboard';
    }

    // --- Bar konteks "Bot yang diatur" di halaman per bot ---
    const BOT_VIEWS = ['statistik', 'config', 'mess', 'cmd', 'welcome', 'broadcast', 'menu', 'api', 'upgrade', 'addons'];
    const CTX_NOTE = {
        upgrade: 'Paket berlaku untuk bot ini. Bot lain tidak ikut berubah.',
        addons: 'Add-on dipasang ke bot ini.',
        statistik: 'Angka di halaman ini milik bot ini.',
        api: 'Token & kuota API milik bot ini.'
    };
    function placeBotCtx(view) {
        const box = $id('botCtx');
        if (!box) return;
        const sec = $id('view-' + view);
        if (!sec || !BOT_VIEWS.includes(view)) { box.classList.add('v-hide'); return; }
        const head = sec.querySelector('.page-head');
        if (head) head.after(box); else sec.prepend(box);
        box.dataset.view = view;
        box.classList.remove('v-hide');
        renderBotCtx();
    }
    function renderBotCtx() {
        const box = $id('botCtx');
        if (!box) return;
        const sel = $id('botCtxSelect');
        const b = activeBot();
        if (sel) {
            const opts = myBots.length
                ? myBots.map(x => `<option value="${escapeHtml(x.number)}"${x.number === activeBotNumber ? ' selected' : ''}>${escapeHtml(botName(x))} · ${fmtBotNumber(x.number)}</option>`).join('')
                : `<option value="">${activeBotNumber ? fmtBotNumber(activeBotNumber) : 'Belum ada bot'}</option>`;
            if (sel.innerHTML !== opts) sel.innerHTML = opts;
            sel.disabled = myBots.length < 2;
        }
        const dot = $id('botCtxDot');
        if (dot) dot.className = statusOf(b).dot;
        const tierEl = $id('botCtxTier');
        if (tierEl) tierEl.innerHTML = activeBotNumber ? nitroBadgeHTML(botTier()) : '';
        const exp = $id('botCtxExp');
        if (exp) {
            const d = daysLeftOf(b);
            exp.textContent = !activeBotNumber ? '' : d != null ? `sisa ${d} hari` : botTier() === 'free' ? 'paket gratis' : '';
            exp.classList.toggle('is-warn', d != null && d <= 3);
        }
        const note = $id('botCtxNote');
        if (note) note.textContent = activeBotNumber
            ? (CTX_NOTE[box.dataset.view] || 'Setelan di halaman ini berlaku untuk bot ini saja.')
            : 'Belum ada bot. Tambah bot dulu di Dashboard.';
        const btn = $id('botCtxUpgrade');
        if (btn) {
            const free = botTier() === 'free';
            btn.dataset.mode = activeBotNumber ? 'upgrade' : 'add';
            btn.innerHTML = activeBotNumber
                ? `<i class="fa-regular fa-gem"></i> <span>${free ? 'Upgrade<span class="hide-sm"> bot ini</span>' : 'Perpanjang<span class="hide-sm"> paket</span>'}</span>`
                : '<i class="fa-solid fa-plus"></i> <span>Tambah bot</span>';
        }
    }
    $id('botCtxSelect')?.addEventListener('change', (e) => {
        if (e.target.value && e.target.value !== activeBotNumber) {
            window.setActiveBotNumber(e.target.value);
            const b = activeBot();
            say(`Sekarang mengatur ${botRef(b)}.`, 'ok');
        }
    });
    $id('botCtxUpgrade')?.addEventListener('click', (e) => {
        if (e.currentTarget.dataset.mode === 'add') { showView('dashboard'); openAddPanel(); return; }
        const t = botTier();
        openOrderModal(t === 'free' ? 'basic' : t, activeBotNumber);
    });

    // --- Form tambah bot ---
    function openAddPanel() {
        const panel = $id('addBotPanel');
        if (!panel) return;
        panel.classList.remove('v-hide');
        $id('fleet')?.classList.add('is-adding');
        $id('btnAddBotToggle')?.setAttribute('aria-expanded', 'true');
        renderAddPanel();
        // Data batas bisa basi (mis. baru upgrade di tab lain): segarkan.
        loadMyBots();
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setTimeout(() => $id('inputWaNumber')?.focus({ preventScroll: true }), 250);
    }
    function closeAddPanel() {
        $id('addBotPanel')?.classList.add('v-hide');
        $id('fleet')?.classList.remove('is-adding');
        $id('btnAddBotToggle')?.setAttribute('aria-expanded', 'false');
        addNoticeSticky = false;
    }
    $id('btnAddBotToggle')?.addEventListener('click', () => {
        if ($id('addBotPanel')?.classList.contains('v-hide')) openAddPanel(); else closeAddPanel();
    });
    $id('btnAddBotClose')?.addEventListener('click', closeAddPanel);

    function setMeterOf(id, pct, tone) { const el = $id(id); if (el) window.VLive.setMeter(el, pct, tone); }

    // Notice di form tambah bot. Kode dari server (BOT_LIMIT, BOT_LIMIT_FREE,
    // SERVER_FULL) diterjemahkan jadi kalimat yang jelas + langkah lanjutnya.
    function addNoticeHTML(code, serverText = '', cap = null) {
        const max = botLimits?.maxBots;
        if (code === 'BOT_LIMIT') {
            return { tone: 'danger', html: `<i class="fa-solid fa-layer-group"></i><span><strong>Batas ${max ? `${max} bot` : 'bot'} per akun sudah tercapai.</strong> ${escapeHtml(serverText || 'Hapus salah satu bot dulu untuk menambah yang baru.')}</span>` };
        }
        if (code === 'BOT_LIMIT_FREE') {
            const freeBot = myBots.find(b => effectiveTier(b) === 'free');
            const act = freeBot
                ? `<span class="notice__acts"><button type="button" class="v-btn v-btn--sm v-btn--primary" data-act="upgrade" data-number="${escapeHtml(freeBot.number)}"><i class="fa-regular fa-gem"></i> Upgrade ${escapeHtml(botRef(freeBot))}</button></span>`
                : '';
            return { tone: 'warn', html: `<i class="fa-solid fa-lock"></i><span><strong>Slot bot Free sudah terpakai.</strong> ${escapeHtml(serverText || `Tiap akun cuma boleh ${botLimits?.maxFree ?? 1} bot Free, dan bot baru selalu mulai dari Free. Upgrade bot Free kamu dulu (atau hapus), lalu tambah bot baru.`)}${act}</span>` };
        }
        if (code === 'SERVER_FULL') {
            const angka = cap && cap.max != null ? ` (${cap.used ?? cap.max}/${cap.max} bot)` : '';
            return { tone: 'danger', html: `<i class="fa-solid fa-server"></i><span><strong>Server lagi penuh${angka}.</strong> Supaya semua bot tetap lancar, bot baru belum bisa ditambahkan dulu. Coba lagi beberapa saat lagi — sisa slot terlihat di kartu Server.</span>` };
        }
        if (code === 'PENDING') {
            const nm = pendingPkg?.tierName || tierName(pendingPkg?.tier);
            return { tone: 'ok', html: `<i class="fa-solid fa-gift"></i><span><strong>Bot baru ini langsung dapat paket ${escapeHtml(nm)}</strong>${pendingPkg?.daysLeft != null ? ` (sisa ${Number(pendingPkg.daysLeft) || 0} hari)` : ''} — paket yang tersimpan di akun kamu.</span>` };
        }
        return { tone: 'danger', html: `<i class="fa-solid fa-circle-exclamation"></i><span>${escapeHtml(serverText || 'Bot belum bisa ditambahkan.')}</span>` };
    }
    function showAddNotice(code, serverText, cap, { sticky = false } = {}) {
        const box = $id('addBotNotice');
        if (!box) return;
        // Aturan slot Free tidak perlu tampil kalau notice-nya sudah menjelaskan itu.
        $id('addBotRule')?.classList.toggle('v-hide', !botLimits || code === 'BOT_LIMIT_FREE' || code === 'PENDING');
        if (!code) { box.classList.add('v-hide'); box.innerHTML = ''; addNoticeSticky = false; return; }
        const n = addNoticeHTML(code, serverText, cap);
        box.className = `notice notice--${n.tone}`;
        box.innerHTML = n.html;
        addNoticeSticky = sticky;
    }

    function renderAddPanel() {
        const panel = $id('addBotPanel');
        if (!panel) return;
        const L = botLimits;
        $id('limBotsBox')?.classList.toggle('v-hide', !L);
        $id('limFreeBox')?.classList.toggle('v-hide', !L);
        if (L) {
            const used = L.used ?? myBots.length;
            const freeUsed = L.freeUsed ?? myBots.filter(b => effectiveTier(b) === 'free').length;
            $id('limBots').textContent = `${used}/${L.maxBots}`;
            setMeterOf('limBotsMeter', L.maxBots ? (used / L.maxBots) * 100 : 0, used >= L.maxBots ? 'danger' : used >= L.maxBots - 1 ? 'warn' : '');
            $id('limFree').textContent = `${freeUsed}/${L.maxFree}`;
            setMeterOf('limFreeMeter', L.maxFree ? (freeUsed / L.maxFree) * 100 : 100, freeUsed >= L.maxFree ? 'warn' : '');
            const rf = $id('ruleFree');
            if (rf) rf.textContent = L.maxFree;
            // FAQ ikut jatah bot Free yang diatur admin.
            document.querySelectorAll('[data-free-n]').forEach(el => { el.textContent = L.maxFree; });
        }
        const cap = lastCapacity || botsCapacity;
        if (cap && cap.max != null) {
            const info = window.VLive.capacityInfo(cap);
            $id('limSrv').textContent = info.remaining === 0 ? 'penuh' : `${info.remaining} kosong`;
            const pct = cap.percent ?? (cap.max ? ((cap.max - info.remaining) / cap.max) * 100 : 0);
            setMeterOf('limSrvMeter', pct, info.tone === 'ok' ? '' : info.tone);
        } else {
            $id('limSrv').textContent = 'belum dicek';
            setMeterOf('limSrvMeter', 0, '');
        }

        const btn = $id('btnAddBot');
        const block = addBlock();
        if (btn && !btn.querySelector('.fa-spin')) btn.disabled = !!block;
        if (addNoticeSticky) return;
        // Peringatan sebelum user mencoba, supaya tidak menebak-nebak.
        if (block) showAddNotice(block);
        else if (cap && cap.max != null && window.VLive.capacityInfo(cap).remaining === 0 && currentUser?.role !== 'admin') showAddNotice('SERVER_FULL', '', cap);
        else if (pendingPkg) showAddNotice('PENDING');
        else showAddNotice('');
    }
    ['inputWaNumber', 'addBotLabel'].forEach(id => $id(id)?.addEventListener('input', () => {
        if (addNoticeSticky) { addNoticeSticky = false; renderAddPanel(); }
    }));

    // --- Start / stop ---
    // isNew: nomor yang belum ada di "Bot saya" (didaftarkan ke akun oleh
    // server saat start). Penolakan batas ditampilkan di form tambah bot.
    async function startBot(number, { isNew = false, label = '', btn = null } = {}) {
        const clean = cleanNumber(number);
        if (clean.length < 9) {
            say('Nomor WA terlalu pendek. Pakai format 62812xxxx.', 'err');
            return false;
        }
        const previous = activeBotNumber;
        showStartNotice('');
        if (isNew) { addingNumber = clean; showAddNotice(''); }
        // Pindah ke bot ini SEBELUM request: SSE harus sudah mendengarkan
        // nomor ini supaya pairing code tidak terlewat.
        if (clean !== activeBotNumber) window.setActiveBotNumber(clean, { load: false });
        else window.reconnectBotStream?.();
        liveWidgets?.feed?.render();

        setBotState('connecting');
        termReset(`$ Menyiapkan sesi untuk ${clean}…`, 't-info');
        const done = busy(btn, isNew ? 'Menambahkan…' : 'Memulai…');
        const revert = () => {
            addingNumber = '';
            if (isNew && previous !== clean) window.setActiveBotNumber(previous);
        };

        try {
            const res = await fetch('/api/bot/start', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: clean, userId: currentUser.id })
            });
            let result = {};
            try { result = await res.json(); } catch { result = {}; }

            // Server penuh (kapasitas habis).
            if (res.status === 503 && result.code === 'SERVER_FULL') {
                const cap = result.capacity || lastCapacity;
                termLine(`$ ${result.message || 'Server penuh. Coba lagi nanti.'}`, 't-warn');
                setBotState('offline');
                if (cap) { lastCapacity = { ...(lastCapacity || {}), ...cap }; renderSlotHint(lastCapacity); }
                if (isNew) {
                    showAddNotice('SERVER_FULL', '', cap, { sticky: true });
                    revert();
                } else {
                    const angka = cap && cap.max != null ? ` (${cap.used ?? cap.max}/${cap.max} bot)` : '';
                    showStartNotice(`<strong>Server lagi penuh${angka}.</strong> Supaya semua bot tetap lancar, bot baru belum bisa dijalankan dulu. Coba lagi beberapa saat lagi — sisa slot terlihat di kartu Server.`);
                }
                say('Server penuh — bot baru belum bisa dijalankan sekarang.', 'err');
                return false;
            }

            if (!result.success) {
                // Penolakan harus terlihat, bukan menggantung di "Connecting...".
                const msg = serverMsg(res, result, 'Gagal memulai bot.');
                setBotState('offline');
                termLine(`$ ${msg}`, 't-err');
                if (isNew) {
                    showAddNotice(['BOT_LIMIT', 'BOT_LIMIT_FREE'].includes(result.code) ? result.code : 'OTHER', res.status >= 500 ? msg : result.message, null, { sticky: true });
                    say(result.code === 'BOT_LIMIT_FREE' ? 'Slot bot Free sudah terpakai.' : result.code === 'BOT_LIMIT' ? 'Batas jumlah bot tercapai.' : msg, 'err');
                    revert();
                    // Batas di layar mungkin basi — ambil yang terbaru.
                    loadMyBots();
                } else {
                    say(msg, 'err');
                }
                return false;
            }

            termLine('$ Koneksi dimulai. Tunggu pairing code muncul di sini…', 't-dim');
            if (isNew) {
                closeAddPanel();
                const inp = $id('inputWaNumber'); if (inp) inp.value = '';
                const lab = $id('addBotLabel'); if (lab) lab.value = '';
            }
            // Daftar dimuat ulang SELAGI addingNumber masih terisi: kalau
            // tidak, bot baru (belum ada di daftar lama) dianggap "bukan
            // milik akun" dan pilihan melompat ke bot lain — pairing code-nya
            // jadi tidak terlihat.
            // Permintaan yang sudah jalan sebelum start bisa membawa daftar
            // lama — tunggu selesai, lalu minta yang baru.
            if (botsReq) await botsReq;
            await loadMyBots();
            addingNumber = '';
            if (isNew) {
                if (label) await saveLabel(clean, label, { quiet: true });
                // Paket tersimpan (dari bot yang dihapus) langsung terpasang ke bot ini.
                const applied = result.pendingApplied;
                say(applied
                    ? `Bot ditambahkan dengan paket ${applied.tierName || tierName(applied.tier)}. Tunggu pairing code di terminal, ya.`
                    : 'Bot ditambahkan. Tunggu pairing code di terminal, ya.', 'ok');
                // Pairing code muncul di terminal — bawa user ke sana.
                $id('botTerminal')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            loadBotConfig({ quiet: true });
            loadBotStats();
            if (currentView === 'api') loadApiToken();
            return true;
        } catch (err) {
            // Sebelumnya ditelan, jadi status macet di "Connecting..." selamanya.
            say('Gagal terhubung ke server. Coba lagi.', 'err');
            setBotState('offline');
            if (isNew) revert();
            return false;
        } finally {
            if (isNew) addingNumber = '';
            done();
        }
    }

    async function stopBot(number, btn) {
        if (!number) return say('Belum ada bot yang dipilih.', 'err');
        const done = busy(btn, 'Menghentikan…');
        try {
            const res = await fetch('/api/bot/stop', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number, userId: currentUser.id })
            });
            let result = {};
            try { result = await res.json(); } catch { result = {}; }
            if (!result.success) return say(serverMsg(res, result, 'Gagal menghentikan bot.'), 'err');
            if (number === activeBotNumber) setBotState('offline');
            const b = myBots.find(x => x.number === number);
            if (b) b.status = 'stop';
            onBotsChanged({ light: true });
            say(result.message || 'Bot dihentikan.', 'ok');
        } catch (err) {
            say('Gagal terhubung ke server.', 'err');
        } finally { done(); }
    }

    $id('btnStartBot')?.addEventListener('click', (e) => {
        if (!activeBotNumber) { openAddPanel(); return say('Tambah bot dulu, lalu start.', 'err'); }
        startBot(activeBotNumber, { btn: e.currentTarget });
    });
    $id('btnStopBot')?.addEventListener('click', (e) => stopBot(activeBotNumber, e.currentTarget));
    $id('btnDeleteSession')?.addEventListener('click', () => {
        if (!activeBotNumber) return say('Belum ada bot yang dipilih.', 'err');
        openDeleteModal(activeBotNumber);
    });

    $id('btnAddBot')?.addEventListener('click', async (e) => {
        const inp = $id('inputWaNumber');
        const clean = cleanNumber(inp?.value);
        if (!clean) { inp?.focus(); return say('Masukkan nomor WA bot dulu.', 'err'); }
        if (clean.length < 9) { inp?.focus(); return say('Nomor WA terlalu pendek. Pakai format 62812xxxx.', 'err'); }
        const label = ($id('addBotLabel')?.value || '').trim().slice(0, 32);
        // Nomor yang sudah ada di akun cukup dipilih & di-start ulang.
        const existing = myBots.find(b => b.number === clean);
        if (existing) {
            closeAddPanel();
            if (inp) inp.value = '';
            say(`${botRef(existing)} sudah ada di akun kamu — langsung di-start.`);
            if (label && label !== existing.label) saveLabel(clean, label, { quiet: true });
            return startBot(clean, { btn: $id('btnStartBot') });
        }
        startBot(clean, { isNew: true, label, btn: e.currentTarget });
    });
    $id('inputWaNumber')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $id('btnAddBot')?.click(); });

    // --- Ganti nama ---
    async function saveLabel(number, label, { quiet = false } = {}) {
        const clean = String(label || '').trim().slice(0, 32);
        try {
            const res = await fetch('/api/bots/label', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: currentUser.id, number, label: clean })
            });
            let d = {};
            try { d = await res.json(); } catch { d = {}; }
            if (!res.ok || !d.success) {
                if (!quiet) say(serverMsg(res, d, 'Gagal mengganti nama bot.'), 'err');
                return false;
            }
            const b = myBots.find(x => x.number === number);
            if (b) b.label = typeof d.label === 'string' ? d.label : clean;
            renamingNumber = '';
            saveBotsCache();
            onBotsChanged();
            if (!quiet) say(clean ? `Nama bot disimpan: ${clean}.` : 'Nama bot dikosongkan.', 'ok');
            return true;
        } catch (err) {
            if (!quiet) say('Gagal terhubung ke server.', 'err');
            return false;
        }
    }

    // --- Klik di kartu bot (delegasi) ---
    $id('fleet')?.addEventListener('click', (e) => {
        const actEl = e.target.closest('[data-act]');
        const card = e.target.closest('.botcard[data-number]');
        const number = actEl?.dataset.number || card?.dataset.number || '';
        if (!actEl) {
            // Klik di badan kartu = pilih bot itu.
            if (card && number !== activeBotNumber && !e.target.closest('form')) {
                window.setActiveBotNumber(number);
                say(`Sekarang mengatur ${botRef(activeBot())}.`, 'ok');
            }
            return;
        }
        const act = actEl.dataset.act;
        if (act === 'add') return openAddPanel();
        if (act === 'rename') {
            renamingNumber = number;
            renderFleet();
            const input = $id('botList').querySelector(`.botcard__rename-form[data-number="${CSS.escape(number)}"] input`);
            input?.focus(); input?.select();
            return;
        }
        if (act === 'rename-cancel') { renamingNumber = ''; renderFleet(); return; }
        if (act === 'manage') {
            if (number !== activeBotNumber) window.setActiveBotNumber(number);
            showView('config');
            return;
        }
        if (act === 'upgrade') {
            const b = myBots.find(x => x.number === number);
            const t = b ? effectiveTier(b) : 'free';
            return openOrderModal(t === 'free' ? 'basic' : t, number);
        }
        if (act === 'start') {
            if (number !== activeBotNumber) window.setActiveBotNumber(number);
            startBot(number, { btn: actEl });
            return;
        }
        if (act === 'stop') return stopBot(number, actEl);
        if (act === 'delete') return openDeleteModal(number);
    });
    $id('fleet')?.addEventListener('submit', (e) => {
        const form = e.target.closest('.botcard__rename-form');
        if (!form) return;
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
        saveLabel(form.dataset.number, form.querySelector('input')?.value || '').finally(() => { if (btn) btn.disabled = false; });
    });
    $id('fleet')?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && e.target.closest('.botcard__rename-form')) {
            e.stopPropagation();
            renamingNumber = ''; renderFleet();
        }
    });
    // Tombol "Upgrade bot Free" di notice tambah bot ikut ditangani
    // delegasi #fleet di atas (data-act="upgrade" + data-number).

    // --- Hapus bot ---
    let deleteTarget = '';
    function botIdentityHTML(b) {
        return `<span class="order-bot__icon"><i class="fa-brands fa-whatsapp"></i></span>
            <span class="order-bot__id"><strong>${escapeHtml(botName(b))}</strong><span class="v-mono">${fmtBotNumber(b.number)}</span></span>
            ${nitroBadgeHTML(effectiveTier(b))}`;
    }
    function openDeleteModal(number) {
        const b = myBots.find(x => x.number === number) || { number, label: '', tier: botsLegacy ? (currentUser.tier || 'free') : 'free' };
        deleteTarget = number;
        $id('delBotWho').innerHTML = botIdentityHTML(b);
        const t = effectiveTier(b);
        const d = daysLeftOf(b);
        const pkg = $id('delBotPkg');
        if (botsLegacy) {
            pkg.className = 'notice';
            pkg.innerHTML = `<i class="fa-solid fa-circle-info"></i><span>Paket akun kamu tidak berubah.</span>`;
        } else if (t !== 'free') {
            // Aturan paket tersimpan: paket berbayar tidak hangus saat bot dihapus.
            let html = `<strong>Paket ${tierName(t)}${d != null ? ` (sisa ${d} hari)` : ''} tidak hangus.</strong> Paketnya disimpan dan otomatis dipasang ke bot berikutnya yang kamu tambahkan.`;
            if (pendingPkg) {
                const nm = pendingPkg.tierName || tierName(pendingPkg.tier);
                html += ` Kamu sudah punya paket ${escapeHtml(nm)}${pendingPkg.daysLeft != null ? ` (sisa ${Number(pendingPkg.daysLeft) || 0} hari)` : ''} yang menunggu — yang disimpan cuma satu, yaitu yang masa aktifnya paling lama.`;
            }
            pkg.className = 'notice notice--ok';
            pkg.innerHTML = `<i class="fa-solid fa-box-archive"></i><span>${html}</span>`;
        } else {
            pkg.className = 'notice';
            pkg.innerHTML = `<i class="fa-solid fa-circle-info"></i><span>Bot ini pakai paket Free, jadi tidak ada paket yang hilang. Slot bot Free kamu kosong lagi setelah bot ini dihapus.</span>`;
        }
        $id('delBotTitle').textContent = `Hapus ${botRef(b)}?`;
        openModal($id('deleteBotModal'));
    }
    $id('btnConfirmDeleteBot')?.addEventListener('click', async (e) => {
        const number = deleteTarget;
        if (!number) return;
        const done = busy(e.currentTarget, 'Menghapus…');
        try {
            const res = await fetch('/api/bot/delete', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number, userId: currentUser.id })
            });
            let result = {};
            try { result = await res.json(); } catch { result = {}; }
            // Data lokal HANYA dibersihkan kalau server benar-benar menghapus.
            // Kalau server menolak, nomornya masih terdaftar di akun.
            if (!result.success) return say(serverMsg(res, result, 'Gagal menghapus bot.'), 'err');

            closeModal($id('deleteBotModal'));
            deleteTarget = '';
            myBots = myBots.filter(b => b.number !== number);
            if (number === activeBotNumber) {
                window.setActiveBotNumber(myBots[0]?.number || '');
                termReset('$ Bot dihapus.', 't-dim');
            }
            onBotsChanged();
            say(result.message || 'Bot dihapus.', 'ok');
            loadMyBots();
        } catch (err) {
            say('Gagal terhubung ke server.', 'err');
        } finally { done(); }
    });

    // Status & batas berubah dari luar halaman ini (bot putus, paket
    // habis, upgrade di tab lain): segarkan berkala selama tab terlihat.
    setInterval(() => { if (document.visibilityState === 'visible') loadMyBots(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadMyBots(); });

    // Tombol simpan hanya aktif setelah config berhasil dimuat dari server.
    // Mencegah config asli tertimpa form kosong saat pemuatan gagal.
    function setConfigLoaded(ok) {
        ['btnSaveConfig', 'btnSaveMenu', 'btnSaveAutoReply', 'btnSaveCmd'].forEach(id => {
            const el = $id(id);
            if (!el) return;
            el.dataset.loadBlocked = ok ? '' : '1';
            if (!ok) {
                el.disabled = true;
                el.title = 'Config gagal dimuat. Muat ulang halaman sebelum menyimpan.';
            } else if (el.title.startsWith('Config gagal')) {
                el.disabled = false;
                el.title = '';
            }
        });
    }

    // Mode self dinyalakan lewat .self di WhatsApp, bukan dari dashboard.
    // Tanpa penanda ini user mengira bot rusak karena diam ke semua orang.
    function setSelfModeNotice(on) {
        document.querySelectorAll('.self-mode-notice').forEach(el => el.classList.toggle('v-hide', !on));
    }

    // quiet: dipakai saat halaman baru dibuka / ganti bot — gagal di sini
    // jangan memunculkan toast, cukup kunci tombol simpan.
    async function loadBotConfig({ quiet = false } = {}) {
        if (!activeBotNumber) { setSelfModeNotice(false); return; }
        try {
            const res = await fetch(`/api/bot/config/${encodeURIComponent(activeBotNumber)}?userId=${encodeURIComponent(currentUser?.id || '')}`);
            const result = await res.json();
            if (result.success) {
                const cfg = result.data || {};
                setSelfModeNotice(cfg.selfMode === true);
                const toggleModePublik = $id('modePublik');
                if (toggleModePublik) toggleModePublik.checked = cfg.modePublik ?? true;

                if ($id('cfgBotName')) $id('cfgBotName').value = cfg.botName || '';
                if ($id('cfgOwnerNumber')) $id('cfgOwnerNumber').value = cfg.ownerNumber || '';
                if ($id('cfgWatermark')) $id('cfgWatermark').value = cfg.watermark || '';
                if ($id('cfgFooter')) $id('cfgFooter').value = cfg.footer || '';
                // Selalu ditimpa (kosong = teks otomatis) supaya teks bot
                // sebelumnya tidak tertinggal di form saat ganti bot.
                if ($id('cfgSewaText')) $id('cfgSewaText').value = typeof cfg.sewaText === 'string' ? cfg.sewaText : '';
                if ($id('cfgPremiumText')) $id('cfgPremiumText').value = typeof cfg.premiumText === 'string' ? cfg.premiumText : '';
                renderOwnerText();

                // Selalu ditimpa (bawaan kalau kosong): kalau tidak, menu bot
                // sebelumnya tertinggal di form saat ganti bot lalu ikut
                // tersimpan ke bot ini.
                const customMenuInput = $id('cfgCustomMenu');
                if (customMenuInput) customMenuInput.value = cfg.customMenu || DEFAULT_MENU;

                const menuImageInput = $id('cfgMenuImage');
                if (menuImageInput) menuImageInput.value = cfg.menuImage || '';

                autoReplies = Array.isArray(cfg.autoReply) ? cfg.autoReply : [];
                renderAutoReplies();

                customCommands = Array.isArray(cfg.customCommands) ? cfg.customCommands : [];
                renderCustomCommands();
                setConfigLoaded(true);
            } else {
                setConfigLoaded(false);
            }
        } catch (err) {
            // BERBAHAYA kalau dibiarkan: form tampil kosong, user menekan
            // Simpan, dan config asli di server tertimpa data kosong.
            // Tombol simpan dikunci sampai config berhasil dimuat.
            setConfigLoaded(false);
            if (!quiet) say('Config bot gagal dimuat. Tombol simpan dikunci sampai halaman dimuat ulang.', 'err');
        }
    }

    function renderBotStats(s) {
        const set = (id, val) => { const el = $id(id); if (el) el.innerText = val; };
        set('stMessages', (s.messages || 0).toLocaleString('id-ID'));
        set('stCommands', (s.commands || 0).toLocaleString('id-ID'));
        set('stGroups', s.groups || 0);
        set('stSplit', `${(s.groupMessages || 0).toLocaleString('id-ID')} / ${(s.privateMessages || 0).toLocaleString('id-ID')}`);

        // Status online dari server lebih bisa dipercaya daripada tebakan
        // dari log. Saat sedang pairing/menyambung jangan ditimpa "Offline".
        if (s.online === true && botState !== 'online') setBotState('online');
        else if (s.online === false && botState === 'online') setBotState('offline');

        // Angka ringkas di kartu "Bot saya" ikut hidup untuk bot terpilih.
        const ab = activeBot();
        if (ab && (ab.groups !== s.groups || ab.messages !== s.messages || ab.commands !== s.commands)) {
            if (s.groups != null) ab.groups = s.groups;
            if (s.messages != null) ab.messages = s.messages;
            if (s.commands != null) ab.commands = s.commands;
            window.refreshBotsUI?.({ light: true });
        }

        const feed = $id('activityFeed');
        if (!feed) return;
        const items = s.recent || [];
        if (!items.length) {
            feed.innerHTML = `<p class="feed-empty">Belum ada aktivitas. Jalankan bot dan kirim pesan ke grup untuk melihatnya di sini.</p>`;
            return;
        }
        feed.innerHTML = items.map(r => {
            const time = new Date(r.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\./g, ':');
            const where = r.isGroup ? 'Grup' : 'Pribadi';
            const label = r.command
                ? `<code class="feed-cmd">.${escapeHtml(r.command)}</code>`
                : `<span class="feed-text">${escapeHtml(r.preview) || '<i>pesan</i>'}</span>`;
            return `
                <div class="feed-row">
                    <span class="feed-time">${time}</span>
                    <span class="feed-where ${r.isGroup ? 'g' : 'p'}">${where}</span>
                    <span class="feed-body">${label}</span>
                    <span class="feed-from">${escapeHtml(r.from) || '-'}</span>
                </div>`;
        }).join('');
    }

    // ==========================================
    // ADD-ONS
    // ==========================================
    let addonCatalog = null;
    let addonVoucher = null;
    let addonPick = { type: '', days: 0, price: 0 };

    async function loadAddons() {
        const optBox = $id('addonOptions');
        if (!optBox) return;

        try {
            const [catRes, mineRes] = await Promise.all([
                fetch('/api/addons/catalog'),
                fetch(`/api/addons/mine/${encodeURIComponent(currentUser.id)}`)
            ]);
            const cat = await catRes.json();
            const mine = await mineRes.json();

            if (!cat.success) { optBox.innerHTML = `<p class="feed-empty">Gagal memuat pilihan add-on.</p>`; return; }
            addonCatalog = cat.catalog;
            if (cat.fee != null) adminFee = cat.fee;

            // Tampilkan add-on yang sedang aktif beserta sisa waktunya.
            const activeBox = $id('activeAddons');
            const active = (mine.success && mine.addons) ? mine.addons : [];
            if (activeBox) {
                activeBox.innerHTML = active.length ? active.map(a => {
                    const exp = new Date(a.expiredAt);
                    const hoursLeft = Math.max(0, Math.round((exp - new Date()) / 3600000));
                    const left = hoursLeft >= 24 ? `${Math.floor(hoursLeft / 24)} hari ${hoursLeft % 24} jam` : `${hoursLeft} jam`;
                    // Add-on melekat ke bot tertentu: sebutkan botnya.
                    const ab = a.botNumber ? myBots.find(b => b.number === String(a.botNumber)) : null;
                    const forBot = a.botNumber ? ` &middot; bot ${escapeHtml(ab?.label || fmtBotNumber(a.botNumber))}` : '';
                    return `
                    <div class="addon-active">
                        <span class="v-dot v-dot--live"></span>
                        <div style="min-width:0;">
                            <strong>${escapeHtml(a.name)} aktif</strong>
                            <p>Sisa ${left} &middot; sampai ${exp.toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${forBot}</p>
                        </div>
                    </div>`;
                }).join('') : '';
            }

            const mlbb = addonCatalog.mlbb_unlimited;
            optBox.innerHTML = mlbb.options.map(o => `
                <button type="button" class="addon-opt btn-buy-addon" data-type="mlbb_unlimited" data-days="${o.days}" data-price="${o.price}">
                    <span class="addon-opt-days">${o.days} hari</span>
                    <span class="addon-opt-price">${rupiah(o.price)}</span>
                    <span class="addon-opt-per">${rupiah(Math.round(o.price / o.days))} / hari</span>
                </button>
            `).join('');
        } catch (err) {
            optBox.innerHTML = `<p class="feed-empty">Gagal terhubung ke server.</p>`;
        }
    }

    function recalcAddon() {
        const discount = addonVoucher?.discount || 0;
        $id('addonSubtotal').innerText = rupiah(addonPick.price);
        $id('addonFee').innerText = rupiah(adminFee);
        $id('addonTotal').innerText = rupiah(addonPick.price - discount + adminFee);
        const row = $id('addonDiscountRow');
        if (discount > 0) {
            row.style.display = 'flex';
            $id('addonDiscount').innerText = '- ' + rupiah(discount);
        } else { row.style.display = 'none'; }
    }

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-buy-addon');
        if (!btn) return;
        const type = btn.dataset.type;
        const days = Number(btn.dataset.days);
        const info = addonCatalog?.[type];
        if (!info) return;

        addonPick = { type, days, price: Number(btn.dataset.price) };
        addonVoucher = null;

        $id('addonName').value = info.name;
        const sel = $id('addonDays');
        sel.innerHTML = info.options.map(o =>
            `<option value="${o.days}" data-price="${o.price}" ${o.days === days ? 'selected' : ''}>${o.days} hari — ${rupiah(o.price)}</option>`
        ).join('');
        $id('addonVoucher').value = '';
        $id('addonVoucherMsg').innerText = '';
        recalcAddon();
        openModal($id('addonModal'));
    });

    $id('addonDays')?.addEventListener('change', (e) => {
        const opt = e.target.selectedOptions[0];
        addonPick.days = Number(e.target.value);
        addonPick.price = Number(opt.dataset.price);
        // Voucher direset karena nominalnya berubah.
        addonVoucher = null;
        $id('addonVoucherMsg').innerText = 'Voucher direset karena durasi berubah.';
        $id('addonVoucherMsg').className = 'form-msg v-dim';
        recalcAddon();
    });

    const addonModal = $id('addonModal');
    $id('btnCloseAddon')?.addEventListener('click', () => closeModal(addonModal));
    $id('btnCancelAddon')?.addEventListener('click', () => closeModal(addonModal));

    $id('btnApplyAddonVoucher')?.addEventListener('click', async (e) => {
        const code = $id('addonVoucher').value.trim();
        const msg = $id('addonVoucherMsg');
        if (!code) return;
        const done = busy(e.currentTarget, '');
        try {
            const res = await fetch('/api/addons/check-promo', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, type: addonPick.type, days: addonPick.days })
            });
            const r = await res.json();
            if (r.success) {
                addonVoucher = { code: r.code, discount: r.discount };
                msg.innerText = `Voucher ${r.code} aktif: potongan ${r.percent}%.`;
                msg.className = 'form-msg is-ok';
            } else {
                addonVoucher = null;
                msg.innerText = r.message || 'Kode voucher tidak valid.';
                msg.className = 'form-msg is-err';
            }
            recalcAddon();
        } catch (err) {
            msg.innerText = 'Gagal memeriksa voucher.'; msg.className = 'form-msg is-err';
        } finally { done(); }
    });

    $id('btnCreateAddon')?.addEventListener('click', async (e) => {
        if (!currentUser?.id) return say('Silakan login ulang.', 'err');
        // Add-on dipasang ke bot tertentu, jadi harus ada bot yang dipilih.
        if (!activeBotNumber) return say(NO_BOT_MSG, 'err');
        const done = busy(e.currentTarget, 'Memproses…');
        try {
            const res = await fetch('/api/addons/create', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: currentUser.id,
                    type: addonPick.type,
                    days: addonPick.days,
                    botNumber: activeBotNumber || '',
                    promoCode: addonVoucher?.code || ''
                })
            });
            const r = await res.json();
            if (!r.success) {
                if (r.code === 'PENDING_EXISTS' && r.orderId) {
                    if (confirm(`${r.message}\n\nBuka invoice yang belum dibayar itu sekarang?`)) {
                        window.location.href = `/invoice?order_id=${encodeURIComponent(r.orderId)}`;
                    }
                    return;
                }
                say(r.message || 'Gagal membuat pesanan.', 'err');
                return;
            }
            window.location.href = `/invoice?order_id=${encodeURIComponent(r.order.orderId)}`;
        } catch (err) {
            say('Gagal terhubung ke server pembayaran.', 'err');
        } finally { done(); }
    });

    async function loadLeaderboard() {
        const box = $id('leaderboard');
        if (!box) return;
        try {
            const res = await fetch('/api/leaderboard');
            const result = await res.json();
            if (!result.success || !result.board.length) {
                box.innerHTML = `<p class="feed-empty">Belum ada pelanggan berbayar. Jadilah yang pertama menempati puncak.</p>`;
                return;
            }
            const medal = ['gold', 'silver', 'bronze'];
            box.innerHTML = result.board.map(r => {
                const initial = (r.username || '?').charAt(0).toUpperCase();
                const face = r.avatarUrl
                    ? `<img src="${escapeHtml(r.avatarUrl)}" alt="">`
                    : escapeHtml(initial);
                const sinceTxt = r.since
                    ? new Date(r.since).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })
                    : '-';
                const isMe = r.username === currentUser.username;
                return `
                <div class="lb-row ${medal[r.rank - 1] || ''} ${isMe ? 'me' : ''}">
                    <span class="lb-rank">${r.rank}</span>
                    <span class="lb-face">${face}</span>
                    <span class="lb-name">
                        <span>${escapeHtml(r.username)} ${isMe ? '<span class="lb-you">kamu</span>' : ''}</span>
                        <em>sejak ${sinceTxt}</em>
                    </span>
                    ${nitroBadgeHTML(r.tier)}
                    <span class="lb-months">${r.totalMonths} bln</span>
                </div>`;
            }).join('');
        } catch (err) {
            box.innerHTML = `<p class="feed-empty">Gagal memuat peringkat.</p>`;
        }
    }

    async function loadBotStats() {
        if (!activeBotNumber) return;
        try {
            const res = await fetch(`/api/bot/stats/${encodeURIComponent(activeBotNumber)}?userId=${encodeURIComponent(currentUser?.id || '')}`);
            const result = await res.json();
            if (result.success) renderBotStats(result.data);
        } catch (err) { /* statistik bersifat tambahan; diam saja */ }
    }

    // --- SIMPAN CONFIG / MENU / PROFIL ---
    $id('btnSaveConfig')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return say(NO_BOT_MSG, 'err');

        const modePublik = $id('modePublik')?.checked ?? true;
        const caps = TIER_CAPS[botTier()] || TIER_CAPS.free;
        const botName = caps.customize ? ($id('cfgBotName')?.value.trim() || '') : '';
        const ownerNumber = caps.customize ? ($id('cfgOwnerNumber')?.value || '') : '';
        const watermark = caps.customize ? ($id('cfgWatermark')?.value || '') : '';
        const footer = caps.customize ? ($id('cfgFooter')?.value || '') : '';

        const ownerCount = ownerNumber.split(',').map(n => n.trim()).filter(Boolean).length;
        const maxOwners = OWNER_LIMIT_BY_TIER[botTier()] ?? 0;
        if (ownerCount > maxOwners) {
            return say(maxOwners === 0
                ? 'Kustomisasi nomor owner khusus bot berpaket berbayar. Upgrade bot ini dulu, ya.'
                : `Paket ${tierName(botTier())} bot ini maksimal ${maxOwners} nomor owner. Kurangi jumlah nomor atau upgrade bot ini.`, 'err');
        }

        const payload = { number: activeBotNumber, userId: currentUser.id, tier: botTier(), modePublik, botName, ownerNumber, watermark, footer };
        // Teks sewa & premium ikut tersimpan di sini (satu tombol untuk
        // seluruh halaman Config). Bot Free tidak mengirimnya sama sekali:
        // server memang mengabaikannya untuk Free.
        if (caps.customize) {
            payload.sewaText = $id('cfgSewaText')?.value.trim() ?? '';
            payload.premiumText = $id('cfgPremiumText')?.value.trim() ?? '';
            const panjang = [['Teks sewa', payload.sewaText], ['Teks premium', payload.premiumText]]
                .find(([, t]) => t.length > OWNER_TEXT_MAX);
            if (panjang) return say(`${panjang[0]} maksimal ${OWNER_TEXT_MAX} karakter. Ringkas dulu, ya.`, 'err');
        }

        const done = busy(e.currentTarget, 'Menyimpan…');
        try {
            const res = await fetch('/api/bot/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await res.json();
            say(result.success ? (result.message || 'Konfigurasi disimpan!') : serverMsg(res, result, 'Gagal menyimpan konfigurasi.'), result.success ? 'ok' : 'err');
        } catch (err) {
            say('Gagal terhubung ke server. Konfigurasi BELUM tersimpan.', 'err');
        } finally { done(); }
    });

    $id('btnSaveMenu')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return say(NO_BOT_MSG, 'err');
        const caps = TIER_CAPS[botTier()] || TIER_CAPS.free;
        if (!caps.customize) return say('Kustomisasi menu khusus paket berbayar (Core/Prime/Zenith).', 'err');

        const customMenu = $id('cfgCustomMenu')?.value || '';
        const payload = { number: activeBotNumber, userId: currentUser.id, tier: botTier(), customMenu };
        if (caps.menuImage) payload.menuImage = $id('cfgMenuImage')?.value || '';

        const done = busy(e.currentTarget, 'Menyimpan…');
        try {
            const res = await fetch('/api/bot/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await res.json();
            say(result.success ? (result.message || 'Menu kustom berhasil disimpan!') : serverMsg(res, result, 'Gagal menyimpan menu.'), result.success ? 'ok' : 'err');
        } catch (err) {
            say('Gagal terhubung ke server. Menu BELUM tersimpan.', 'err');
        } finally { done(); }
    });

    $id('btnResetMenu')?.addEventListener('click', () => {
        const menuBox = $id('cfgCustomMenu');
        if (menuBox) menuBox.value = DEFAULT_MENU;
        say('Menu dikembalikan ke bawaan. Tekan Simpan untuk menerapkan.');
    });

    $id('btnSaveProfile')?.addEventListener('click', async (e) => {
        const newName = $id('inputProfileName')?.value.trim();
        if (!newName) return say('Username tidak boleh kosong.', 'err');

        const payload = {
            id: currentUser.id,
            username: newName,
            avatarUrl: $id('cfgAvatarUrl')?.value.trim() || ''
        };

        const done = busy(e.currentTarget, 'Menyimpan…');
        try {
            const res = await fetch('/api/user/profile', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await res.json();
            if (!result.success) { say(serverMsg(res, result, 'Gagal menyimpan profil.'), 'err'); return; }

            currentUser = { ...currentUser, ...payload };
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            applyProfileToUI();
            say('Profil berhasil diperbarui.', 'ok');
        } catch (err) { say('Gagal terhubung ke server.', 'err'); }
        finally { done(); }
    });

    // ==========================================
    // ORDER DETAIL & PEMBAYARAN
    // ==========================================
    const TIER_LABEL = TIER_NAME;
    const rupiah = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

    let pricingData = null;
    let appliedVoucher = null; // { code, percent, discount }

    const orderModal = $id('orderModal');
    const orderBot = $id('orderBot');
    const orderPaket = $id('orderPaket');
    const orderMonths = $id('orderMonths');
    const orderVoucher = $id('orderVoucher');
    const voucherMsg = $id('voucherMsg');

    async function loadPricing() {
        if (pricingData) return pricingData;
        try {
            const res = await fetch('/api/pricing');
            const result = await res.json();
            if (result.success) {
                pricingData = result.pricing;
                adminFee = result.fee || 0;
                renderPriceCards();
            } else {
                showPriceLoadError();
            }
        } catch (err) {
            showPriceLoadError();
        }
        return pricingData;
    }

    function showPriceLoadError() {
        document.querySelectorAll('[data-price]').forEach(el => {
            el.innerHTML = `<span class="form-msg is-err" style="font-family:var(--font-sans);font-size:13px;letter-spacing:0;">Gagal memuat harga</span>`;
        });
    }

    // Kartu harga mengikuti angka yang diatur admin, bukan angka tetap di HTML.
    function renderPriceCards() {
        if (!pricingData) return;
        document.querySelectorAll('[data-price]').forEach(el => {
            const v = pricingData[el.getAttribute('data-price')];
            if (v == null) return;
            el.innerHTML = `<span class="price-cur">Rp</span>${Number(v).toLocaleString('id-ID')}<span class="price-period">/ bot / bln</span>`;
        });
        // Harga coret ditampilkan sebagai harga normal sebelum diskon 25%.
        document.querySelectorAll('[data-strike]').forEach(el => {
            const v = pricingData[el.getAttribute('data-strike')];
            if (v == null) return;
            el.innerText = rupiah(Math.round(v / 0.75 / 500) * 500);
        });
    }
    loadPricing();

    function recalcOrderSummary() {
        if (!pricingData) return;
        const tier = orderPaket.value;
        const months = parseInt(orderMonths.value) || 1;
        const subtotal = (pricingData[tier] || 0) * months;

        // Voucher dibatalkan kalau paket/durasi berubah: nominalnya sudah beda.
        let discount = 0;
        if (appliedVoucher && appliedVoucher.tier === tier && appliedVoucher.months === months) {
            discount = appliedVoucher.discount;
        } else if (appliedVoucher) {
            appliedVoucher = null;
            voucherMsg.innerText = 'Voucher direset karena paket/durasi berubah. Terapkan ulang.';
            voucherMsg.className = 'form-msg v-dim';
        }

        $id('sumSubtotal').innerText = rupiah(subtotal);
        $id('sumFee').innerText = rupiah(adminFee);
        $id('sumTotal').innerText = rupiah(subtotal - discount + adminFee);
        const dRow = $id('sumDiscountRow');
        if (discount > 0) {
            dRow.style.display = 'flex';
            $id('sumDiscount').innerText = '- ' + rupiah(discount);
        } else {
            dRow.style.display = 'none';
        }
        renderOrderBot(tier, months);
    }

    // Bot tujuan paket + perkiraan masa aktif. Rumusnya SAMA dengan
    // computeNewExpiry() di server: paket sama -> sisa hari ditumpuk;
    // paket beda -> sisa nilai rupiah dikonversi ke hari paket baru.
    function renderOrderBot(tier, months) {
        const b = myBots.find(x => x.number === orderBot?.value);
        const help = $id('orderBotHelp');
        const until = $id('sumUntil');
        if (!b) {
            if (help) help.innerHTML = '<i class="fa-solid fa-circle-info"></i> <span>Paket berlaku untuk bot ini.</span>';
            if (until) until.innerText = '–';
            return;
        }
        const cur = effectiveTier(b);
        const left = (cur !== 'free' && b.tierExpiredAt) ? Math.max(0, (new Date(b.tierExpiredAt) - new Date()) / 86400000) : 0;
        let bonus = 0;
        let note = `Sekarang bot ini pakai paket ${tierName(cur)}.`;
        if (left > 0 && cur === tier) {
            bonus = left;
            note = `Sisa ${Math.ceil(left)} hari ${tierName(cur)} sekarang ikut ditambahkan.`;
        } else if (left > 0 && pricingData?.[cur] && pricingData?.[tier]) {
            bonus = left * pricingData[cur] / pricingData[tier];
            note = `Sisa ${Math.ceil(left)} hari ${tierName(cur)} dikonversi otomatis jadi ±${Math.round(bonus)} hari ${tierName(tier)}.`;
        }
        if (help) help.innerHTML = `<i class="fa-solid fa-circle-info"></i> <span><b>Paket berlaku untuk bot ini.</b> ${escapeHtml(note)}</span>`;
        const exp = new Date(Date.now() + ((months * 30) + bonus) * 86400000);
        if (until) until.innerText = exp.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function fillOrderBots(number) {
        if (!orderBot) return;
        const has = myBots.length > 0;
        orderBot.innerHTML = has
            ? myBots.map(b => `<option value="${escapeHtml(b.number)}">${escapeHtml(botName(b))} · ${fmtBotNumber(b.number)} — ${escapeHtml(planText(b))}</option>`).join('')
            : '<option value="">Belum ada bot</option>';
        const want = number && myBots.some(b => b.number === number) ? number : (myBots.some(b => b.number === activeBotNumber) ? activeBotNumber : myBots[0]?.number || '');
        orderBot.value = want;
        orderBot.closest('.order-bot-field')?.classList.toggle('v-hide', !has);
        $id('orderNoBot')?.classList.toggle('v-hide', has);
        const create = $id('btnCreateOrder');
        if (create) create.disabled = !has;
    }

    // number: bot yang mau di-upgrade (bawaan: bot yang sedang dipilih).
    async function openOrderModal(tier, number = '') {
        await loadPricing();
        if (!pricingData) return say('Gagal memuat harga. Coba lagi sebentar.', 'err');

        appliedVoucher = null;
        orderVoucher.value = '';
        voucherMsg.innerText = '';
        fillOrderBots(number || activeBotNumber);
        orderPaket.value = TIER_LABEL[tier] && tier !== 'free' ? tier : 'basic';
        orderMonths.value = '1';
        recalcOrderSummary();
        openModal(orderModal);
    }

    document.querySelectorAll('.btn-order').forEach(btn => {
        btn.addEventListener('click', () => openOrderModal(btn.getAttribute('data-tier'), activeBotNumber));
    });

    orderBot?.addEventListener('change', recalcOrderSummary);
    orderPaket?.addEventListener('change', recalcOrderSummary);
    orderMonths?.addEventListener('change', recalcOrderSummary);

    $id('btnCloseOrder')?.addEventListener('click', () => closeModal(orderModal));
    $id('btnCancelOrder')?.addEventListener('click', () => closeModal(orderModal));

    $id('btnApplyVoucher')?.addEventListener('click', async (e) => {
        const code = orderVoucher.value.trim();
        if (!code) return;
        const done = busy(e.currentTarget, '');
        try {
            const tier = orderPaket.value;
            const months = parseInt(orderMonths.value) || 1;
            const res = await fetch('/api/payment/check-promo', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, tier, months })
            });
            const result = await res.json();
            if (result.success) {
                appliedVoucher = { code: result.code, percent: result.percent, discount: result.discount, tier, months };
                voucherMsg.innerText = `Voucher ${result.code} aktif: potongan ${result.percent}%.`;
                voucherMsg.className = 'form-msg is-ok';
            } else {
                appliedVoucher = null;
                voucherMsg.innerText = result.message || 'Kode voucher tidak valid.';
                voucherMsg.className = 'form-msg is-err';
            }
            recalcOrderSummary();
        } catch (err) {
            voucherMsg.innerText = 'Gagal memeriksa voucher.';
            voucherMsg.className = 'form-msg is-err';
        } finally { done(); }
    });

    $id('btnCreateOrder')?.addEventListener('click', async (e) => {
        if (!currentUser?.id) return say('Silakan login ulang.', 'err');
        // Paket dibeli untuk satu bot tertentu — server menolak tanpa botNumber.
        const botNumber = orderBot?.value || '';
        if (!botNumber) return say('Pilih bot yang mau di-upgrade.', 'err');
        const done = busy(e.currentTarget, 'Memproses…');
        try {
            const res = await fetch('/api/payment/create', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: currentUser.id,
                    tier: orderPaket.value,
                    months: parseInt(orderMonths.value) || 1,
                    promoCode: appliedVoucher?.code || '',
                    botNumber
                })
            });
            const result = await res.json();
            if (!result.success) {
                // Sudah ada invoice berjalan: arahkan ke invoice itu
                // daripada sekadar menampilkan error buntu.
                if (result.code === 'PENDING_EXISTS' && result.orderId) {
                    if (confirm(`${result.message}\n\nBuka invoice yang belum dibayar itu sekarang?`)) {
                        window.location.href = `/invoice?order_id=${encodeURIComponent(result.orderId)}`;
                    }
                    return;
                }
                say(serverMsg(res, result, 'Gagal membuat pesanan.'), 'err');
                return;
            }
            window.location.href = `/invoice?order_id=${encodeURIComponent(result.order.orderId)}`;
        } catch (err) {
            say('Gagal terhubung ke server pembayaran.', 'err');
        } finally { done(); }
    });

    async function loadOrderHistory() {
        const box = $id('orderHistory');
        if (!box || !currentUser?.id) return;
        try {
            const res = await fetch(`/api/payment/orders/${encodeURIComponent(currentUser.id)}`);
            const result = await res.json();
            if (!result.success || !result.orders.length) {
                box.innerHTML = `<p class="feed-empty">Belum ada transaksi.</p>`;
                return;
            }
            const statusBadge = {
                completed: '<span class="v-badge v-badge--ok status-pill">Lunas</span>',
                pending: '<span class="v-badge v-badge--warn status-pill">Menunggu</span>',
                cancelled: '<span class="v-badge v-badge--danger status-pill">Dibatalkan</span>',
                expired: '<span class="v-badge status-pill">Kedaluwarsa</span>'
            };
            box.innerHTML = result.orders.map(o => {
                const when = o.createdAt ? new Date(o.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
                const what = o.kind === 'addon' ? 'Add-On Unlimited' : `${TIER_LABEL[o.tier] || o.tier}${o.months ? ` · ${o.months} bln` : ''}`;
                // Paket per bot: tunjukkan bot tujuannya (nama kalau dikenal).
                const ob = o.botNumber ? myBots.find(b => b.number === String(o.botNumber)) : null;
                const forBot = o.botNumber
                    ? `<span class="order-for"><i class="fa-brands fa-whatsapp"></i> ${escapeHtml(ob?.label || window.VLive.maskNumber(o.botNumber))}</span>`
                    : '';
                return `
                <div class="list-item">
                    <div class="list-item__main">
                        <div class="list-item__title">${escapeHtml(what)} ${statusBadge[o.status] || escapeHtml(o.status)}</div>
                        <p class="list-item__meta meta-parts">${forBot ? `<span>${forBot}</span>` : ''}<span>${escapeHtml(o.orderId)}</span><span>${rupiah(o.totalPayment || o.amount)}</span>${when ? `<span>${when}</span>` : ''}</p>
                    </div>
                    <a class="v-btn v-btn--sm v-btn--outline" href="/invoice?order_id=${encodeURIComponent(o.orderId)}">Lihat <i class="fa-solid fa-arrow-right"></i></a>
                </div>`;
            }).join('');
        } catch (err) {
            box.innerHTML = `<p class="feed-empty">Gagal memuat riwayat.</p>`;
        }
    }
    loadOrderHistory();

    // ==========================================
    // PESAN OTOMATIS (AUTO-REPLY)
    // ==========================================
    function renderAutoReplies() {
        const box = $id('autoReplyList');
        const counter = $id('autoReplyCount');
        if (!box) return;

        const quota = AUTOREPLY_QUOTA[botTier()] ?? 0;
        if (counter) counter.innerText = `${autoReplies.length} / ${quota} aturan`;

        if (!autoReplies.length) {
            box.innerHTML = `<p class="feed-empty">Belum ada balasan otomatis.</p>`;
            return;
        }

        const matchLabel = { contains: 'Mengandung', exact: 'Sama persis', startsWith: 'Diawali' };
        box.innerHTML = autoReplies.map((r, i) => `
            <div class="list-item">
                <div class="list-item__main">
                    <div class="list-item__title">${escapeHtml(r.keyword)} <span class="v-badge">${matchLabel[r.match] || escapeHtml(r.match)}</span></div>
                    <p class="list-item__body">${escapeHtml(r.reply)}</p>
                </div>
                <button type="button" class="v-btn v-btn--danger v-btn--sm btn-del-ar" data-index="${i}" aria-label="Hapus aturan"><i class="fa-regular fa-trash-can"></i></button>
            </div>
        `).join('');
    }

    $id('btnAddAutoReply')?.addEventListener('click', () => {
        const caps = TIER_CAPS[botTier()] || TIER_CAPS.free;
        if (!caps.customize) return say('Pesan otomatis khusus paket berbayar. Upgrade dulu, ya.', 'err');

        const keyword = $id('arKeyword').value.trim();
        const reply = $id('arReply').value.trim();
        const match = $id('arMatch').value;
        if (!keyword || !reply) return say('Kata kunci dan balasan wajib diisi.', 'err');

        const quota = AUTOREPLY_QUOTA[botTier()] ?? 0;
        if (autoReplies.length >= quota) {
            return say(`Paket ${tierName(botTier())} bot ini maksimal ${quota} aturan. Hapus salah satu atau upgrade bot ini.`, 'err');
        }
        if (autoReplies.some(r => r.keyword.toLowerCase() === keyword.toLowerCase())) {
            return say('Kata kunci itu sudah ada.', 'err');
        }

        autoReplies.push({ keyword, reply, match });
        $id('arKeyword').value = '';
        $id('arReply').value = '';
        renderAutoReplies();
        say('Ditambahkan ke daftar. Jangan lupa tekan Simpan.');
    });

    $id('autoReplyList')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-del-ar');
        if (!btn) return;
        autoReplies.splice(parseInt(btn.dataset.index), 1);
        renderAutoReplies();
    });

    $id('btnSaveAutoReply')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return say(NO_BOT_MSG, 'err');
        const caps = TIER_CAPS[botTier()] || TIER_CAPS.free;
        if (!caps.customize) return say('Pesan otomatis khusus paket berbayar.', 'err');

        const done = busy(e.currentTarget, 'Menyimpan…');
        try {
            const res = await fetch('/api/bot/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: activeBotNumber, userId: currentUser.id, tier: botTier(), autoReply: autoReplies })
            });
            const result = await res.json();
            say(result.success ? (result.message || 'Pesan otomatis disimpan!') : serverMsg(res, result, 'Gagal menyimpan.'), result.success ? 'ok' : 'err');
        } catch (err) { say('Gagal terhubung ke server.', 'err'); }
        finally { done(); }
    });

    $id('welcomeMode')?.addEventListener('change', (e) => {
        $id('welcomeMediaBox').style.display = e.target.value === 'custom' ? 'block' : 'none';
    });

    $id('btnSaveWelcome')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return say(NO_BOT_MSG, 'err');
        const caps = TIER_CAPS[botTier()] || TIER_CAPS.free;
        if (!caps.customize) return say('Sambutan anggota khusus paket berbayar.', 'err');

        const mode = $id('welcomeMode').value;
        if (mode === 'custom' && !caps.menuImage) return say('Foto/GIF sendiri khusus paket Zenith.', 'err');

        const payload = {
            number: activeBotNumber, userId: currentUser.id, tier: botTier(),
            enabled: $id('welcomeEnabled').checked,
            welcomeText: $id('welcomeText').value.trim(),
            leaveText: $id('leaveText').value.trim(),
            mode, mediaUrl: mode === 'custom' ? $id('welcomeMedia').value.trim() : ''
        };

        const done = busy(e.currentTarget, 'Menerapkan…');
        try {
            const res = await fetch('/api/bot/welcome', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await res.json();
            say(result.success ? (result.message || 'Sambutan diterapkan.') : serverMsg(res, result, 'Gagal menerapkan.'), result.success ? 'ok' : 'err');
        } catch (err) { say('Gagal terhubung ke server.', 'err'); }
        finally { done(); }
    });

    $id('btnSendBroadcast')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return say(NO_BOT_MSG, 'err');
        const caps = TIER_CAPS[botTier()] || TIER_CAPS.free;
        if (!caps.customize) return say('Siaran pesan khusus paket berbayar.', 'err');

        const text = $id('broadcastText').value.trim();
        if (!text) return say('Isi pesan tidak boleh kosong.', 'err');
        if (!confirm('Kirim pesan ini ke semua grup yang diikuti bot? Aksi ini tidak bisa dibatalkan.')) return;

        const done = busy(e.currentTarget, 'Mengirim…');
        try {
            const res = await fetch('/api/bot/broadcast', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: activeBotNumber, userId: currentUser.id, tier: botTier(), message: text })
            });
            const result = await res.json();
            say(result.success ? (result.message || 'Pesan terkirim.') : serverMsg(res, result, 'Gagal mengirim.'), result.success ? 'ok' : 'err');
            if (result.success) $id('broadcastText').value = '';
        } catch (err) { say('Gagal terhubung ke server.', 'err'); }
        finally { done(); }
    });

    // ==========================================
    // PERINTAH KUSTOM
    // ==========================================
    function renderCustomCommands() {
        const box = $id('cmdList');
        const counter = $id('cmdCount');
        if (!box) return;

        const quota = CUSTOMCMD_QUOTA[botTier()] ?? 0;
        if (counter) counter.innerText = `${customCommands.length} / ${quota} perintah`;

        if (!customCommands.length) {
            box.innerHTML = `<p class="feed-empty">Belum ada perintah kustom.</p>`;
            return;
        }
        box.innerHTML = customCommands.map((c, i) => `
            <div class="list-item">
                <div class="list-item__main">
                    <div class="list-item__title"><code class="feed-cmd">.${escapeHtml(c.cmd)}</code>
                        ${c.showInMenu === false ? '<span class="v-badge">disembunyikan dari menu</span>' : ''}
                        ${c.image ? '<span class="v-badge"><i class="fa-regular fa-image"></i> gambar</span>' : ''}
                    </div>
                    <p class="list-item__body">${escapeHtml(String(c.response || '').slice(0, 160))}</p>
                </div>
                <button type="button" class="v-btn v-btn--danger v-btn--sm btn-del-cmd" data-index="${i}" aria-label="Hapus perintah"><i class="fa-regular fa-trash-can"></i></button>
            </div>
        `).join('');
    }

    $id('btnAddCmd')?.addEventListener('click', () => {
        const quota = CUSTOMCMD_QUOTA[botTier()] ?? 0;
        if (quota === 0) return say('Perintah kustom khusus paket Prime ke atas.', 'err');

        const cmd = $id('cmdName').value.trim().replace(/^[./!#]/, '').toLowerCase();
        const response = $id('cmdResponse').value.trim();
        if (!cmd || !response) return say('Nama perintah dan balasan wajib diisi.', 'err');

        // Perintah inti tidak boleh ditimpa, nanti bot tidak bisa dikendalikan.
        const dilindungi = ['menu', 'jadibot', 'owner', 'ping', 'stop', 'start', 'delete'];
        if (dilindungi.includes(cmd)) return say(`Perintah ".${cmd}" dipakai sistem dan tidak bisa ditimpa.`, 'err');

        if (customCommands.length >= quota) return say(`Paket ${tierName(botTier())} bot ini maksimal ${quota} perintah.`, 'err');
        if (customCommands.some(c => c.cmd === cmd)) return say('Perintah itu sudah ada.', 'err');

        const caps = TIER_CAPS[botTier()] || TIER_CAPS.free;
        customCommands.push({
            cmd, response,
            image: caps.menuImage ? ($id('cmdImage')?.value.trim() || '') : '',
            showInMenu: $id('cmdShowMenu').checked
        });

        $id('cmdName').value = '';
        $id('cmdResponse').value = '';
        if ($id('cmdImage')) $id('cmdImage').value = '';
        renderCustomCommands();
        say('Ditambahkan ke daftar. Jangan lupa tekan Simpan.');
    });

    $id('cmdList')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-del-cmd');
        if (!btn) return;
        customCommands.splice(parseInt(btn.dataset.index), 1);
        renderCustomCommands();
    });

    $id('btnSaveCmd')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return say(NO_BOT_MSG, 'err');
        const done = busy(e.currentTarget, 'Menyimpan…');
        try {
            const res = await fetch('/api/bot/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    number: activeBotNumber, userId: currentUser.id,
                    tier: botTier(), customCommands
                })
            });
            const result = await res.json();
            say(result.success ? (result.message || 'Perintah kustom disimpan.') : serverMsg(res, result, 'Gagal menyimpan.'), result.success ? 'ok' : 'err');
        } catch (err) { say('Gagal terhubung ke server.', 'err'); }
        finally { done(); }
    });

    // ==========================================
    // REFERRAL
    // ==========================================
    let refLink = '';

    async function loadReferral() {
        if (!currentUser?.id) return;
        try {
            const res = await fetch(`/api/referral/me/${encodeURIComponent(currentUser.id)}`);
            const d = await res.json();
            if (!d.success) return;

            refLink = d.link;
            $id('refCode').innerText = d.code;
            $id('refCredit').innerText = rupiah(d.credit);
            $id('refCount').innerText = d.totalReferral;
            $id('refDiscPct').innerText = d.discountPercent;
            $id('refRewardPct').innerText = d.rewardPercent;

            // Kotak "punya kode dari teman" disembunyikan kalau sudah tidak
            // relevan — kode hanya bisa dipakai sekali, sebelum transaksi pertama.
            const claimBox = $id('refClaimBox');
            if (claimBox && currentUser.referredBy) claimBox.style.display = 'none';

            const box = $id('refHistory');
            if (!d.riwayat.length) {
                box.innerHTML = `<p class="feed-empty">Belum ada teman yang bergabung.</p>`;
            } else {
                box.innerHTML = d.riwayat.map(r => `
                    <div class="list-item">
                        <div class="list-item__main">
                            <div class="list-item__title">Teman bergabung</div>
                            <p class="list-item__meta">${new Date(r.at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                        </div>
                        <strong class="v-mono is-ok">+${rupiah(r.kredit)}</strong>
                    </div>`).join('');
            }
        } catch (err) {
            // Jangan gagal diam-diam: tampilkan bahwa datanya gagal dimuat.
            const el = $id('refCode');
            if (el) el.innerText = 'Gagal dimuat';
        }
    }

    $id('btnCopyRef')?.addEventListener('click', async () => {
        if (!refLink) return;
        if (await window.VLive.copyText(refLink)) say('Link referral disalin.', 'ok');
        else prompt('Salin link ini:', refLink);
    });

    $id('btnShareRef')?.addEventListener('click', () => {
        if (!refLink) return;
        const teks = `Aku pakai Varesa buat bikin bot WhatsApp. Daftar pakai link ini, kamu dapat potongan buat pembelian pertama:\n${refLink}`;
        // Web Share API kalau ada (lebih natural di HP), kalau tidak ke WhatsApp.
        if (navigator.share) {
            navigator.share({ title: 'Varesa', text: teks }).catch(() => {});
        } else {
            window.open(`https://wa.me/?text=${encodeURIComponent(teks)}`, '_blank');
        }
    });

    $id('btnClaimRef')?.addEventListener('click', async (e) => {
        const kode = $id('refClaimInput').value.trim();
        const msg = $id('refClaimMsg');
        if (!kode) return;

        const done = busy(e.currentTarget, '');
        try {
            const res = await fetch('/api/referral/claim', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: currentUser.id, code: kode })
            });
            const d = await res.json();
            msg.innerText = d.message;
            msg.className = `form-msg ${d.success ? 'is-ok' : 'is-err'}`;
            if (d.success) {
                currentUser.referredBy = 'ok';
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                $id('refClaimBox').style.display = 'none';
            }
        } catch (err) {
            msg.innerText = 'Gagal terhubung ke server.'; msg.className = 'form-msg is-err';
        } finally { done(); }
    });

    // ==========================================
    // BACKUP & RESTORE SETELAN
    // ==========================================
    $id('btnBackup')?.addEventListener('click', async () => {
        if (!activeBotNumber) return say(NO_BOT_MSG, 'err');
        try {
            const res = await fetch(`/api/bot/backup/${encodeURIComponent(activeBotNumber)}?userId=${encodeURIComponent(currentUser.id)}`);
            const d = await res.json();
            if (!d.success) return say(serverMsg(res, d, 'Gagal membuat cadangan.'), 'err');

            const blob = new Blob([JSON.stringify(d.backup, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `varesa-backup-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
            say('File cadangan diunduh.', 'ok');
        } catch (err) { say('Gagal terhubung ke server.', 'err'); }
    });

    $id('btnRestore')?.addEventListener('click', () => {
        if (!activeBotNumber) return say(NO_BOT_MSG, 'err');
        $id('restoreFile').click();
    });

    $id('restoreFile')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!confirm('Setelan bot yang sekarang akan ditimpa. Lanjutkan?')) { e.target.value = ''; return; }

        try {
            const backup = JSON.parse(await file.text());
            const res = await fetch('/api/bot/restore', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: activeBotNumber, userId: currentUser.id, tier: botTier(), backup })
            });
            const d = await res.json();
            say(d.success ? (d.message || 'Berhasil dipulihkan.') : serverMsg(res, d, 'Gagal memulihkan.'), d.success ? 'ok' : 'err');
            if (d.success) loadBotConfig();
        } catch (err) {
            say('File tidak bisa dibaca. Pastikan itu file cadangan Varesa.', 'err');
        } finally { e.target.value = ''; }
    });

    // ==========================================
    // API GATEWAY (token per bot)
    // ==========================================
    const api = { token: '', revealed: false, lang: 'curl', usage: null, tier: '', loading: false };
    const SAMPLE_NUMBER = '6281234567890';
    const SAMPLE_RESPONSE = {
        creator: 'Varesa',
        status: true,
        data: {
            key: { remoteJid: `${SAMPLE_NUMBER}@s.whatsapp.net`, fromMe: true, id: '3EB0A9C2F1D4E5788A6C' },
            messageTimestamp: 1757318400,
            status: 'SENT'
        }
    };

    const maskToken = (t) => t ? `${t.slice(0, 4)}${'•'.repeat(18)}${t.slice(-4)}` : '';

    function buildSnippet(lang, token) {
        const url = `${location.origin}/api/v1/text`;
        const tok = token || 'TOKEN_BOT_KAMU';
        if (lang === 'js') {
            return `const res = await fetch('${url}', {\n  method: 'POST',\n  headers: {\n    'x-varesa-token': '${tok}',\n    'Content-Type': 'application/json'\n  },\n  body: JSON.stringify({\n    number: '${SAMPLE_NUMBER}',\n    text: 'Halo dari Varesa 👋'\n  })\n});\nconsole.log(await res.json());`;
        }
        if (lang === 'py') {
            return `import requests\n\nres = requests.post(\n    '${url}',\n    headers={'x-varesa-token': '${tok}'},\n    json={'number': '${SAMPLE_NUMBER}', 'text': 'Halo dari Varesa 👋'},\n)\nprint(res.json())`;
        }
        return `curl -X POST '${url}' \\\n  -H 'x-varesa-token: ${tok}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\n    "number": "${SAMPLE_NUMBER}",\n    "text": "Halo dari Varesa 👋"\n  }'`;
    }

    // Pewarnaan sintaks sederhana: cukup string, flag & kata kunci.
    function highlight(code, lang) {
        let h = escapeHtml(code);
        h = h.replace(/(&#39;[^\n]*?&#39;|&quot;[^\n]*?&quot;)/g, '<span class="tk-s">$1</span>');
        if (lang === 'curl') h = h.replace(/(^|\s)(-X|-H|-d)(?=\s)/g, '$1<span class="tk-f">$2</span>').replace(/^curl/, '<span class="tk-k">curl</span>');
        if (lang === 'js') h = h.replace(/\b(const|await|new)\b/g, '<span class="tk-k">$1</span>');
        if (lang === 'py') h = h.replace(/\b(import|print)\b/g, '<span class="tk-k">$1</span>');
        return h;
    }

    function highlightJson(obj) {
        return escapeHtml(JSON.stringify(obj, null, 2))
            .replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span class="tk-p">$1</span>$2')
            .replace(/(:\s*)(&quot;.*?&quot;)/g, '$1<span class="tk-s">$2</span>')
            .replace(/(:\s*)(true|false|\d+)/g, '$1<span class="tk-n">$2</span>');
    }

    function renderApi() {
        const box = $id('apiTokenValue');
        if (!box) return;
        const ab = activeBot();
        $id('apiBotNumber').textContent = activeBotNumber ? `${ab?.label ? ab.label + ' · ' : ''}${fmtBotNumber(activeBotNumber)}` : '–';
        if (api.loading) {
            box.textContent = 'memuat…'; box.classList.add('is-empty');
        } else if (api.token) {
            box.textContent = api.revealed ? api.token : maskToken(api.token);
            box.classList.remove('is-empty');
        } else {
            box.textContent = 'Belum ada token — tekan "Buat token".';
            box.classList.add('is-empty');
        }
        const reveal = $id('btnApiReveal');
        if (reveal) {
            reveal.disabled = !api.token;
            reveal.innerHTML = api.revealed ? '<i class="fa-regular fa-eye-slash"></i>' : '<i class="fa-regular fa-eye"></i>';
            reveal.setAttribute('aria-label', api.revealed ? 'Sembunyikan token' : 'Tampilkan token');
        }
        const copy = $id('btnApiCopy');
        if (copy) copy.disabled = !api.token;
        const rotate = $id('btnApiRotate');
        if (rotate) rotate.querySelector('span').textContent = api.token ? 'Buat ulang token' : 'Buat token';
        const revoke = $id('btnApiRevoke');
        if (revoke) revoke.disabled = !api.token;

        const tierBadge = $id('apiTierBadge');
        if (tierBadge) { tierBadge.className = ''; tierBadge.innerHTML = nitroBadgeHTML(api.tier || botTier()); }

        const u = api.usage || {};
        const limit = Number(u.limit) || 0;
        const today = Number(u.today) || 0;
        $id('apiUsageToday').textContent = today.toLocaleString('id-ID');
        $id('apiUsageLimit').textContent = limit ? limit.toLocaleString('id-ID') : '–';
        const pct = limit ? (today / limit) * 100 : 0;
        window.VLive.setMeter($id('apiUsageMeter'), pct, window.VLive.toneOf(pct, 75, 95));
        let resetTxt = 'reset tiap tengah malam WIB';
        if (u.resetAt) {
            const r = new Date(u.resetAt);
            if (!isNaN(r)) resetTxt = `reset ${r.toLocaleString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
        }
        $id('apiUsageReset').textContent = resetTxt;

        const shown = api.token ? (api.revealed ? api.token : maskToken(api.token)) : '';
        const snippet = $id('apiSnippet');
        if (snippet) snippet.innerHTML = `<code>${highlight(buildSnippet(api.lang, shown), api.lang)}</code>`;
        const resp = $id('apiResponse');
        if (resp && !resp.dataset.ready) { resp.innerHTML = `<code>${highlightJson(SAMPLE_RESPONSE)}</code>`; resp.dataset.ready = '1'; }
        document.querySelectorAll('.code-tab').forEach(t => t.classList.toggle('is-active', t.dataset.lang === api.lang));
    }

    async function loadApiToken() {
        const empty = $id('apiEmpty');
        const main = $id('apiMain');
        if (!empty || !main) return;
        if (!activeBotNumber || !currentUser?.id) {
            empty.classList.remove('v-hide'); main.classList.add('v-hide');
            return;
        }
        empty.classList.add('v-hide'); main.classList.remove('v-hide');
        api.loading = true; api.revealed = false;
        renderApi();
        try {
            const res = await fetch(`/api/bot/api-token/${encodeURIComponent(activeBotNumber)}?userId=${encodeURIComponent(currentUser.id)}`);
            let d = {};
            try { d = await res.json(); } catch { d = {}; }
            api.loading = false;
            if (!res.ok || !d.success) {
                api.token = ''; api.usage = null;
                renderApi();
                $id('apiTokenValue').textContent = serverMsg(res, d, 'Token belum bisa dimuat.');
                return;
            }
            api.token = d.token || '';
            api.usage = d.usage || null;
            api.tier = d.tier || botTier();
        } catch (err) {
            api.loading = false;
            renderApi();
            $id('apiTokenValue').textContent = 'Tidak bisa terhubung ke server.';
            return;
        }
        renderApi();
    }

    const flashIcon = (btn) => {
        if (!btn) return;
        const html = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i>';
        btn.classList.add('is-done');
        setTimeout(() => { btn.innerHTML = html; btn.classList.remove('is-done'); }, 1400);
    };

    $id('btnApiReveal')?.addEventListener('click', () => { api.revealed = !api.revealed; renderApi(); });
    $id('btnApiCopy')?.addEventListener('click', async (e) => {
        if (!api.token) return;
        const btn = e.currentTarget;
        if (await window.VLive.copyText(api.token)) { flashIcon(btn); say('Token disalin.', 'ok'); }
        else say('Browser menolak akses clipboard. Tampilkan token lalu salin manual.', 'err');
    });
    $id('btnApiRotate')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return say(NO_BOT_MSG, 'err');
        if (api.token && !confirm('Buat token baru?\n\nToken lama langsung tidak berlaku — aplikasi yang memakainya harus diperbarui.')) return;
        const done = busy(e.currentTarget, 'Membuat…');
        try {
            const res = await fetch('/api/bot/api-token', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: activeBotNumber, userId: currentUser.id })
            });
            let d = {};
            try { d = await res.json(); } catch { d = {}; }
            if (!res.ok || !d.success || !d.token) { say(serverMsg(res, d, 'Gagal membuat token.'), 'err'); return; }
            api.token = d.token;
            api.revealed = true;
            say('Token baru siap. Simpan baik-baik — jangan dibagikan.', 'ok');
        } catch (err) {
            say('Gagal terhubung ke server.', 'err');
        } finally { done(); renderApi(); }
    });
    // Cabut token tanpa membuat yang baru: untuk yang sudah tidak memakai
    // API atau curiga tokennya bocor. Server mengosongkan token (revoke).
    $id('btnApiRevoke')?.addEventListener('click', async (e) => {
        if (!activeBotNumber || !api.token) return;
        if (!confirm('Matikan API untuk bot ini?\n\nToken sekarang langsung tidak berlaku. Kamu bisa membuat token baru kapan saja.')) return;
        const done = busy(e.currentTarget, 'Mematikan…');
        try {
            const res = await fetch('/api/bot/api-token', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: activeBotNumber, userId: currentUser.id, revoke: true })
            });
            let d = {};
            try { d = await res.json(); } catch { d = {}; }
            if (!res.ok || !d.success) { say(serverMsg(res, d, 'Gagal mematikan API.'), 'err'); return; }
            api.token = ''; api.revealed = false;
            say('API dimatikan. Token lama sudah tidak berlaku.', 'ok');
        } catch (err) {
            say('Gagal terhubung ke server.', 'err');
        } finally { done(); renderApi(); }
    });
    document.querySelectorAll('.code-tab').forEach(t => t.addEventListener('click', () => { api.lang = t.dataset.lang; renderApi(); }));
    $id('btnApiSnippetCopy')?.addEventListener('click', async (e) => {
        // Yang disalin selalu berisi token asli (kalau ada), walau di layar disensor.
        const ok = await window.VLive.copyText(buildSnippet(api.lang, api.token));
        if (ok) { say(api.token ? 'Contoh request disalin, lengkap dengan token kamu.' : 'Contoh request disalin. Ganti TOKEN_BOT_KAMU dengan token kamu.', 'ok'); }
        else say('Gagal menyalin.', 'err');
    });

    // --- SSE TERMINAL LOGS & STATISTIK LANGSUNG ---
    // Nomor bot dikirim sebagai query supaya server hanya mengirimkan event
    // milik bot ini. Sebelumnya semua client menerima semua event, termasuk
    // pairing code milik orang lain.
    let sse = null;

    let sseRetry = 0;
    function connectSSE() {
        if (sse) { sse.close(); sse = null; }

        // Tanpa nomor bot aktif tidak ada yang bisa dipantau. Membuka stream
        // di sini cuma menghabiskan slot koneksi Cloudflare dan memicu
        // reconnect terus-menerus — terlihat jelas di log tunnel.
        if (!activeBotNumber) return;

        // userId ikut dikirim: server hanya menyertakan cuplikan pesan &
        // nama pengirim di bot_stats kalau yang menonton pemilik bot ini.
        const uid = currentUser?.id ? `&userId=${encodeURIComponent(currentUser.id)}` : '';
        sse = new EventSource(`/api/bot/events?number=${encodeURIComponent(activeBotNumber)}${uid}`);
        bindSSE(sse);

        sse.onopen = () => { sseRetry = 0; };

        // EventSource otomatis reconnect tiap ~3 detik. Kalau server sedang
        // bermasalah, itu jadi hujan request yang memperparah keadaan.
        // Di sini stream ditutup lalu disambung sendiri dengan jeda menanjak.
        sse.onerror = () => {
            sse.close(); sse = null;
            sseRetry = Math.min(sseRetry + 1, 6);
            const wait = Math.min(30000, 2000 * 2 ** (sseRetry - 1));
            setTimeout(() => { if (document.visibilityState === 'visible' && !sse) connectSSE(); }, wait);
        };
    }

    // Tab disembunyikan (pindah tab / layar HP mati): tutup stream supaya
    // server tidak menyiarkan ke penonton yang tidak menonton. Dibuka lagi
    // saat tab kembali terlihat.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            if (sse) { sse.close(); sse = null; }
        } else {
            connectSSE();
        }
    });

    // Aktivitas user menyambung ulang stream yang sempat ditutup karena
    // menganggur — jadi terminal tetap hidup saat memang sedang dipakai.
    ['click', 'keydown'].forEach(evt => {
        document.addEventListener(evt, () => {
            if (!sse && activeBotNumber && document.visibilityState === 'visible') connectSSE();
        }, { passive: true });
    });

    // Dipanggil ulang saat nomor bot aktif berubah, supaya langganan
    // event-nya ikut berpindah ke bot yang baru.
    window.reconnectBotStream = connectSSE;

    const safeJSON = (s) => { try { return JSON.parse(s); } catch { return null; } };

    function bindSSE(src) {
        src.addEventListener('server_stats', (e) => {
            // Data live.js (CPU/RAM asli) lebih akurat; SSE ini hanya cadangan
            // saat /api/public/live tidak bisa dijangkau.
            if (liveOk) return;
            const stats = safeJSON(e.data);
            const statServer = $id('statServer');
            if (stats && statServer) statServer.innerText = `${window.VLive.fmt1(stats.cpu)}% · ${window.VLive.fmt1(stats.ram)}%`;
            // Sisa slot tetap terlihat sebelum Start walau polling live gagal.
            if (stats?.capacity?.max != null) { lastCapacity = stats.capacity; renderSlotHint(stats.capacity); }
        });

        src.addEventListener('bot_stats', (e) => {
            const s = safeJSON(e.data);
            if (s) renderBotStats(s);
        });

        // Server menutup stream yang lama menganggur untuk menghemat kuota
        // stream HTTP/2 di Cloudflare Tunnel. Ini penutupan yang disengaja,
        // jadi jangan langsung menyambung ulang — cukup ambil data sekali
        // lewat polling biasa, dan sambung lagi kalau user beraktivitas.
        src.addEventListener('idle_close', () => {
            if (sse) { sse.close(); sse = null; }
            loadBotStats();
        });

        src.addEventListener('pairing', (e) => {
            const data = safeJSON(e.data);
            if (!data) return;
            if (activeBotNumber && data.number && !String(data.number).includes(activeBotNumber)) return;
            if (data.code) {
                notify('Pairing code siap', `Kode: ${data.code} — masukkan di WhatsApp sebelum kedaluwarsa.`,
                       { tag: 'jv-pair', url: '/dashboard' });
            }
            setBotState('pairing');
            if (terminalLogs && data.code) {
                termLine('$ Pairing code berhasil dibuat.', 't-ok');
                const code = escapeHtml(data.code);
                const box = document.createElement('div');
                box.className = 'pair';
                box.innerHTML = `
                    <div><span class="pair__label">Pairing code</span><span class="pair__code">${code}</span></div>
                    <button type="button" class="v-btn v-btn--sm v-btn--primary" data-copy="${code}"><i class="fa-regular fa-copy"></i> Salin kode</button>`;
                terminalLogs.appendChild(box);
                termLine('Buka WhatsApp → Perangkat tertaut → Tautkan dengan nomor telepon, lalu masukkan kode di atas.', 't-dim');
                terminalLogs.scrollTop = terminalLogs.scrollHeight;
            }
        });

        src.addEventListener('bot_log', (e) => {
            const data = safeJSON(e.data);
            if (!data || !terminalLogs) return;

            // Lapis pertahanan kedua: walau server sudah menyaring per nomor,
            // terminal tetap menolak log yang bukan milik bot yang sedang dibuka.
            if (activeBotNumber && data.number && String(data.number) !== String(activeBotNumber)) return;
            const message = String(data.message || '');

            // Kabari user untuk kejadian yang benar-benar penting saja.
            // Terlalu sering memberi notifikasi membuat orang mematikannya.
            if (message.includes('Connected')) {
                notify('Bot tersambung', `Bot ${data.number || ''} sudah online.`, { tag: 'jv-conn' });
            } else if (/Connection Closed|dihentikan|Gagal menyambung|BLOCKED/i.test(message)) {
                notify('Bot terputus', message.slice(0, 120), { tag: 'jv-conn', url: '/dashboard' });
            }

            if (message.includes('Connected')) {
                setBotState('online');
                termLine(`$ ${message}`, 't-ok t-strong');
            } else if (message.includes('Closed') || message.includes('dihentikan')) {
                setBotState('offline');
                termLine(`$ ${message}`, 't-warn');
            } else if (message.includes('BLOCKED') || message.includes('KICK')) {
                termLine(`$ ${message}`, 't-err t-strong');
            } else {
                termLine(`$ ${message}`, 't-info');
            }
        });
    }

    // Tombol salin pairing code (dibuat dinamis di terminal).
    terminalLogs?.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-copy]');
        if (!btn) return;
        if (await window.VLive.copyText(btn.dataset.copy)) say(`Kode ${btn.dataset.copy} disalin.`, 'ok');
        else say(`Salin manual: ${btn.dataset.copy}`);
    });

    // --- WIDGET LIVE (kartu Server + log command) ---
    // Filter "Bot saya" di log live mencakup SEMUA bot milik akun ini.
    liveWidgets = window.VLive?.mountDashboard({
        getMyBot: () => (myBots.length ? myBots.map(b => b.number) : (activeBotNumber ? [activeBotNumber] : []))
    }) || null;

    connectSSE();
    if (activeBotNumber) loadBotStats();
    // Daftar bot (paket per bot). Tampilan dari cache dulu kalau ada.
    if (botsLoaded) onBotsChanged();
    loadMyBots();

    // --- CHIP VARIABEL (menu & sambutan) ---
    // Klik chip = sisipkan placeholder di posisi kursor. Mengetik manual
    // gampang salah ({Pushname}, {pushName}) dan bot tidak mengenalinya.
    document.querySelectorAll('.var-chips').forEach(box => {
        const targets = (box.dataset.targets || '').split(',').map(id => $id(id.trim())).filter(Boolean);
        let last = targets[0] || null;
        targets.forEach(t => t.addEventListener('focus', () => { last = t; }));
        box.addEventListener('click', (e) => {
            const chip = e.target.closest('.var-chip');
            if (!chip || !last || last.disabled || last.readOnly) return;
            const start = last.selectionStart ?? last.value.length;
            const end = last.selectionEnd ?? start;
            last.setRangeText(chip.dataset.var, start, end, 'end');
            last.focus();
            last.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });

    // --- TEKS SEWA & PREMIUM ---
    // Pratinjau mengikuti kolom yang sedang diketik; nama & owner bot di
    // kartu Identitas ikut memengaruhi isi pratinjau.
    Object.entries(OTEXT).forEach(([tab, o]) => {
        const input = $id(o.input);
        input?.addEventListener('input', renderOwnerText);
        input?.addEventListener('focus', () => { if (otextTab !== tab) setOwnerTextTab(tab); });
    });
    ['cfgBotName', 'cfgOwnerNumber'].forEach(id => $id(id)?.addEventListener('input', renderOwnerText));
    document.querySelectorAll('[data-otext-tab]').forEach(b =>
        b.addEventListener('click', () => setOwnerTextTab(b.dataset.otextTab)));
    document.querySelectorAll('[data-otext-reset]').forEach(b => b.addEventListener('click', () => {
        const input = $id(b.dataset.otextReset);
        if (!input || input.disabled) return;
        input.value = '';
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        say('Teks dikosongkan — bot akan memakai teks otomatis. Tekan Simpan config untuk menerapkan.');
    }));
    renderOwnerText();

    // Buka halaman sesuai #hash di URL (mis. /dashboard#api).
    const initial = (location.hash || '').replace('#', '');
    if (initial && initial !== 'dashboard') showView(initial, { scroll: false });
    // Halaman config dkk. sudah memuat config sendiri; selain itu muat diam-diam
    // supaya penanda mode self di kartu Kontrol Bot langsung benar.
    if (!['config', 'menu', 'cmd', 'mess'].includes(initial)) loadBotConfig({ quiet: true });
});
