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

function nitroBadgeHTML(tier) {
    if (tier === 'basic') return `<span class="tier-badge core"><i class="fa-solid fa-bolt"></i> Core</span>`;
    if (tier === 'plus') return `<span class="tier-badge prime"><i class="fa-solid fa-gem"></i> Prime</span>`;
    if (tier === 'booster') return `<span class="tier-badge zenith"><i class="fa-solid fa-crown"></i> Zenith</span>`;
    return `<span style="color: var(--text-muted); font-size: 12px; font-weight: 600;">Free</span>`;
}

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TIER_NAME = { free: 'Free', basic: 'Core', plus: 'Prime', booster: 'Zenith' };

// Render ulang semua elemen UI yang bergantung pada data profil user.
function applyProfileToUI() {
    const name = currentUser.username || 'Guest';
    const initial = name.charAt(0).toUpperCase();
    const tier = currentUser.tier || 'free';
    const email = currentUser.email || '';

    const avatarHTML = currentUser.avatarUrl
        ? `<img src="${escapeHtml(currentUser.avatarUrl)}" alt="">`
        : initial;

    document.querySelectorAll('.avatar-circle').forEach(el => { el.innerHTML = avatarHTML; });

    const dropName = document.getElementById('dropName');
    if (dropName) dropName.innerHTML = `${escapeHtml(name)} ${nitroBadgeHTML(tier)}`;
    // Tampilkan email asli dari akun Google; jangan pakai alamat contoh.
    const dropEmail = document.getElementById('dropEmail');
    if (dropEmail) {
        dropEmail.innerText = email;
        dropEmail.style.display = email ? '' : 'none';
    }

    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    setVal('inputProfileName', name);
    setVal('cfgAvatarUrl', currentUser.avatarUrl);

    const prevAvatar = document.getElementById('profileAvatarPreview');
    if (prevAvatar) prevAvatar.innerHTML = avatarHTML;

    const prevName = document.getElementById('previewName');
    if (prevName) prevName.innerText = name;

    const prevEmail = document.getElementById('previewEmail');
    if (prevEmail) prevEmail.innerText = email || 'Belum ada email terhubung';

    // Banner berganti warna mengikuti paket aktif.
    const banner = document.getElementById('profileBanner');
    if (banner) banner.className = `profile-banner tier-${tier}`;
    const bannerTier = document.getElementById('bannerTier');
    if (bannerTier) bannerTier.innerText = TIER_NAME[tier] || 'Free';
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

        document.getElementById('btnInstallApp')?.addEventListener('click', async () => {
            if (!deferredInstall) return;
            deferredInstall.prompt();
            await deferredInstall.userChoice;
            deferredInstall = null;
            const box = document.getElementById('installBox');
            if (box) box.style.display = 'none';
        });
        if (before !== currentUser.tier) {
            const statRole = document.getElementById('statRole');
            if (statRole) statRole.innerHTML = nitroBadgeHTML(currentUser.tier);
        }
    } catch (err) { /* offline: pakai data localStorage */ }
}

// Kunci / buka fitur sesuai paket aktif.
function applyTierGating() {
    const caps = TIER_CAPS[currentUser.tier] || TIER_CAPS.free;

    // Tandai paket di <body> supaya CSS bisa memberi hiasan khusus
    // (border avatar, konsol berwarna, dsb) tanpa perlu JS tambahan.
    document.body.classList.remove('t-free', 't-basic', 't-plus', 't-booster');
    document.body.classList.add(`t-${currentUser.tier || 'free'}`);

    const identityLock = document.getElementById('identityLockOverlay');
    if (identityLock) identityLock.style.display = caps.customize ? 'none' : 'flex';
    [document.getElementById('cfgBotName'), document.getElementById('cfgOwnerNumber'), document.getElementById('cfgWatermark'), document.getElementById('cfgFooter')]
        .forEach(el => { if (el) el.disabled = !caps.customize; });

    const menuLock = document.getElementById('menuLockOverlay');
    if (menuLock) menuLock.style.display = caps.customize ? 'none' : 'flex';
    const cfgCustomMenu = document.getElementById('cfgCustomMenu');
    if (cfgCustomMenu) cfgCustomMenu.disabled = !caps.customize;

    const boosterImageBox = document.getElementById('boosterImageBox');
    if (boosterImageBox) boosterImageBox.style.display = caps.menuImage ? 'block' : 'none';

    const messLock = document.getElementById('messLockOverlay');
    if (messLock) messLock.style.display = caps.customize ? 'none' : 'flex';
    ['arKeyword', 'arReply', 'arMatch', 'btnAddAutoReply'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !caps.customize;
    });
    const messQuotaText = document.getElementById('messQuotaText');
    if (messQuotaText) messQuotaText.innerText = AUTOREPLY_QUOTA[currentUser.tier] ?? 0;

    const welcomeLock = document.getElementById('welcomeLockOverlay');
    if (welcomeLock) welcomeLock.style.display = caps.customize ? 'none' : 'flex';
    ['welcomeEnabled', 'welcomeText', 'leaveText', 'welcomeMode', 'btnSaveWelcome'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !caps.customize;
    });
    // Opsi "Foto/GIF sendiri" cuma untuk Booster.
    const customOpt = document.querySelector('#welcomeMode option[value="custom"]');
    if (customOpt) customOpt.disabled = !caps.menuImage;

    // Perintah kustom: Prime ke atas.
    const cmdAllowed = (CUSTOMCMD_QUOTA[currentUser.tier] ?? 0) > 0;
    const cmdLock = document.getElementById('cmdLockOverlay');
    if (cmdLock) cmdLock.style.display = cmdAllowed ? 'none' : 'flex';
    ['cmdName', 'cmdResponse', 'cmdImage', 'cmdShowMenu', 'btnAddCmd', 'btnSaveCmd'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !cmdAllowed;
    });
    const cmdQuotaText = document.getElementById('cmdQuotaText');
    if (cmdQuotaText) cmdQuotaText.innerText = CUSTOMCMD_QUOTA[currentUser.tier] ?? 0;
    const cmdImageBox = document.getElementById('cmdImageBox');
    if (cmdImageBox) cmdImageBox.style.display = caps.menuImage ? 'block' : 'none';

    const broadcastLock = document.getElementById('broadcastLockOverlay');
    if (broadcastLock) broadcastLock.style.display = caps.customize ? 'none' : 'flex';
    ['broadcastText', 'btnSendBroadcast'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !caps.customize;
    });

    const freeAlert = document.getElementById('freeAlert');
    if (freeAlert) freeAlert.style.display = currentUser.tier === 'free' ? 'flex' : 'none';

    const configTierText = document.getElementById('configTierText');
    if (configTierText) configTierText.innerText = `Paket: ${currentUser.tier.toUpperCase()}`;

    const ownerLimitHint = document.getElementById('ownerLimitHint');
    if (ownerLimitHint) {
        const maxOwners = OWNER_LIMIT_BY_TIER[currentUser.tier] ?? 0;
        ownerLimitHint.innerText = maxOwners > 0
            ? `Paket ${currentUser.tier.toUpperCase()} kamu: maks ${maxOwners} nomor owner.`
            : `Upgrade paket untuk bisa atur nomor owner sendiri.`;
    }
}

// Tampilkan tanggal berakhirnya paket berbayar di kartu statistik "Kedaluwarsa".
// Sebelumnya elemen ini ada di HTML tapi tidak pernah diisi apapun.
function renderExpiry() {
    const el = document.getElementById('statExpire');
    if (!el) return;
    if (currentUser.tier === 'free' || !currentUser.tierExpiredAt) {
        el.innerText = '-';
        return;
    }
    const exp = new Date(currentUser.tierExpiredAt);
    if (isNaN(exp)) { el.innerText = '-'; return; }

    const daysLeft = Math.ceil((exp - new Date()) / 86400000);
    el.innerText = exp.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    el.style.color = daysLeft <= 3 ? 'var(--danger)' : 'var(--text-main)';
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
            .catch(err => console.warn('Service worker gagal didaftarkan:', err));
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
function initNotifButton() {
    const btn = document.getElementById('btnEnableNotif');
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

    btn.addEventListener('click', async () => {
        const p = await Notification.requestPermission();
        sync();
        if (p === 'granted') notify('Notifikasi aktif', 'Kamu akan dikabari saat bot terputus atau pembayaran masuk.');
    });
    sync();
}

// Tombol "Pasang aplikasi". Browser memunculkan event ini hanya kalau
// situs memenuhi syarat PWA (HTTPS, manifest, service worker) dan belum
// terpasang — jadi tombolnya disembunyikan sampai benar-benar bisa dipakai.
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    const box = document.getElementById('installBox');
    if (box) box.style.display = 'block';
});

window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    const box = document.getElementById('installBox');
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
        currentUser = JSON.parse(userStr);
        if (!currentUser.tier) currentUser.tier = 'free'; 

        applyProfileToUI();

        // Ambil data terbaru dari server: tier bisa saja sudah naik setelah
        // pembayaran (webhook Pakasir), sementara localStorage masih data lama.
        refreshUserFromServer();

        const statRole = document.getElementById('statRole');
        if (statRole) statRole.innerHTML = nitroBadgeHTML(currentUser.tier);

        applyTierGating();
        renderExpiry();

        if (currentUser.role === 'admin') {
            const profileDropList = document.querySelector('.profile-dropdown-list');
            if (profileDropList && !document.getElementById('btnAdminPanel')) {
                const adminLi = document.createElement('li');
                adminLi.id = 'btnAdminPanel';
                adminLi.innerHTML = `<i class="fa-solid fa-shield-halved" style="color: #a78bfa;"></i> <span style="color: #a78bfa; font-weight: bold;">Admin Panel</span>`;
                adminLi.style.borderBottom = "1px solid var(--border-color)";
                adminLi.addEventListener('click', () => { window.location.href = '/admin'; });
                profileDropList.insertBefore(adminLi, profileDropList.firstChild);
            }
        }
    }

    if (activeBotNumber) {
        const inputWa = document.getElementById('inputWaNumber');
        if (inputWa) inputWa.value = activeBotNumber;
    }

    const themeToggle = document.getElementById('themeToggleBtn');
    if (localStorage.getItem('theme') === 'light') {
        document.body.classList.add('light-mode');
        if (themeToggle) themeToggle.className = 'fa-regular fa-moon icon-btn';
    }
    themeToggle?.addEventListener('click', () => {
        document.body.classList.toggle('light-mode');
        localStorage.setItem('theme', document.body.classList.contains('light-mode') ? 'light' : 'dark');
        themeToggle.className = document.body.classList.contains('light-mode') ? 'fa-regular fa-moon icon-btn' : 'fa-regular fa-sun icon-btn';
    });

    const updateModal = document.getElementById('updateModal');
    const chkHideUpdate = document.getElementById('chkHideUpdate');
    const hideUntil = localStorage.getItem('hideUpdateUntil');
    if (updateModal && (!hideUntil || Date.now() > parseInt(hideUntil))) updateModal.classList.add('active');
    chkHideUpdate?.addEventListener('change', (e) => {
        if (e.target.checked) localStorage.setItem('hideUpdateUntil', Date.now() + (24 * 60 * 60 * 1000));
        else localStorage.removeItem('hideUpdateUntil');
    });

    const profileAvatarBtn = document.getElementById('profileAvatarBtn');
    const profileDropdown = document.getElementById('profileDropdown');
    profileAvatarBtn?.addEventListener('click', (e) => { e.stopPropagation(); profileDropdown.classList.toggle('active'); });
    document.addEventListener('click', (e) => { if (!profileDropdown?.contains(e.target) && e.target !== profileAvatarBtn) profileDropdown?.classList.remove('active'); });

    const btnHamburger = document.getElementById('btnHamburger');
    const mobileMenu = document.getElementById('mobileMenu');
    btnHamburger?.addEventListener('click', () => mobileMenu.classList.add('active'));
    mobileMenu?.addEventListener('click', (e) => { if (e.target === mobileMenu) mobileMenu.classList.remove('active'); });

    document.getElementById('btnLogoutDrop')?.addEventListener('click', () => { localStorage.removeItem('currentUser'); window.location.href = '/login'; });
    document.getElementById('btnLogoutSetting')?.addEventListener('click', () => { localStorage.removeItem('currentUser'); window.location.href = '/login'; });

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetView = btn.getAttribute('data-target');
            if(!targetView) return;
            document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
            const targetEl = document.getElementById('view-' + targetView);
            if (targetEl) {
                targetEl.classList.add('active');
                // Tandai item menu yang sedang dibuka supaya user tahu posisinya.
                document.querySelectorAll('.menu-list li').forEach(li => li.classList.remove('active'));
                document.querySelectorAll(`.menu-list li[data-target="${targetView}"]`)
                    .forEach(li => li.classList.add('active'));

                window.scrollTo({ top: 0, behavior: 'smooth' });
                if (['config','menu','cmd'].includes(targetView)) loadBotConfig();
                if (targetView === 'statistik') loadBotStats();
                if (targetView === 'upgrade') loadLeaderboard();
                if (targetView === 'addons') loadAddons();
                if (targetView === 'referral') loadReferral();
            }
            if(mobileMenu) mobileMenu.classList.remove('active');
            if(profileDropdown) profileDropdown.classList.remove('active');
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
            document.getElementById('modalTitle').innerText = paketName + ' - Semua Manfaat';
            const list = document.getElementById('modalFeatureList');
            let features = [];
            if (paketName === 'Core') {
                features = ["Badge Core animasi", "Nama bot bisa diganti sendiri", "1 nomor owner", "Bebas watermark iklan", "Balasan otomatis sampai 10 aturan", "Sambutan anggota grup", "Siaran pesan ke semua grup", "Dukungan standar"];
            } else if (paketName === 'Prime') {
                features = ["Badge Prime animasi", "Semua fitur Core", "3 nomor owner", "Balasan otomatis sampai 30 aturan", "Kustomisasi bot lebih lengkap", "Prioritas antrean update"];
            } else {
                features = ["Badge Zenith animasi", "Semua fitur Prime", "5 nomor owner", "Akses penuh fitur Cek MLBB (lookup, bind, cekban, creation, find)", "Balasan otomatis sampai 100 aturan", "Upload foto/GIF untuk menu bot", "Prioritas utama update fitur", "Dukungan & penanganan kendala prioritas"];
            }
            list.innerHTML = features.map(f => `<li><i class="fa-solid fa-check"></i> ${f}</li>`).join('');
            document.getElementById('benefitModal').classList.add('active');
        });
    });

    const benefitModal = document.getElementById('benefitModal');
    document.getElementById('btnCloseModal')?.addEventListener('click', () => benefitModal.classList.remove('active'));
    document.getElementById('btnTutupModal')?.addEventListener('click', () => benefitModal.classList.remove('active'));
    benefitModal?.addEventListener('click', (e) => { if (e.target === benefitModal) benefitModal.classList.remove('active'); });

    // --- BOT CONTROL API ---
    document.getElementById('btnStartBot')?.addEventListener('click', async () => {
        const inputWa = document.getElementById('inputWaNumber');
        if (!inputWa || !inputWa.value.trim()) return alert('Masukkan nomor WA terlebih dahulu!');
        
        const cleanNumber = inputWa.value.trim().replace(/^0/, '62').replace(/\D/g, '');
        activeBotNumber = cleanNumber;
        localStorage.setItem('active_bot_num', cleanNumber);
        // Pindahkan langganan SSE ke nomor bot yang baru ini.
        window.reconnectBotStream?.();
        
        document.getElementById('statStatus').innerText = 'Connecting...';
        document.getElementById('statStatus').style.color = '#eab308';
        document.getElementById('termHeaderTitle').innerHTML = `varesa.mom@bot... &nbsp; <span style="color: #eab308;">● connecting</span>`;
        document.getElementById('terminalLogs').innerHTML = `<div class="log-line" style="color: #a78bfa;">$ Initializing deployment sequence for ${cleanNumber}...</div>`;
        
        try {
            const res = await fetch('/api/bot/start', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: cleanNumber, userId: currentUser.id })
            });
            const result = await res.json();
            if (!result.success) {
                // Penolakan (mis. sudah punya nomor lain) harus terlihat,
                // bukan dibiarkan menggantung di status "Connecting...".
                alert(result.message || 'Gagal memulai bot.');
                document.getElementById('statStatus').innerText = 'Offline';
                document.getElementById('statStatus').style.color = '#f87171';
                document.getElementById('termHeaderTitle').innerHTML = `varesa.mom@bot... &nbsp; <span style="color: #f87171;">● disconnected</span>`;
                document.getElementById('terminalLogs').innerHTML += `<div class="log-line" style="color:#f87171;">$ ${result.message || 'Ditolak server.'}</div>`;
                localStorage.removeItem('active_bot_num');
                activeBotNumber = '';
                return;
            }
        } catch(e) {
            // Sebelumnya ditelan, jadi status macet di "Connecting..." selamanya.
            alert('Gagal terhubung ke server. Coba lagi.');
            document.getElementById('statStatus').innerText = 'Offline';
            document.getElementById('statStatus').style.color = '#f87171';
        }
    });

    document.getElementById('btnStopBot')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return alert("Sesi bot belum diatur.");
        const btn = e.currentTarget; const orig = btn.innerText;
        btn.innerText = 'Menghentikan...'; btn.disabled = true;
        try {
            const res = await fetch('/api/bot/stop', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: activeBotNumber, userId: currentUser.id })
            });
            const result = await res.json();
            if (!result.success) return alert(result.message || 'Gagal menghentikan bot.');
            document.getElementById('statStatus').innerText = 'Offline';
            document.getElementById('statStatus').style.color = 'var(--text-main)';
        } catch (err) {
            alert('Gagal terhubung ke server.');
        } finally { btn.innerText = orig; btn.disabled = false; }
    });

    document.getElementById('btnDeleteSession')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return alert("Sesi bot belum diatur.");
        if (!confirm(`Hapus permanen data sesi WA?`)) return;

        const btn = e.currentTarget; const orig = btn.innerText;
        btn.innerText = 'Menghapus...'; btn.disabled = true;
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
            if (!result.success) return alert(result.message || 'Gagal menghapus sesi.');

            localStorage.removeItem('active_bot_num'); activeBotNumber = '';
            window.reconnectBotStream?.();
            document.getElementById('inputWaNumber').value = '';
            document.getElementById('statStatus').innerText = 'Offline';
            document.getElementById('statStatus').style.color = 'var(--text-main)';
            document.getElementById('termHeaderTitle').innerHTML = `varesa.mom@bot... &nbsp; <span style="color: #f87171;">● disconnected</span>`;
            alert(result.message || 'Sesi dihapus.');
        } catch (err) {
            alert('Gagal terhubung ke server.');
        } finally { btn.innerText = orig; btn.disabled = false; }
    });

    // Tombol simpan hanya aktif setelah config berhasil dimuat dari server.
    // Mencegah config asli tertimpa form kosong saat pemuatan gagal.
    function setConfigLoaded(ok) {
        ['btnSaveConfig', 'btnSaveMenu', 'btnSaveAutoReply', 'btnSaveCmd'].forEach(id => {
            const el = document.getElementById(id);
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
                const toggleModePublik = document.getElementById('modePublik');
                if (toggleModePublik) toggleModePublik.checked = cfg.modePublik ?? true;
                
                if (document.getElementById('cfgBotName')) document.getElementById('cfgBotName').value = cfg.botName || '';
                if (document.getElementById('cfgOwnerNumber')) document.getElementById('cfgOwnerNumber').value = cfg.ownerNumber || '';
                if (document.getElementById('cfgWatermark')) document.getElementById('cfgWatermark').value = cfg.watermark || '';
                if (document.getElementById('cfgFooter')) document.getElementById('cfgFooter').value = cfg.footer || '';
                
                const customMenuInput = document.getElementById('cfgCustomMenu');
                if (customMenuInput && cfg.customMenu) customMenuInput.value = cfg.customMenu;

                const menuImageInput = document.getElementById('cfgMenuImage');
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
            console.error('Gagal memuat config bot:', err);
            setConfigLoaded(false);
        }
    }

    function renderBotStats(s) {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
        set('stMessages', (s.messages || 0).toLocaleString('id-ID'));
        set('stCommands', (s.commands || 0).toLocaleString('id-ID'));
        set('stGroups', s.groups || 0);
        set('stSplit', `${s.groupMessages || 0} / ${s.privateMessages || 0}`);

        const feed = document.getElementById('activityFeed');
        if (!feed) return;
        const items = s.recent || [];
        if (!items.length) {
            feed.innerHTML = `<p class="feed-empty">Belum ada aktivitas. Jalankan bot dan kirim pesan ke grup untuk melihatnya di sini.</p>`;
            return;
        }
        feed.innerHTML = items.map(r => {
            const time = new Date(r.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
        const optBox = document.getElementById('addonOptions');
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
            const activeBox = document.getElementById('activeAddons');
            const active = (mine.success && mine.addons) ? mine.addons : [];
            if (activeBox) {
                activeBox.innerHTML = active.length ? active.map(a => {
                    const exp = new Date(a.expiredAt);
                    const hoursLeft = Math.max(0, Math.round((exp - new Date()) / 3600000));
                    const left = hoursLeft >= 24 ? `${Math.floor(hoursLeft / 24)} hari ${hoursLeft % 24} jam` : `${hoursLeft} jam`;
                    return `
                    <div class="addon-active">
                        <span class="addon-active-dot"></span>
                        <div style="min-width:0;">
                            <strong>${escapeHtml(a.name)} aktif</strong>
                            <p>Sisa ${left} &middot; sampai ${exp.toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                    </div>`;
                }).join('') : '';
            }

            const mlbb = addonCatalog.mlbb_unlimited;
            optBox.innerHTML = mlbb.options.map(o => `
                <button class="addon-opt btn-buy-addon" data-type="mlbb_unlimited" data-days="${o.days}" data-price="${o.price}">
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
        document.getElementById('addonSubtotal').innerText = rupiah(addonPick.price);
        document.getElementById('addonFee').innerText = rupiah(adminFee);
        document.getElementById('addonTotal').innerText = rupiah(addonPick.price - discount + adminFee);
        const row = document.getElementById('addonDiscountRow');
        if (discount > 0) {
            row.style.display = 'flex';
            document.getElementById('addonDiscount').innerText = '- ' + rupiah(discount);
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

        document.getElementById('addonName').value = info.name;
        const sel = document.getElementById('addonDays');
        sel.innerHTML = info.options.map(o =>
            `<option value="${o.days}" data-price="${o.price}" ${o.days === days ? 'selected' : ''}>${o.days} hari — ${rupiah(o.price)}</option>`
        ).join('');
        document.getElementById('addonVoucher').value = '';
        document.getElementById('addonVoucherMsg').innerText = '';
        recalcAddon();
        document.getElementById('addonModal').classList.add('active');
    });

    document.getElementById('addonDays')?.addEventListener('change', (e) => {
        const opt = e.target.selectedOptions[0];
        addonPick.days = Number(e.target.value);
        addonPick.price = Number(opt.dataset.price);
        // Voucher direset karena nominalnya berubah.
        addonVoucher = null;
        document.getElementById('addonVoucherMsg').innerText = 'Voucher direset karena durasi berubah.';
        document.getElementById('addonVoucherMsg').style.color = 'var(--text-muted)';
        recalcAddon();
    });

    const addonModal = document.getElementById('addonModal');
    document.getElementById('btnCloseAddon')?.addEventListener('click', () => addonModal.classList.remove('active'));
    document.getElementById('btnCancelAddon')?.addEventListener('click', () => addonModal.classList.remove('active'));
    addonModal?.addEventListener('click', (e) => { if (e.target === addonModal) addonModal.classList.remove('active'); });

    document.getElementById('btnApplyAddonVoucher')?.addEventListener('click', async (e) => {
        const code = document.getElementById('addonVoucher').value.trim();
        const msg = document.getElementById('addonVoucherMsg');
        if (!code) return;
        const btn = e.target; const orig = btn.innerText;
        btn.innerText = '...'; btn.disabled = true;
        try {
            const res = await fetch('/api/addons/check-promo', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, type: addonPick.type, days: addonPick.days })
            });
            const r = await res.json();
            if (r.success) {
                addonVoucher = { code: r.code, discount: r.discount };
                msg.innerText = `Voucher ${r.code} aktif: potongan ${r.percent}%.`;
                msg.style.color = '#34d399';
            } else {
                addonVoucher = null;
                msg.innerText = r.message || 'Kode voucher tidak valid.';
                msg.style.color = '#f87171';
            }
            recalcAddon();
        } catch (err) {
            msg.innerText = 'Gagal memeriksa voucher.'; msg.style.color = '#f87171';
        } finally { btn.innerText = orig; btn.disabled = false; }
    });

    document.getElementById('btnCreateAddon')?.addEventListener('click', async (e) => {
        if (!currentUser?.id) return alert('Silakan login ulang.');
        const btn = e.target; const orig = btn.innerText;
        btn.innerText = 'Memproses...'; btn.disabled = true;
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
                alert(r.message || 'Gagal membuat pesanan.');
                return;
            }
            window.location.href = `/invoice?order_id=${encodeURIComponent(r.order.orderId)}`;
        } catch (err) {
            alert('Gagal terhubung ke server pembayaran.');
        } finally { btn.innerText = orig; btn.disabled = false; }
    });

    async function loadLeaderboard() {
        const box = document.getElementById('leaderboard');
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
                    : initial;
                const sinceTxt = r.since
                    ? new Date(r.since).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })
                    : '-';
                const isMe = r.username === currentUser.username;
                return `
                <div class="lb-row ${medal[r.rank - 1] || ''} ${isMe ? 'me' : ''}">
                    <span class="lb-rank">${r.rank}</span>
                    <span class="lb-face">${face}</span>
                    <span class="lb-name">
                        ${escapeHtml(r.username)} ${isMe ? '<span class="lb-you">kamu</span>' : ''}
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
        } catch (err) {}
    }

    document.addEventListener('click', async (e) => {
        if (e.target.id === 'btnSaveConfig') {
            if (!activeBotNumber) return alert('Jalankan bot (Start) terlebih dahulu.');

            const modePublik = document.getElementById('modePublik')?.checked ?? true;
            const caps = TIER_CAPS[currentUser.tier] || TIER_CAPS.free;
            const botName = caps.customize ? (document.getElementById('cfgBotName')?.value.trim() || '') : '';
            const ownerNumber = caps.customize ? (document.getElementById('cfgOwnerNumber')?.value || '') : '';
            const watermark = caps.customize ? (document.getElementById('cfgWatermark')?.value || '') : '';
            const footer = caps.customize ? (document.getElementById('cfgFooter')?.value || '') : '';

            const ownerCount = ownerNumber.split(',').map(n => n.trim()).filter(Boolean).length;
            const maxOwners = OWNER_LIMIT_BY_TIER[currentUser.tier] ?? 0;
            if (ownerCount > maxOwners) {
                return alert(maxOwners === 0
                    ? 'Kustomisasi Nomor Owner khusus paket berbayar. Upgrade dulu, ya.'
                    : `Paket ${currentUser.tier.toUpperCase()} kamu maksimal ${maxOwners} nomor owner. Kurangi jumlah nomor atau upgrade paket.`);
            }

            const originalText = e.target.innerText; e.target.innerText = 'Menyimpan...'; e.target.disabled = true;

            try {
                const res = await fetch('/api/bot/config', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ number: activeBotNumber, userId: currentUser.id, tier: currentUser.tier, modePublik, botName, ownerNumber, watermark, footer })
                });
                const result = await res.json();
                alert(result.message || (result.success ? 'Konfigurasi disimpan!' : 'Gagal menyimpan konfigurasi.'));
            } catch (err) {
                alert('Gagal terhubung ke server. Konfigurasi BELUM tersimpan.');
            } finally { e.target.innerText = originalText; e.target.disabled = false; }
        }

        if (e.target.id === 'btnSaveMenu') {
            if (!activeBotNumber) return alert('Jalankan bot (Start) terlebih dahulu.');
            const caps = TIER_CAPS[currentUser.tier] || TIER_CAPS.free;
            if (!caps.customize) return alert('Kustomisasi menu khusus paket berbayar (Core/Prime/Zenith).');

            const customMenu = document.getElementById('cfgCustomMenu')?.value || '';
            const payload = { number: activeBotNumber, userId: currentUser.id, tier: currentUser.tier, customMenu };
            if (caps.menuImage) payload.menuImage = document.getElementById('cfgMenuImage')?.value || '';

            const originalText = e.target.innerText; e.target.innerText = 'Menyimpan...'; e.target.disabled = true;
            try {
                const res = await fetch('/api/bot/config', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();
                alert(result.message || (result.success ? 'Menu kustom berhasil disimpan!' : 'Gagal menyimpan menu.'));
            } catch (err) {
                alert('Gagal terhubung ke server. Menu BELUM tersimpan.');
            } finally { e.target.innerText = originalText; e.target.disabled = false; }
        }

        if (e.target.id === 'btnResetMenu') {
            const menuBox = document.getElementById('cfgCustomMenu');
            if (menuBox) menuBox.value = `{ucapanWaktu}\n\n*User:* {pushname}\n*Status:* {statusUser}\n*Date:* {date}\n\n*MAIN*\n- {prefix}jadibot\n- {prefix}statistik\n- {prefix}ping\n`;
        }

        if (e.target.id === 'btnSaveProfile') {
            const newName = document.getElementById('inputProfileName')?.value.trim();
            if (!newName) return alert('Username tidak boleh kosong.');

            const payload = {
                id: currentUser.id,
                username: newName,
                avatarUrl: document.getElementById('cfgAvatarUrl')?.value.trim() || ''
            };

            const btn = e.target;
            const orig = btn.innerText; btn.innerText = "Menyimpan..."; btn.disabled = true;
            try {
                const res = await fetch('/api/user/profile', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();
                if (!result.success) { alert(result.message || 'Gagal menyimpan profil.'); return; }

                currentUser = { ...currentUser, ...payload };
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                applyProfileToUI();
                alert('Profil berhasil diperbarui.');
            } catch (err) { alert('Gagal terhubung ke server.'); }
            finally { btn.innerText = orig; btn.disabled = false; }
        }
    });

    // ==========================================
    // ORDER DETAIL & PEMBAYARAN (PAKASIR)
    // ==========================================
    const TIER_LABEL = TIER_NAME;
    const rupiah = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

    let pricingData = null;
    let appliedVoucher = null; // { code, percent, discount }

    const orderModal = document.getElementById('orderModal');
    const orderPaket = document.getElementById('orderPaket');
    const orderMonths = document.getElementById('orderMonths');
    const orderVoucher = document.getElementById('orderVoucher');
    const voucherMsg = document.getElementById('voucherMsg');

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
                console.error('Gagal memuat harga:', result.message);
                showPriceLoadError();
            }
        } catch (err) {
            console.error('Gagal memuat harga (jaringan/server):', err);
            showPriceLoadError();
        }
        return pricingData;
    }

    function showPriceLoadError() {
        document.querySelectorAll('[data-price]').forEach(el => {
            el.innerHTML = `<span style="font-size: 13px; color: var(--danger);">Gagal memuat harga</span>`;
        });
    }

    // Kartu harga mengikuti angka yang diatur admin, bukan angka tetap di HTML.
    function renderPriceCards() {
        if (!pricingData) return;
        document.querySelectorAll('[data-price]').forEach(el => {
            const v = pricingData[el.getAttribute('data-price')];
            if (v == null) return;
            el.innerHTML = `${rupiah(v)} <span class="price-period">/ bln</span>`;
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
            voucherMsg.style.color = 'var(--text-muted)';
        }

        document.getElementById('sumSubtotal').innerText = rupiah(subtotal);
        document.getElementById('sumFee').innerText = rupiah(adminFee);
        document.getElementById('sumTotal').innerText = rupiah(subtotal - discount + adminFee);
        const dRow = document.getElementById('sumDiscountRow');
        if (discount > 0) {
            dRow.style.display = 'flex';
            document.getElementById('sumDiscount').innerText = '- ' + rupiah(discount);
        } else {
            dRow.style.display = 'none';
        }
    }

    async function openOrderModal(tier) {
        await loadPricing();
        if (!pricingData) return alert('Gagal memuat harga. Coba lagi sebentar.');

        appliedVoucher = null;
        orderVoucher.value = '';
        voucherMsg.innerText = '';
        orderPaket.value = tier;
        orderMonths.value = '1';
        recalcOrderSummary();
        orderModal.classList.add('active');
    }

    document.querySelectorAll('.btn-order').forEach(btn => {
        btn.addEventListener('click', () => openOrderModal(btn.getAttribute('data-tier')));
    });

    orderPaket?.addEventListener('change', recalcOrderSummary);
    orderMonths?.addEventListener('change', recalcOrderSummary);

    document.getElementById('btnCloseOrder')?.addEventListener('click', () => orderModal.classList.remove('active'));
    document.getElementById('btnCancelOrder')?.addEventListener('click', () => orderModal.classList.remove('active'));
    orderModal?.addEventListener('click', (e) => { if (e.target === orderModal) orderModal.classList.remove('active'); });

    document.getElementById('btnApplyVoucher')?.addEventListener('click', async (e) => {
        const code = orderVoucher.value.trim();
        if (!code) return;
        const btn = e.target; const orig = btn.innerText;
        btn.innerText = '...'; btn.disabled = true;
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
                voucherMsg.style.color = '#34d399';
            } else {
                appliedVoucher = null;
                voucherMsg.innerText = result.message || 'Kode voucher tidak valid.';
                voucherMsg.style.color = '#f87171';
            }
            recalcOrderSummary();
        } catch (err) {
            voucherMsg.innerText = 'Gagal memeriksa voucher.';
            voucherMsg.style.color = '#f87171';
        } finally { btn.innerText = orig; btn.disabled = false; }
    });

    document.getElementById('btnCreateOrder')?.addEventListener('click', async (e) => {
        if (!currentUser?.id) return alert('Silakan login ulang.');
        const btn = e.target; const orig = btn.innerText;
        btn.innerText = 'Memproses...'; btn.disabled = true;
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
                alert(result.message || 'Gagal membuat pesanan.');
                return;
            }
            window.location.href = `/invoice?order_id=${encodeURIComponent(result.order.orderId)}`;
        } catch (err) {
            alert('Gagal terhubung ke server pembayaran.');
        } finally { btn.innerText = orig; btn.disabled = false; }
    });

    async function loadOrderHistory() {
        const box = document.getElementById('orderHistory');
        if (!box || !currentUser?.id) return;
        try {
            const res = await fetch(`/api/payment/orders/${encodeURIComponent(currentUser.id)}`);
            const result = await res.json();
            if (!result.success || !result.orders.length) {
                box.innerHTML = `<p style="color: var(--text-muted); font-size: 13px;">Belum ada transaksi.</p>`;
                return;
            }
            const statusStyle = {
                completed: 'color:#34d399;', pending: 'color:#fbbf24;',
                cancelled: 'color:#f87171;', expired: 'color:#f87171;'
            };
            const statusLabel = {
                completed: 'Lunas', pending: 'Menunggu', cancelled: 'Dibatalkan', expired: 'Kedaluwarsa'
            };
            box.innerHTML = result.orders.map(o => `
                <div class="order-history-item">
                    <div style="min-width:0;">
                        <strong style="font-size:13px;">${escapeHtml(o.kind === 'addon' ? 'Add-On Unlimited' : (TIER_LABEL[o.tier] || o.tier))}</strong>
                        <span style="font-size:11px;${statusStyle[o.status] || ''}"> &bull; ${statusLabel[o.status] || o.status}</span>
                        <p style="font-size:11px;color:var(--text-muted);margin-top:3px;">${escapeHtml(o.orderId)} &middot; ${rupiah(o.totalPayment || o.amount)}</p>
                    </div>
                    <a href="/invoice?order_id=${encodeURIComponent(o.orderId)}">Lihat &rsaquo;</a>
                </div>
            `).join('');
        } catch (err) {
            box.innerHTML = `<p style="color: var(--text-muted); font-size: 13px;">Gagal memuat riwayat.</p>`;
        }
    }
    loadOrderHistory();

    // ==========================================
    // PESAN OTOMATIS (AUTO-REPLY)
    // ==========================================
    function renderAutoReplies() {
        const box = document.getElementById('autoReplyList');
        const counter = document.getElementById('autoReplyCount');
        if (!box) return;

        const quota = AUTOREPLY_QUOTA[currentUser.tier] ?? 0;
        if (counter) counter.innerText = `${autoReplies.length} / ${quota} aturan`;

        if (!autoReplies.length) {
            box.innerHTML = `<p style="color: var(--text-muted); font-size: 13px;">Belum ada balasan otomatis.</p>`;
            return;
        }

        const matchLabel = { contains: 'Mengandung', exact: 'Sama persis', startsWith: 'Diawali' };
        box.innerHTML = autoReplies.map((r, i) => `
            <div class="order-history-item">
                <div style="min-width:0;">
                    <strong style="font-size:13px;">${escapeHtml(r.keyword)}</strong>
                    <span style="font-size:11px;color:var(--text-muted);"> &bull; ${matchLabel[r.match] || r.match}</span>
                    <p style="font-size:12px;color:var(--text-muted);margin-top:4px;white-space:pre-wrap;">${escapeHtml(r.reply)}</p>
                </div>
                <button class="btn btn-delete btn-del-ar" data-index="${i}" style="padding:6px 12px;font-size:12px;flex:none;">Hapus</button>
            </div>
        `).join('');
    }

    document.getElementById('btnAddAutoReply')?.addEventListener('click', () => {
        const caps = TIER_CAPS[currentUser.tier] || TIER_CAPS.free;
        if (!caps.customize) return alert('Pesan Otomatis khusus paket berbayar. Upgrade dulu, ya.');

        const keyword = document.getElementById('arKeyword').value.trim();
        const reply = document.getElementById('arReply').value.trim();
        const match = document.getElementById('arMatch').value;
        if (!keyword || !reply) return alert('Kata kunci dan balasan wajib diisi.');

        const quota = AUTOREPLY_QUOTA[currentUser.tier] ?? 0;
        if (autoReplies.length >= quota) {
            return alert(`Paket ${currentUser.tier.toUpperCase()} kamu maksimal ${quota} aturan. Hapus salah satu atau upgrade paket.`);
        }
        if (autoReplies.some(r => r.keyword.toLowerCase() === keyword.toLowerCase())) {
            return alert('Kata kunci itu sudah ada.');
        }

        autoReplies.push({ keyword, reply, match });
        document.getElementById('arKeyword').value = '';
        document.getElementById('arReply').value = '';
        renderAutoReplies();
    });

    document.getElementById('autoReplyList')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-del-ar');
        if (!btn) return;
        autoReplies.splice(parseInt(btn.dataset.index), 1);
        renderAutoReplies();
    });

    document.getElementById('btnSaveAutoReply')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return alert('Jalankan bot (Start) terlebih dahulu.');
        const caps = TIER_CAPS[currentUser.tier] || TIER_CAPS.free;
        if (!caps.customize) return alert('Pesan Otomatis khusus paket berbayar.');

        const btn = e.target; const orig = btn.innerText;
        btn.innerText = 'Menyimpan...'; btn.disabled = true;
        try {
            const res = await fetch('/api/bot/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: activeBotNumber, tier: currentUser.tier, autoReply: autoReplies })
            });
            const result = await res.json();
            alert(result.message || (result.success ? 'Pesan otomatis disimpan!' : 'Gagal menyimpan.'));
        } catch (err) { alert('Gagal terhubung ke server.'); }
        finally { btn.innerText = orig; btn.disabled = false; }
    });

    document.getElementById('welcomeMode')?.addEventListener('change', (e) => {
        document.getElementById('welcomeMediaBox').style.display = e.target.value === 'custom' ? 'block' : 'none';
    });

    document.getElementById('btnSaveWelcome')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return alert('Jalankan bot (Start) terlebih dahulu.');
        const caps = TIER_CAPS[currentUser.tier] || TIER_CAPS.free;
        if (!caps.customize) return alert('Sambutan Anggota khusus paket berbayar.');

        const mode = document.getElementById('welcomeMode').value;
        if (mode === 'custom' && !caps.menuImage) return alert('Foto/GIF sendiri khusus paket Zenith.');

        const payload = {
            number: activeBotNumber, tier: currentUser.tier,
            enabled: document.getElementById('welcomeEnabled').checked,
            welcomeText: document.getElementById('welcomeText').value.trim(),
            leaveText: document.getElementById('leaveText').value.trim(),
            mode, mediaUrl: mode === 'custom' ? document.getElementById('welcomeMedia').value.trim() : ''
        };

        const btn = e.target; const orig = btn.innerText;
        btn.innerText = 'Menerapkan...'; btn.disabled = true;
        try {
            const res = await fetch('/api/bot/welcome', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await res.json();
            alert(result.message || (result.success ? 'Sambutan diterapkan.' : 'Gagal menerapkan.'));
        } catch (err) { alert('Gagal terhubung ke server.'); }
        finally { btn.innerText = orig; btn.disabled = false; }
    });

    document.getElementById('btnSendBroadcast')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return alert('Jalankan bot (Start) terlebih dahulu.');
        const caps = TIER_CAPS[currentUser.tier] || TIER_CAPS.free;
        if (!caps.customize) return alert('Siaran Pesan khusus paket berbayar.');

        const text = document.getElementById('broadcastText').value.trim();
        if (!text) return alert('Isi pesan tidak boleh kosong.');
        if (!confirm('Kirim pesan ini ke semua grup yang diikuti bot? Aksi ini tidak bisa dibatalkan.')) return;

        const btn = e.target; const orig = btn.innerText;
        btn.innerText = 'Mengirim...'; btn.disabled = true;
        try {
            const res = await fetch('/api/bot/broadcast', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: activeBotNumber, tier: currentUser.tier, message: text })
            });
            const result = await res.json();
            alert(result.message || (result.success ? 'Pesan terkirim.' : 'Gagal mengirim.'));
            if (result.success) document.getElementById('broadcastText').value = '';
        } catch (err) { alert('Gagal terhubung ke server.'); }
        finally { btn.innerText = orig; btn.disabled = false; }
    });

    // ==========================================
    // PERINTAH KUSTOM
    // ==========================================
    function renderCustomCommands() {
        const box = document.getElementById('cmdList');
        const counter = document.getElementById('cmdCount');
        if (!box) return;

        const quota = CUSTOMCMD_QUOTA[currentUser.tier] ?? 0;
        if (counter) counter.innerText = `${customCommands.length} / ${quota} perintah`;

        if (!customCommands.length) {
            box.innerHTML = `<p class="feed-empty">Belum ada perintah kustom.</p>`;
            return;
        }
        box.innerHTML = customCommands.map((c, i) => `
            <div class="order-history-item">
                <div style="min-width:0;">
                    <strong style="font-size:13px;"><code class="feed-cmd">.${escapeHtml(c.cmd)}</code></strong>
                    ${c.showInMenu === false ? '<span style="font-size:11px;color:var(--text-muted);"> &bull; disembunyikan dari menu</span>' : ''}
                    <p style="font-size:12px;color:var(--text-muted);margin-top:4px;white-space:pre-wrap;">${escapeHtml(c.response).slice(0, 120)}</p>
                    ${c.image ? `<p style="font-size:11px;color:var(--text-muted);margin-top:3px;"><i class="fa-regular fa-image"></i> dengan gambar</p>` : ''}
                </div>
                <button class="btn btn-delete btn-del-cmd" data-index="${i}" style="padding:6px 12px;font-size:12px;flex:none;">Hapus</button>
            </div>
        `).join('');
    }

    document.getElementById('btnAddCmd')?.addEventListener('click', () => {
        const quota = CUSTOMCMD_QUOTA[currentUser.tier] ?? 0;
        if (quota === 0) return alert('Perintah Kustom khusus paket Prime ke atas.');

        const cmd = document.getElementById('cmdName').value.trim().replace(/^[./!#]/, '').toLowerCase();
        const response = document.getElementById('cmdResponse').value.trim();
        if (!cmd || !response) return alert('Nama perintah dan balasan wajib diisi.');

        // Perintah inti tidak boleh ditimpa, nanti bot tidak bisa dikendalikan.
        const dilindungi = ['menu', 'jadibot', 'owner', 'ping', 'stop', 'start', 'delete'];
        if (dilindungi.includes(cmd)) return alert(`Perintah ".${cmd}" dipakai sistem dan tidak bisa ditimpa.`);

        if (customCommands.length >= quota) return alert(`Paket kamu maksimal ${quota} perintah.`);
        if (customCommands.some(c => c.cmd === cmd)) return alert('Perintah itu sudah ada.');

        const caps = TIER_CAPS[currentUser.tier] || TIER_CAPS.free;
        customCommands.push({
            cmd, response,
            image: caps.menuImage ? (document.getElementById('cmdImage')?.value.trim() || '') : '',
            showInMenu: document.getElementById('cmdShowMenu').checked
        });

        document.getElementById('cmdName').value = '';
        document.getElementById('cmdResponse').value = '';
        if (document.getElementById('cmdImage')) document.getElementById('cmdImage').value = '';
        renderCustomCommands();
    });

    document.getElementById('cmdList')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-del-cmd');
        if (!btn) return;
        customCommands.splice(parseInt(btn.dataset.index), 1);
        renderCustomCommands();
    });

    document.getElementById('btnSaveCmd')?.addEventListener('click', async (e) => {
        if (!activeBotNumber) return alert('Jalankan bot (Start) terlebih dahulu.');
        const btn = e.target; const orig = btn.innerText;
        btn.innerText = 'Menyimpan...'; btn.disabled = true;
        try {
            const res = await fetch('/api/bot/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    number: activeBotNumber, userId: currentUser.id,
                    tier: currentUser.tier, customCommands
                })
            });
            const result = await res.json();
            alert(result.message || (result.success ? 'Perintah kustom disimpan.' : 'Gagal menyimpan.'));
        } catch (err) { alert('Gagal terhubung ke server.'); }
        finally { btn.innerText = orig; btn.disabled = false; }
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
            document.getElementById('refCode').innerText = d.code;
            document.getElementById('refCredit').innerText = rupiah(d.credit);
            document.getElementById('refCount').innerText = d.totalReferral;
            document.getElementById('refDiscPct').innerText = d.discountPercent;
            document.getElementById('refRewardPct').innerText = d.rewardPercent;

            // Kotak "punya kode dari teman" disembunyikan kalau sudah tidak
            // relevan — kode hanya bisa dipakai sekali, sebelum transaksi pertama.
            const claimBox = document.getElementById('refClaimBox');
            if (claimBox && currentUser.referredBy) claimBox.style.display = 'none';

            const box = document.getElementById('refHistory');
            if (!d.riwayat.length) {
                box.innerHTML = `<p class="feed-empty">Belum ada teman yang bergabung.</p>`;
            } else {
                box.innerHTML = d.riwayat.map(r => `
                    <div class="order-history-item">
                        <div>
                            <strong style="font-size:13px;">Teman bergabung</strong>
                            <p style="font-size:11px;color:var(--text-muted);margin-top:3px;">
                                ${new Date(r.at).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' })}
                            </p>
                        </div>
                        <strong style="color:var(--success);font-size:13px;">+${rupiah(r.kredit)}</strong>
                    </div>`).join('');
            }
        } catch (err) {
            // Jangan gagal diam-diam. Sebelumnya error di sini ditelan, jadi
            // kode referral hanya menampilkan "—" tanpa petunjuk apa pun —
            // padahal penyebabnya bisa sekadar backend belum ter-deploy.
            console.error('Gagal memuat data referral:', err);
            const el = document.getElementById('refCode');
            if (el) el.innerText = 'Gagal dimuat';
        }
    }

    document.getElementById('btnCopyRef')?.addEventListener('click', async () => {
        if (!refLink) return;
        try {
            await navigator.clipboard.writeText(refLink);
            alert('Link referral disalin.');
        } catch { prompt('Salin link ini:', refLink); }
    });

    document.getElementById('btnShareRef')?.addEventListener('click', () => {
        if (!refLink) return;
        const teks = `Aku pakai JadiVaresa buat bikin bot WhatsApp. Daftar pakai link ini, kamu dapat potongan buat pembelian pertama:\n${refLink}`;
        // Web Share API kalau ada (lebih natural di HP), kalau tidak ke WhatsApp.
        if (navigator.share) {
            navigator.share({ title: 'JadiVaresa', text: teks }).catch(() => {});
        } else {
            window.open(`https://wa.me/?text=${encodeURIComponent(teks)}`, '_blank');
        }
    });

    document.getElementById('btnClaimRef')?.addEventListener('click', async (e) => {
        const kode = document.getElementById('refClaimInput').value.trim();
        const msg = document.getElementById('refClaimMsg');
        if (!kode) return;

        const btn = e.target; const orig = btn.innerText;
        btn.innerText = '...'; btn.disabled = true;
        try {
            const res = await fetch('/api/referral/claim', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: currentUser.id, code: kode })
            });
            const d = await res.json();
            msg.innerText = d.message;
            msg.style.color = d.success ? '#34d399' : '#f87171';
            if (d.success) {
                currentUser.referredBy = 'ok';
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                document.getElementById('refClaimBox').style.display = 'none';
            }
        } catch (err) {
            msg.innerText = 'Gagal terhubung ke server.'; msg.style.color = '#f87171';
        } finally { btn.innerText = orig; btn.disabled = false; }
    });

    // ==========================================
    // BACKUP & RESTORE SETELAN
    // ==========================================
    document.getElementById('btnBackup')?.addEventListener('click', async () => {
        if (!activeBotNumber) return alert('Jalankan bot (Start) terlebih dahulu.');
        try {
            const res = await fetch(`/api/bot/backup/${encodeURIComponent(activeBotNumber)}?userId=${encodeURIComponent(currentUser.id)}`);
            const d = await res.json();
            if (!d.success) return alert(d.message || 'Gagal membuat cadangan.');

            const blob = new Blob([JSON.stringify(d.backup, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `jadivaresa-backup-${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (err) { alert('Gagal terhubung ke server.'); }
    });

    document.getElementById('btnRestore')?.addEventListener('click', () => {
        if (!activeBotNumber) return alert('Jalankan bot (Start) terlebih dahulu.');
        document.getElementById('restoreFile').click();
    });

    document.getElementById('restoreFile')?.addEventListener('change', async (e) => {
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
            alert(d.message || (d.success ? 'Berhasil dipulihkan.' : 'Gagal memulihkan.'));
            if (d.success) loadBotConfig();
        } catch (err) {
            alert('File tidak bisa dibaca. Pastikan itu file cadangan JadiVaresa.');
        } finally { e.target.value = ''; }
    });

    // --- SSE TERMINAL LOGS & STATISTIK LANGSUNG ---
    // Nomor bot dikirim sebagai query supaya server hanya mengirimkan event
    // milik bot ini. Sebelumnya semua client menerima semua event, termasuk
    // pairing code milik orang lain.
    let sse = null;
    const terminalLogs = document.getElementById('terminalLogs');

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
            setTimeout(() => { if (document.visibilityState === 'visible') connectSSE(); }, wait);
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

    function bindSSE(src) {
    src.addEventListener('server_stats', (e) => {
        const stats = JSON.parse(e.data);
        const statServer = document.getElementById('statServer');
        if (statServer) statServer.innerText = `${stats.ram}% RAM | ${stats.cpu}% CPU`;
    });

    src.addEventListener('bot_stats', (e) => {
        try { renderBotStats(JSON.parse(e.data)); } catch (err) {}
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
        const data = JSON.parse(e.data);
        if (data.code) {
            notify('Pairing code siap', `Kode: ${data.code} — masukkan di WhatsApp sebelum kedaluwarsa.`,
                   { tag: 'jv-pair', url: '/dashboard' });
        }
        if (activeBotNumber && !data.number.includes(activeBotNumber)) return;
        document.getElementById('statStatus').innerText = 'Pairing...';
        document.getElementById('statStatus').style.color = '#eab308';
        document.getElementById('termHeaderTitle').innerHTML = `varesa.mom@bot... &nbsp; <span style="color: #eab308;">● connecting</span>`;
        if (terminalLogs) {
            terminalLogs.innerHTML += `
                <div class="log-line" style="color: #34d399;">$ Pairing Code generated successfully.</div>
                <div class="log-line" style="margin-top: 15px; color: var(--text-muted);">Your pairing code is:</div>
                <div class="pairing-box" onclick="navigator.clipboard.writeText('${data.code}'); alert('Kode ${data.code} disalin!');">
                    <div class="pairing-code">${data.code}</div>
                    <div class="pairing-hint">&larr; click to copy</div>
                </div>
                <div class="log-line" style="color: var(--text-muted);">Enter this code in your WhatsApp Linked Devices screen.</div>
            `;
            terminalLogs.scrollTop = terminalLogs.scrollHeight;
        }
    });

    src.addEventListener('bot_log', (e) => {
        const data = JSON.parse(e.data);
        if (!terminalLogs) return;

        // Lapis pertahanan kedua: walau server sudah menyaring per nomor,
        // terminal tetap menolak log yang bukan milik bot yang sedang dibuka.
        if (activeBotNumber && data.number && String(data.number) !== String(activeBotNumber)) return;

        // Kabari user untuk kejadian yang benar-benar penting saja.
        // Terlalu sering memberi notifikasi membuat orang mematikannya.
        if (data.message.includes('Connected')) {
            notify('Bot tersambung', `Bot ${data.number || ''} sudah online.`, { tag: 'jv-conn' });
        } else if (/Connection Closed|dihentikan|Gagal menyambung|BLOCKED/i.test(data.message)) {
            notify('Bot terputus', data.message.slice(0, 120), { tag: 'jv-conn', url: '/dashboard' });
        }

        if (data.message.includes('Connected')) {
            document.getElementById('statStatus').innerText = 'Online';
            document.getElementById('statStatus').style.color = '#10b981';
            document.getElementById('termHeaderTitle').innerHTML = `varesa.mom@bot... &nbsp; <span style="color: #10b981;"><span class="status-live-dot"></span>connected</span>`;
            terminalLogs.innerHTML += `<div class="log-line" style="color: #34d399; font-weight: bold;">$ ${data.message}</div>`;
        } else if (data.message.includes('Closed') || data.message.includes('dihentikan')) {
            document.getElementById('statStatus').innerText = 'Offline';
            document.getElementById('statStatus').style.color = '#f87171';
            document.getElementById('termHeaderTitle').innerHTML = `varesa.mom@bot... &nbsp; <span style="color: #f87171;">● disconnected</span>`;
            terminalLogs.innerHTML += `<div class="log-line" style="color: #fbbf24;">$ ${data.message}</div>`;
        } else if (data.message.includes('BLOCKED') || data.message.includes('KICK')) {
            terminalLogs.innerHTML += `<div class="log-line" style="color: #ef4444; font-weight: bold;">$ ${data.message}</div>`;
        } else {
            terminalLogs.innerHTML += `<div class="log-line" style="color: #60a5fa;">$ ${data.message}</div>`;
        }
        terminalLogs.scrollTop = terminalLogs.scrollHeight;
    });
    }

    connectSSE();
});