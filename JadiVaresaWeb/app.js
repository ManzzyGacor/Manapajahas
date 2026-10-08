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
    const tier = currentUser.tier || 'free';
    const email = currentUser.email || '';

    const avatarHTML = currentUser.avatarUrl
        ? `<img src="${escapeHtml(currentUser.avatarUrl)}" alt="">`
        : escapeHtml(initial);

    document.querySelectorAll('.avatar-circle').forEach(el => { el.innerHTML = avatarHTML; });

    const dropName = $id('dropName');
    if (dropName) dropName.innerHTML = `${escapeHtml(name)} ${nitroBadgeHTML(tier)}`;
    // Tampilkan email asli dari akun Google; jangan pakai alamat contoh.
    const dropEmail = $id('dropEmail');
    if (dropEmail) {
        dropEmail.innerText = email;
        dropEmail.style.display = email ? '' : 'none';
    }

    const chipName = $id('chipName');
    if (chipName) chipName.textContent = name;
    const chipTier = $id('chipTier');
    if (chipTier) chipTier.innerHTML = nitroBadgeHTML(tier);
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

        const before = currentUser.tier;
        currentUser = { ...currentUser, ...result.user };
        localStorage.setItem('currentUser', JSON.stringify(currentUser));

        applyProfileToUI();
        applyTierGating();
        renderExpiry();
        initNotifButton();

        // Buka dashboard dari perangkat baru: localStorage belum tahu nomor
        // bot-nya, padahal akun ini sudah punya. Pakai nomor dari server
        // supaya terminal, statistik & token API langsung tersambung.
        const owned = Array.isArray(currentUser.botNumbers) ? currentUser.botNumbers : [];
        if (!activeBotNumber && owned.length) {
            window.setActiveBotNumber?.(owned[0]);
        }

        if (before !== currentUser.tier) {
            const statRole = $id('statRole');
            if (statRole) statRole.innerHTML = nitroBadgeHTML(currentUser.tier);
        }
    } catch (err) { /* offline: pakai data localStorage */ }
}

// Kunci / buka fitur sesuai paket aktif.
function applyTierGating() {
    const tier = currentUser.tier || 'free';
    const caps = TIER_CAPS[tier] || TIER_CAPS.free;

    // Tandai paket di <body> supaya CSS bisa memberi hiasan khusus
    // (cincin avatar, banner profil, dsb) tanpa perlu JS tambahan.
    document.body.classList.remove('t-free', 't-basic', 't-plus', 't-booster');
    document.body.classList.add(`t-${tier}`);

    const identityLock = $id('identityLockOverlay');
    if (identityLock) identityLock.style.display = caps.customize ? 'none' : 'flex';
    [$id('cfgBotName'), $id('cfgOwnerNumber'), $id('cfgWatermark'), $id('cfgFooter')]
        .forEach(el => { if (el) el.disabled = !caps.customize; });

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

    const freeAlert = $id('freeAlert');
    if (freeAlert) freeAlert.style.display = tier === 'free' ? 'flex' : 'none';

    const configTierText = $id('configTierText');
    if (configTierText) configTierText.innerHTML = `Paket aktif ${nitroBadgeHTML(tier)}`;

    const ownerLimitHint = $id('ownerLimitHint');
    if (ownerLimitHint) {
        const maxOwners = OWNER_LIMIT_BY_TIER[tier] ?? 0;
        ownerLimitHint.innerText = maxOwners > 0
            ? `Paket ${tierName(tier)} kamu: maks ${maxOwners} nomor owner.`
            : `Upgrade paket untuk bisa atur nomor owner sendiri.`;
    }

    // Kuota API harian: tandai baris paket yang sedang aktif.
    document.querySelectorAll('.quota-table li[data-tier]').forEach(li => {
        li.classList.toggle('is-current', li.dataset.tier === tier);
    });
}

// Tampilkan tanggal berakhirnya paket berbayar di kartu "Kedaluwarsa".
function renderExpiry() {
    const el = $id('statExpire');
    const sub = $id('statExpireSub');
    if (!el) return;
    if (currentUser.tier === 'free' || !currentUser.tierExpiredAt) {
        el.innerText = '-';
        el.style.color = '';
        if (sub) sub.innerText = currentUser.tier === 'free' ? 'paket gratis' : 'tanpa batas';
        return;
    }
    const exp = new Date(currentUser.tierExpiredAt);
    if (isNaN(exp)) { el.innerText = '-'; return; }

    const daysLeft = Math.ceil((exp - new Date()) / 86400000);
    el.innerText = exp.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    el.style.color = daysLeft <= 3 ? 'var(--danger)' : '';
    if (sub) sub.innerText = daysLeft > 0 ? `${daysLeft} hari lagi` : 'sudah lewat';
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

        applyProfileToUI();

        // Ambil data terbaru dari server: tier bisa saja sudah naik setelah
        // pembayaran (webhook), sementara localStorage masih data lama.
        refreshUserFromServer();

        const statRole = $id('statRole');
        if (statRole) statRole.innerHTML = nitroBadgeHTML(currentUser.tier);

        applyTierGating();
        renderExpiry();
        initNotifButton();

        if (currentUser.role === 'admin') {
            const profileDropList = document.querySelector('.profile-dropdown-list');
            if (profileDropList && !$id('btnAdminPanel')) {
                const adminLi = document.createElement('li');
                adminLi.id = 'btnAdminPanel';
                adminLi.className = 'is-admin';
                adminLi.innerHTML = `<i class="fa-solid fa-shield-halved"></i> Konsol admin`;
                adminLi.addEventListener('click', () => { window.location.href = '/admin'; });
                profileDropList.insertBefore(adminLi, profileDropList.firstChild);
            }
            // Pintasan yang sama di sidebar supaya admin tidak perlu membuka menu profil.
            const sideNav = document.querySelector('.side__nav');
            if (sideNav && !$id('sideAdminLink')) {
                const a = document.createElement('a');
                a.id = 'sideAdminLink';
                a.href = '/admin';
                a.className = 'side__item is-admin';
                a.innerHTML = '<i class="fa-solid fa-shield-halved"></i><span>Konsol admin</span>';
                sideNav.appendChild(a);
            }
        }
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
    function setBotState(state) {
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
    }

    function syncBotNumberUI() {
        const statNumber = $id('statNumber');
        if (statNumber) statNumber.innerText = activeBotNumber ? `+${activeBotNumber}` : 'belum ada nomor';
        const termTitle = $id('termTitle');
        if (termTitle) termTitle.innerText = activeBotNumber ? `bot@varesa:~/${activeBotNumber}` : 'bot@varesa:~';
        const inputWa = $id('inputWaNumber');
        if (inputWa && activeBotNumber && !inputWa.value) inputWa.value = activeBotNumber;
    }

    // Dipakai juga oleh refreshUserFromServer() saat nomor diambil dari akun.
    window.setActiveBotNumber = (num) => {
        activeBotNumber = String(num || '');
        if (activeBotNumber) localStorage.setItem('active_bot_num', activeBotNumber);
        else localStorage.removeItem('active_bot_num');
        syncBotNumberUI();
        window.reconnectBotStream?.();
        liveWidgets?.feed?.render();
        if (activeBotNumber) loadBotStats();
    };

    setBotState('offline');
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

    // --- BOT CONTROL API ---
    $id('btnStartBot')?.addEventListener('click', async (e) => {
        const inputWa = $id('inputWaNumber');
        if (!inputWa || !inputWa.value.trim()) {
            inputWa?.focus();
            return say('Masukkan nomor WA terlebih dahulu.', 'err');
        }

        const cleanNumber = inputWa.value.trim().replace(/^0/, '62').replace(/\D/g, '');
        if (cleanNumber.length < 9) return say('Nomor WA terlalu pendek. Pakai format 62812xxxx.', 'err');
        const previousNumber = activeBotNumber;
        activeBotNumber = cleanNumber;
        localStorage.setItem('active_bot_num', cleanNumber);
        syncBotNumberUI();
        showStartNotice('');
        // Pindahkan langganan SSE ke nomor bot yang baru ini.
        window.reconnectBotStream?.();
        liveWidgets?.feed?.render();

        setBotState('connecting');
        termReset(`$ Menyiapkan sesi untuk ${cleanNumber}…`, 't-info');
        const done = busy(e.currentTarget, 'Memulai…');

        try {
            const res = await fetch('/api/bot/start', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: cleanNumber, userId: currentUser.id })
            });
            let result = {};
            try { result = await res.json(); } catch { result = {}; }

            // Server penuh (kapasitas habis). Nomor tetap disimpan supaya
            // user cukup menekan Start lagi saat slot sudah tersedia.
            if (res.status === 503 && result.code === 'SERVER_FULL') {
                const cap = result.capacity || lastCapacity;
                const angka = cap && cap.max != null ? ` (${cap.used ?? cap.max}/${cap.max} bot)` : '';
                showStartNotice(`<strong>Server lagi penuh${angka}.</strong> Supaya semua bot tetap lancar, bot baru belum bisa dijalankan dulu. Coba lagi beberapa saat lagi — sisa slot terlihat di kartu Server. ${result.message ? `<br><span class="v-dim">${escapeHtml(result.message)}</span>` : ''}`);
                say('Server penuh — bot baru belum bisa dijalankan sekarang.', 'err');
                termLine(`$ ${result.message || 'Server penuh. Coba lagi nanti.'}`, 't-warn');
                setBotState('offline');
                if (cap) renderSlotHint(cap);
                return;
            }

            if (!result.success) {
                // Penolakan (mis. sudah punya nomor lain) harus terlihat,
                // bukan dibiarkan menggantung di status "Connecting...".
                say(result.message || 'Gagal memulai bot.', 'err');
                setBotState('offline');
                termLine(`$ ${result.message || 'Ditolak server.'}`, 't-err');
                if (result.code === 'BOT_LIMIT' && previousNumber && previousNumber !== cleanNumber) {
                    // Kembalikan ke nomor lama milik user, bukan dikosongkan.
                    window.setActiveBotNumber(previousNumber);
                    inputWa.value = previousNumber;
                } else {
                    localStorage.removeItem('active_bot_num');
                    activeBotNumber = '';
                    syncBotNumberUI();
                }
                return;
            }
            termLine('$ Koneksi dimulai. Tunggu pairing code muncul di sini…', 't-dim');
        } catch (err) {
            // Sebelumnya ditelan, jadi status macet di "Connecting..." selamanya.
            say('Gagal terhubung ke server. Coba lagi.', 'err');
            setBotState('offline');
        } finally { done(); }
    });

    $id('btnStopBot')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return say('Sesi bot belum diatur.', 'err');
        const done = busy(e.currentTarget, 'Menghentikan…');
        try {
            const res = await fetch('/api/bot/stop', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: activeBotNumber, userId: currentUser.id })
            });
            const result = await res.json();
            if (!result.success) return say(result.message || 'Gagal menghentikan bot.', 'err');
            setBotState('offline');
            say(result.message || 'Bot dihentikan.', 'ok');
        } catch (err) {
            say('Gagal terhubung ke server.', 'err');
        } finally { done(); }
    });

    $id('btnDeleteSession')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return say('Sesi bot belum diatur.', 'err');
        if (!confirm(`Hapus permanen data sesi WA ${activeBotNumber}?`)) return;

        const done = busy(e.currentTarget, '');
        try {
            const res = await fetch('/api/bot/delete', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: activeBotNumber, userId: currentUser.id })
            });
            const result = await res.json();

            // Data lokal HANYA dibersihkan kalau server benar-benar menghapus.
            // Sebelumnya dibersihkan apa pun hasilnya — kalau server menolak,
            // user kehilangan jejak nomornya padahal di server masih
            // terdaftar, lalu terkunci oleh batas satu nomor per akun.
            if (!result.success) return say(result.message || 'Gagal menghapus sesi.', 'err');

            window.setActiveBotNumber('');
            $id('inputWaNumber').value = '';
            setBotState('offline');
            termReset('$ Sesi dihapus.', 't-dim');
            say(result.message || 'Sesi dihapus.', 'ok');
        } catch (err) {
            say('Gagal terhubung ke server.', 'err');
        } finally { done(); }
    });

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

    async function loadBotConfig() {
        if (!activeBotNumber) return;
        try {
            const res = await fetch(`/api/bot/config/${activeBotNumber}`);
            const result = await res.json();
            if (result.success) {
                const cfg = result.data || {};
                const toggleModePublik = $id('modePublik');
                if (toggleModePublik) toggleModePublik.checked = cfg.modePublik ?? true;

                if ($id('cfgBotName')) $id('cfgBotName').value = cfg.botName || '';
                if ($id('cfgOwnerNumber')) $id('cfgOwnerNumber').value = cfg.ownerNumber || '';
                if ($id('cfgWatermark')) $id('cfgWatermark').value = cfg.watermark || '';
                if ($id('cfgFooter')) $id('cfgFooter').value = cfg.footer || '';

                const customMenuInput = $id('cfgCustomMenu');
                if (customMenuInput && cfg.customMenu) customMenuInput.value = cfg.customMenu;

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
            say('Config bot gagal dimuat. Tombol simpan dikunci sampai halaman dimuat ulang.', 'err');
        }
    }

    function renderBotStats(s) {
        const set = (id, val) => { const el = $id(id); if (el) el.innerText = val; };
        set('stMessages', (s.messages || 0).toLocaleString('id-ID'));
        set('stCommands', (s.commands || 0).toLocaleString('id-ID'));
        set('stGroups', s.groups || 0);
        set('stSplit', `${s.groupMessages || 0} / ${s.privateMessages || 0}`);

        // Status online dari server lebih bisa dipercaya daripada tebakan
        // dari log. Saat sedang pairing/menyambung jangan ditimpa "Offline".
        if (s.online === true && botState !== 'online') setBotState('online');
        else if (s.online === false && botState === 'online') setBotState('offline');

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
                    return `
                    <div class="addon-active">
                        <span class="v-dot v-dot--live"></span>
                        <div style="min-width:0;">
                            <strong>${escapeHtml(a.name)} aktif</strong>
                            <p>Sisa ${left} &middot; sampai ${exp.toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
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
            const res = await fetch(`/api/bot/stats/${activeBotNumber}`);
            const result = await res.json();
            if (result.success) renderBotStats(result.data);
        } catch (err) { /* statistik bersifat tambahan; diam saja */ }
    }

    // --- SIMPAN CONFIG / MENU / PROFIL ---
    $id('btnSaveConfig')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return say('Jalankan bot (Start) terlebih dahulu.', 'err');

        const modePublik = $id('modePublik')?.checked ?? true;
        const caps = TIER_CAPS[currentUser.tier] || TIER_CAPS.free;
        const botName = caps.customize ? ($id('cfgBotName')?.value.trim() || '') : '';
        const ownerNumber = caps.customize ? ($id('cfgOwnerNumber')?.value || '') : '';
        const watermark = caps.customize ? ($id('cfgWatermark')?.value || '') : '';
        const footer = caps.customize ? ($id('cfgFooter')?.value || '') : '';

        const ownerCount = ownerNumber.split(',').map(n => n.trim()).filter(Boolean).length;
        const maxOwners = OWNER_LIMIT_BY_TIER[currentUser.tier] ?? 0;
        if (ownerCount > maxOwners) {
            return say(maxOwners === 0
                ? 'Kustomisasi nomor owner khusus paket berbayar. Upgrade dulu, ya.'
                : `Paket ${tierName(currentUser.tier)} kamu maksimal ${maxOwners} nomor owner. Kurangi jumlah nomor atau upgrade paket.`, 'err');
        }

        const done = busy(e.currentTarget, 'Menyimpan…');
        try {
            const res = await fetch('/api/bot/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: activeBotNumber, userId: currentUser.id, tier: currentUser.tier, modePublik, botName, ownerNumber, watermark, footer })
            });
            const result = await res.json();
            say(result.message || (result.success ? 'Konfigurasi disimpan!' : 'Gagal menyimpan konfigurasi.'), result.success ? 'ok' : 'err');
        } catch (err) {
            say('Gagal terhubung ke server. Konfigurasi BELUM tersimpan.', 'err');
        } finally { done(); }
    });

    $id('btnSaveMenu')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return say('Jalankan bot (Start) terlebih dahulu.', 'err');
        const caps = TIER_CAPS[currentUser.tier] || TIER_CAPS.free;
        if (!caps.customize) return say('Kustomisasi menu khusus paket berbayar (Core/Prime/Zenith).', 'err');

        const customMenu = $id('cfgCustomMenu')?.value || '';
        const payload = { number: activeBotNumber, userId: currentUser.id, tier: currentUser.tier, customMenu };
        if (caps.menuImage) payload.menuImage = $id('cfgMenuImage')?.value || '';

        const done = busy(e.currentTarget, 'Menyimpan…');
        try {
            const res = await fetch('/api/bot/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await res.json();
            say(result.message || (result.success ? 'Menu kustom berhasil disimpan!' : 'Gagal menyimpan menu.'), result.success ? 'ok' : 'err');
        } catch (err) {
            say('Gagal terhubung ke server. Menu BELUM tersimpan.', 'err');
        } finally { done(); }
    });

    $id('btnResetMenu')?.addEventListener('click', () => {
        const menuBox = $id('cfgCustomMenu');
        if (menuBox) menuBox.value = `{ucapanWaktu}\n\n*User:* {pushname}\n*Status:* {statusUser}\n*Date:* {date}\n\n*MAIN*\n- {prefix}jadibot\n- {prefix}statistik\n- {prefix}ping\n`;
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
            if (!result.success) { say(result.message || 'Gagal menyimpan profil.', 'err'); return; }

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
            el.innerHTML = `<span class="price-cur">Rp</span>${Number(v).toLocaleString('id-ID')}<span class="price-period">/ bln</span>`;
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
    }

    async function openOrderModal(tier) {
        await loadPricing();
        if (!pricingData) return say('Gagal memuat harga. Coba lagi sebentar.', 'err');

        appliedVoucher = null;
        orderVoucher.value = '';
        voucherMsg.innerText = '';
        orderPaket.value = tier;
        orderMonths.value = '1';
        recalcOrderSummary();
        openModal(orderModal);
    }

    document.querySelectorAll('.btn-order').forEach(btn => {
        btn.addEventListener('click', () => openOrderModal(btn.getAttribute('data-tier')));
    });

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
        const done = busy(e.currentTarget, 'Memproses…');
        try {
            const res = await fetch('/api/payment/create', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: currentUser.id,
                    tier: orderPaket.value,
                    months: parseInt(orderMonths.value) || 1,
                    promoCode: appliedVoucher?.code || ''
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
                say(result.message || 'Gagal membuat pesanan.', 'err');
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
                return `
                <div class="list-item">
                    <div class="list-item__main">
                        <div class="list-item__title">${escapeHtml(what)} ${statusBadge[o.status] || escapeHtml(o.status)}</div>
                        <p class="list-item__meta">${escapeHtml(o.orderId)} · ${rupiah(o.totalPayment || o.amount)}${when ? ` · ${when}` : ''}</p>
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

        const quota = AUTOREPLY_QUOTA[currentUser.tier] ?? 0;
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
        const caps = TIER_CAPS[currentUser.tier] || TIER_CAPS.free;
        if (!caps.customize) return say('Pesan otomatis khusus paket berbayar. Upgrade dulu, ya.', 'err');

        const keyword = $id('arKeyword').value.trim();
        const reply = $id('arReply').value.trim();
        const match = $id('arMatch').value;
        if (!keyword || !reply) return say('Kata kunci dan balasan wajib diisi.', 'err');

        const quota = AUTOREPLY_QUOTA[currentUser.tier] ?? 0;
        if (autoReplies.length >= quota) {
            return say(`Paket ${tierName(currentUser.tier)} kamu maksimal ${quota} aturan. Hapus salah satu atau upgrade paket.`, 'err');
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
        if (!activeBotNumber) return say('Jalankan bot (Start) terlebih dahulu.', 'err');
        const caps = TIER_CAPS[currentUser.tier] || TIER_CAPS.free;
        if (!caps.customize) return say('Pesan otomatis khusus paket berbayar.', 'err');

        const done = busy(e.currentTarget, 'Menyimpan…');
        try {
            const res = await fetch('/api/bot/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: activeBotNumber, userId: currentUser.id, tier: currentUser.tier, autoReply: autoReplies })
            });
            const result = await res.json();
            say(result.message || (result.success ? 'Pesan otomatis disimpan!' : 'Gagal menyimpan.'), result.success ? 'ok' : 'err');
        } catch (err) { say('Gagal terhubung ke server.', 'err'); }
        finally { done(); }
    });

    $id('welcomeMode')?.addEventListener('change', (e) => {
        $id('welcomeMediaBox').style.display = e.target.value === 'custom' ? 'block' : 'none';
    });

    $id('btnSaveWelcome')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return say('Jalankan bot (Start) terlebih dahulu.', 'err');
        const caps = TIER_CAPS[currentUser.tier] || TIER_CAPS.free;
        if (!caps.customize) return say('Sambutan anggota khusus paket berbayar.', 'err');

        const mode = $id('welcomeMode').value;
        if (mode === 'custom' && !caps.menuImage) return say('Foto/GIF sendiri khusus paket Zenith.', 'err');

        const payload = {
            number: activeBotNumber, userId: currentUser.id, tier: currentUser.tier,
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
            say(result.message || (result.success ? 'Sambutan diterapkan.' : 'Gagal menerapkan.'), result.success ? 'ok' : 'err');
        } catch (err) { say('Gagal terhubung ke server.', 'err'); }
        finally { done(); }
    });

    $id('btnSendBroadcast')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return say('Jalankan bot (Start) terlebih dahulu.', 'err');
        const caps = TIER_CAPS[currentUser.tier] || TIER_CAPS.free;
        if (!caps.customize) return say('Siaran pesan khusus paket berbayar.', 'err');

        const text = $id('broadcastText').value.trim();
        if (!text) return say('Isi pesan tidak boleh kosong.', 'err');
        if (!confirm('Kirim pesan ini ke semua grup yang diikuti bot? Aksi ini tidak bisa dibatalkan.')) return;

        const done = busy(e.currentTarget, 'Mengirim…');
        try {
            const res = await fetch('/api/bot/broadcast', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: activeBotNumber, userId: currentUser.id, tier: currentUser.tier, message: text })
            });
            const result = await res.json();
            say(result.message || (result.success ? 'Pesan terkirim.' : 'Gagal mengirim.'), result.success ? 'ok' : 'err');
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

        const quota = CUSTOMCMD_QUOTA[currentUser.tier] ?? 0;
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
        const quota = CUSTOMCMD_QUOTA[currentUser.tier] ?? 0;
        if (quota === 0) return say('Perintah kustom khusus paket Prime ke atas.', 'err');

        const cmd = $id('cmdName').value.trim().replace(/^[./!#]/, '').toLowerCase();
        const response = $id('cmdResponse').value.trim();
        if (!cmd || !response) return say('Nama perintah dan balasan wajib diisi.', 'err');

        // Perintah inti tidak boleh ditimpa, nanti bot tidak bisa dikendalikan.
        const dilindungi = ['menu', 'jadibot', 'owner', 'ping', 'stop', 'start', 'delete'];
        if (dilindungi.includes(cmd)) return say(`Perintah ".${cmd}" dipakai sistem dan tidak bisa ditimpa.`, 'err');

        if (customCommands.length >= quota) return say(`Paket kamu maksimal ${quota} perintah.`, 'err');
        if (customCommands.some(c => c.cmd === cmd)) return say('Perintah itu sudah ada.', 'err');

        const caps = TIER_CAPS[currentUser.tier] || TIER_CAPS.free;
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
        if (!activeBotNumber) return say('Jalankan bot (Start) terlebih dahulu.', 'err');
        const done = busy(e.currentTarget, 'Menyimpan…');
        try {
            const res = await fetch('/api/bot/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    number: activeBotNumber, userId: currentUser.id,
                    tier: currentUser.tier, customCommands
                })
            });
            const result = await res.json();
            say(result.message || (result.success ? 'Perintah kustom disimpan.' : 'Gagal menyimpan.'), result.success ? 'ok' : 'err');
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
        if (!activeBotNumber) return say('Jalankan bot (Start) terlebih dahulu.', 'err');
        try {
            const res = await fetch(`/api/bot/backup/${encodeURIComponent(activeBotNumber)}?userId=${encodeURIComponent(currentUser.id)}`);
            const d = await res.json();
            if (!d.success) return say(d.message || 'Gagal membuat cadangan.', 'err');

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
        if (!activeBotNumber) return say('Jalankan bot (Start) terlebih dahulu.', 'err');
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
                body: JSON.stringify({ number: activeBotNumber, userId: currentUser.id, tier: currentUser.tier, backup })
            });
            const d = await res.json();
            say(d.message || (d.success ? 'Berhasil dipulihkan.' : 'Gagal memulihkan.'), d.success ? 'ok' : 'err');
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
        $id('apiBotNumber').textContent = activeBotNumber || '–';
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

        const tierBadge = $id('apiTierBadge');
        if (tierBadge) { tierBadge.className = ''; tierBadge.innerHTML = nitroBadgeHTML(api.tier || currentUser.tier); }

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
                $id('apiTokenValue').textContent = d.message || 'Token belum bisa dimuat.';
                return;
            }
            api.token = d.token || '';
            api.usage = d.usage || null;
            api.tier = d.tier || currentUser.tier;
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
        if (!activeBotNumber) return say('Jalankan bot dulu.', 'err');
        if (api.token && !confirm('Buat token baru?\n\nToken lama langsung tidak berlaku — aplikasi yang memakainya harus diperbarui.')) return;
        const done = busy(e.currentTarget, 'Membuat…');
        try {
            const res = await fetch('/api/bot/api-token', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: activeBotNumber, userId: currentUser.id })
            });
            let d = {};
            try { d = await res.json(); } catch { d = {}; }
            if (!res.ok || !d.success || !d.token) { say(d.message || 'Gagal membuat token.', 'err'); return; }
            api.token = d.token;
            api.revealed = true;
            say('Token baru siap. Simpan baik-baik — jangan dibagikan.', 'ok');
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

        sse = new EventSource(`/api/bot/events?number=${encodeURIComponent(activeBotNumber)}`);
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
            if (stats && statServer) statServer.innerText = `${stats.cpu}% · ${stats.ram}%`;
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
    const liveWidgets = window.VLive?.mountDashboard({ getMyBot: () => activeBotNumber }) || null;

    connectSSE();
    if (activeBotNumber) loadBotStats();

    // Buka halaman sesuai #hash di URL (mis. /dashboard#api).
    const initial = (location.hash || '').replace('#', '');
    if (initial && initial !== 'dashboard') showView(initial, { scroll: false });
});
