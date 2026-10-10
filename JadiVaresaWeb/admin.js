/* ==========================================================================
   Varesa — Konsol Admin (admin.js)
   --------------------------------------------------------------------------
   Satu file untuk seluruh panel admin: penjaga akses, data user/bot/invoice,
   harga & promo, banner situs, kapasitas server, dan monitor live.

   Catatan penting:
   - Semua request ke /api/admin/* WAJIB membawa header `x-user-id`. Server
     memeriksa ulang role admin dari database (requireAdmin) — localStorage
     hanya dipakai untuk menentukan halaman mana yang ditampilkan.
   - Semua data dari server di-escape sebelum masuk innerHTML. Username,
     email, dan judul banner diisi user/admin lain; tanpa escape, satu
     username berisi <img onerror=...> sudah cukup untuk membajak sesi admin.
   - Tidak ada alert()/confirm() kecuali untuk penjaga akses: dialog bawaan
     browser memblokir halaman (polling ikut berhenti) dan tidak bisa
     ditata. Konfirmasi memakai modal #askModal.
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------
     Utilitas kecil
     ------------------------------------------------------------------ */
  const TIER_LABEL = { free: 'Free', basic: 'Core', plus: 'Prime', booster: 'Zenith' };
  const TIERS = ['free', 'basic', 'plus', 'booster'];
  const $ = (id) => document.getElementById(id);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const fmt = (n) => Math.round(num(n)).toLocaleString('id-ID');
  const fmt1 = (n, d = 1) => num(n).toLocaleString('id-ID', { maximumFractionDigits: d });
  const rupiah = (n) => 'Rp ' + num(n).toLocaleString('id-ID');
  const compact = (n) => new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(num(n));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const tierName = (t) => TIER_LABEL[t] || String(t || '-');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }
  function setMeter(el, percent) {
    if (typeof el === 'string') el = $(el);
    if (!el) return;
    const p = clamp(num(percent), 0, 100);
    el.style.setProperty('--v', p + '%');
    el.classList.toggle('is-warn', p >= 75 && p < 90);
    el.classList.toggle('is-danger', p >= 90);
  }
  function fmtMB(mb) {
    mb = num(mb);
    return mb >= 1024 ? `${fmt1(mb / 1024, 1)} GB` : `${fmt(mb)} MB`;
  }
  function fmtUptime(sec) {
    sec = Math.max(0, Math.floor(num(sec)));
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return `${d}h ${h}j`;
    if (h) return `${h}j ${m}m`;
    return `${m}m`;
  }
  function timeAgo(ts) {
    if (!ts) return '–';
    const t = typeof ts === 'number' ? ts : Date.parse(ts);
    if (!Number.isFinite(t)) return '–';
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 10) return 'baru saja';
    if (s < 60) return `${s} dtk lalu`;
    if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
    if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)} hari lalu`;
    return new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function clock(ts) {
    const d = new Date(ts);
    return isNaN(d) ? '--:--:--' : d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\./g, ':');
  }
  const DAY_MS = 86400000;
  const shortDate = (ts) => new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

  // Sisa hari dari tanggal ISO (dibulatkan ke atas, sama dengan daysLeftOf()
  // di server). Baris bot sudah membawa daysLeft; baris user hanya tanggal.
  function daysLeftOf(iso) {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    return Number.isNaN(ms) ? null : Math.max(0, Math.ceil(ms / DAY_MS));
  }

  // Ringkasan masa aktif satu paket untuk kartu bot, tabel user, dan dialog
  // ubah paket. Paket berbayar tanpa tanggal = diatur admin (permanen).
  function expiryInfo(tier, iso, daysLeft) {
    if (!tier || tier === 'free') return { date: 'Tidak ada', sub: 'paket gratis', soon: false, none: true };
    if (!iso) return { date: 'Permanen', sub: 'diatur admin', soon: false, forever: true };
    if (Number.isNaN(new Date(iso).getTime())) return { date: '–', sub: '', soon: false };
    const left = daysLeft ?? daysLeftOf(iso);
    return { date: shortDate(iso), sub: left > 0 ? `${fmt(left)} hari lagi` : 'habis hari ini', soon: left <= 3, left };
  }

  function fmtDate(ts, withTime = false) {
    const d = new Date(ts);
    if (isNaN(d)) return '–';
    const opt = { day: 'numeric', month: 'short', year: 'numeric' };
    if (withTime) Object.assign(opt, { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString('id-ID', opt);
  }

  /* ------------------------------------------------------------------
     Penjaga akses — kunci localStorage SAMA dengan login.html/app.js
     ------------------------------------------------------------------ */
  let admin = null;
  try { admin = JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch { admin = null; }
  if (!admin) { window.location.href = '/login'; return; }
  if (admin.role !== 'admin') {
    alert('Akses Ditolak! Halaman ini khusus Admin.');
    window.location.href = '/dashboard';
    return;
  }

  /* ------------------------------------------------------------------
     Toast & dialog
     ------------------------------------------------------------------ */
  function toast(message, type = 'ok', ms = 4200) {
    const wrap = $('toastWrap');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'v-toast' + (type === 'ok' || type === 'err' ? ` v-toast--${type}` : '');
    el.setAttribute('role', type === 'err' ? 'alert' : 'status');
    const icon = type === 'err' ? 'fa-circle-exclamation' : type === 'info' ? 'fa-circle-info' : 'fa-circle-check';
    el.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
    el.querySelector('span').textContent = message;
    wrap.appendChild(el);
    // Jangan sampai toast menumpuk menutupi layar HP.
    while (wrap.children.length > 4) wrap.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 300);
    }, ms);
  }

  const openModals = [];
  function openModal(el, focusEl) {
    if (!el || openModals.includes(el)) return;
    el._returnFocus = document.activeElement;
    el.hidden = false;
    openModals.push(el);
    document.body.classList.add('no-scroll');
    requestAnimationFrame(() => {
      el.classList.add('is-open');
      const f = focusEl || el.querySelector('input:not([type=hidden]):not([hidden]), .modal__foot .v-btn--primary');
      try { f?.focus({ preventScroll: true }); } catch { /* abaikan */ }
    });
  }
  function closeModal(el) {
    const i = openModals.indexOf(el);
    if (i === -1) return;
    openModals.splice(i, 1);
    el.classList.remove('is-open');
    setTimeout(() => { if (!openModals.includes(el)) el.hidden = true; }, 220);
    if (!openModals.length && !$('sideMenu').classList.contains('is-open')) document.body.classList.remove('no-scroll');
    try { el._returnFocus?.focus({ preventScroll: true }); } catch { /* abaikan */ }
    el.dispatchEvent(new CustomEvent('modal:close'));
  }
  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close]');
    if (closer) { closeModal(closer.closest('.modal')); return; }
    // Klik di latar gelap (di luar kotak) = tutup.
    if (e.target.classList?.contains('modal')) closeModal(e.target);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (openModals.length) { closeModal(openModals[openModals.length - 1]); return; }
    if ($('sideMenu').classList.contains('is-open')) closeSide();
  });

  /**
   * Pengganti confirm()/prompt(). Hasil: true (konfirmasi), string (isian),
   * atau null kalau dibatalkan.
   */
  let askResolve = null;
  function ask({ title = 'Yakin?', body = '', ok = 'Lanjutkan', danger = false, input = null } = {}) {
    const modal = $('askModal');
    if (askResolve) { askResolve(null); askResolve = null; }
    setText('askTitle', title);
    setText('askBody', body);
    $('askIcon').classList.toggle('is-danger', !!danger);
    const okBtn = $('askOk');
    okBtn.textContent = ok;
    okBtn.className = 'v-btn ' + (danger ? 'v-btn--danger' : 'v-btn--primary');
    const field = $('askField'), inp = $('askInput');
    field.hidden = !input;
    if (input) {
      setText('askLabel', input.label || 'Isian');
      inp.value = input.value || '';
      inp.placeholder = input.placeholder || '';
      inp.inputMode = input.inputMode || 'text';
    }
    return new Promise((resolve) => {
      askResolve = resolve;
      openModal(modal, input ? inp : okBtn);
    });
  }
  function askDone(value) {
    const r = askResolve;
    askResolve = null;
    closeModal($('askModal'));
    r?.(value);
  }
  $('askOk').addEventListener('click', () => askDone($('askField').hidden ? true : $('askInput').value));
  $('askInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('askOk').click(); } });
  $('askModal').addEventListener('modal:close', () => { if (askResolve) { const r = askResolve; askResolve = null; r(null); } });

  /* ------------------------------------------------------------------
     Request ke server
     ------------------------------------------------------------------ */
  let sessionGone = false;
  // Role admin dicabut / user dihapus: jangan biarkan panel terus menembak
  // request yang pasti ditolak. Sama seperti versi lama: kabari lalu ke /login.
  function sessionInvalid() {
    if (sessionGone) return;
    sessionGone = true;
    stopLive();
    alert('Sesi admin tidak valid. Silakan login ulang.');
    window.location.href = '/login';
  }

  function adminHeaders(json = true) {
    const h = { 'x-user-id': admin?.id || '' };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async function api(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: adminHeaders(body !== undefined),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      const err = new Error('Gagal terhubung ke server.');
      err.network = true;
      throw err;
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    // 401/403 dari /api/admin/* = bukan admin lagi. 403 dari endpoint bot
    // (/api/bot/stop, /api/bot/delete) artinya lain ("bukan milik kamu"),
    // jadi cukup ditampilkan pesannya.
    if ((res.status === 401 || res.status === 403) && path.startsWith('/api/admin/')) {
      const err = new Error((data && data.message) || 'Sesi admin tidak valid.');
      err.auth = true;
      sessionInvalid();
      throw err;
    }
    if (!res.ok || !data || data.success === false) {
      const err = new Error((data && data.message) || `Server menjawab ${res.status}.`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // Tombol jadi "sibuk" selama request berjalan supaya tidak terkirim dua kali.
  async function busy(btn, label, fn) {
    if (!btn) return fn();
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${esc(label)}`;
    try { return await fn(); }
    finally { btn.disabled = false; btn.innerHTML = orig; }
  }

  /* ------------------------------------------------------------------
     Navigasi: sidebar/drawer + view berdasarkan hash (#monitor, #site, …)
     ------------------------------------------------------------------ */
  const VIEWS = qsa('.view').map((v) => v.id.replace('view-', ''));
  let currentView = '';

  function openSide() {
    $('sideMenu').classList.add('is-open');
    $('btnMenu').setAttribute('aria-expanded', 'true');
    document.body.classList.add('no-scroll');
  }
  function closeSide() {
    const side = $('sideMenu');
    if (!side.classList.contains('is-open')) return;
    side.classList.remove('is-open');
    $('btnMenu').setAttribute('aria-expanded', 'false');
    if (!openModals.length) document.body.classList.remove('no-scroll');
  }
  $('btnMenu').addEventListener('click', openSide);
  $('btnSideClose').addEventListener('click', closeSide);
  $('sideMenu').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeSide(); });

  function showView(name, { scroll = true } = {}) {
    if (!VIEWS.includes(name)) name = 'overview';
    const changed = name !== currentView;
    currentView = name;
    qsa('.view').forEach((v) => v.classList.toggle('is-active', v.id === 'view-' + name));
    qsa('.side__item').forEach((b) => {
      const on = b.dataset.view === name;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const sec = $('view-' + name);
    setText('viewTitle', sec.dataset.title || '');
    setText('viewEyebrow', sec.dataset.group || 'Konsol admin');
    document.title = `${sec.dataset.title || 'Konsol'} · Admin Varesa`;
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    closeSide();
    if (changed && scroll) window.scrollTo({ top: 0, behavior: 'auto' });
    onEnterView(name);
  }

  function onEnterView(name) {
    if (name === 'audit') loadAuditLog();
    if (name === 'site' || name === 'capacity') ensureSiteSettings();
    if (name === 'monitor' && live.data) renderMonitor(live.data, { charts: true });
    if (name === 'capacity' && live.data) renderCapacity(live.data);
    if (name === 'site') stage.restart(); else stage.stop();
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-view]');
    if (!t || t.closest('.modal')) return;
    e.preventDefault();
    showView(t.dataset.view);
  });
  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

  // Identitas admin di top bar.
  setText('whoName', admin.username || 'Admin');
  setText('whoAvatar', String(admin.username || 'A').trim().charAt(0).toUpperCase() || 'A');
  setText('helloName', admin.username || 'admin');

  /* ------------------------------------------------------------------
     Segmented control (filter) — dipakai beberapa tabel
     ------------------------------------------------------------------ */
  function bindSeg(id, key, onChange) {
    const seg = $(id);
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('.seg__btn');
      if (!b) return;
      qsa('.seg__btn', seg).forEach((x) => x.classList.toggle('is-active', x === b));
      onChange(b.dataset[key] || '');
    });
  }

  /* ==================================================================
     DATA UTAMA (/api/admin/dashboard)
     ================================================================== */
  const state = { users: [], orders: [], promos: [], revenue: 0, activeSessions: 0, pricing: null };

  async function loadAdminData() {
    try {
      const result = await api('/api/admin/dashboard');
      const d = result.data || {};
      state.users = Array.isArray(d.users) ? d.users : [];
      state.orders = Array.isArray(d.orders) ? d.orders : [];
      state.promos = Array.isArray(d.promos) ? d.promos : [];
      state.revenue = num(d.revenue);
      state.activeSessions = num(d.activeSessionsCount);
      if (d.pricing) state.pricing = d.pricing;

      setText('admTotalUser', fmt(state.users.length));
      setText('admActiveBot', fmt(state.activeSessions));
      if (d.bots) renderBotsTable(d.bots);
      renderOrdersTable();
      renderUsers();
      renderPricing(d.pricing);
      renderPromos();
      renderOverview();
    } catch (err) {
      if (err.auth) return;
      // Jangan gagal diam-diam: tampilkan sebabnya di tabel supaya langsung kelihatan.
      console.warn('Gagal load data admin:', err);
      $('adminTableBody').innerHTML = `<tr><td colspan="6" class="td-empty is-err"><i class="fa-solid fa-triangle-exclamation"></i>Gagal memuat data admin.<br><small>${esc(err.message)}</small></td></tr>`;
      toast('Gagal memuat data admin: ' + err.message, 'err');
    }
  }

  /* ---------------- Ikhtisar ---------------- */
  function renderOverview() {
    const users = state.users;
    const paid = users.filter((u) => topTierOf(u) !== 'free').length;
    setText('ovUsers', fmt(users.length));
    setText('ovUsersSub', `${fmt(paid)} punya bot berbayar`);
    setText('ovRevenue', rupiah(state.revenue));
    setText('ovPending', fmt(state.orders.filter((o) => o.status === 'pending').length));
    if (!live.data) setText('ovBots', fmt(state.activeSessions));

    // Sebaran paket dihitung per BOT: paket sekarang melekat di bot, satu
    // akun bisa punya beberapa bot dengan paket berbeda.
    const counts = { free: 0, basic: 0, plus: 0, booster: 0 };
    botList.forEach((b) => { const t = b.tier || 'free'; counts[t] = (counts[t] || 0) + 1; });
    const total = botList.length || 1;
    setText('ovDistNote', `Dari ${fmt(botList.length)} bot terdaftar — paket dihitung per bot.`);
    $('ovDist').innerHTML = TIERS.map((t) => `
      <div class="dist__row" data-t="${t}">
        <span>${tierName(t)}</span>
        <div class="dist__bar"><i style="--v:${((counts[t] / total) * 100).toFixed(1)}%"></i></div>
        <span class="dist__n">${fmt(counts[t])}</span>
      </div>`).join('');

    // Invoice terbaru
    const recent = state.orders.slice(0, 5);
    $('ovOrders').innerHTML = recent.length
      ? recent.map((o) => `
        <div class="recent__row">
          <span>${esc(o.username || '-')} · ${esc(orderPackage(o).name)}</span>
          <b>${rupiah(o.totalPayment || o.amount)}</b>
          <small>${esc(o.orderId)} · ${esc(timeAgo(o.createdAt))}</small>
          <small style="text-align:right">${orderBadge(o.status)}</small>
        </div>`).join('')
      : '<p class="recent__empty">Belum ada transaksi.</p>';
  }

  /* ---------------- Pengguna ---------------- */
  const userFilter = { q: '', tier: '' };

  // Paket di baris user hanya RINGKASAN (paket tertinggi yang aktif di
  // antara bot-botnya). Server lama belum mengirim topTier/botsCount, jadi
  // ada cadangan ke field lama.
  const topTierOf = (u) => u.topTier || u.tier || 'free';
  const userBots = (u) => (Array.isArray(u.botNumbers) ? u.botNumbers : []);
  const botsCountOf = (u) => (u.botsCount !== undefined && Number.isFinite(Number(u.botsCount)) ? Number(u.botsCount) : userBots(u).length);

  function pkgCell(u) {
    const tier = topTierOf(u);
    const badge = `<span class="tier tier--${esc(tier)}">${esc(tierName(tier))}</span>`;
    if (tier === 'free') return `<span class="cell-pkg">${badge}</span>`;
    const e = expiryInfo(tier, u.tierExpiredAt);
    const sub = e.forever ? 'permanen' : `s/d ${e.date} · ${e.sub}`;
    return `<span class="cell-pkg">${badge}<small class="${e.soon ? 'is-err' : ''}">${esc(sub)}</small></span>`;
  }

  function botsCell(u) {
    const list = userBots(u);
    const n = botsCountOf(u);
    const pend = u.pending && u.pending.tier
      ? `<small class="cell-pending" title="Dipasang otomatis ke bot berikutnya yang ditambahkan user"><i class="fa-regular fa-clock"></i> tertunda: ${esc(u.pending.tierName || tierName(u.pending.tier))}${u.pending.daysLeft != null ? ` · ${fmt(u.pending.daysLeft)} hr` : ''}</small>`
      : '';
    if (!n) return `<span class="cell-bots"><span class="muted">belum ada</span>${pend}</span>`;
    const first = list[0] ? `<small class="cell-mono">${esc(list[0])}${list.length > 1 ? ` <span class="muted">+${list.length - 1}</span>` : ''}</small>` : '';
    return `<span class="cell-bots"><b>${fmt(n)} bot</b>${first}${pend}</span>`;
  }

  function userMatches(u) {
    const f = userFilter;
    const tier = topTierOf(u);
    if (f.tier === 'free' && tier !== 'free') return false;
    if (f.tier === 'paid' && tier === 'free') return false;
    if (f.tier === 'admin' && u.role !== 'admin') return false;
    if (!f.q) return true;
    const hay = [u.username, u.email, u.id, ...(u.botNumbers || [])].join(' ').toLowerCase();
    return hay.includes(f.q);
  }

  function renderUsers() {
    const tbody = $('adminTableBody');
    const list = state.users.filter(userMatches);
    setText('userCount', `${fmt(list.length)} dari ${fmt(state.users.length)} akun`);
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="td-empty"><i class="fa-regular fa-face-meh"></i>${state.users.length ? 'Tidak ada user yang cocok dengan filter.' : 'Belum ada user.'}</td></tr>`;
      return;
    }
    const opts = TIERS.map((t) => `<option value="${t}">${tierName(t)}</option>`).join('');
    tbody.innerHTML = list.map((u) => {
      const role = u.role || 'user';
      const n = botsCountOf(u);
      const name = u.username || u.id || '';
      return `
        <tr>
          <td class="td-main"><span class="cell-user"><strong>${esc(u.username || '-')}</strong><span>${esc(u.email || u.id || '')}</span></span></td>
          <td data-label="Role"><span class="tier ${role === 'admin' ? 'role-admin' : ''}">${esc(role)}</span></td>
          <td data-label="Bot">${botsCell(u)}</td>
          <td data-label="Paket tertinggi">${pkgCell(u)}</td>
          <td data-label="Terapkan ke semua bot">
            <select class="v-select is-sm tier-select" data-user="${esc(u.id)}" data-name="${esc(name)}" data-bots="${n}" aria-label="Terapkan paket ke semua bot milik ${esc(name)}">
              <option value="" selected disabled>Pilih paket…</option>${opts}
            </select>
          </td>
          <td data-label="Aksi" class="right">
            ${n
              ? `<button type="button" class="v-btn v-btn--outline v-btn--sm" data-act="user-bots" data-user="${esc(u.id)}" data-name="${esc(name)}" title="Lihat & atur paket bot milik ${esc(name)}"><i class="fa-solid fa-robot"></i> Lihat bot</button>`
              : '<span class="muted">–</span>'}
          </td>
        </tr>`;
    }).join('');

    // Statistik ringkas di atas tabel. "Habis ≤ 3 hari" dihitung per bot di
    // renderBotsTable() karena masa aktif sekarang melekat di bot.
    const paid = state.users.filter((u) => topTierOf(u) !== 'free');
    const c = { basic: 0, plus: 0, booster: 0 };
    paid.forEach((u) => { const t = topTierOf(u); if (c[t] !== undefined) c[t]++; });
    setText('admPaidUser', fmt(paid.length));
    setText('admPaidSub', `${c.basic} Core · ${c.plus} Prime · ${c.booster} Zenith`);
  }

  $('userSearch').addEventListener('input', (e) => { userFilter.q = e.target.value.trim().toLowerCase(); renderUsers(); });
  bindSeg('userTierSeg', 'tier', (v) => { userFilter.tier = v; renderUsers(); });

  $('adminTableBody').addEventListener('change', (e) => {
    const sel = e.target.closest('select.tier-select');
    if (sel && sel.value) updateUserTier(sel.dataset.user, sel.value, sel.dataset.name, sel);
  });

  // KOMPATIBILITAS: endpoint lama per akun. Server memasang paket ke SEMUA
  // bot milik user (permanen) — atau jadi paket tertunda kalau user belum
  // punya bot. Untuk satu bot saja, admin memakai dialog "Ubah paket".
  async function updateUserTier(userId, newTier, name, sel) {
    const n = num(sel?.dataset.bots);
    const who = name || 'user ini';
    const label = tierName(newTier);
    let body;
    if (n) {
      body = `Paket ${label.toUpperCase()} akan dipasang ke SEMUA ${n} bot milik ${who}, permanen (tanpa tanggal habis). Masa aktif yang sedang berjalan di bot-botnya ikut diganti.\n\nCuma mau ubah satu bot? Pakai “Ubah paket” di Bot & Node.`;
    } else if (newTier === 'free') {
      body = `${who} belum punya bot. Paket tertunda miliknya (kalau ada) akan dikosongkan.`;
    } else {
      body = `${who} belum punya bot — paket ${label.toUpperCase()} disimpan sebagai paket tertunda dan otomatis dipasang ke bot pertama yang dia tambahkan.`;
    }
    const ok = await ask({
      title: n ? 'Terapkan ke semua bot?' : 'Simpan paket tertunda?',
      body,
      ok: n ? `Jadikan ${label} (${n} bot)` : (newTier === 'free' ? 'Kosongkan' : `Simpan ${label}`),
    });
    if (!ok) { if (sel) sel.value = ''; return; }
    try {
      const result = await api('/api/admin/update-tier', { method: 'POST', body: { userId, newTier } });
      toast(result.message || 'Paket diperbarui.');
    } catch (err) {
      if (!err.auth) toast(err.network ? 'Gagal terhubung ke server. Perubahan BELUM tersimpan.' : err.message, 'err');
    }
    loadAdminData();
    loadBotsData();
  }

  /* ---------------- Bot & node ---------------- */
  const BOTS_PER_PAGE = 12;
  let botList = [];
  let botPage = 0;
  // owner = id akun (filter dari tombol "Lihat bot" di tabel user).
  const botFilter = { q: '', state: '', owner: '' };
  // Kartu yang baru diubah paketnya diberi sorotan sebentar.
  const flashBot = { number: '', at: 0 };

  function renderBotsTable(bots) {
    botList = Array.isArray(bots) ? bots : [];
    const online = botList.filter((b) => b.isOnline).length;
    const paid = botList.filter((b) => (b.tier || 'free') !== 'free');
    const c = { basic: 0, plus: 0, booster: 0 };
    paid.forEach((b) => { if (c[b.tier] !== undefined) c[b.tier]++; });
    const owners = new Set(botList.map((b) => b.ownerId).filter(Boolean)).size;
    setText('botOnlineCount', fmt(online));
    setText('botOnlineSub', `${fmt(botList.length - online)} offline`);
    setText('botTotalCount', fmt(botList.length));
    setText('botOwnerSub', owners ? `milik ${fmt(owners)} akun` : 'semua status');
    setText('botPaidCount', fmt(paid.length));
    setText('botPaidSub', `${c.basic} Core · ${c.plus} Prime · ${c.booster} Zenith`);
    setText('botFreeCount', fmt(botList.length - paid.length));

    // Pengingat perpanjangan dihitung per bot (masa aktif melekat di bot).
    const soon = paid.filter((b) => {
      if (!b.tierExpiredAt) return false;
      const d = b.daysLeft ?? daysLeftOf(b.tierExpiredAt);
      return d !== null && d > 0 && d <= 3;
    }).length;
    setText('admExpiring', fmt(soon));
    setText('admExpiringSub', soon ? 'ingatkan pemiliknya' : 'aman untuk 3 hari ke depan');
    renderBotPage();
  }

  function filteredBots() {
    const { q, state: st, owner } = botFilter;
    return botList.filter((b) => {
      if (st === 'on' && !b.isOnline) return false;
      if (st === 'off' && b.isOnline) return false;
      if (owner && b.ownerId !== owner) return false;
      if (!q) return true;
      return [b.number, b.ownerNumber, b.label, b.ownerName, tierName(b.tier || 'free')].join(' ').toLowerCase().includes(q);
    });
  }

  function setOwnerFilter(id, name) {
    botFilter.owner = id || '';
    $('botOwnerChip').hidden = !botFilter.owner;
    setText('botOwnerName', name || id || '');
    botPage = 0;
    renderBotPage();
  }
  $('botOwnerChip').addEventListener('click', () => setOwnerFilter(''));

  function renderBotPage() {
    const board = $('botBoard');
    const pager = $('botPager');
    const list = filteredBots();

    if (!list.length) {
      const why = !botList.length ? 'Belum ada bot yang pernah dibuat.'
        : botFilter.owner && !botFilter.q && !botFilter.state ? 'Akun ini belum punya bot terdaftar.'
          : 'Tidak ada bot yang cocok dengan filter.';
      board.innerHTML = `<p class="board-empty"><i class="fa-solid fa-robot"></i>${why}</p>`;
      pager.hidden = true;
      return;
    }

    // Jaga halaman tetap valid kalau jumlah bot berkurang saat refresh.
    const totalPages = Math.ceil(list.length / BOTS_PER_PAGE);
    if (botPage > totalPages - 1) botPage = totalPages - 1;
    const slice = list.slice(botPage * BOTS_PER_PAGE, botPage * BOTS_PER_PAGE + BOTS_PER_PAGE);
    const perBot = new Map((live.data?.perBot || []).map((p) => [String(p.number), p]));

    board.innerHTML = slice.map((b) => {
      const tier = b.tier || 'free';
      const on = !!b.isOnline;
      const st = perBot.get(String(b.number));
      const canStop = on || (b.status && b.status !== 'stop');
      const e = expiryInfo(tier, b.tierExpiredAt, b.daysLeft);
      const flash = flashBot.number === b.number && Date.now() - flashBot.at < 2500;
      const owner = b.ownerName
        ? `<button type="button" class="link-btn" data-act="owner-filter" data-user="${esc(b.ownerId)}" data-name="${esc(b.ownerName)}" title="Tampilkan semua bot milik ${esc(b.ownerName)}">${esc(b.ownerName)}</button>`
        : `<span class="muted">${b.ownerId ? 'akun terhapus' : 'tanpa akun'}</span>`;
      return `
        <article class="bot-card ${on ? 'is-on' : ''} ${flash ? 'is-flash' : ''}" data-number="${esc(b.number)}">
          <header class="bot-card__top">
            <span class="bot-state"><span class="v-dot ${on ? 'v-dot--live' : 'v-dot--off'}"></span>${on ? 'Online' : 'Offline'}</span>
            <span class="tier tier--${esc(tier)}">${esc(tierName(tier))}</span>
          </header>
          <div class="bot-id">
            <div class="bot-number">${esc(b.number)}</div>
            ${b.label ? `<div class="bot-label" title="Label dari pemilik">${esc(b.label)}</div>` : '<div class="bot-label is-empty">tanpa label</div>'}
          </div>
          <div class="bot-pkg ${e.soon ? 'is-soon' : ''} ${e.none ? 'is-free' : ''}">
            <div class="bot-pkg__txt"><span>Masa aktif</span><b>${esc(e.date)}</b><small>${esc(e.sub)}</small></div>
            <button type="button" class="v-btn v-btn--outline v-btn--sm" data-act="bot-tier" data-number="${esc(b.number)}" title="Ubah paket bot ${esc(b.number)}"><i class="fa-regular fa-gem"></i> Ubah paket</button>
          </div>
          <dl class="bot-meta">
            <div><dt>Akun</dt><dd>${owner}</dd></div>
            <div><dt>Owner WA</dt><dd>${b.ownerNumber ? esc(b.ownerNumber) : '<span class="muted">belum diatur</span>'}</dd></div>
            <div><dt>Status DB</dt><dd>${esc(b.status || '-')}</dd></div>
            ${st ? `<div><dt>Pesan · cmd</dt><dd>${fmt(st.messages)} · ${fmt(st.commands)}</dd></div>` : ''}
          </dl>
          <div class="bot-card__actions">
            <button type="button" class="v-btn v-btn--outline v-btn--sm" data-act="stop" data-number="${esc(b.number)}" ${canStop ? '' : 'disabled'} title="Putus koneksi, sesi tetap tersimpan"><i class="fa-solid fa-stop"></i> Hentikan</button>
            <button type="button" class="v-btn v-btn--danger v-btn--sm" data-act="force-delete" data-number="${esc(b.number)}" title="Hapus sesi & data bot"><i class="fa-solid fa-power-off"></i> Hapus</button>
          </div>
        </article>`;
    }).join('');

    pager.hidden = totalPages <= 1;
    setText('botPageInfo', `${botPage + 1} / ${totalPages}`);
    $('botPrev').disabled = botPage === 0;
    $('botNext').disabled = botPage >= totalPages - 1;
  }

  $('botPrev').addEventListener('click', () => { if (botPage > 0) { botPage--; renderBotPage(); } });
  $('botNext').addEventListener('click', () => {
    if (botPage < Math.ceil(filteredBots().length / BOTS_PER_PAGE) - 1) { botPage++; renderBotPage(); }
  });
  $('botSearch').addEventListener('input', (e) => { botFilter.q = e.target.value.trim().toLowerCase(); botPage = 0; renderBotPage(); });
  bindSeg('botStateSeg', 'state', (v) => { botFilter.state = v; botPage = 0; renderBotPage(); });

  let botsLoading = false;
  async function loadBotsData() {
    if (botsLoading || sessionGone) return;
    botsLoading = true;
    try {
      const result = await api('/api/admin/bots');
      renderBotsTable(result.data?.bots || []);
    } catch (err) {
      if (!err.auth) console.warn('Gagal load data bot:', err.message);
    } finally { botsLoading = false; }
  }

  $('btnBotsRefresh').addEventListener('click', (e) => busy(e.currentTarget, 'Memuat…', loadBotsData));

  $('btnSyncTiers').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const ok = await ask({
      title: 'Sinkronkan paket bot?',
      body: 'Samakan pemilik & paket di config setiap bot dengan data paket per bot di database, sekaligus memindahkan paket akun lama yang belum termigrasi ke bot pertamanya.\n\nAman dijalankan berulang kali.',
      ok: 'Sinkronkan',
    });
    if (!ok) return;
    await busy(btn, 'Menyinkronkan…', async () => {
      try {
        const result = await api('/api/admin/sync-tiers', { method: 'POST' });
        toast(result.message || 'Selesai.');
        loadBotsData();
      } catch (err) { if (!err.auth) toast(err.message, 'err'); }
    });
  });

  $('btnDeleteFree').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const jumlah = botList.filter((b) => (b.tier || 'free') === 'free').length;
    if (!jumlah) { toast('Tidak ada bot berpaket Free.', 'info'); return; }
    // Konfirmasi dua langkah: aksi ini tidak bisa dibatalkan dan memutus
    // WhatsApp user. Mengetik angka mencegah salah klik.
    const ketik = await ask({
      title: 'Hapus semua bot Free?',
      body: `${jumlah} bot berpaket Free akan dihapus PERMANEN dan sesi WhatsApp-nya diputus. Bot berbayar tidak ikut terhapus.`,
      ok: 'Hapus permanen',
      danger: true,
      input: { label: `Ketik ${jumlah} untuk melanjutkan`, placeholder: String(jumlah), inputMode: 'numeric' },
    });
    if (ketik === null) return;
    if (String(ketik).trim() !== String(jumlah)) { toast('Angka tidak cocok. Dibatalkan.', 'err'); return; }
    await busy(btn, 'Menghapus…', async () => {
      try {
        const result = await api('/api/admin/delete-free-bots', { method: 'POST' });
        toast(result.message || 'Selesai.');
        loadBotsData(); loadAdminData();
      } catch (err) { if (!err.auth) toast(err.message, 'err'); }
    });
  });

  $('btnForceDelete')?.addEventListener('click', () => forceDeleteBot(''));

  // Aksi per bot (kartu node & tabel user) lewat satu listener.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    if (b.dataset.act === 'force-delete') forceDeleteBot(b.dataset.number || '', b);
    if (b.dataset.act === 'stop') stopBot(b.dataset.number, b);
    if (b.dataset.act === 'bot-tier') openBotTier(b.dataset.number);
    if (b.dataset.act === 'owner-filter') setOwnerFilter(b.dataset.user, b.dataset.name);
    if (b.dataset.act === 'user-bots') {
      // Dari tabel user: buka Bot & Node dengan filter akun saja, supaya
      // pencarian/status lama tidak menyembunyikan bot miliknya.
      botFilter.q = ''; $('botSearch').value = '';
      botFilter.state = '';
      qsa('#botStateSeg .seg__btn').forEach((x) => x.classList.toggle('is-active', !x.dataset.state));
      setOwnerFilter(b.dataset.user, b.dataset.name);
      showView('bots');
    }
  });

  /* ---------------- Ubah paket SATU bot (/api/admin/bot-tier) ---------------- */
  const btModal = $('botTierModal');
  const bt = { bot: null };
  const btTier = () => btModal.querySelector('input[name="btTier"]:checked')?.value || 'free';
  const readDays = () => { const v = $('btDays').value.trim(); return v === '' ? NaN : Number(v); };
  const daysValid = (d) => Number.isInteger(d) && d >= 1 && d <= 3650;
  // Sisa hari paket berbayar yang sedang berjalan (null = Free / permanen).
  const btLeft = (b) => ((b.tier || 'free') !== 'free' && b.tierExpiredAt ? (b.daysLeft ?? daysLeftOf(b.tierExpiredAt)) : null);

  function openBotTier(number) {
    const b = botList.find((x) => x.number === number);
    if (!b) { toast('Bot tidak ada di daftar. Coba Refresh dulu.', 'err'); return; }
    bt.bot = b;
    const tier = b.tier || 'free';
    const e = expiryInfo(tier, b.tierExpiredAt, b.daysLeft);
    setText('btNumber', b.number);
    setText('btWho', [b.label, b.ownerName ? `milik ${b.ownerName}` : 'tanpa akun pemilik'].filter(Boolean).join(' · '));
    const badge = $('btNowBadge');
    badge.className = `tier tier--${tier}`;
    badge.textContent = tierName(tier);
    setText('btNowText', tier === 'free'
      ? 'Sekarang Free — belum ada paket berbayar di bot ini.'
      : e.forever ? `Sekarang ${tierName(tier)}, permanen (diatur admin).`
        : `Sekarang ${tierName(tier)}, berlaku s/d ${e.date} (${e.sub}).`);
    const pr = state.pricing || {};
    qsa('[data-price]', btModal).forEach((el) => {
      const t = el.dataset.price;
      el.textContent = t === 'free' ? 'gratis' : pr[t] ? rupiah(pr[t]) : '–';
    });
    // Mulai dari paket sekarang: kasus paling sering adalah perpanjang.
    btModal.querySelector(`input[name="btTier"][value="${TIERS.includes(tier) ? tier : 'free'}"]`).checked = true;
    $('btDays').value = 30;
    setText('btErr', '');
    updateBotTierPreview();
    openModal(btModal, btModal.querySelector('input[name="btTier"]:checked'));
  }

  function updateBotTierPreview() {
    const b = bt.bot;
    if (!b) return;
    const now = b.tier || 'free';
    const t = btTier();
    const left = btLeft(b);
    const free = t === 'free';
    const d = readDays();

    $('btDaysField').hidden = free;
    qsa('.bt-tier', btModal).forEach((l) => l.classList.toggle('is-on', l.dataset.t === t));
    const ext = $('btExtend');
    ext.hidden = !(left > 0 && t === now);
    if (left > 0) ext.textContent = `Sisa + 30 = ${fmt(Math.min(3650, left + 30))}`;
    qsa('.bt-chip[data-days]', btModal).forEach((c) => c.classList.toggle('is-on', Number(c.dataset.days) === d));
    ext.classList.toggle('is-on', left > 0 && d === Math.min(3650, left + 30));

    let val; let note; let same = false; let warn = false;
    if (free) {
      same = now === 'free';
      warn = !same;
      val = 'Free · tanpa masa aktif';
      note = same
        ? 'Bot ini sudah Free — tidak ada yang berubah.'
        : `Fitur berbayar bot ini langsung terkunci${left ? ` dan sisa ${fmt(left)} hari paket ${tierName(now)} hangus (tidak jadi paket tertunda)` : ''}.`;
    } else if (!daysValid(d)) {
      same = true;
      val = 'masa aktif tidak valid';
      note = 'Isi angka bulat 1–3650 hari.';
    } else {
      val = `${tierName(t)} s/d ${shortDate(Date.now() + d * DAY_MS)}`;
      if (t === now && left !== null) note = `${fmt(d)} hari dari sekarang — MENGGANTI sisa ${fmt(left)} hari, bukan ditambahkan.`;
      else if (t === now) note = `${fmt(d)} hari dari sekarang — paket permanen jadi punya tanggal habis.`;
      else note = `${fmt(d)} hari dari sekarang.${now !== 'free' ? ` Paket ${tierName(now)} diganti${left ? `, sisa ${fmt(left)} harinya hangus` : ''}.` : ''}`;
    }
    $('btPreview').className = 'preview-box' + (same ? ' is-same' : '') + (warn ? ' is-warn' : '');
    setText('btPreviewVal', val);
    setText('btPreviewNote', note);
    $('btSave').disabled = free && now === 'free';
    $('btSave').querySelector('span').textContent = free && now !== 'free' ? 'Jadikan Free' : 'Simpan paket';
  }

  btModal.addEventListener('change', (e) => {
    if (e.target.name !== 'btTier') return;
    setText('btErr', '');
    updateBotTierPreview();
  });
  $('btDays').addEventListener('input', () => { setText('btErr', ''); updateBotTierPreview(); });
  $('btDays').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('btSave').click(); } });
  $('btPresets').addEventListener('click', (e) => {
    const c = e.target.closest('.bt-chip');
    if (!c || !bt.bot) return;
    const d = c.id === 'btExtend' ? num(btLeft(bt.bot)) + 30 : Number(c.dataset.days);
    $('btDays').value = Math.min(3650, d);
    setText('btErr', '');
    updateBotTierPreview();
  });
  $('btSave').addEventListener('click', (e) => saveBotTier(e.currentTarget));

  async function saveBotTier(btn) {
    const b = bt.bot;
    if (!b || btn.disabled) return;
    const tier = btTier();
    // Free tidak punya masa aktif: server mengosongkan tanggalnya, jadi
    // `days` tidak dikirim sama sekali.
    const body = { number: b.number, tier };
    if (tier !== 'free') {
      const d = readDays();
      if (!daysValid(d)) { setText('btErr', 'Masa aktif harus angka bulat 1–3650 hari.'); $('btDays').focus(); return; }
      body.days = d;
    }
    await busy(btn, 'Menyimpan…', async () => {
      try {
        const result = await api('/api/admin/bot-tier', { method: 'POST', body });
        // Baris dari server tidak membawa status sesi & owner WA — gabung
        // dengan baris lama supaya kartu tidak kehilangan info itu.
        const i = botList.findIndex((x) => x.number === b.number);
        if (i !== -1 && result.bot) botList[i] = { ...botList[i], ...result.bot };
        flashBot.number = b.number;
        flashBot.at = Date.now();
        closeModal(btModal);
        renderBotsTable(botList);
        toast(result.message || `Paket bot ${b.number} diperbarui.`);
        loadAdminData(); // paket tertinggi user & sebaran paket ikut berubah
      } catch (err) {
        if (err.auth) return;
        setText('btErr', err.network ? 'Gagal terhubung ke server. Paket BELUM berubah.' : err.message);
      }
    });
  }

  async function stopBot(number, btn) {
    if (!number) return;
    const ok = await ask({
      title: 'Hentikan bot?',
      body: `Bot ${number} akan diputus dari WhatsApp. Sesinya tetap tersimpan, jadi pemilik bisa menyalakannya lagi dari dashboard tanpa scan ulang.`,
      ok: 'Hentikan',
    });
    if (!ok) return;
    await busy(btn, '…', async () => {
      try {
        const result = await api('/api/bot/stop', { method: 'POST', body: { number } });
        toast(result.message || `Bot ${number} dihentikan.`);
        loadBotsData();
      } catch (err) { toast(err.message || `Gagal menghentikan ${number}.`, 'err'); }
    });
  }

  async function forceDeleteBot(prefillNumber, btn) {
    let num = prefillNumber;
    if (!num) {
      const typed = await ask({
        title: 'Hapus paksa sesi bot',
        body: 'Masukkan nomor WA bot user yang ingin dihapus.',
        ok: 'Lanjut',
        input: { label: 'Nomor bot', placeholder: 'cth: 62812…', inputMode: 'numeric' },
      });
      num = String(typed || '').replace(/\D/g, '');
      if (!num) return;
    }
    const ok = await ask({
      title: 'Hapus paksa bot?',
      body: `Yakin MENGHAPUS PAKSA bot nomor ${num}?\n\nSesi WhatsApp diputus & dihapus, dan nomor dilepas dari akun pemiliknya.`,
      ok: 'Hapus sesi',
      danger: true,
    });
    if (!ok) return;
    await busy(btn, '…', async () => {
      try {
        // Hasil WAJIB dicek: dulu pesan "berhasil" selalu muncul walau server menolak.
        await api('/api/bot/delete', { method: 'POST', body: { number: num } });
        toast(`Sesi bot ${num} berhasil dihapus.`);
        loadAdminData(); loadBotsData();
      } catch (err) { toast(err.message || `Gagal menghapus sesi ${num}.`, 'err'); }
    });
  }

  /* ---------------- Invoice ---------------- */
  const orderFilter = { q: '', status: '' };
  const ORDER_BADGE = {
    completed: '<span class="v-badge v-badge--ok">Lunas</span>',
    pending: '<span class="v-badge v-badge--warn">Menunggu</span>',
    cancelled: '<span class="v-badge">Dibatalkan</span>',
    expired: '<span class="v-badge">Kedaluwarsa</span>',
  };
  const orderBadge = (s) => ORDER_BADGE[s] || `<span class="v-badge">${esc(s || '-')}</span>`;

  function orderPackage(o) {
    if (o.kind === 'addon') {
      return {
        name: o.addonType === 'mlbb_unlimited' ? 'Add-on Unlimited' : `Add-on ${o.addonType || ''}`.trim(),
        dur: `${num(o.addonDays)} hari`,
      };
    }
    return { name: tierName(o.tier), dur: `×${num(o.months) || 1} bln` };
  }

  function renderOrdersTable() {
    const orders = state.orders;
    setText('admRevenue', rupiah(state.revenue));
    setText('admPending', fmt(orders.filter((o) => o.status === 'pending').length));
    const paid = orders.filter((o) => o.status === 'completed');
    setText('admPaidCount', fmt(paid.length));
    setText('admPaidSum', `${rupiah(paid.reduce((a, o) => a + num(o.totalPayment || o.amount), 0))} dari 50 terakhir`);
    setText('admFailCount', fmt(orders.filter((o) => o.status === 'cancelled' || o.status === 'expired').length));

    const { q, status } = orderFilter;
    const list = orders.filter((o) => {
      if (status === 'failed' && !(o.status === 'cancelled' || o.status === 'expired')) return false;
      if (status && status !== 'failed' && o.status !== status) return false;
      if (!q) return true;
      return `${o.orderId} ${o.username || ''} ${o.email || ''} ${o.botNumber || ''}`.toLowerCase().includes(q);
    });
    setText('orderCount', `${fmt(list.length)} invoice`);

    const tbody = $('ordersTableBody');
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="td-empty"><i class="fa-regular fa-file-lines"></i>${orders.length ? 'Tidak ada invoice yang cocok.' : 'Belum ada transaksi.'}</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map((o) => {
      const pkg = orderPackage(o);
      return `
        <tr>
          <td class="td-main"><span class="cell-user"><a class="cell-mono" href="/invoice?order_id=${encodeURIComponent(o.orderId)}" target="_blank" rel="noopener">${esc(o.orderId)}</a><span>${esc(fmtDate(o.createdAt, true))}</span></span></td>
          <td data-label="User"><span class="cell-user"><strong>${esc(o.username || '-')}</strong><span>${esc(o.email || '')}</span></span></td>
          <td data-label="Paket"><span class="cell-order"><span>${esc(pkg.name)} <span class="muted">${esc(pkg.dur)}</span>${o.promoCode ? ` <span class="promo-code" style="font-size:11px">${esc(o.promoCode)}</span>` : ''}</span>${o.botNumber ? `<small title="Paket dibayar untuk bot ini">bot ${esc(o.botNumber)}</small>` : ''}</span></td>
          <td data-label="Total" class="right num">${rupiah(o.totalPayment || o.amount)}</td>
          <td data-label="Status">${orderBadge(o.status)}</td>
        </tr>`;
    }).join('');
  }

  $('orderSearch').addEventListener('input', (e) => { orderFilter.q = e.target.value.trim().toLowerCase(); renderOrdersTable(); });
  bindSeg('orderStatusSeg', 'status', (v) => { orderFilter.status = v; renderOrdersTable(); });

  /* ---------------- Harga & promo ---------------- */
  let priceDirty = false;
  const PRICE_IDS = { basic: 'priceBasic', plus: 'pricePlus', booster: 'priceBooster' };
  const PRICE_DEFAULT = { basic: 7500, plus: 15000, booster: 25000 };

  function renderPricing(p) {
    // Jangan timpa angka yang sedang diketik admin hanya karena data dimuat ulang.
    if (!p || priceDirty) return;
    for (const [k, id] of Object.entries(PRICE_IDS)) $(id).value = p[k] || PRICE_DEFAULT[k];
    setText('priceHint', 'Harga tersimpan dimuat dari server.');
  }
  Object.values(PRICE_IDS).forEach((id) => $(id).addEventListener('input', () => {
    priceDirty = true;
    setText('priceHint', 'Ada perubahan yang belum disimpan.');
  }));

  $('btnSavePricing').addEventListener('click', (e) => {
    const body = {};
    for (const [k, id] of Object.entries(PRICE_IDS)) {
      const v = $(id).value.trim();
      const n = Number(v);
      if (v === '' || !Number.isFinite(n) || n < 0) {
        toast(`Harga ${tierName(k)} harus berupa angka.`, 'err');
        $(id).focus();
        return;
      }
      body[k] = v;
    }
    busy(e.currentTarget, 'Menyimpan…', async () => {
      try {
        const result = await api('/api/admin/update-pricing', { method: 'POST', body });
        priceDirty = false;
        // Tampilkan angka yang benar-benar tersimpan di server.
        if (result.pricing) renderPricing(result.pricing);
        toast('Harga paket diperbarui. Halaman harga dan dashboard user langsung mengikuti.');
      } catch (err) { if (!err.auth) toast(err.network ? 'Gagal terhubung ke server.' : (err.message || 'Gagal menyimpan harga.'), 'err'); }
    });
  });

  function renderPromos() {
    const promos = state.promos;
    setText('promoCount', `${fmt(promos.length)} kode`);
    const tbody = $('promoTableBody');
    if (!promos.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="td-empty"><i class="fa-solid fa-ticket"></i>Belum ada kode promo.</td></tr>';
      return;
    }
    tbody.innerHTML = promos.map((p) => {
      const used = num(p.usedCount), max = num(p.maxUses) || 0;
      const pct = max ? clamp((used / max) * 100, 0, 100) : 0;
      return `
        <tr>
          <td class="td-main"><span class="promo-code">${esc(p.code)}</span></td>
          <td data-label="Diskon" class="num">${fmt(p.discount)}%</td>
          <td data-label="Penggunaan"><div class="use-meter"><span>${fmt(used)} / ${fmt(max)}</span><div class="v-meter${pct >= 90 ? ' is-danger' : pct >= 75 ? ' is-warn' : ''}" style="--v:${pct.toFixed(1)}%"><i></i></div></div></td>
          <td data-label="Status">${p.isActive ? '<span class="v-badge v-badge--ok">Aktif</span>' : '<span class="v-badge">Nonaktif</span>'}</td>
        </tr>`;
    }).join('');
  }

  $('btnAddPromo').addEventListener('click', (e) => {
    const code = $('promoCode').value.trim().toUpperCase();
    const discount = $('promoDiscount').value.trim();
    const maxUses = $('promoMax').value.trim();
    if (!code || !discount) { toast('Kode dan diskon wajib diisi.', 'err'); return; }
    const d = Number(discount);
    if (!Number.isFinite(d) || d < 1 || d > 100) { toast('Diskon harus 1–100%.', 'err'); return; }
    busy(e.currentTarget, 'Membuat…', async () => {
      try {
        const result = await api('/api/admin/add-promo', { method: 'POST', body: { code, discount, maxUses } });
        toast(result.message || 'Promo code ditambahkan.');
        $('promoCode').value = ''; $('promoDiscount').value = '';
        loadAdminData();
      } catch (err) {
        if (!err.auth) toast(err.network ? 'Gagal terhubung ke server. Perubahan BELUM tersimpan.' : err.message, 'err');
      }
    });
  });

  /* ---------------- Riwayat admin ---------------- */
  const AUDIT_LABEL = {
    'ubah-tier': 'Paket semua bot user',
    'ubah-paket-bot': 'Ubah paket bot',
    'ubah-harga': 'Ubah harga',
    'hapus-bot-free': 'Hapus bot Free',
    'sinkron-tier': 'Sinkron paket',
    'ubah-pengaturan-situs': 'Ubah tampilan situs',
    'unggah-media-situs': 'Unggah media',
  };
  async function loadAuditLog() {
    const tbody = $('auditTableBody');
    try {
      const result = await api('/api/admin/audit');
      const logs = Array.isArray(result.logs) ? result.logs : [];
      if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="td-empty"><i class="fa-solid fa-clock-rotate-left"></i>Belum ada catatan.</td></tr>';
        return;
      }
      tbody.innerHTML = logs.map((l) => `
        <tr>
          <td class="td-main nowrap cell-mono">${esc(fmtDate(l.at, true))}</td>
          <td data-label="Admin"><strong>${esc(l.adminName || '-')}</strong></td>
          <td data-label="Aksi">${esc(AUDIT_LABEL[l.action] || l.action)}</td>
          <td data-label="Target" class="cell-mono">${esc(l.target || '-')}</td>
          <td data-label="Detail" class="cell-detail">${esc(l.detail || '-')}</td>
        </tr>`).join('');
    } catch (err) {
      if (err.auth) return;
      tbody.innerHTML = `<tr><td colspan="5" class="td-empty is-err"><i class="fa-solid fa-triangle-exclamation"></i>Gagal memuat riwayat.<br><small>${esc(err.message)}</small></td></tr>`;
    }
  }
  $('btnAuditRefresh').addEventListener('click', (e) => busy(e.currentTarget, 'Memuat…', loadAuditLog));

  /* ==================================================================
     MONITOR LIVE (/api/admin/live)
     ================================================================== */
  const POLL_MS = 3000;
  const HISTORY_EVERY_MS = 30000;
  const LOG_KEEP = 200;
  const live = {
    data: null, timer: null, inflight: false, failures: 0,
    history: [], historyAt: 0,
    lastId: null, logs: [], pending: [], paused: false, newIds: new Set(),
  };

  const STATUS_TEXT = { operational: 'normal', busy: 'sibuk', degraded: 'terganggu' };
  const STATUS_DOT = { operational: 'v-dot v-dot--live', busy: 'v-dot v-dot--warn', degraded: 'v-dot v-dot--danger' };
  const CAP_BADGE = {
    available: ['v-badge v-badge--ok', 'Tersedia'],
    limited: ['v-badge v-badge--warn', 'Hampir penuh'],
    full: ['v-badge v-badge--danger', 'Penuh'],
  };
  const BASIS_TEXT = { memory: 'RAM', cpu: 'CPU', admin: 'batas admin' };

  function schedule(ms) {
    clearTimeout(live.timer);
    if (sessionGone) return;
    live.timer = setTimeout(pollLive, ms);
  }
  function stopLive() { clearTimeout(live.timer); live.timer = null; }

  async function pollLive() {
    clearTimeout(live.timer);
    if (sessionGone || live.inflight) return;
    // Tab tidak dilihat: berhenti total (dilanjutkan lagi oleh visibilitychange).
    if (document.hidden) { setLiveBadge('hidden'); return; }
    const wantHistory = !live.history.length || Date.now() - live.historyAt > HISTORY_EVERY_MS;
    const qs = new URLSearchParams();
    if (live.lastId !== null) qs.set('since', String(live.lastId));
    if (wantHistory) qs.set('history', '1');
    live.inflight = true;
    try {
      const d = await api('/api/admin/live' + (qs.toString() ? '?' + qs : ''));
      live.failures = 0;
      ingestHistory(d, wantHistory);
      ingestLogs(d);
      const firstData = !live.data;
      live.data = d;
      renderLiveEverywhere(d);
      // Kartu bot menampilkan jumlah pesan dari data live; gambar ulang
      // sekali saat data itu pertama kali tersedia.
      if (firstData && botList.length) renderBotPage();
      setLiveBadge('ok');
      schedule(POLL_MS);
    } catch (err) {
      if (err.auth) return;
      live.failures++;
      // Mundur bertahap (6, 12, 24, 48, 60 dtk) supaya server yang sedang
      // kewalahan tidak makin dibanjiri request dari panel admin.
      const wait = Math.min(60000, POLL_MS * 2 ** Math.min(live.failures, 5));
      setLiveBadge('error', wait);
      schedule(wait);
    } finally { live.inflight = false; }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopLive(); setLiveBadge('hidden'); return; }
    pollLive();
    loadBotsData();
  });

  function setLiveBadge(mode, wait = 0) {
    const badge = $('liveBadge'), dot = $('liveDot'), text = $('liveBadgeText');
    const nav = $('navLiveDot');
    if (mode === 'ok') {
      dot.className = 'v-dot v-dot--live';
      text.textContent = `live · ${POLL_MS / 1000} dtk`;
      badge.classList.remove('is-paused');
      nav.className = 'v-dot v-dot--live';
    } else if (mode === 'hidden') {
      dot.className = 'v-dot v-dot--off';
      text.textContent = 'dijeda · tab tidak aktif';
      badge.classList.add('is-paused');
    } else {
      dot.className = 'v-dot v-dot--danger';
      text.textContent = `koneksi putus · coba lagi ${Math.round(wait / 1000)} dtk`;
      badge.classList.add('is-paused');
      nav.className = 'v-dot v-dot--danger';
    }
  }

  function ingestHistory(d, full) {
    if (full && Array.isArray(d.history)) {
      live.history = d.history.slice(-120);
      live.historyAt = Date.now();
      return;
    }
    // Di antara pengambilan riwayat penuh (tiap 30 dtk) titik terbaru
    // ditambahkan sendiri — tapi tidak lebih rapat dari sampel server (5 dtk)
    // supaya bentuk grafik tidak berubah saat riwayat penuh datang.
    const last = live.history[live.history.length - 1];
    const t = num(d.now) || Date.now();
    if (!last || t - num(last.t) >= 4500) {
      live.history.push({ t, cpu: d.server?.cpu?.percent, ram: d.server?.ram?.percent, mps: d.traffic?.msgPerSec });
      if (live.history.length > 120) live.history.splice(0, live.history.length - 120);
    }
  }

  function ingestLogs(d) {
    const serverLast = Number.isFinite(Number(d.lastId)) ? Number(d.lastId) : null;
    // Data monitor di server di-reset (ID mulai dari kecil lagi): buang
    // cursor & log lama, kalau tidak log baru tidak akan pernah tampil.
    if (serverLast !== null && live.lastId !== null && serverLast < live.lastId) {
      live.logs = []; live.pending = [];
    }
    const first = live.lastId === null;
    const known = new Set(live.logs.map((l) => l.id).concat(live.pending.map((l) => l.id)));
    const fresh = (Array.isArray(d.logs) ? d.logs : []).filter((l) => !known.has(l.id)); // terbaru dulu
    if (serverLast !== null) live.lastId = serverLast;
    // Cursor tetap diperbarui walau log sedang dijeda: tanda polling masih jalan.
    setText('logCursor', live.lastId !== null ? `cursor #${live.lastId}` : 'cursor –');
    if (!fresh.length) { if (first) renderLog(); return; }

    if (live.paused) {
      live.pending = fresh.concat(live.pending).slice(0, LOG_KEEP);
      updatePauseBtn();
      return;
    }
    live.newIds = first ? new Set() : new Set(fresh.map((l) => l.id));
    live.logs = fresh.concat(live.logs).slice(0, LOG_KEEP);
    renderLog();
  }

  function renderLog() {
    const listEl = $('logList');
    const q = $('logFilter').value.trim().toLowerCase();
    const rows = q
      ? live.logs.filter((l) => `${l.botFull || ''} ${l.bot || ''} ${l.cmd || ''}`.toLowerCase().includes(q))
      : live.logs;
    if (!rows.length) {
      listEl.innerHTML = `<div class="alog__empty"><i class="fa-solid fa-terminal"></i>${q ? 'Tidak ada log yang cocok.' : 'Menunggu command masuk…'}</div>`;
    } else {
      listEl.innerHTML = rows.map((l) => `
        <div class="al-row${l.ok === false ? ' is-err' : ''}${live.newIds.has(l.id) && !reduceMotion ? ' is-new' : ''}">
          <span class="al-time">${esc(clock(l.at))}</span>
          <span class="al-tag">${l.ok === false ? 'ERR' : 'OK'}</span>
          <span class="al-bot" title="${esc(l.bot || '')}">${esc(l.botFull || l.bot || '-')}</span>
          <span class="al-cmd" title=".${esc(l.cmd || '')}">${esc(l.cmd || '?')}</span>
          <span class="al-chat">${l.chat === 'group' ? 'grup' : 'pribadi'}</span>
          <span class="al-ms">${fmt(l.ms)}ms</span>
        </div>`).join('');
    }
    live.newIds = new Set();
    setText('logCount', `${fmt(rows.length)} baris${q ? ' (disaring)' : ''}`);
    setText('logCursor', live.lastId !== null ? `cursor #${live.lastId}` : 'cursor –');
  }

  function updatePauseBtn() {
    const btn = $('btnLogPause');
    btn.classList.toggle('is-paused', live.paused);
    btn.setAttribute('aria-pressed', String(live.paused));
    const n = live.pending.length;
    btn.innerHTML = live.paused
      ? `<i class="fa-solid fa-play"></i> <span>Lanjutkan${n ? ` (${n} baru)` : ''}</span>`
      : '<i class="fa-solid fa-pause"></i> <span>Jeda</span>';
    $('logDot').className = live.paused ? 'v-dot v-dot--warn' : 'v-dot v-dot--live';
  }
  $('btnLogPause').addEventListener('click', () => {
    live.paused = !live.paused;
    if (!live.paused && live.pending.length) {
      live.newIds = new Set(live.pending.map((l) => l.id));
      live.logs = live.pending.concat(live.logs).slice(0, LOG_KEEP);
      live.pending = [];
      renderLog();
    }
    updatePauseBtn();
  });
  $('btnLogClear').addEventListener('click', () => { live.logs = []; live.pending = []; updatePauseBtn(); renderLog(); });
  $('logFilter').addEventListener('input', renderLog);

  /* ---------------- Grafik SVG ringan ---------------- */
  function niceMax(v) {
    if (v <= 1) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
    return 10 * p;
  }

  function renderChart(el, points) {
    if (!el) return;
    const key = el.dataset.key;
    const unit = el.dataset.unit || '';
    const vals = points.map((p) => num(p[key]));
    el._pts = points;
    if (points.length < 2) {
      el.innerHTML = '<div class="chart__empty">Mengumpulkan data…</div>';
      return;
    }
    const max = el.dataset.max ? Number(el.dataset.max) : niceMax(Math.max(...vals) * 1.15);
    el._max = max;
    const W = 300, H = 100, n = vals.length;
    const xy = vals.map((v, i) => [((i / (n - 1)) * W), H - (clamp(v, 0, max) / max) * H]);
    const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('');
    const area = `${line}L${W},${H}L0,${H}Z`;
    const gid = 'g-' + key;
    const ylab = [1, 0.5, 0].map((f) => {
      const v = max * f;
      const label = unit === '%' ? `${fmt(v)}%` : fmt1(v, v < 10 ? 1 : 0);
      return `<span class="chart__yl" style="top:${(1 - f) * 100}%">${label}</span>`;
    }).join('');
    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#5cf0b4" stop-opacity=".28"/><stop offset="1" stop-color="#5cf0b4" stop-opacity="0"/>
        </linearGradient></defs>
        <g class="chart__grid"><line x1="0" y1="0" x2="${W}" y2="0"/><line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"/><line x1="0" y1="${H}" x2="${W}" y2="${H}"/></g>
        <path class="chart__area" d="${area}" fill="url(#${gid})"/>
        <path class="chart__line" d="${line}"/>
      </svg>
      ${ylab}
      <span class="chart__cross"></span><span class="chart__dot"></span><span class="chart__tip"></span>`;
  }

  // Tooltip grafik: satu listener per grafik, dipasang sekali.
  qsa('.chart').forEach((el) => {
    const move = (e) => {
      const pts = el._pts;
      if (!pts || pts.length < 2) return;
      const r = el.getBoundingClientRect();
      const f = clamp((e.clientX - r.left) / r.width, 0, 1);
      const i = Math.round(f * (pts.length - 1));
      const p = pts[i];
      const v = num(p[el.dataset.key]);
      const x = (i / (pts.length - 1)) * r.width;
      const y = r.height - (clamp(v, 0, el._max || 1) / (el._max || 1)) * r.height;
      el.classList.add('is-hover');
      const cross = el.querySelector('.chart__cross'), dot = el.querySelector('.chart__dot'), tip = el.querySelector('.chart__tip');
      cross.style.left = x + 'px';
      dot.style.left = x + 'px'; dot.style.top = y + 'px';
      const unit = el.dataset.unit || '';
      tip.innerHTML = `<span>${esc(clock(p.t))}</span>${fmt1(v, unit === '%' ? 1 : 2)}${unit === '%' ? '%' : ' msg/s'}`;
      const tw = tip.offsetWidth || 90;
      tip.style.left = clamp(x - tw / 2, 0, Math.max(0, r.width - tw)) + 'px';
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerdown', move);
    el.addEventListener('pointerleave', () => el.classList.remove('is-hover'));
  });

  /* ---------------- Render data live ---------------- */
  function renderLiveEverywhere(d) {
    renderServerChrome(d);
    renderOverviewLive(d);
    if (currentView === 'monitor') renderMonitor(d, { charts: true });
    else renderMonitor(d, { charts: false });
    if (currentView === 'capacity') renderCapacity(d);
  }

  // Sidebar + chip server di top bar.
  function renderServerChrome(d) {
    const s = d.server || {}, cap = d.capacity || {};
    const dotCls = STATUS_DOT[s.status] || 'v-dot v-dot--off';
    $('sideSrvDot').className = dotCls;
    $('topSrvDot').className = dotCls;
    setText('sideSrvName', s.name || 'Server');
    setText('sideSrvState', STATUS_TEXT[s.status] || s.status || '–');
    setMeter('sideSrvMeter', cap.percent);
    setText('sideSrvCap', `${fmt(cap.used)}/${fmt(cap.max)} bot · ${fmt(cap.remaining)} slot`);
    setText('topSrvText', `${s.name || 'Server'} · CPU ${fmt(s.cpu?.percent)}%`);
  }

  function capSentence(cap) {
    if (cap.status === 'full') return ['Server penuh — user tidak bisa menyalakan bot baru.', 'is-danger'];
    if (cap.status === 'limited') return [`Hampir penuh: sisa ${fmt(cap.remaining)} slot bot.`, 'is-warn'];
    return [`Masih muat ±${fmt(cap.remaining)} bot lagi.`, ''];
  }

  function renderOverviewLive(d) {
    const s = d.server || {}, cap = d.capacity || {}, t = d.traffic || {}, b = d.bots || {};
    $('ovSrvDot').className = STATUS_DOT[s.status] || 'v-dot v-dot--off';
    setText('ovSrvName', s.name || 'Server');
    setText('ovSrvMeta', `${s.host || '-'} · ${s.region || '-'} · nyala ${fmtUptime(s.uptimeSec)} · ${STATUS_TEXT[s.status] || s.status || '-'}`);
    const [sentence, cls] = capSentence(cap);
    const sEl = $('ovCapSentence');
    sEl.textContent = sentence;
    sEl.className = 'health__sentence' + (cls ? ' ' + cls : '');
    setMeter('ovCapMeter', cap.percent);
    setText('ovCapUsed', `${fmt(cap.used)} bot aktif`);
    setText('ovCapLeft', `${fmt(cap.remaining)} slot kosong dari ${fmt(cap.max)}`);
    setText('ovCpu', `${fmt1(s.cpu?.percent)}%`);
    setMeter('ovCpuMeter', s.cpu?.percent);
    setText('ovRam', `${fmt1(s.ram?.percent)}%`);
    setMeter('ovRamMeter', s.ram?.percent);
    setText('ovMps', fmt1(t.msgPerSec, 2));
    setText('ovMpsSub', `puncak ${fmt1(t.peakMsgPerSec, 1)}`);
    setText('ovBots', fmt(b.online));
    setText('ovBotsSub', `${fmt(b.connecting)} menghubungkan · ${fmt(b.registered)} terdaftar`);
  }

  function renderMonitor(d, { charts }) {
    const s = d.server || {}, t = d.traffic || {}, b = d.bots || {};
    setText('mCpu', `${fmt1(s.cpu?.percent)}%`);
    setText('mCpuSub', `${fmt1(s.cpu?.cores, 2)} core · load ${fmt1(s.cpu?.load1, 2)}`);
    setText('mRam', `${fmt1(s.ram?.percent)}%`);
    setText('mRamSub', `${fmtMB(s.ram?.usedMB)} / ${fmtMB(s.ram?.limitMB)}`);
    setText('mMps', fmt1(t.msgPerSec, 2));
    setText('mMpsSub', `puncak ${fmt1(t.peakMsgPerSec, 1)}/s`);
    setText('mBots', fmt(b.online));
    setText('mBotsSub', `${fmt(b.connecting)} menghubungkan · ${fmt(b.registered)} terdaftar`);
    setText('mMsgToday', fmt(t.messagesToday));
    setText('mMsgTotal', `total ${compact(t.totalMessages)} · ${fmt(b.groups)} grup`);
    setText('mCmdToday', fmt(t.commandsToday));
    setText('mCmdTotal', `total ${compact(t.totalCommands)} · ${d.users == null ? '–' : fmt(d.users)} user`);
    setText('mUptime', fmtUptime(s.uptimeSec));
    setText('mUptimeSub', `status ${STATUS_TEXT[s.status] || s.status || '–'}`);
    setText('mLag', `${fmt1(s.eventLoopLagMs)} ms`);
    setText('mHeap', `heap ${fmt(s.heapMB)} MB · proses ${fmt(s.ram?.processMB)} MB`);

    // Info server
    setText('srvInfoName', s.name || 'Server');
    const badge = $('srvInfoStatus');
    badge.className = s.status === 'operational' ? 'v-badge v-badge--ok' : s.status === 'busy' ? 'v-badge v-badge--warn' : 'v-badge v-badge--danger';
    badge.textContent = s.status === 'operational' ? 'Normal' : s.status === 'busy' ? 'Sibuk' : 'Terganggu';
    setText('siHost', s.host || '–');
    setText('siRegion', s.region || '–');
    setText('siCpu', `${s.cpu?.model || '–'} · ${fmt1(s.cpu?.cores, 2)} core`);
    setText('siOs', s.os || '–');
    setText('siNode', s.node ? `Node.js ${String(s.node).replace(/^v/, '')}` : '–');
    setText('siProc', `${fmt(s.ram?.processMB)} MB`);

    // Command terpopuler
    const top = Array.isArray(t.topCommands) ? t.topCommands.slice(0, 8) : [];
    const maxC = Math.max(1, ...top.map((c) => num(c.count)));
    $('topCmds').innerHTML = top.length
      ? top.map((c) => `
          <div class="top-cmd">
            <span class="top-cmd__name">${esc(c.cmd)}</span>
            <span class="top-cmd__bar"><i style="--v:${((num(c.count) / maxC) * 100).toFixed(1)}%"></i></span>
            <span class="top-cmd__n">${fmt(c.count)}</span>
          </div>`).join('')
      : '<p class="empty-note">Belum ada command hari ini.</p>';

    // Tabel per bot
    const rows = Array.isArray(d.perBot) ? d.perBot : [];
    const online = rows.filter((r) => r.online).length;
    setText('perBotCount', `${fmt(online)} online · ${fmt(rows.length)} bot`);
    $('perBotBody').innerHTML = rows.length
      ? rows.slice(0, 300).map((r) => {
          const pill = r.online
            ? '<span class="state-pill is-on"><span class="v-dot v-dot--live"></span>online</span>'
            : r.connecting
              ? '<span class="state-pill is-wait"><span class="v-dot v-dot--warn"></span>menghubungkan</span>'
              : '<span class="state-pill"><span class="v-dot v-dot--off"></span>offline</span>';
          return `
            <tr>
              <td class="td-main cell-mono pb-num">${esc(r.number)}</td>
              <td data-label="Status" class="pb-st">${pill}</td>
              <td data-label="Pesan" class="right num pb-n">${fmt(r.messages)}</td>
              <td data-label="Command" class="right num pb-n">${fmt(r.commands)}</td>
              <td data-label="Grup" class="right num pb-n">${fmt(r.groups)}</td>
              <td data-label="Aktivitas terakhir" class="right muted nowrap pb-act">${esc(timeAgo(r.lastActivity))}</td>
            </tr>`;
        }).join('')
      : '<tr><td colspan="6" class="td-empty"><i class="fa-solid fa-robot"></i>Belum ada bot.</td></tr>';

    // Nilai di kepala grafik selalu diperbarui; garisnya hanya digambar
    // ulang saat view monitor terlihat (hemat CPU HP admin).
    setChartHead('cCpuVal', s.cpu?.percent, '%');
    setChartHead('cRamVal', s.ram?.percent, '%');
    setChartHead('cMpsVal', t.msgPerSec, '/s', 2);
    if (charts) {
      renderChart($('chartCpu'), live.history);
      renderChart($('chartRam'), live.history);
      renderChart($('chartMps'), live.history);
      const h = live.history;
      const span = h.length > 1 ? Math.max(1, Math.round((num(h[h.length - 1].t) - num(h[0].t)) / 60000)) : 0;
      const from = span ? `−${span} mnt` : '–';
      ['cCpuFrom', 'cRamFrom', 'cMpsFrom'].forEach((id) => setText(id, from));
    }
  }
  function setChartHead(id, v, unit, d = 1) {
    const el = $(id);
    if (el) el.innerHTML = `${fmt1(v, d)}<small>${unit}</small>`;
  }

  /* ==================================================================
     KAPASITAS
     ================================================================== */
  const BOTS_PER_CORE = 25;

  // Rumus yang SAMA dengan estimateCapacity() di lib/monitor.js. Dipakai
  // hanya untuk pratinjau "kalau disimpan jadinya berapa"; angka resmi
  // tetap dari server setelah disimpan.
  function estimateCapacity({ limitMB, baselineMB, perBotMB, reservePercent, cores, maxBots, used }) {
    const usable = num(limitMB) * (1 - clamp(num(reservePercent), 0, 50) / 100) - num(baselineMB);
    const memCap = Math.max(1, Math.floor(usable / Math.max(1, num(perBotMB) || 70)));
    const cpuCap = Math.max(1, Math.floor((num(cores) || 1) * BOTS_PER_CORE));
    const adminCap = Math.max(0, Math.floor(num(maxBots)));
    const opts = [];
    if (adminCap > 0) opts.push({ basis: 'admin', cap: adminCap });
    opts.push({ basis: 'memory', cap: memCap }, { basis: 'cpu', cap: cpuCap });
    const pick = opts.reduce((a, b) => (b.cap < a.cap ? b : a));
    const remaining = Math.max(0, pick.cap - num(used));
    return { max: pick.cap, basis: pick.basis, remaining, memCap, cpuCap, adminCap, usable };
  }

  function renderCapacity(d) {
    const cap = d.capacity || {};
    const det = cap.detail || {};
    const badge = CAP_BADGE[cap.status] || ['v-badge', cap.status || '–'];
    $('capStatus').className = badge[0];
    setText('capStatus', badge[1]);
    $('capDot').className = cap.status === 'full' ? 'v-dot v-dot--danger' : cap.status === 'limited' ? 'v-dot v-dot--warn' : 'v-dot v-dot--live';
    setText('capNote', cap.note || '–');
    setText('capMax', fmt(cap.max));
    setMeter('capMeter', cap.percent);
    setText('capUsed', fmt(cap.used));
    setText('capLeft', fmt(cap.remaining));
    setText('capPerBot', `${fmt(cap.perBotMB)} MB`);
    setText('cdMem', `${fmt(det.memCap)} bot`);
    setText('cdCpu', `${fmt(det.cpuCap)} bot`);
    setText('cdAdmin', det.adminCap > 0 ? `${fmt(det.adminCap)} bot` : 'otomatis');
    qsa('#capDetail [data-basis]').forEach((row) => row.classList.toggle('is-pick', row.dataset.basis === cap.basis));

    if (det.limitMB !== undefined) {
      const pm2 = det.pm2CapMB ? `${fmt(det.pm2CapMB)} MB` : 'tidak dipakai';
      const lines = [
        `<i>batas RAM    </i>= min(mesin ${fmt(det.containerLimitMB)} MB, PM2 ${pm2}) = <b>${fmt(det.limitMB)} MB</b>`,
        `<i>bisa dipakai </i>= ${fmt(det.limitMB)} × (1 − ${fmt(det.reservePercent)}% cadangan) − ${fmt(det.baselineMB)} MB dasar = <b>${fmt(det.usableMB)} MB</b>`,
        `<i>kap. RAM     </i>= ${fmt(det.usableMB)} ÷ ${fmt(cap.perBotMB)} MB per bot = <b>${fmt(det.memCap)} bot</b>`,
        `<i>kap. CPU     </i>= ${fmt1(det.cores, 2)} core × ${BOTS_PER_CORE} = <b>${fmt(det.cpuCap)} bot</b>`,
        `<i>batas admin  </i>= <b>${det.adminCap > 0 ? fmt(det.adminCap) + ' bot' : 'otomatis (tidak ikut)'}</b>`,
        `<i>dipakai      </i>= yang terkecil → <b>${fmt(cap.max)} bot</b> (${BASIS_TEXT[cap.basis] || cap.basis})`,
        `<i>sisa slot    </i>= ${fmt(cap.max)} − ${fmt(cap.used)} sesi hidup = <b>${fmt(cap.remaining)}</b>`,
      ];
      $('capFormula').innerHTML = lines.join('\n');
      const m = det.measured || {};
      setText('capMeasured', [
        m.perBot ? 'Rata-rata RAM per bot DIUKUR dari bot yang sedang jalan.' : 'Rata-rata per bot belum terukur — memakai angka bawaan 70 MB.',
        m.baseline ? 'RAM dasar aplikasi terukur saat belum ada bot.' : 'RAM dasar memakai angka bawaan 160 MB.',
        det.memSource ? `Sumber RAM: ${det.memSource}.` : '',
      ].filter(Boolean).join(' '));
    }
    updateCapPreview();
  }

  const capForm = { maxBots: $('capMaxBots'), reserve: $('capReserve'), range: $('capReserveRange'), auto: $('capAuto') };

  function fillCapForm(c) {
    const maxBots = num(c?.maxBots);
    const reserve = c?.reservePercent ?? 15;
    capForm.auto.checked = maxBots === 0;
    capForm.maxBots.value = maxBots;
    capForm.maxBots.disabled = maxBots === 0;
    capForm.reserve.value = reserve;
    capForm.range.value = reserve;
    setText('capSavedInfo', `Tersimpan: ${maxBots > 0 ? `maks. ${fmt(maxBots)} bot` : 'otomatis'} · cadangan ${fmt(reserve)}%`);
    updateCapPreview();
  }

  function readCapForm() {
    return {
      maxBots: capForm.auto.checked ? 0 : Math.round(Number(capForm.maxBots.value)),
      reservePercent: Math.round(Number(capForm.reserve.value)),
    };
  }

  function updateCapPreview() {
    const box = $('capPreview');
    const det = live.data?.capacity?.detail;
    const cap = live.data?.capacity;
    const f = readCapForm();
    const valid = Number.isFinite(f.maxBots) && f.maxBots >= 0 && f.maxBots <= 5000 && Number.isFinite(f.reservePercent) && f.reservePercent >= 0 && f.reservePercent <= 50;
    if (!valid) {
      box.className = 'preview-box is-same';
      setText('capPreviewVal', 'angka tidak valid');
      setText('capPreviewNote', 'Maksimal bot 0–5000, cadangan RAM 0–50%.');
      return;
    }
    if (!det || !cap) {
      box.className = 'preview-box is-same';
      setText('capPreviewVal', '–');
      setText('capPreviewNote', 'Menunggu data server…');
      return;
    }
    const est = estimateCapacity({
      limitMB: det.limitMB, baselineMB: det.baselineMB, perBotMB: cap.perBotMB,
      reservePercent: f.reservePercent, cores: det.cores, maxBots: f.maxBots, used: cap.used,
    });
    const same = est.max === cap.max;
    box.className = 'preview-box' + (same ? ' is-same' : '');
    setText('capPreviewVal', `${fmt(est.max)} bot`);
    setText('capPreviewNote', same
      ? `Sama dengan sekarang · dibatasi ${BASIS_TEXT[est.basis]} · sisa ${fmt(est.remaining)} slot.`
      : `${est.max > cap.max ? 'Naik' : 'Turun'} ${fmt(Math.abs(est.max - cap.max))} dari ${fmt(cap.max)} · dibatasi ${BASIS_TEXT[est.basis]} · sisa ${fmt(est.remaining)} slot.`);
  }

  capForm.auto.addEventListener('change', () => {
    capForm.maxBots.disabled = capForm.auto.checked;
    if (capForm.auto.checked) capForm.maxBots.value = 0;
    else {
      // Mulai dari kapasitas sekarang supaya admin tinggal menurunkan.
      capForm.maxBots.value = live.data?.capacity?.max || 50;
      capForm.maxBots.focus();
    }
    updateCapPreview();
  });
  capForm.maxBots.addEventListener('input', () => {
    if (Number(capForm.maxBots.value) === 0 && capForm.maxBots.value !== '') { capForm.auto.checked = true; capForm.maxBots.disabled = true; }
    updateCapPreview();
  });
  capForm.reserve.addEventListener('input', () => { capForm.range.value = capForm.reserve.value; updateCapPreview(); });
  capForm.range.addEventListener('input', () => { capForm.reserve.value = capForm.range.value; updateCapPreview(); });

  $('btnSaveCap').addEventListener('click', (e) => {
    const f = readCapForm();
    if (!Number.isInteger(f.maxBots) || f.maxBots < 0 || f.maxBots > 5000) { toast('Maksimal bot harus 0–5000 (0 = otomatis).', 'err'); capForm.maxBots.focus(); return; }
    if (!Number.isInteger(f.reservePercent) || f.reservePercent < 0 || f.reservePercent > 50) { toast('Cadangan RAM harus 0–50%.', 'err'); capForm.reserve.focus(); return; }
    busy(e.currentTarget, 'Menyimpan…', async () => {
      try {
        const result = await api('/api/admin/site-settings', { method: 'POST', body: { capacity: f } });
        if (site.saved) site.saved.capacity = result.settings.capacity;
        fillCapForm(result.settings.capacity);
        toast('Batas kapasitas disimpan dan langsung berlaku.');
        live.inflight = false;
        pollLive(); // tampilkan angka kapasitas baru tanpa menunggu 3 dtk
      } catch (err) { if (!err.auth) toast(err.message, 'err'); }
    });
  });

  /* ---------------- Batas bot per akun (settings.limits) ----------------
     Paket sekarang per bot, jadi satu akun boleh punya beberapa bot. Batas
     ini dicek server saat user menambah bot BARU; admin selalu lolos.
     Rentang SAMA dengan validasi lib/site-settings.js. */
  const LIMIT_DEFAULT = { maxBotsPerUser: 5, maxFreeBotsPerUser: 1 };
  const limForm = { max: $('limMaxBots'), free: $('limMaxFree') };
  let limSaved = { ...LIMIT_DEFAULT };

  function fillLimitsForm(l) {
    limSaved = { ...LIMIT_DEFAULT, ...(l && typeof l === 'object' ? l : {}) };
    limForm.max.value = limSaved.maxBotsPerUser;
    limForm.free.value = limSaved.maxFreeBotsPerUser;
    setText('limSavedInfo', `Tersimpan: maks. ${fmt(limSaved.maxBotsPerUser)} bot · ${fmt(limSaved.maxFreeBotsPerUser)} Free`);
    updateLimitsPreview();
  }

  function readLimitsForm() {
    const n = (el) => (el.value.trim() === '' ? NaN : Number(el.value));
    return { maxBotsPerUser: n(limForm.max), maxFreeBotsPerUser: n(limForm.free) };
  }
  const maxOk = (v) => Number.isInteger(v) && v >= 1 && v <= 50;
  const freeOk = (v) => Number.isInteger(v) && v >= 1 && v <= 10;

  function updateLimitsPreview() {
    const f = readLimitsForm();
    const box = $('limPreview');
    if (!maxOk(f.maxBotsPerUser) || !freeOk(f.maxFreeBotsPerUser)) {
      box.className = 'preview-box span-all is-same';
      setText('limPreviewVal', 'angka tidak valid');
      setText('limPreviewNote', 'Maksimal bot per akun 1–50, maksimal bot Free 1–10 (angka bulat).');
      return;
    }
    // Bot Free tetap terhitung di batas total, jadi yang efektif = yang terkecil.
    const free = Math.min(f.maxFreeBotsPerUser, f.maxBotsPerUser);
    const same = f.maxBotsPerUser === limSaved.maxBotsPerUser && f.maxFreeBotsPerUser === limSaved.maxFreeBotsPerUser;
    box.className = 'preview-box span-all' + (same ? ' is-same' : '');
    setText('limPreviewVal', `${fmt(f.maxBotsPerUser)} bot per akun · ${free ? `${fmt(free)} boleh Free` : 'semua wajib berbayar'}`);
    setText('limPreviewNote', [
      free
        ? `Bot Free ke-${free + 1} ditolak — user diminta upgrade bot Free-nya dulu.`
        : 'User baru bisa menambah bot kalau punya paket tertunda (sudah bayar).',
      f.maxFreeBotsPerUser > f.maxBotsPerUser ? `Batas Free lebih besar dari batas total, jadi yang berlaku ${fmt(free)}.` : '',
      'Bot yang sudah ada tidak dihapus kalau batas diturunkan.',
    ].filter(Boolean).join(' '));
  }

  [limForm.max, limForm.free].forEach((el) => {
    el.addEventListener('input', updateLimitsPreview);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('btnSaveLimits').click(); } });
  });
  updateLimitsPreview();

  $('btnSaveLimits').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    const f = readLimitsForm();
    if (!maxOk(f.maxBotsPerUser)) { toast('Maksimal bot per akun harus 1–50.', 'err'); limForm.max.focus(); return; }
    if (!freeOk(f.maxFreeBotsPerUser)) { toast('Maksimal bot Free per akun harus 0–10.', 'err'); limForm.free.focus(); return; }
    busy(btn, 'Menyimpan…', async () => {
      try {
        const result = await api('/api/admin/site-settings', { method: 'POST', body: { limits: f } });
        const saved = result.settings?.limits || f;
        if (site.saved) site.saved.limits = clone(saved);
        if (site.draft) site.draft.limits = clone(saved);
        fillLimitsForm(saved);
        toast('Batas bot per akun disimpan dan langsung berlaku.');
      } catch (err) { if (!err.auth) toast(err.message, 'err'); }
    });
  });

  /* ==================================================================
     BANNER & TAMPILAN SITUS
     ================================================================== */
  const MAX_BANNERS = 10;
  const MAX_UPLOAD = 25 * 1024 * 1024;
  const MEDIA_TYPES = {
    video: ['video/mp4', 'video/webm'],
    image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  };
  const site = { saved: null, draft: null, loading: null };
  const SITE_KEYS = ['announcement', 'banners', 'bannerIntervalMs', 'serverName', 'social'];

  // Validasi sisi klien MENIRU lib/site-settings.js supaya admin langsung
  // tahu salahnya di mana; server tetap memvalidasi ulang.
  const RE_HTTP = /^https?:\/\/[^\s<>"']+$/i;
  const isLink = (v) => !v || RE_HTTP.test(v) || /^\/(?!\/)[A-Za-z0-9\-._~/?#=&%+:@]*$/.test(v);
  const isMedia = (v) => RE_HTTP.test(v) || (/^\/(uploads|assets)\/[A-Za-z0-9\-._/]+$/.test(v) && !v.includes('..'));

  function ensureSiteSettings(force = false) {
    if (site.saved && !force) return Promise.resolve();
    if (site.loading) return site.loading;
    site.loading = (async () => {
      try {
        const result = await api('/api/admin/site-settings');
        applySaved(result.settings);
      } catch (err) {
        if (!err.auth) {
          toast('Gagal memuat pengaturan situs: ' + err.message, 'err');
          $('bannerList').innerHTML = `<p class="banner-empty is-err">Gagal memuat pengaturan. <button type="button" class="v-btn v-btn--outline v-btn--sm" id="btnSiteRetry">Coba lagi</button></p>`;
          $('btnSiteRetry')?.addEventListener('click', () => ensureSiteSettings(true));
        }
      } finally { site.loading = null; }
    })();
    return site.loading;
  }

  function applySaved(settings) {
    site.saved = clone(settings);
    site.draft = clone(settings);
    fillSiteForm();
    fillCapForm(settings.capacity);
    fillLimitsForm(settings.limits);
    updateDirty();
  }

  const pickSite = (s) => (s ? Object.fromEntries(SITE_KEYS.map((k) => [k, s[k]])) : null);
  const isDirty = () => !!site.saved && JSON.stringify(pickSite(site.draft)) !== JSON.stringify(pickSite(site.saved));

  function updateDirty() {
    const dirty = isDirty();
    $('siteSavebar').classList.toggle('is-dirty', dirty);
    $('btnSiteSave').disabled = !dirty;
    $('btnSiteReset').disabled = !dirty;
    $('siteSaveMsg').innerHTML = dirty
      ? '<i class="fa-solid fa-circle-exclamation"></i> Ada perubahan yang belum disimpan.'
      : '<i class="fa-regular fa-circle-check"></i> Semua perubahan tersimpan.';
  }
  window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

  function fillSiteForm() {
    const d = site.draft;
    const a = d.announcement || {};
    $('annEnabled').checked = !!a.enabled;
    $('annText').value = a.text || '';
    $('annLink').value = a.link || '';
    $('annLinkLabel').value = a.linkLabel || '';
    const sec = Math.round(num(d.bannerIntervalMs) / 1000) || 6;
    $('bannerInterval').value = sec;
    $('bannerIntervalRange').value = sec;
    $('serverName').value = d.serverName || '';
    qsa('[data-social]').forEach((inp) => { inp.value = d.social?.[inp.dataset.social] || ''; });
    qsa('[data-count-for]').forEach(updateCount);
    renderAnnPreview();
    renderBannerList();
    stage.restart();
  }

  function updateCount(hint) {
    const inp = $(hint.dataset.countFor);
    if (!inp) return;
    const max = Number(inp.maxLength) || 0;
    hint.textContent = `${inp.value.length}/${max}`;
    hint.classList.toggle('is-max', max && inp.value.length >= max);
  }
  document.addEventListener('input', (e) => {
    const id = e.target.id;
    if (!id) return;
    const hint = document.querySelector(`[data-count-for="${CSS.escape(id)}"]`);
    if (hint) updateCount(hint);
  });

  // Pengumuman
  function readAnn() {
    if (!site.draft) return;
    site.draft.announcement = {
      enabled: $('annEnabled').checked,
      text: $('annText').value,
      link: $('annLink').value.trim(),
      linkLabel: $('annLinkLabel').value,
    };
    renderAnnPreview();
    updateDirty();
  }
  ['annEnabled', 'annText', 'annLink', 'annLinkLabel'].forEach((id) => $(id).addEventListener(id === 'annEnabled' ? 'change' : 'input', readAnn));

  function renderAnnPreview() {
    const a = site.draft?.announcement || {};
    const text = String(a.text || '').trim();
    $('annPreview').classList.toggle('is-off', !a.enabled);
    const track = $('annPreviewTrack');
    const shown = text || 'Teks pengumuman tampil di sini…';
    // Dua salinan teks supaya geraknya menyambung, sama seperti di halaman depan.
    track.innerHTML = `<span>${esc(shown)}</span><span aria-hidden="true">${esc(shown)}</span>`;
    track.style.setProperty('--speed', clamp(Math.round(shown.length * 0.32 + 14), 16, 70) + 's');
    const cta = $('annPreviewCta');
    cta.hidden = !a.link;
    cta.innerHTML = `${esc(a.linkLabel || 'Lihat')} <i class="fa-solid fa-arrow-right"></i>`;
  }

  // Umum
  function setIntervalSec(sec, { commit = false } = {}) {
    if (!site.draft) return;
    let s = Math.round(Number(sec));
    if (!Number.isFinite(s)) return;
    if (commit) s = clamp(s, 3, 30);
    if (s < 3 || s > 30) return;
    site.draft.bannerIntervalMs = s * 1000;
    $('bannerIntervalRange').value = s;
    if (commit) $('bannerInterval').value = s;
    updateStageInfo();
    updateDirty();
  }
  $('bannerIntervalRange').addEventListener('input', (e) => { $('bannerInterval').value = e.target.value; setIntervalSec(e.target.value); stage.restart(); });
  $('bannerInterval').addEventListener('input', (e) => setIntervalSec(e.target.value));
  $('bannerInterval').addEventListener('change', (e) => { setIntervalSec(e.target.value || 6, { commit: true }); stage.restart(); });
  $('serverName').addEventListener('input', (e) => { if (site.draft) { site.draft.serverName = e.target.value; updateDirty(); } });
  qsa('[data-social]').forEach((inp) => inp.addEventListener('input', () => {
    if (!site.draft) return;
    site.draft.social = { ...(site.draft.social || {}), [inp.dataset.social]: inp.value.trim() };
    updateDirty();
  }));

  /* ---------------- Daftar banner ---------------- */
  function thumbMedia(b, { autoplay = false } = {}) {
    if (!b.src) return '<i class="fa-regular fa-image"></i>';
    if (b.type === 'video') {
      // "#t=0.1" membuat browser menampilkan frame pertama tanpa memutar video.
      const src = autoplay ? b.src : b.src + (b.src.includes('#') ? '' : '#t=0.1');
      return `<video src="${esc(src)}" ${b.poster ? `poster="${esc(b.poster)}"` : ''} muted playsinline preload="metadata" ${autoplay ? 'autoplay' : ''}></video>`;
    }
    return `<img src="${esc(b.src)}" alt="" loading="lazy" decoding="async">`;
  }

  function renderBannerList() {
    const list = $('bannerList');
    const banners = site.draft?.banners || [];
    const active = banners.filter((b) => b.active).length;
    setText('bannerSummary', banners.length
      ? `${banners.length} banner · ${active} aktif. Berputar di hero halaman depan.`
      : 'Belum ada banner — halaman depan memakai video bawaan.');
    $('btnAddBanner').disabled = banners.length >= MAX_BANNERS;
    if (!banners.length) {
      list.innerHTML = '<p class="banner-empty"><i class="fa-regular fa-images"></i><br>Belum ada banner. Tambahkan video atau gambar.</p>';
    } else {
      list.innerHTML = banners.map((b, i) => `
        <div class="banner-item${b.active ? '' : ' is-off'}" data-i="${i}">
          <div class="banner-thumb">${thumbMedia(b)}<span class="banner-thumb__type">${b.type === 'video' ? 'Video' : 'Gambar'}</span><span class="banner-thumb__n">${i + 1}</span></div>
          <div class="banner-item__main">
            <span class="banner-item__title">${b.title ? esc(b.title) : '<em>Tanpa judul</em>'}${b.active ? '' : ' <em>· nonaktif</em>'}</span>
            <span class="banner-item__src" title="${esc(b.src)}">${esc(b.src)}</span>
          </div>
          <div class="banner-item__tools">
            <label class="v-switch" title="${b.active ? 'Sembunyikan' : 'Tampilkan'} banner ini"><input type="checkbox" data-bact="toggle" ${b.active ? 'checked' : ''} aria-label="Banner ${i + 1} aktif"><span></span></label>
            <button type="button" class="icon-btn icon-btn--sm" data-bact="up" ${i === 0 ? 'disabled' : ''} aria-label="Naikkan banner ${i + 1}" title="Naikkan"><i class="fa-solid fa-arrow-up"></i></button>
            <button type="button" class="icon-btn icon-btn--sm" data-bact="down" ${i === banners.length - 1 ? 'disabled' : ''} aria-label="Turunkan banner ${i + 1}" title="Turunkan"><i class="fa-solid fa-arrow-down"></i></button>
            <button type="button" class="icon-btn icon-btn--sm" data-bact="edit" aria-label="Ubah banner ${i + 1}" title="Ubah"><i class="fa-solid fa-pen"></i></button>
            <button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-bact="delete" aria-label="Hapus banner ${i + 1}" title="Hapus"><i class="fa-regular fa-trash-can"></i></button>
          </div>
        </div>`).join('');
    }
    updateStageInfo();
  }

  // Media rusak di thumbnail: ganti dengan ikon, jangan biarkan kotak hitam kosong.
  $('bannerList').addEventListener('error', (e) => {
    const m = e.target;
    if (m.tagName !== 'VIDEO' && m.tagName !== 'IMG') return;
    const box = m.closest('.banner-thumb');
    if (box) { m.remove(); box.insertAdjacentHTML('afterbegin', '<i class="fa-solid fa-link-slash media-err" title="Media tidak bisa dimuat"></i>'); }
  }, true);

  $('bannerList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-bact]');
    if (!btn || !site.draft) return;
    const i = Number(btn.closest('.banner-item').dataset.i);
    const arr = site.draft.banners;
    const act = btn.dataset.bact;
    if (act === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    else if (act === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
    else if (act === 'edit') { openBannerEditor(i); return; }
    else if (act === 'delete') {
      const ok = await ask({
        title: 'Hapus banner?',
        body: `Banner #${i + 1}${arr[i].title ? ` “${arr[i].title}”` : ''} dihapus dari daftar. Baru berlaku di situs setelah kamu menekan Simpan perubahan.`,
        ok: 'Hapus banner',
        danger: true,
      });
      if (!ok) return;
      arr.splice(i, 1);
    } else return;
    renderBannerList();
    stage.restart();
    updateDirty();
    // Fokus tetap di tombol yang sama setelah daftar digambar ulang (keyboard).
    if (act === 'up' || act === 'down') {
      const ni = act === 'up' ? i - 1 : i + 1;
      $('bannerList').querySelector(`.banner-item[data-i="${ni}"] [data-bact="${act}"]:not([disabled])`)?.focus();
    }
  });
  $('bannerList').addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-bact="toggle"]');
    if (!inp || !site.draft) return;
    const i = Number(inp.closest('.banner-item').dataset.i);
    site.draft.banners[i].active = inp.checked;
    renderBannerList();
    stage.restart();
    updateDirty();
  });

  /* ---------------- Pratinjau hero (carousel) ---------------- */
  const stage = {
    idx: 0, timer: null,
    stop() { clearTimeout(this.timer); this.timer = null; qsa('#stagePreview video').forEach((v) => v.pause()); },
    restart() {
      this.stop();
      if (!site.draft) return;
      const el = $('stagePreview');
      const act = (site.draft.banners || []).filter((b) => b.active);
      if (!act.length) {
        el.innerHTML = '<p class="stage-preview__empty">Tidak ada banner aktif.<br>Halaman depan akan memakai video bawaan.</p>';
        return;
      }
      if (this.idx >= act.length) this.idx = 0;
      el.innerHTML = `
        ${act.length > 1 ? `<div class="stage-preview__dots">${act.map((_, i) => `<i class="${i === this.idx ? 'is-on' : ''}"></i>`).join('')}</div>` : ''}
        ${act.map((b, i) => `
          <div class="stage-preview__slide${i === this.idx ? ' is-on' : ''}">
            ${b.type === 'video'
              ? `<video src="${esc(b.src)}" ${b.poster ? `poster="${esc(b.poster)}"` : ''} muted playsinline preload="metadata" ${act.length === 1 ? 'loop' : ''}></video>`
              : `<img src="${esc(b.src)}" alt="">`}
            ${captionHtml(b)}
          </div>`).join('')}`;
      if (currentView === 'site') this.play(act);
    },
    play(act) {
      const slides = qsa('#stagePreview .stage-preview__slide');
      const vid = slides[this.idx]?.querySelector('video');
      if (vid) { try { vid.currentTime = 0; } catch { /* abaikan */ } vid.play().catch(() => {}); }
      if (act.length < 2 || reduceMotion) return;
      const next = () => {
        clearTimeout(this.timer);
        if (vid) vid.onended = null;
        slides[this.idx]?.classList.remove('is-on');
        slides[this.idx]?.querySelector('video')?.pause();
        this.idx = (this.idx + 1) % act.length;
        slides[this.idx]?.classList.add('is-on');
        qsa('#stagePreview .stage-preview__dots i').forEach((d, i) => d.classList.toggle('is-on', i === this.idx));
        this.play(act);
      };
      // Pindah setelah interval ATAU saat video selesai — mana yang duluan
      // (aturan yang sama dengan hero halaman depan).
      if (vid) vid.onended = next;
      this.timer = setTimeout(next, num(site.draft.bannerIntervalMs) || 6000);
    },
  };

  function captionHtml(b) {
    if (!b.title && !b.subtitle && !b.linkLabel) return '';
    return `<div class="cap-overlay"><div>${b.title ? `<strong>${esc(b.title)}</strong>` : ''}${b.subtitle ? `<span>${esc(b.subtitle)}</span>` : ''}</div>${b.link && b.linkLabel ? `<em>${esc(b.linkLabel)} <i class="fa-solid fa-arrow-right"></i></em>` : ''}</div>`;
  }

  function updateStageInfo() {
    const d = site.draft;
    if (!d) return;
    const act = (d.banners || []).filter((b) => b.active).length;
    setText('stageInfo', act
      ? `${act} banner aktif · ganti tiap ${Math.round(num(d.bannerIntervalMs) / 1000)} dtk`
      : 'Tidak ada banner aktif.');
  }

  /* ---------------- Editor banner (modal) ---------------- */
  const ed = { index: null, type: 'video', uploading: false, previewTimer: null };

  function setEdType(type) {
    ed.type = type === 'image' ? 'image' : 'video';
    qsa('#bType .seg__btn').forEach((b) => {
      const on = b.dataset.type === ed.type;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    });
    setText('bUploadLabel', ed.type === 'video' ? 'Unggah video dari perangkat' : 'Unggah gambar dari perangkat');
    setText('bUploadHint', ed.type === 'video'
      ? 'MP4/WEBM, maks. 25 MB · bisa juga seret file ke sini'
      : 'PNG/JPG/WEBP/GIF, maks. 25 MB · bisa juga seret file ke sini');
    $('bSrc').placeholder = ed.type === 'video' ? 'https://…/banner.mp4' : 'https://…/banner.webp';
    $('bFile').accept = MEDIA_TYPES[ed.type].join(',');
    $('bPosterField').hidden = ed.type !== 'video';
    renderEdPreview();
  }
  $('bType').addEventListener('click', (e) => {
    const b = e.target.closest('.seg__btn');
    if (b) setEdType(b.dataset.type);
  });

  function openBannerEditor(index = null) {
    if (!site.draft) return;
    if (index === null && site.draft.banners.length >= MAX_BANNERS) { toast(`Maksimal ${MAX_BANNERS} banner.`, 'err'); return; }
    ed.index = index;
    const b = index === null
      ? { type: 'video', src: '', poster: '', title: '', subtitle: '', link: '', linkLabel: '', active: true }
      : site.draft.banners[index];
    setText('bannerModalTitle', index === null ? 'Tambah banner' : `Ubah banner #${index + 1}`);
    $('bApply').querySelector('span').textContent = index === null ? 'Tambahkan banner' : 'Pakai perubahan';
    $('bSrc').value = b.src || '';
    $('bPoster').value = b.poster || '';
    $('bTitle').value = b.title || '';
    $('bSubtitle').value = b.subtitle || '';
    $('bLink').value = b.link || '';
    $('bLinkLabel').value = b.linkLabel || '';
    $('bActive').checked = b.active !== false;
    setFormErr('');
    $('bProgress').hidden = true;
    qsa('#bannerModal [data-count-for]').forEach(updateCount);
    setEdType(b.type);
    openModal($('bannerModal'), $('bSrc'));
  }
  $('btnAddBanner').addEventListener('click', () => openBannerEditor(null));
  $('bannerModal').addEventListener('modal:close', () => { $('bPreview').querySelector('video')?.pause(); });

  function setFormErr(msg) {
    const el = $('bFormErr');
    el.textContent = msg;
    el.classList.toggle('is-err', !!msg);
  }

  function edBanner() {
    return {
      type: ed.type,
      src: $('bSrc').value.trim(),
      poster: ed.type === 'video' ? $('bPoster').value.trim() : '',
      title: $('bTitle').value.trim(),
      subtitle: $('bSubtitle').value.trim(),
      link: $('bLink').value.trim(),
      linkLabel: $('bLinkLabel').value.trim(),
      active: $('bActive').checked,
    };
  }

  function renderEdPreview() {
    const box = $('bPreview');
    const b = edBanner();
    if (!b.src) { box.innerHTML = 'Masukkan URL atau unggah file untuk melihat pratinjau.'; return; }
    if (!isMedia(b.src)) { box.innerHTML = '<span class="media-err">Sumber harus URL http(s) atau file dari /uploads/.</span>'; return; }
    box.innerHTML = (b.type === 'video'
      ? `<video src="${esc(b.src)}" ${b.poster && isMedia(b.poster) ? `poster="${esc(b.poster)}"` : ''} muted playsinline autoplay loop preload="metadata"></video>`
      : `<img src="${esc(b.src)}" alt="">`) + captionHtml(b);
    const m = box.querySelector('video, img');
    m.addEventListener('error', () => {
      box.innerHTML = `<span class="media-err"><i class="fa-solid fa-link-slash"></i> ${b.type === 'video' ? 'Video' : 'Gambar'} tidak bisa dimuat. Cek URL atau jenis medianya.</span>`;
    }, { once: true });
  }
  const queuePreview = () => { clearTimeout(ed.previewTimer); ed.previewTimer = setTimeout(renderEdPreview, 350); };
  ['bSrc', 'bPoster'].forEach((id) => $(id).addEventListener('input', queuePreview));
  ['bTitle', 'bSubtitle', 'bLink', 'bLinkLabel'].forEach((id) => $(id).addEventListener('input', () => {
    // Cukup perbarui teks keterangan — jangan muat ulang videonya tiap ketikan.
    const box = $('bPreview');
    if (!box.querySelector('video, img')) return;
    box.querySelector('.cap-overlay')?.remove();
    box.insertAdjacentHTML('beforeend', captionHtml(edBanner()));
  }));

  // Unggah file: body MENTAH (bukan multipart), Content-Type = tipe file.
  // Pakai XHR (bukan fetch) karena fetch belum bisa melaporkan progres unggah.
  function uploadMedia(file, kind) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/admin/site-media');
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name || 'media'));
      xhr.setRequestHeader('x-user-id', admin.id || '');
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const p = Math.round((e.loaded / e.total) * 100);
        setText('bProgressPct', p + '%');
        $('bProgressBar').parentElement.style.setProperty('--v', p + '%');
      };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { data = null; }
        if (xhr.status === 401 || xhr.status === 403) { sessionInvalid(); reject(new Error('Sesi admin tidak valid.')); return; }
        if (xhr.status >= 200 && xhr.status < 300 && data?.success && data.url) resolve(data);
        else reject(new Error(data?.message || (xhr.status === 413 ? 'Ukuran file maksimal 25 MB.' : `Gagal mengunggah (HTTP ${xhr.status}).`)));
      };
      xhr.onerror = () => reject(new Error('Koneksi putus saat mengunggah.'));
      xhr.send(file);
      void kind;
    });
  }

  const fileSize = (b) => (b >= 1048576 ? `${fmt1(b / 1048576, 1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  async function handleUpload(file, kind) {
    if (!file || ed.uploading) return;
    setFormErr('');
    const allowed = kind === 'poster' ? MEDIA_TYPES.image : [...MEDIA_TYPES.video, ...MEDIA_TYPES.image];
    if (!allowed.includes(file.type)) {
      setFormErr(kind === 'poster' ? 'Poster harus gambar PNG, JPG, WEBP, atau GIF.' : 'Tipe file tidak didukung. Pakai MP4, WEBM, PNG, JPG, WEBP, atau GIF.');
      return;
    }
    if (file.size > MAX_UPLOAD) { setFormErr(`File ${fileSize(file.size)} — maksimal 25 MB.`); return; }
    if (!file.size) { setFormErr('File kosong.'); return; }
    // File video diunggah saat mode "Gambar" (atau sebaliknya): ikuti file-nya.
    if (kind === 'src') {
      const t = file.type.startsWith('video/') ? 'video' : 'image';
      if (t !== ed.type) setEdType(t);
    }
    ed.uploading = true;
    $('bApply').disabled = true;
    $('bUploadZone').disabled = true;
    $('bPosterUpload').disabled = true;
    $('bProgress').hidden = false;
    setText('bProgressName', `${kind === 'poster' ? 'Poster · ' : ''}${file.name} · ${fileSize(file.size)}`);
    setText('bProgressPct', '0%');
    $('bProgressBar').parentElement.style.setProperty('--v', '0%');
    $('bProgressBar').parentElement.classList.remove('is-danger');
    try {
      const res = await uploadMedia(file, kind);
      if (kind === 'poster') $('bPoster').value = res.url;
      else { $('bSrc').value = res.url; if (res.type) setEdType(res.type); }
      setText('bProgressPct', 'selesai');
      $('bProgressBar').parentElement.style.setProperty('--v', '100%');
      renderEdPreview();
      toast(`${kind === 'poster' ? 'Poster' : 'Media'} terunggah.`);
    } catch (err) {
      setFormErr(err.message);
      setText('bProgressPct', 'gagal');
      $('bProgressBar').parentElement.classList.add('is-danger');
    } finally {
      ed.uploading = false;
      $('bApply').disabled = false;
      $('bUploadZone').disabled = false;
      $('bPosterUpload').disabled = false;
    }
  }

  $('bUploadZone').addEventListener('click', () => $('bFile').click());
  $('bFile').addEventListener('change', (e) => { handleUpload(e.target.files[0], 'src'); e.target.value = ''; });
  $('bPosterUpload').addEventListener('click', () => $('bPosterFile').click());
  $('bPosterFile').addEventListener('change', (e) => { handleUpload(e.target.files[0], 'poster'); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => $('bUploadZone').addEventListener(ev, (e) => { e.preventDefault(); $('bUploadZone').classList.add('is-drag'); }));
  ['dragleave', 'drop'].forEach((ev) => $('bUploadZone').addEventListener(ev, (e) => { e.preventDefault(); $('bUploadZone').classList.remove('is-drag'); }));
  $('bUploadZone').addEventListener('drop', (e) => handleUpload(e.dataTransfer?.files?.[0], 'src'));

  $('bApply').addEventListener('click', () => {
    if (ed.uploading) return;
    const b = edBanner();
    if (!b.src) { setFormErr('Sumber media wajib diisi (URL atau unggah file).'); $('bSrc').focus(); return; }
    if (!isMedia(b.src)) { setFormErr('Sumber media harus URL http(s) atau file dari /uploads/.'); $('bSrc').focus(); return; }
    if (b.poster && !isMedia(b.poster)) { setFormErr('Poster harus URL http(s) atau file dari /uploads/.'); $('bPoster').focus(); return; }
    if (!isLink(b.link)) { setFormErr('Tautan tombol harus diawali http://, https://, atau / (halaman internal).'); $('bLink').focus(); return; }
    const arr = site.draft.banners;
    if (ed.index === null) {
      // ID dibuat di sini supaya carousel di halaman depan bisa membedakan banner.
      const id = 'b' + Math.random().toString(16).slice(2, 10);
      arr.push({ id, ...b });
      toast('Banner ditambahkan. Tekan “Simpan perubahan” supaya tampil di situs.', 'info');
    } else {
      arr[ed.index] = { id: arr[ed.index].id, ...b };
      toast('Banner diperbarui. Jangan lupa simpan.', 'info');
    }
    closeModal($('bannerModal'));
    renderBannerList();
    stage.restart();
    updateDirty();
  });

  /* ---------------- Simpan / batalkan ---------------- */
  function validateDraft(d) {
    const a = d.announcement || {};
    if (a.enabled && !String(a.text || '').trim()) return ['Teks pengumuman wajib diisi kalau pengumuman diaktifkan.', 'annText'];
    if (!isLink(a.link)) return ['Tautan pengumuman harus diawali http://, https://, atau /.', 'annLink'];
    const ms = num(d.bannerIntervalMs);
    if (ms < 3000 || ms > 30000) return ['Interval banner harus 3–30 detik.', 'bannerInterval'];
    for (const [k, v] of Object.entries(d.social || {})) {
      if (!v) continue;
      if (k === 'whatsapp' && /^\+?[\d\s-]{8,20}$/.test(v)) continue;
      if (!RE_HTTP.test(v)) return [`Tautan ${k} harus diawali http:// atau https://.`, 'soc' + k.charAt(0).toUpperCase() + k.slice(1)];
    }
    return null;
  }

  $('btnSiteSave').addEventListener('click', (e) => {
    if (!site.draft) return;
    const bad = validateDraft(site.draft);
    if (bad) { toast(bad[0], 'err'); $(bad[1])?.focus(); return; }
    const payload = clone(pickSite(site.draft));
    busy(e.currentTarget, 'Menyimpan…', async () => {
      try {
        const result = await api('/api/admin/site-settings', { method: 'POST', body: payload });
        // Pakai hasil validasi server (mis. nomor WA jadi tautan wa.me).
        applySaved(result.settings);
        toast('Tampilan situs disimpan. Halaman depan langsung memakai pengaturan baru.');
      } catch (err) { if (!err.auth) toast(err.message, 'err', 6000); }
    }).then(updateDirty);
  });
  $('btnSiteReset').addEventListener('click', async () => {
    const ok = await ask({ title: 'Batalkan perubahan?', body: 'Semua perubahan yang belum disimpan akan dikembalikan ke versi tersimpan.', ok: 'Batalkan perubahan', danger: true });
    if (!ok || !site.saved) return;
    site.draft = clone(site.saved);
    fillSiteForm();
    updateDirty();
  });

  /* ==================================================================
     Mulai
     ================================================================== */
  showView(location.hash.slice(1) || 'overview', { scroll: false });
  loadAdminData();
  pollLive();
  // Auto-refresh status bot tiap 10 detik (dilewati saat tab tidak dilihat).
  setInterval(() => { if (!document.hidden) loadBotsData(); }, 10000);
  // Teks "x mnt lalu" di tabel per bot tetap segar walau data belum berubah.
  setInterval(() => { if (!document.hidden && currentView === 'overview') renderOverview(); }, 60000);
})();
