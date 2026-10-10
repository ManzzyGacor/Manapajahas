/* ==========================================================================
   landing.js — skrip halaman publik Varesa (beranda & status)
   --------------------------------------------------------------------------
   Prinsip:
   - Tidak boleh ada error yang merusak halaman walau API mati. Semua fetch
     dibungkus, nilai yang belum ada tampil "—" atau skeleton.
   - Polling /api/public/live tiap 3 detik, berhenti saat tab disembunyikan,
     mundur eksponensial saat gagal supaya server yang sedang susah tidak
     makin dibebani.
   - Elemen diisi lewat atribut data-* (data-k, data-meter, data-cap-*, …),
     jadi halaman status bisa memakai mesin yang sama tanpa duplikasi.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const PAGE = document.body.dataset.page || 'landing';
  const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const POLL_MS = 3000;
  const HISTORY_EVERY_MS = 30000;
  const DEFAULT_BANNER = {
    id: 'default', type: 'video', active: true,
    src: 'https://raw.githubusercontent.com/ManzzyGacor/Urlmanzzy/main/file_1763982754350_735.mp4',
  };

  document.documentElement.classList.add('js');

  /* ---------------------------------------------------------------- util */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (v != null && v !== '' && isFinite(+v) ? +v : null));
  const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* mode privat */ } },
    sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    sset(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* abaikan */ } },
  };

  // Hanya izinkan tautan http(s) atau relatif — admin bisa salah ketik,
  // dan "javascript:" di href adalah celah XSS klasik.
  function safeUrl(u, { allowHash = true } = {}) {
    const s = String(u || '').trim();
    if (!s) return '';
    if (s.startsWith('/') && !s.startsWith('//')) return s;
    if (allowHash && s.startsWith('#')) return s;
    try {
      const url = new URL(s, location.origin);
      return /^https?:$/.test(url.protocol) ? url.href : '';
    } catch (e) { return ''; }
  }

  async function getJSON(url, timeout = 8000) {
    const ctl = 'AbortController' in window ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), timeout) : 0;
    try {
      const res = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' }, signal: ctl ? ctl.signal : undefined });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data || data.success === false) throw new Error((data && data.message) || 'Respons tidak valid');
      return data;
    } finally { clearTimeout(t); }
  }

  /* ------------------------------------------------------- format angka */
  const nfInt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
  const dec = (n, d = 1) => n.toFixed(d).replace(/\.0+$/, '').replace('.', ',');
  function compactParts(n) {
    const a = Math.abs(n);
    if (a >= 1e9) return [dec(n / 1e9, n / 1e9 >= 100 ? 0 : 1), 'M'];
    if (a >= 1e6) return [dec(n / 1e6, n / 1e6 >= 100 ? 0 : 1), 'jt'];
    if (a >= 1e4) return [dec(n / 1e3, n / 1e3 >= 100 ? 0 : 1), 'rb'];
    return [nfInt.format(Math.round(n)), ''];
  }
  const FMT = {
    int: (n) => nfInt.format(Math.round(n)),
    compact: (n) => { const [v, u] = compactParts(n); return u ? `${v}<small>${u}</small>` : v; },
    compactText: (n) => compactParts(n).join(' ').trim(),
    dec1: (n) => (Math.abs(n) >= 100 ? nfInt.format(Math.round(n)) : n.toFixed(1).replace('.', ',')),
    pct: (n) => `${Math.round(n)}%`,
    mb: (n) => (n >= 1024 ? `${dec(n / 1024, 1)} GB` : `${Math.round(n)} MB`),
  };
  function fmtUptime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}h ${h}j`;
    if (h > 0) return `${h}j ${m}m`;
    return `${m}m ${sec % 60}d`;
  }
  // Jumlah core bisa pecahan: di container/panel, kuota CPU sering 0,5 atau
  // 1,5 core. Dulu dibulatkan jadi "1 core" — menyesatkan saat membaca beban.
  function fmtCores(n) {
    const r = Math.round(n * 100) / 100;
    return Number.isInteger(r) ? nfInt.format(r) : String(r).replace('.', ',');
  }
  // Panjang rentang waktu untuk label sumbu-x grafik ("−45 dtk", "−3 mnt").
  function fmtAgo(ms) {
    const s = Math.max(1, Math.round(ms / 1000));
    if (s < 60) return `−${s} dtk`;
    const m = Math.round(s / 60);
    return m < 60 ? `−${m} mnt` : `−${dec(s / 3600, 1)} jam`;
  }
  function relTime(at, now = Date.now()) {
    const s = Math.max(0, Math.round((now - at) / 1000));
    if (s < 5) return 'baru saja';
    if (s < 60) return `${s} dtk lalu`;
    if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
    if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
    return `${Math.floor(s / 86400)} hari lalu`;
  }
  const pad = (n) => String(n).padStart(2, '0');
  const clock = (t = new Date()) => `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;

  // Angka "berjalan" dari nilai lama ke nilai baru.
  function countTo(el, to, fmt) {
    const from = typeof el._v === 'number' ? el._v : 0;
    el._v = to;
    if (el._raf) cancelAnimationFrame(el._raf);
    if (REDUCED || from === to || !document.body.contains(el)) { el.innerHTML = fmt(to); return; }
    const dur = from === 0 ? 1100 : 650;
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.innerHTML = fmt(from + (to - from) * e);
      if (p < 1) el._raf = requestAnimationFrame(step); else el._raf = 0;
    };
    el._raf = requestAnimationFrame(step);
  }

  // Nilai kosong ditandai .is-empty supaya "—" tampil redup, bukan garis
  // tebal raksasa di angka besar saat server belum terjangkau.
  function setEmpty(el) { el.textContent = '—'; el._v = undefined; el.classList.add('is-empty'); }
  function setVal(el, v, f) {
    el.classList.remove('v-skel');
    if (v == null || v === '') { setEmpty(el); return; }
    el.classList.remove('is-empty');
    if (f === 'text') { el.textContent = String(v); return; }
    if (f === 'node') { el.textContent = 'Node.js ' + String(v).replace(/^v/i, ''); return; }
    const n = num(v);
    if (n == null) { setEmpty(el); return; }
    if (f === 'uptime') { el.textContent = fmtUptime(n); return; }
    if (f === 'cores') { el.textContent = fmtCores(n); el._v = n; return; }
    countTo(el, n, FMT[f] || FMT.int);
  }

  function toast(msg, kind = 'ok') {
    const wrap = $('#toasts');
    if (!wrap) return;
    const t = document.createElement('div');
    t.className = `v-toast v-toast--${kind}`;
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, 2200);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      try {
        const ta = Object.assign(document.createElement('textarea'), { value: text });
        ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy'); ta.remove(); return ok;
      } catch (e2) { return false; }
    }
  }

  const icon = (id, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

  /* ----------------------------------------------------- status login */
  // Kunci 'currentUser' sama dengan yang ditulis login.html & app.js.
  let USER = null;
  try { USER = JSON.parse(store.get('currentUser') || 'null'); } catch (e) { USER = null; }
  const LOGGED_IN = !!(USER && (USER.id || USER._id));
  const AUTH_HREF = LOGGED_IN ? '/dashboard' : '/login';
  function applyAuth() {
    if (!LOGGED_IN) return;
    $$('[data-auth-cta]').forEach((a) => { a.href = '/dashboard'; });
    $$('[data-auth-label]').forEach((s) => { s.textContent = 'Buka Dashboard'; });
    $$('[data-auth-link]').forEach((a) => { a.href = '/dashboard'; a.textContent = 'Dashboard'; });
  }

  /* ------------------------------------------------------- navigasi */
  function initNav() {
    const nav = $('#nav');
    if (!nav) return;
    const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    const btn = $('#menuBtn'), sheet = $('#menuSheet');
    if (!btn || !sheet) return;
    const useEl = btn.querySelector('use');
    const close = () => {
      if (sheet.hidden) return;
      sheet.hidden = true; nav.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-label', 'Buka menu');
      if (useEl) useEl.setAttribute('href', '#i-menu');
      document.body.classList.remove('is-locked');
    };
    const open = () => {
      sheet.style.setProperty('--sheet-top', Math.max(0, nav.getBoundingClientRect().bottom) + 'px');
      sheet.hidden = false; nav.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true'); btn.setAttribute('aria-label', 'Tutup menu');
      if (useEl) useEl.setAttribute('href', '#i-x');
      document.body.classList.add('is-locked');
    };
    btn.addEventListener('click', () => (sheet.hidden ? open() : close()));
    $$('[data-close-menu]', sheet).forEach((el) => el.addEventListener('click', close));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    window.addEventListener('resize', () => { if (window.innerWidth > 860) close(); });
  }

  /* ---------------------------------------------- muncul saat discroll */
  function initReveal() {
    const els = $$('.v-reveal, .steps');
    if (!('IntersectionObserver' in window) || REDUCED) { els.forEach((el) => el.classList.add('is-in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach((el) => io.observe(el));
  }

  /* ------------------------------------------------------------- FAQ */
  function initFaq() {
    const items = $$('.faq__item');
    const setOpen = (item, open) => {
      items.forEach((i) => { i.classList.remove('is-open'); const b = $('.faq__q', i); if (b) b.setAttribute('aria-expanded', 'false'); });
      if (open) { item.classList.add('is-open'); const q = $('.faq__q', item); if (q) q.setAttribute('aria-expanded', 'true'); }
    };
    items.forEach((item) => {
      const q = $('.faq__q', item);
      if (!q) return;
      q.addEventListener('click', () => setOpen(item, !item.classList.contains('is-open')));
    });
    // Tautan langsung ke satu pertanyaan (mis. "Cara kerjanya" di bagian
    // harga → #faq-multibot) harus membuka jawabannya, bukan cuma menggulir.
    const fromHash = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      const item = id && document.getElementById(id);
      if (item && item.classList.contains('faq__item')) setOpen(item, true);
    };
    window.addEventListener('hashchange', fromHash);
    // hashchange tidak terpicu kalau hash-nya sama (tautan diklik dua kali).
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#faq-"]');
      const item = a && document.getElementById(a.getAttribute('href').slice(1));
      if (item && item.classList.contains('faq__item')) setOpen(item, true);
    });
    fromHash();
  }

  /* =================================================================
     BANNER BERGERAK (diatur admin)
     ================================================================= */
  function inferType(b) {
    if (b.type === 'video' || b.type === 'image') return b.type;
    return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(b.src || '') ? 'video' : 'image';
  }

  function fallbackSlideHTML() {
    return `
      <div class="fb" aria-label="Pratinjau bot Varesa">
        <div class="fb__brand">
          <img src="/assets/logo-mark.svg" alt="">
          <div><b>Bot WhatsApp<br>kamu, 24 jam.</b><span><i class="v-dot v-dot--live"></i>Bot Varesa · online</span></div>
        </div>
        <div class="fb__chat">
          <div class="fb__b fb__b--me">.menu</div>
          <div class="fb__b">Halo! Bot aktif di grup ini.<br><code>.tiktok</code> unduh video · <code>.sticker</code> bikin stiker<small>bot · baru saja</small></div>
          <div class="fb__b fb__b--me">.ping</div>
          <div class="fb__b">Pong! Respons <b>230 ms</b><small>bot · baru saja</small></div>
        </div>
      </div>`;
  }

  function Stage(root, banners, intervalMs) {
    const view = $('#stageView', root);
    const prog = $('#stageProgress', root);
    const countEl = $('#stageCount', root);
    const toggle = $('#stageToggle', root);
    const interval = clamp(num(intervalMs) || 6000, 2500, 60000);
    const MAX_DWELL = 90000;
    const slides = [];
    // Waktu tayang memakai "jam virtual": startedAt digeser saat jeda/lanjut,
    // jadi sisa waktu & progres bar tetap akurat walau banner dijeda berkali-
    // kali atau durasi video baru diketahui setelah metadata termuat.
    let idx = -1, timer = 0, startedAt = 0, playedAtPause = 0, prevTimer = 0;
    let userPaused = REDUCED, sysPaused = false, inView = true, dead = false;
    let wasPaused = userPaused;
    const now = () => performance.now();
    const isPaused = () => userPaused || sysPaused;
    const elapsed = () => (isPaused() ? playedAtPause : now() - startedAt);

    const list = (Array.isArray(banners) ? banners : [])
      .filter((b) => b && b.active !== false && safeUrl(b.src, { allowHash: false }))
      .map((b) => ({ ...b, type: inferType(b), src: safeUrl(b.src, { allowHash: false }) }))
      .slice(0, 12);
    const multi = list.length > 1;

    // Lapisan dasar (ilustrasi chat) selalu ada di belakang slide: terlihat
    // saat video masih memuat, dan jadi cadangan kalau semua banner gagal.
    view.innerHTML = `<div class="stage__base">${fallbackSlideHTML()}</div>`;
    prog.innerHTML = '';
    if (!list.length) { finish(); return; }

    list.forEach((b, i) => {
      const el = document.createElement('div');
      el.className = 'stage__slide';
      el.setAttribute('role', 'group');
      el.setAttribute('aria-roledescription', 'slide');
      el.setAttribute('aria-label', `${i + 1} dari ${list.length}`);
      const s = { b, el, media: null, seg: null, broken: false, started: false };
      const ready = () => el.classList.add('is-ready');
      let media;
      if (b.type === 'video') {
        media = document.createElement('video');
        media.muted = true; media.defaultMuted = true; media.playsInline = true;
        media.setAttribute('muted', ''); media.setAttribute('playsinline', ''); media.setAttribute('webkit-playsinline', '');
        media.setAttribute('disablepictureinpicture', ''); media.setAttribute('aria-hidden', 'true');
        media.preload = i === 0 ? 'auto' : 'metadata';
        media.loop = !multi;
        const poster = safeUrl(b.poster, { allowHash: false });
        if (poster) media.poster = poster;
        media.addEventListener('error', () => fail(s));
        media.addEventListener('loadeddata', ready);
        // Durasi baru diketahui di sini → hitung ulang lama tayang.
        media.addEventListener('loadedmetadata', () => { if (slides[idx] === s) plan(); });
        // Video yang telat mulai (buffer/jaringan lambat) jangan sampai
        // "kehilangan" jatah tayang: jam diulang saat video benar-benar jalan.
        media.addEventListener('playing', () => {
          if (slides[idx] !== s || s.started) return;
          s.started = true;
          if (!isPaused() && elapsed() > 250 && elapsed() < 8000) { startedAt = now(); plan(); }
        });
        media.addEventListener('ended', () => { if (slides[idx] === s && multi) next(); });
        media.src = b.src;
      } else {
        media = document.createElement('img');
        media.decoding = 'async';
        media.alt = b.title || 'Banner Varesa';
        media.addEventListener('error', () => fail(s));
        media.addEventListener('load', ready);
        if (i > 1) media.loading = 'lazy';
        media.src = b.src;
        if (media.complete && media.naturalWidth) ready();
      }
      s.media = media;
      el.appendChild(media);

      const link = safeUrl(b.link);
      if (b.title || b.subtitle || link) {
        const ext = /^https?:/.test(link) && !link.startsWith(location.origin);
        const cap = document.createElement('div');
        cap.className = 'stage__cap';
        cap.innerHTML = `<div>${b.title ? `<h3>${esc(b.title)}</h3>` : ''}${b.subtitle ? `<p>${esc(b.subtitle)}</p>` : ''}</div>` +
          (link ? `<a class="v-btn v-btn--light v-btn--sm" href="${esc(link)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${esc(b.linkLabel || 'Lihat')}${icon('arrow-right')}</a>` : '');
        el.appendChild(cap);
      }
      view.appendChild(el);

      if (multi) {
        const seg = document.createElement('button');
        seg.type = 'button'; seg.className = 'stage__seg';
        seg.setAttribute('role', 'tab');
        seg.setAttribute('aria-label', `Banner ${i + 1}${b.title ? ': ' + b.title : ''}`);
        seg.innerHTML = '<i></i>';
        seg.addEventListener('click', () => show(i));
        prog.appendChild(seg);
        s.seg = seg;
      }
      slides.push(s);
    });

    if (toggle && (multi || list[0].type === 'video')) {
      toggle.hidden = false;
      toggle.addEventListener('click', () => { userPaused = !userPaused; syncPause(); });
    }
    if (REDUCED) root.classList.add('is-static');

    // Geser kiri/kanan di HP, panah kiri/kanan di keyboard.
    let x0 = null;
    view.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
    view.addEventListener('pointerup', (e) => {
      if (x0 == null || !multi) return;
      const dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) (dx < 0 ? next() : prev());
    });
    root.addEventListener('keydown', (e) => {
      if (!multi) return;
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    });

    // Hemat baterai: jeda saat tab disembunyikan atau banner keluar layar.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((en) => { inView = en[0].isIntersecting; sysPaused = !inView || document.hidden; syncPause(); }, { threshold: 0.15 }).observe(root);
    }
    document.addEventListener('visibilitychange', () => { sysPaused = document.hidden || !inView; syncPause(); });

    syncToggle();
    show(0);

    function valid() { return slides.filter((s) => !s.broken); }
    function fail(s) {
      if (s.broken || dead) return;
      s.broken = true;
      s.el.remove();
      if (s.seg) s.seg.hidden = true;
      if (!valid().length) { finish(); return; }
      if (slides[idx] === s) next(); else updateCount();
    }
    // Tidak ada banner yang bisa tampil: cukup lapisan dasar.
    function finish() {
      dead = true;
      clearTimeout(timer);
      slides.forEach((s) => { try { if (s.media.pause) s.media.pause(); s.media.removeAttribute('src'); } catch (e) {} s.el.remove(); });
      prog.innerHTML = '';
      if (countEl) countEl.textContent = '';
      if (toggle) toggle.hidden = true;
      root.classList.add('is-fallback');
    }
    function updateCount() {
      if (!countEl) return;
      const vs = valid();
      countEl.textContent = vs.length > 1 ? `${pad(vs.indexOf(slides[idx]) + 1)} / ${pad(vs.length)}` : '';
    }
    function show(i) {
      if (dead || !slides.length) return;
      const n = slides.length;
      i = ((i % n) + n) % n;
      let guard = 0;
      while (slides[i].broken && guard++ < n) i = (i + 1) % n;
      if (slides[i].broken) { finish(); return; }
      const old = slides[idx];
      idx = i;
      const cur = slides[i];
      clearTimeout(prevTimer);
      slides.forEach((s, k) => {
        s.el.classList.toggle('is-on', k === i);
        s.el.classList.toggle('is-prev', s === old && s !== cur);
        s.el.setAttribute('aria-hidden', k === i ? 'false' : 'true');
        if (s.seg) {
          s.seg.classList.toggle('is-done', k < i);
          s.seg.classList.remove('is-on');
          s.seg.setAttribute('aria-selected', k === i ? 'true' : 'false');
        }
      });
      // Slide lama tetap di bawah sampai slide baru selesai muncul.
      if (old && old !== cur) {
        prevTimer = setTimeout(() => {
          old.el.classList.remove('is-prev');
          if (old.media.tagName === 'VIDEO') { try { old.media.pause(); old.media.currentTime = 0; } catch (e) {} }
        }, 850);
      }
      updateCount();
      startedAt = now(); playedAtPause = 0; cur.started = false;
      if (cur.media.tagName === 'VIDEO') {
        try { if (cur.media.currentTime) cur.media.currentTime = 0; } catch (e) {}
        if (!isPaused()) playSafe(cur.media);
      }
      plan();
    }
    function playSafe(v) { try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
    // Lama tayang → { bar: durasi progres bar, hard: batas timer }.
    // Gambar = interval. Video pendek diulang sampai interval terpenuhi
    // (dibulatkan ke akhir putaran supaya tidak terpotong). Video panjang
    // diputar sampai selesai — event 'ended' yang memindah slide, timer
    // hanya jaring pengaman kalau video tersendat (maks 90 detik).
    function dwellFor(s) {
      const v = s.media.tagName === 'VIDEO' ? s.media : null;
      const d = v ? v.duration : NaN;
      if (!v || !isFinite(d) || d <= 0) return { bar: interval, hard: interval };
      const ms = d * 1000;
      if (ms >= interval) {
        v.loop = false;
        if (ms >= MAX_DWELL) return { bar: MAX_DWELL, hard: MAX_DWELL };
        return { bar: ms, hard: Math.min(ms + 4000, MAX_DWELL) };
      }
      v.loop = true;
      const t = Math.min(Math.ceil(interval / ms) * ms, interval * 2);
      return { bar: t, hard: t };
    }
    function plan() {
      clearTimeout(timer); timer = 0;
      if (!multi || dead) return;
      const d = dwellFor(slides[idx]);
      const el = elapsed();
      setBar(d.bar, el);
      if (!isPaused()) timer = setTimeout(next, Math.max(300, d.hard - el));
    }
    // Animasi bar diulang dari awal dengan delay negatif = waktu yang sudah
    // berlalu; lebih andal daripada mengubah durasi animasi yang sedang jalan.
    function setBar(total, el) {
      const s = slides[idx];
      if (!s || !s.seg) return;
      const bar = s.seg.querySelector('i');
      s.seg.classList.remove('is-on');
      s.seg.style.setProperty('--dur', Math.round(total) + 'ms');
      bar.style.animationDelay = `-${Math.round(clamp(el, 0, total))}ms`;
      void s.seg.offsetWidth;
      s.seg.classList.add('is-on');
    }
    function syncToggle() {
      root.classList.toggle('is-paused', isPaused());
      if (!toggle) return;
      toggle.setAttribute('aria-label', userPaused ? 'Putar banner' : 'Jeda banner');
      const u = toggle.querySelector('use');
      if (u) u.setAttribute('href', userPaused ? '#i-play' : '#i-pause');
      const svg = toggle.querySelector('svg');
      if (svg) svg.classList.toggle('i-play', userPaused);
    }
    function syncPause() {
      const paused = isPaused();
      syncToggle();
      if (paused === wasPaused || dead) { wasPaused = paused; return; }
      const s = slides[idx];
      if (paused) {
        // elapsed() sudah membaca mode jeda, jadi hitung manual di sini.
        playedAtPause = now() - startedAt;
        clearTimeout(timer); timer = 0;
        if (s && s.media.tagName === 'VIDEO') { try { s.media.pause(); } catch (e) {} }
      } else {
        if (REDUCED) root.classList.remove('is-static');
        startedAt = now() - playedAtPause;
        if (s && s.media.tagName === 'VIDEO') playSafe(s.media);
        plan();
      }
      wasPaused = paused;
    }
    function next() { show(idx + 1); }
    function prev() {
      const n = slides.length; let i = idx - 1, g = 0;
      while (slides[((i % n) + n) % n].broken && g++ < n) i--;
      show(i);
    }
  }

  /* =================================================================
     PENGATURAN SITUS (banner, pengumuman, sosial)
     ================================================================= */
  const SOCIAL = [
    ['whatsapp', 'whatsapp', 'WhatsApp'],
    ['channel', 'megaphone', 'Saluran WhatsApp'],
    ['instagram', 'instagram', 'Instagram'],
    ['tiktok', 'tiktok', 'TikTok'],
    ['github', 'github', 'GitHub'],
  ];

  function renderAnnouncement(a) {
    const bar = $('#ann');
    if (!bar || !a || !a.enabled) return;
    const text = String(a.text || '').trim().slice(0, 400);
    if (!text) return;
    let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    const key = 'vrs-ann-' + h;
    if (store.sget(key)) return;
    const track = $('#annTrack');
    track.innerHTML = `<span class="ann__item">${esc(text)}</span><span class="ann__item" aria-hidden="true">${esc(text)}</span>`;
    track.style.setProperty('--speed', clamp(Math.round(text.length * 0.32 + 14), 16, 70) + 's');
    const link = safeUrl(a.link);
    const l = $('#annLink');
    if (link && l) {
      l.href = link; l.hidden = false;
      $('#annLinkLabel').textContent = String(a.linkLabel || 'Lihat').slice(0, 30);
      if (/^https?:/.test(link) && !link.startsWith(location.origin)) { l.target = '_blank'; l.rel = 'noopener'; }
    }
    bar.hidden = false;
    $('#annClose').addEventListener('click', () => { bar.hidden = true; store.sset(key, '1'); });
  }

  function renderSocial(social) {
    const s = social || {};
    const wrap = $('#footSocial');
    const items = SOCIAL.map(([k, ic, label]) => [safeUrl(s[k], { allowHash: false }), ic, label]).filter(([u]) => u);
    if (wrap) wrap.innerHTML = items.map(([u, ic, label]) => `<a href="${esc(u)}" target="_blank" rel="noopener" aria-label="${label}" title="${label}">${icon(ic)}</a>`).join('');
    const help = $('#footHelp');
    if (help) {
      const wa = safeUrl(s.whatsapp, { allowHash: false }), ch = safeUrl(s.channel, { allowHash: false });
      if (wa) help.insertAdjacentHTML('beforeend', `<a href="${esc(wa)}" target="_blank" rel="noopener">Chat support</a>`);
      if (ch) help.insertAdjacentHTML('beforeend', `<a href="${esc(ch)}" target="_blank" rel="noopener">Saluran WhatsApp</a>`);
    }
    const sup = safeUrl(s.whatsapp || s.channel || s.instagram, { allowHash: false });
    $$('[data-support]').forEach((a) => {
      if (sup) { a.href = sup; a.target = '_blank'; a.rel = 'noopener'; } else a.hidden = true;
    });
  }

  // Batas bot per akun (diatur admin). Paket berlaku per bot, jadi teks
  // harga & FAQ menyebut berapa bot yang boleh dimiliki satu akun. Kalau
  // pengaturan gagal dimuat, teks bawaan di HTML (nilai default) dibiarkan.
  function renderLimits(l) {
    if (!l || typeof l !== 'object') return;
    const maxBots = num(l.maxBotsPerUser), maxFree = num(l.maxFreeBotsPerUser);
    if (maxBots == null || maxFree == null) return;
    const mb = clamp(Math.round(maxBots), 1, 50), mf = clamp(Math.round(maxFree), 0, 10);
    const total = mb === 1 ? 'maksimal 1 bot per akun' : `total sampai ${nfInt.format(mb)} bot`;
    $$('[data-lim-note]').forEach((el) => {
      el.textContent = mf > 0 ? `${nfInt.format(mf)} bot Free per akun, ${total}.` : `Bot Free sedang ditutup — tiap bot pakai paket berbayar, ${total}.`;
    });
    $$('[data-lim-free-per]').forEach((el) => { el.textContent = mf > 0 ? `${nfInt.format(mf)} bot / akun` : 'sedang ditutup'; });
    $$('[data-lim-max]').forEach((el) => { el.textContent = nfInt.format(mb); });
    $$('[data-lim-free-sentence]').forEach((el) => {
      el.textContent = mf > 0 ? `Bot Free dibatasi ${nfInt.format(mf)} per akun.` : 'Untuk saat ini bot Free sedang ditutup, jadi tiap bot memakai paket berbayar.';
    });
  }

  let SERVER_NAME = '';
  async function loadSettings() {
    let st = null;
    try { st = (await getJSON('/api/site/settings', 6000)).settings || null; } catch (e) { st = null; }
    const settings = st || {};
    if (settings.serverName) { SERVER_NAME = String(settings.serverName).slice(0, 40); $$('[data-srv-name]').forEach((el) => { el.textContent = SERVER_NAME; }); }
    renderAnnouncement(settings.announcement);
    renderSocial(settings.social);
    renderLimits(settings.limits);
    const root = $('#stage');
    if (root) {
      // Pengaturan gagal dimuat → pakai banner bawaan. Pengaturan ada tapi
      // semua banner nonaktif → juga pakai bawaan, supaya hero tidak kosong.
      const active = Array.isArray(settings.banners) ? settings.banners.filter((b) => b && b.active !== false && b.src) : [];
      try { Stage(root, active.length ? active : [DEFAULT_BANNER], settings.bannerIntervalMs); }
      catch (e) { $('#stageView').innerHTML = `<div class="stage__base">${fallbackSlideHTML()}</div>`; }
    }
  }

  /* =================================================================
     KATEGORI FITUR + MODAL COMMAND
     ================================================================= */
  const ICONS = {
    download: 'download', robot: 'bot', bot: 'bot', ai: 'bot', gamepad: 'gamepad', game: 'gamepad', games: 'gamepad',
    users: 'users', user: 'users', group: 'users', wand: 'wand', magic: 'wand', tools: 'tools', tool: 'tools', wrench: 'tools',
    store: 'store', shop: 'store', info: 'info', shield: 'shield', admin: 'shield', star: 'star', crown: 'star',
    image: 'image', photo: 'image', music: 'music', audio: 'music', sparkles: 'sparkles', fun: 'sparkles',
    moon: 'moon', mosque: 'moon', book: 'book', news: 'news', terminal: 'terminal', key: 'key', search: 'search',
  };
  const catIcon = (c) => ICONS[String(c.icon || '').toLowerCase()] || 'grid';
  let FEATURES = null;
  const CAT_LIMIT = 8;

  function renderFeatures(d) {
    FEATURES = d;
    const cats = (d.categories || []).filter((c) => c && c.name);
    const total = num(d.total) ?? cats.reduce((a, c) => a + (num(c.count) || 0), 0);
    $$('[data-feat-total]').forEach((el) => { el.textContent = total ? nfInt.format(total) : 'Ratusan'; });
    $$('[data-feat-stat]').forEach((el) => setVal(el, total || null, total >= 1e4 ? 'compact' : 'int'));

    const row = $('#pillRow');
    if (row) {
      row.innerHTML = cats.length
        ? cats.map((c) => `<button type="button" class="v-pill" data-open-cat="${esc(c.key)}">${esc(c.name)}<sup>${nfInt.format(num(c.count) || 0)}</sup></button>`).join('')
        : '<span class="v-pill">Daftar fitur belum tersedia</span>';
    }

    const grid = $('#catGrid'), more = $('#catMore');
    if (!grid) return;
    if (!cats.length) { grid.innerHTML = '<div class="catgrid__err">Daftar kategori belum tersedia. Coba muat ulang sebentar lagi.</div>'; return; }
    const card = (c) => `
      <button type="button" class="cat" data-open-cat="${esc(c.key)}">
        <span class="cat__top"><span class="cat__icon">${icon(catIcon(c))}</span><span class="cat__name">${esc(c.name)}</span><span class="cat__count">${nfInt.format(num(c.count) || 0)}</span></span>
        ${c.desc ? `<p class="cat__desc">${esc(c.desc)}</p>` : ''}
        <span class="cat__cmds">${(c.commands || []).slice(0, 4).map((x) => `<span>.${esc(x)}</span>`).join('')}</span>
        <span class="cat__go">${icon('arrow-right')}</span>
      </button>`;
    let expanded = false;
    const draw = () => {
      const show = expanded ? cats : cats.slice(0, CAT_LIMIT);
      grid.innerHTML = show.map(card).join('');
      if (more) {
        more.hidden = cats.length <= CAT_LIMIT;
        more.classList.toggle('is-open', expanded);
        more.innerHTML = expanded ? `Tampilkan lebih sedikit ${icon('chevron')}` : `Tampilkan ${cats.length - CAT_LIMIT} kategori lainnya ${icon('chevron')}`;
      }
    };
    draw();
    if (more && !more._b) {
      more._b = true;
      more.addEventListener('click', () => {
        expanded = !expanded; draw();
        if (!expanded) grid.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
      });
    }
  }

  // Daftar LENGKAP nama command (termasuk alias) untuk modal & pencarian.
  // /api/public/features cuma membawa maks. 40 command per kategori, jadi
  // ratusan command dulu tidak pernah bisa ditemukan di modal. Dimuat
  // sekali saja; kalau endpoint belum ada (server lama → 404) atau gagal,
  // modal tetap jalan memakai data fitur yang ringkas.
  let COMMANDS = null, commandsJob = null;
  function loadCommands() {
    if (COMMANDS) return Promise.resolve(COMMANDS);
    if (!commandsJob) {
      commandsJob = getJSON('/api/public/commands', 10000)
        .then((d) => {
          const cats = Array.isArray(d.categories) ? d.categories.filter((c) => c && c.key && Array.isArray(c.commands)) : [];
          if (!cats.length) throw new Error('kosong');
          COMMANDS = { total: num(d.total), categories: cats };
          return COMMANDS;
        })
        .catch(() => { commandsJob = null; return null; });
    }
    return commandsJob;
  }
  // Kategori untuk modal: urutan, nama & deskripsi dari data fitur (kalau
  // ada), daftar command dari data lengkap.
  function modalCats() {
    const feat = (FEATURES && FEATURES.categories) || [];
    if (!COMMANDS) return feat;
    const byKey = new Map(feat.map((c) => [c.key, c]));
    return COMMANDS.categories.map((c) => {
      const f = byKey.get(c.key) || {};
      return { ...f, ...c, name: c.name || f.name || c.key, desc: f.desc || '', count: c.commands.length };
    });
  }

  async function loadFeatures() {
    try {
      renderFeatures(await getJSON('/api/public/features', 8000));
      // Daftar lengkap diambil di muka saat browser senggang, supaya modal
      // langsung lengkap begitu dibuka.
      if ('requestIdleCallback' in window) window.requestIdleCallback(() => { loadCommands(); }, { timeout: 5000 });
      else setTimeout(() => { loadCommands(); }, 2500);
    }
    catch (e) {
      FEATURES = null;
      const row = $('#pillRow');
      if (row) row.innerHTML = '<a class="v-pill" href="/login">Daftar fitur ada di dashboard</a>';
      const grid = $('#catGrid');
      if (grid) grid.innerHTML = '<div class="catgrid__err">Daftar kategori belum bisa dimuat. Server mungkin sedang sibuk — coba muat ulang sebentar lagi.</div>';
      $$('[data-feat-stat]').forEach((el) => { el.classList.remove('v-skel'); setEmpty(el); });
    }
  }

  function initModal() {
    const modal = $('#catModal');
    if (!modal) return;
    const body = $('#catModalBody'), search = $('#catSearch'), title = $('#catModalTitle'), desc = $('#catModalDesc'), foot = $('#catModalFoot'), ic = $('#catModalIcon');
    let current = '*', lastFocus = null;

    const hl = (name, q) => {
      const s = esc('.' + name);
      if (!q) return s;
      const i = ('.' + name).toLowerCase().indexOf(q);
      if (i < 0) return s;
      const raw = '.' + name;
      return esc(raw.slice(0, i)) + '<mark>' + esc(raw.slice(i, i + q.length)) + '</mark>' + esc(raw.slice(i + q.length));
    };
    let loading = false;
    function render() {
      const cats = modalCats();
      const q = search.value.trim().toLowerCase().replace(/^\./, '');
      const pool = current === '*' ? cats : cats.filter((c) => c.key === current);
      let shown = 0;
      const groups = pool.map((c) => {
        const cmds = (c.commands || []).filter((x) => !q || String(x).toLowerCase().includes(q));
        shown += cmds.length;
        if (!cmds.length) return '';
        return `<div class="cmdgroup">${current === '*' ? `<h4><span>${esc(c.name)}</span><span>${nfInt.format(num(c.count) || 0)}</span></h4>` : ''}
          <div class="cmdlist">${cmds.map((x) => `<button type="button" class="cmd" data-cmd="${esc(x)}" title="Salin .${esc(x)}">${hl(x, q)}</button>`).join('')}</div></div>`;
      }).join('');
      body.innerHTML = cats.length
        ? (shown ? groups : `<div class="modal__empty">Tidak ada command yang cocok dengan “${esc(search.value.trim())}”.</div>`)
        : (loading ? '<div class="modal__empty">Memuat daftar command…</div>' : '<div class="modal__empty">Daftar command belum bisa dimuat.</div>');
      const totalCount = pool.reduce((a, c) => a + (num(c.count) || 0), 0);
      const partial = !COMMANDS && totalCount > shown && !q;
      foot.innerHTML = `<span>${nfInt.format(shown)} command ditampilkan${partial ? ` dari ${nfInt.format(totalCount)}` : ''}${loading ? ' · memuat sisanya…' : ''}</span><span>Klik command untuk menyalin</span>`;
    }
    function header() {
      const cats = modalCats();
      const c = cats.find((x) => x.key === current);
      title.textContent = c ? c.name : 'Semua command';
      const total = num(COMMANDS && COMMANDS.total) ?? num(FEATURES && FEATURES.total) ?? cats.reduce((a, x) => a + (num(x.count) || 0), 0);
      desc.textContent = c ? (c.desc || `${nfInt.format(num(c.count) || 0)} command di kategori ini`) : `${nfInt.format(total || 0)} command dari ${cats.length} kategori`;
      ic.innerHTML = icon(c ? catIcon(c) : 'grid');
    }
    function open(key, trigger) {
      lastFocus = trigger || document.activeElement;
      current = key || '*';
      if (current !== '*' && !modalCats().some((x) => x.key === current)) current = '*';
      search.value = '';
      header();
      loading = !COMMANDS;
      render();
      if (loading) {
        // Tampilkan dulu yang sudah ada, lalu ganti dengan daftar lengkap
        // begitu tiba — tanpa mengosongkan kata kunci yang sedang diketik.
        loadCommands().then(() => {
          loading = false;
          if (modal.hidden) return;
          const top = body.scrollTop;
          header(); render();
          body.scrollTop = top;
        });
      }
      modal.hidden = false;
      document.body.classList.add('is-locked');
      body.scrollTop = 0;
      setTimeout(() => { if (window.matchMedia('(pointer:fine)').matches) search.focus(); else $('[data-close-modal].v-btn', modal)?.focus(); }, 30);
    }
    function close() {
      if (modal.hidden) return;
      modal.hidden = true;
      document.body.classList.remove('is-locked');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    search.addEventListener('input', render);
    $$('[data-close-modal]', modal).forEach((el) => el.addEventListener('click', close));
    document.addEventListener('keydown', (e) => {
      if (modal.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        // Fokus tetap di dalam modal
        const f = $$('button, input, a[href]', modal).filter((x) => !x.disabled && x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-cmd]');
      if (!b) return;
      const ok = await copyText('.' + b.dataset.cmd);
      toast(ok ? `Disalin: .${b.dataset.cmd}` : 'Gagal menyalin', ok ? 'ok' : 'err');
    });
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-open-cat]');
      if (!t) return;
      e.preventDefault();
      open(t.dataset.openCat, t);
    });
  }

  /* =================================================================
     CONTOH KODE API
     ================================================================= */
  function initApi() {
    const pre = $('#codeReq'), res = $('#codeRes');
    if (!pre) return;
    const base = location.origin;
    const url = `${base}/api/v1/text`;
    const SNIP = {
      curl: { file: 'request.sh', code:
`curl -X POST '${url}' \\
  --header 'x-varesa-token: TOKEN_BOT_KAMU' \\
  --header 'Content-Type: application/json' \\
  --data-raw '{
    "number": "6281234567890",
    "text": "Halo dari Varesa"
  }'` },
      js: { file: 'kirim.js', code:
`const res = await fetch('${url}', {
  method: 'POST',
  headers: {
    'x-varesa-token': 'TOKEN_BOT_KAMU',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    number: '6281234567890',
    text: 'Halo dari Varesa'
  })
});

const data = await res.json();
console.log(data.status, data.data?.key?.id);` },
      py: { file: 'kirim.py', code:
`import requests

res = requests.post(
    "${url}",
    headers={"x-varesa-token": "TOKEN_BOT_KAMU"},
    json={
        "number": "6281234567890",
        "text": "Halo dari Varesa",
    },
    timeout=15,
)

print(res.json())` },
      go: { file: 'main.go', code:
`package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
)

func main() {
	body := []byte(\`{"number":"6281234567890","text":"Halo dari Varesa"}\`)
	req, _ := http.NewRequest("POST", "${url}", bytes.NewBuffer(body))
	req.Header.Set("x-varesa-token", "TOKEN_BOT_KAMU")
	req.Header.Set("Content-Type", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer res.Body.Close()

	out, _ := io.ReadAll(res.Body)
	fmt.Println(string(out))
}` },
    };
    const RESP =
`{
  "creator": "Varesa",
  "status": true,
  "data": {
    "key": {
      "remoteJid": "6281234567890@s.whatsapp.net",
      "fromMe": true,
      "id": "3EB0A9C2F1D4E5788A6C"
    },
    "messageTimestamp": 1757318400,
    "status": "SENT"
  }
}`;
    // Pewarnaan sintaks sederhana — cukup untuk contoh pendek, tanpa library.
    const KW = /^(const|await|async|let|return|import|from|package|func|defer|if|nil|def|print|curl|panic)$/;
    const RE = /("(?:[^"\\\n]|\\.)*")(\s*:)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`)|\b(true|false|null|None|nil)\b|(\b\d+(?:\.\d+)?\b)|(^|\s)(--?[a-zA-Z][\w-]*)|\b([A-Za-z_]\w*)\b/gm;
    function tokens(code) {
      const out = []; let last = 0, m;
      RE.lastIndex = 0;
      while ((m = RE.exec(code))) {
        if (m.index > last) out.push(['', code.slice(last, m.index)]);
        if (m[1]) { out.push(['t-k', m[1]]); out.push(['', m[2]]); }
        else if (m[3]) out.push(['t-s', m[3]]);
        else if (m[4]) out.push(['t-b', m[4]]);
        else if (m[5]) out.push(['t-n', m[5]]);
        else if (m[7]) { out.push(['', m[6]]); out.push(['t-w', m[7]]); }
        else if (m[8]) out.push([KW.test(m[8]) ? 't-b' : '', m[8]]);
        last = RE.lastIndex;
      }
      if (last < code.length) out.push(['', code.slice(last)]);
      return out;
    }
    function render(el, code) {
      const lines = [[]];
      tokens(code).forEach(([cls, text]) => {
        text.split('\n').forEach((part, i) => {
          if (i > 0) lines.push([]);
          if (part) lines[lines.length - 1].push(cls ? `<span class="${cls}">${esc(part)}</span>` : esc(part));
        });
      });
      el.innerHTML = lines.map((l, i) => `<span class="cl"><span class="cl__n">${i + 1}</span><span class="cl__c">${l.join('') || ' '}</span></span>`).join('');
    }
    render(res, RESP);
    const tabs = $$('#codeTabs .tabs__btn');
    let lang = store.get('vrs-code-lang');
    if (!SNIP[lang]) lang = 'curl';
    const pick = (l) => {
      lang = l;
      tabs.forEach((t) => { const on = t.dataset.lang === l; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; });
      $('#codeFile').textContent = SNIP[l].file;
      render(pre, SNIP[l].code);
      pre.scrollTop = 0; pre.scrollLeft = 0;
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => { pick(t.dataset.lang); store.set('vrs-code-lang', t.dataset.lang); });
      t.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        const n = tabs[(i + d + tabs.length) % tabs.length];
        n.focus(); n.click();
      });
    });
    pick(lang);
    const btn = $('#codeCopy');
    btn.addEventListener('click', async () => {
      const ok = await copyText(SNIP[lang].code);
      btn.classList.toggle('is-done', ok);
      btn.querySelector('span').textContent = ok ? 'Tersalin' : 'Gagal';
      setTimeout(() => { btn.classList.remove('is-done'); btn.querySelector('span').textContent = 'Salin'; }, 1800);
    });
  }

  /* =================================================================
     HARGA
     ================================================================= */
  async function loadPricing() {
    const els = $$('[data-price]');
    if (!els.length) return;
    try {
      const d = await getJSON('/api/pricing', 8000);
      // source "default" = harga bawaan kode, belum pernah terbaca dari
      // database (mis. DB putus sejak server nyala). Angkanya tetap
      // ditampilkan sebagai gambaran, tapi diberi label "sementara" supaya
      // tidak dikira harga resmi. "cache" = harga resmi terakhir → normal.
      const est = d.source === 'default';
      els.forEach((el) => {
        const v = num(d.pricing && d.pricing[el.dataset.price]);
        el.classList.remove('v-skel');
        el.textContent = v == null ? '—' : nfInt.format(v);
        el.title = est ? 'Harga sementara — harga final tampil di dashboard sebelum bayar' : '';
      });
      $$('.plans').forEach((el) => el.classList.toggle('is-est', est));
      $$('[data-price-est]').forEach((el) => { el.hidden = !est; });
      const fee = num(d.fee);
      if (fee) $$('[data-fee]').forEach((el) => { el.textContent = ` (+ biaya layanan Rp ${nfInt.format(fee)})`; });
    } catch (e) {
      // Server tak terjangkau: jangan tampilkan harga tebakan.
      els.forEach((el) => { el.classList.remove('v-skel'); el.textContent = '—'; });
    }
  }

  /* =================================================================
     GRAFIK GARIS (SVG, tanpa library)
     ================================================================= */
  let chartSeq = 0;
  function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  function drawChart(el, pts, o) {
    el._pts = pts; el._o = o;
    if (!el._ro && 'ResizeObserver' in window) {
      let w = el.clientWidth;
      el._ro = new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; drawChart(el, el._pts, el._o); } });
      el._ro.observe(el);
    }
    el.classList.add('chart');
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    if (!pts || pts.length < 2) {
      el.innerHTML = `<div class="chart__empty">${o.empty || 'Mengumpulkan data…'}</div>`;
      return;
    }
    const axis = !!o.axis;
    const pl = axis ? 38 : 2, pr = axis ? 6 : 6, pt = axis ? 8 : 6, pb = axis ? 22 : 4;
    const vals = pts.map((p) => p.v);
    const max = o.max != null ? o.max : niceMax(Math.max(o.minMax || 1, ...vals) * 1.15);
    const iw = W - pl - pr, ih = H - pt - pb;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t, span = Math.max(1, t1 - t0);
    const X = (p, i) => pl + iw * (o.byIndex ? i / (pts.length - 1) : (p.t - t0) / span);
    const Y = (v) => pt + ih * (1 - clamp(v / max, 0, 1));
    let d = '';
    pts.forEach((p, i) => { d += (i ? 'L' : 'M') + X(p, i).toFixed(1) + ' ' + Y(p.v).toFixed(1); });
    const lastX = X(pts[pts.length - 1], pts.length - 1), firstX = X(pts[0], 0), base = pt + ih;
    const id = el._gid || (el._gid = 'vg' + (++chartSeq));
    let grid = '', labels = '';
    if (axis) {
      [0, 0.5, 1].forEach((f) => {
        const y = Math.round(pt + ih * (1 - f)) + 0.5;
        grid += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/>`;
        labels += `<span class="chart__yl" style="top:${y}px">${o.tick ? o.tick(max * f) : Math.round(max * f)}</span>`;
      });
    }
    const last = pts[pts.length - 1];
    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#5cf0b4" stop-opacity=".24"/><stop offset="1" stop-color="#5cf0b4" stop-opacity="0"/>
        </linearGradient></defs>
        ${axis ? `<g class="chart__grid">${grid}</g>` : ''}
        <path d="${d}L${lastX.toFixed(1)} ${base}L${firstX.toFixed(1)} ${base}Z" fill="url(#${id})"/>
        <path class="chart__line" d="${d}"/>
        <line class="chart__cross" x1="0" x2="0" y1="${pt}" y2="${base}" visibility="hidden"/>
        <circle class="chart__dot" r="4" cx="0" cy="0" visibility="hidden"/>
        <circle class="chart__end" r="4" cx="${lastX.toFixed(1)}" cy="${Y(last.v).toFixed(1)}"/>
      </svg>
      ${labels}
      ${axis ? `<div class="chart__xl" style="left:${pl}px;right:${pr}px"><span>${o.xStart || fmtAgo(t1 - t0)}</span><span>${o.xEnd || 'sekarang'}</span></div>` : ''}
      <div class="chart__tip" hidden></div>`;
    // Lapisan hover: garis bantu + tooltip di titik terdekat
    const svg = el.querySelector('svg'), cross = svg.querySelector('.chart__cross'), dot = svg.querySelector('.chart__dot'), tip = el.querySelector('.chart__tip');
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const x = clamp(e.clientX - r.left, pl, W - pr);
      let bi = 0, bd = Infinity;
      pts.forEach((p, i) => { const dd = Math.abs(X(p, i) - x); if (dd < bd) { bd = dd; bi = i; } });
      const p = pts[bi], px = X(p, bi), py = Y(p.v);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = `${o.fmt ? o.fmt(p.v) : p.v}<span>${clock(new Date(p.t))}</span>`;
      const tw = tip.offsetWidth;
      tip.style.left = clamp(px, tw / 2, W - tw / 2) + 'px';
      tip.style.top = (axis ? -8 : -30) + 'px';
    };
    const leave = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    el.onpointermove = move; el.onpointerdown = move; el.onpointerleave = leave;
  }

  /* =================================================================
     DATA LIVE
     ================================================================= */
  const SRV = {
    operational: { text: 'Server operational', pill: 'Online', badge: 'v-badge--ok', dot: '' },
    busy: { text: 'Server sedang sibuk', pill: 'Sibuk', badge: 'v-badge--warn', dot: 'v-dot--warn' },
    degraded: { text: 'Sebagian layanan terganggu', pill: 'Gangguan', badge: 'v-badge--danger', dot: 'v-dot--danger' },
    offline: { text: 'Tidak terhubung ke server', pill: 'Offline', badge: 'v-badge--danger', dot: 'v-dot--off' },
    stale: { text: 'Koneksi terputus, mencoba lagi…', pill: 'Menghubungkan', badge: 'v-badge--warn', dot: 'v-dot--warn' },
  };
  const LIVE = { data: null, hist: [], logs: [], lastId: 0, fails: 0, timer: 0, inflight: false, lastHistAt: 0, okAt: 0, rtt: null, skew: 0 };
  // "x dtk lalu" dihitung dengan jam SERVER (waktu log berasal dari server).
  // Jam HP/laptop pengunjung bisa meleset beberapa menit dan dulu membuat
  // log yang baru masuk tampil "3 mnt lalu" atau malah "baru saja" terus.
  const serverNow = () => Date.now() + LIVE.skew;

  function renderServerState(key) {
    const s = SRV[key] || SRV.operational;
    $$('[data-srv-dot]').forEach((el) => { el.className = `v-dot ${s.dot}${key === 'offline' ? '' : ' v-dot--live'}`; });
    $$('[data-srv-status]').forEach((el) => { el.textContent = s.text; });
    $$('[data-srv-pill]').forEach((el) => { el.className = `v-badge ${s.badge}`; el.innerHTML = `<span class="v-dot ${s.dot}"></span>${s.pill}`; });
  }

  function renderCapacity(c) {
    const card = $('[data-cap-card]');
    const shorts = $$('[data-cap-short]'), dots = $$('[data-cap-dot]');
    if (!c || num(c.max) == null) {
      shorts.forEach((el) => { el.textContent = 'Slot server belum bisa dicek'; });
      dots.forEach((el) => { el.className = 'v-dot v-dot--off'; });
      $$('[data-cap-num]').forEach((el) => { el.textContent = '—'; el._v = undefined; });
      $$('[data-cap-sentence]').forEach((el) => { el.textContent = 'Kapasitas server belum bisa dicek. Coba lagi sebentar lagi.'; });
      $$('[data-cap-basis]').forEach((el) => { el.textContent = ''; });
      if (card) card.dataset.state = 'unknown';
      return;
    }
    const max = Math.max(0, num(c.max) || 0), used = clamp(num(c.used) || 0, 0, Math.max(max, 0));
    const rem = Math.max(0, num(c.remaining) ?? (max - used));
    const state = ['available', 'limited', 'full'].includes(c.status) ? c.status : (rem <= 0 ? 'full' : rem <= max * 0.1 ? 'limited' : 'available');
    const dotCls = state === 'full' ? 'v-dot--danger' : state === 'limited' ? 'v-dot--warn' : '';
    const short = state === 'full' ? 'Server penuh — coba lagi nanti'
      : state === 'limited' ? `Hampir penuh · sisa ±${nfInt.format(rem)} slot bot`
        : `Masih muat ±${nfInt.format(rem)} bot lagi`;
    const sentence = state === 'full' ? 'Server penuh — coba lagi nanti. Slot dibuka lagi begitu ada bot yang berhenti.'
      : state === 'limited' ? `Server hampir penuh — tinggal ±${nfInt.format(rem)} slot bot lagi.`
        : `Server ini masih bisa menampung ±${nfInt.format(rem)} bot lagi.`;
    shorts.forEach((el) => { el.textContent = short; });
    dots.forEach((el) => { el.className = `v-dot v-dot--live ${dotCls}`; });
    $$('[data-cap-sentence]').forEach((el) => { el.textContent = sentence; });
    $$('[data-cap-num]').forEach((el) => countTo(el, rem, (n) => (rem > 0 ? '<span class="pm">±</span>' : '') + nfInt.format(Math.round(n))));
    if (card) card.dataset.state = state;
    $$('[data-cap-basis]').forEach((el) => {
      el.textContent = c.basis === 'cpu' ? 'dihitung dari CPU' : c.basis === 'admin' ? 'batas dari admin' : 'dihitung dari RAM';
    });
    $$('[data-cap-note]').forEach((el) => { if (c.note) el.textContent = String(c.note).slice(0, 200); });
    $$('[data-cap-cta]').forEach((a) => {
      const lab = a.querySelector('[data-auth-label]') || a.querySelector('span');
      // Di halaman status sendiri, tautan "pantau slot" ke /status tidak ada
      // gunanya — tombolnya disembunyikan saja selama server penuh.
      a.hidden = state === 'full' && PAGE === 'status';
      if (state === 'full') { a.href = '/status'; if (lab) lab.textContent = 'Pantau slot kosong'; }
      else { a.href = AUTH_HREF; if (lab) lab.textContent = LOGGED_IN ? 'Buka Dashboard' : 'Amankan slot kamu'; }
    });
    // Bar tersegmen: tiap kotak mewakili beberapa slot.
    $$('[data-cap-bar]').forEach((bar) => {
      const w = bar.clientWidth || 300;
      const n = clamp(Math.min(max || 1, Math.floor(w / 13)), 8, 48);
      const per = (max || 1) / n;
      const usedSeg = used / per;
      if (bar._n !== n) { bar._n = n; bar.style.setProperty('--n', n); bar.innerHTML = '<i></i>'.repeat(n); }
      Array.from(bar.children).forEach((seg, i) => {
        seg.classList.toggle('is-used', i + 1 <= usedSeg);
        seg.classList.toggle('is-edge', i < usedSeg && i + 1 > usedSeg);
      });
      bar.title = `${nfInt.format(used)} dari ${nfInt.format(max)} slot terpakai`;
    });
  }

  function renderMeters(d) {
    const vals = {
      cpu: get(d, 'server.cpu.percent'),
      ram: get(d, 'server.ram.percent'),
      cap: get(d, 'capacity.percent'),
    };
    $$('[data-meter]').forEach((m) => {
      const v = num(vals[m.dataset.meter]);
      const pct = v == null ? 0 : clamp(v, 0, 100);
      m.style.setProperty('--v', pct + '%');
      let warn = pct >= 75, danger = pct >= 90;
      if (m.dataset.meter === 'cap') {
        const st = get(d, 'capacity.status');
        warn = st === 'limited'; danger = st === 'full';
      }
      m.classList.toggle('is-warn', warn && !danger);
      m.classList.toggle('is-danger', danger);
    });
  }

  function logRow(l, isNew) {
    const ok = l.ok !== false;
    const chat = l.chat === 'group' ? 'grup' : l.chat === 'private' ? 'pribadi' : (l.chat ? String(l.chat) : '');
    const ms = num(l.ms);
    return `<div class="clog__row${ok ? '' : ' is-err'}${isNew ? ' is-new' : ''}" data-id="${esc(l.id)}">
      <span class="clog__tag">[${ok ? 'CMD' : 'ERR'}]</span>
      <span class="clog__bot">${esc(l.bot || '—')}</span>
      <span class="clog__cmd">.${esc(String(l.cmd || '?').replace(/^\./, ''))}<span class="clog__meta">${chat ? ' · ' + esc(chat) : ''}</span><span class="clog__meta clog__meta--ms">${ms != null ? ' · ' + Math.round(ms) + 'ms' : ''}</span></span>
      <span class="clog__time" data-at="${num(l.at) || ''}">${l.at ? relTime(l.at, serverNow()) : ''}</span>
    </div>`;
  }

  function renderLogs(fresh, reset) {
    $$('[data-live-log]').forEach((box) => {
      const max = num(box.dataset.max) || 8;
      if (reset || !box._init) {
        box._init = true;
        box.innerHTML = LIVE.logs.length
          ? LIVE.logs.slice(0, max).map((l) => logRow(l, false)).join('')
          : '<div class="clog__empty"><span><span class="v-dot v-dot--live"></span>Belum ada command baru. Menunggu aktivitas…</span></div>';
        return;
      }
      if (!fresh.length) return;
      const empty = box.querySelector('.clog__empty');
      if (empty) empty.remove();
      box.insertAdjacentHTML('afterbegin', fresh.slice(0, max).map((l) => logRow(l, !REDUCED)).join(''));
      while (box.children.length > max) box.lastElementChild.remove();
    });
  }

  function renderTop(top) {
    $$('[data-topcmd]').forEach((el) => {
      const list = Array.isArray(top) ? top.slice(0, 8) : [];
      el.innerHTML = list.length
        ? list.map((t) => `<span class="chip">.${esc(String(t.cmd || '').replace(/^\./, ''))}<i>${FMT.compactText(num(t.count) || 0)}×</i></span>`).join('')
        : '<span class="chip v-dim">Belum ada command hari ini</span>';
    });
  }

  const CHARTS = {
    mps: { key: 'mps', fmt: (v) => `${FMT.dec1(v)} pesan/dtk`, minMax: 2, tick: (v) => FMT.dec1(v) },
    cpu: { key: 'cpu', max: 100, fmt: (v) => `CPU ${dec(v, 1)}%`, tick: (v) => `${Math.round(v)}%` },
    ram: { key: 'ram', max: 100, fmt: (v) => `RAM ${dec(v, 1)}%`, tick: (v) => `${Math.round(v)}%` },
  };
  function renderCharts() {
    $$('[data-spark], [data-chart]').forEach((el) => {
      const kind = el.dataset.spark || el.dataset.chart;
      const def = CHARTS[kind];
      if (!def) return;
      const pts = LIVE.hist.map((h) => ({ t: num(h.t) || 0, v: num(h[def.key]) ?? 0 }));
      drawChart(el, pts, { ...def, axis: !!el.dataset.chart, byIndex: false });
    });
    // Judul grafik ikut rentang riwayat yang benar-benar ada: server yang
    // baru nyala baru punya 1–2 menit data, bukan "10 menit terakhir".
    const h = LIVE.hist, span = h.length > 1 ? h[h.length - 1].t - h[0].t : 0;
    $$('[data-hist-span]').forEach((el) => {
      const sec = Math.round(span / 1000);
      el.textContent = h.length < 2 ? 'Mengumpulkan data'
        : sec < 60 ? `${Math.max(1, sec)} detik terakhir`
          : `${Math.max(1, Math.round(sec / 60))} menit terakhir`;
    });
  }

  function onLive(d, withHistory) {
    LIVE.data = d; LIVE.okAt = Date.now();
    // Selisih jam server − jam lokal. Dikurangi setengah waktu tempuh
    // supaya kira-kira sama dengan saat server menulis "now".
    const srvNow = num(d.now);
    if (srvNow) LIVE.skew = srvNow - (Date.now() - (LIVE.rtt || 0) / 2);
    // Bot nomor & angka dasar
    $$('[data-k]').forEach((el) => setVal(el, get(d, el.dataset.k), el.dataset.f || 'int'));
    const st = get(d, 'server.status');
    renderServerState(SRV[st] ? st : 'operational');
    if (!SERVER_NAME && get(d, 'server.name')) $$('[data-srv-name]').forEach((el) => { el.textContent = String(get(d, 'server.name')).slice(0, 40); });
    renderCapacity(d.capacity);
    renderMeters(d);
    renderTop(get(d, 'traffic.topCommands'));

    // Log: server restart → id mulai dari kecil lagi, reset daftar.
    const logs = Array.isArray(d.logs) ? d.logs.filter((l) => l && num(l.id) != null) : [];
    const srvLast = num(d.lastId);
    let reset = false;
    if (srvLast != null && srvLast < LIVE.lastId) { LIVE.logs = []; LIVE.lastId = 0; reset = true; }
    const fresh = logs.filter((l) => l.id > LIVE.lastId).sort((a, b) => b.id - a.id);
    if (fresh.length) {
      LIVE.logs = fresh.concat(LIVE.logs).slice(0, 40);
      LIVE.lastId = Math.max(LIVE.lastId, fresh[0].id);
    }
    if (srvLast != null) LIVE.lastId = Math.max(LIVE.lastId, srvLast);
    renderLogs(fresh, reset);

    // Riwayat: ambil penuh sesekali, di antaranya tambahkan sampel sendiri.
    if (withHistory && Array.isArray(d.history)) {
      LIVE.hist = d.history.slice(-120);
    } else {
      const t = num(d.now) || Date.now();
      const last = LIVE.hist[LIVE.hist.length - 1];
      if (!last || t - last.t >= 4500) {
        LIVE.hist.push({ t, cpu: num(get(d, 'server.cpu.percent')) ?? 0, ram: num(get(d, 'server.ram.percent')) ?? 0, mps: num(get(d, 'traffic.msgPerSec')) ?? 0 });
        const cutoff = t - 10 * 60 * 1000 - 5000;
        while (LIVE.hist.length > 2 && (LIVE.hist.length > 120 || LIVE.hist[0].t < cutoff)) LIVE.hist.shift();
      }
    }
    renderCharts();
    $$('[data-live-tag]').forEach((el) => { el.textContent = `LIVE · ${POLL_MS / 1000} dtk`; el.classList.remove('is-off'); });
    $$('[data-updated]').forEach((el) => { el.textContent = 'Diperbarui ' + clock(); });
    document.dispatchEvent(new CustomEvent('varesa:live', { detail: d }));
  }

  function onLiveError(err) {
    const retry = Math.round(nextDelay() / 1000);
    if (!LIVE.data) {
      // Teks bawaan (mis. host "varesa.mom") dibiarkan; hanya angka yang dikosongkan.
      $$('[data-k]').forEach((el) => { if (el.dataset.f === 'text' && el.textContent.trim() !== '—') return; el.classList.remove('v-skel'); setEmpty(el); });
      renderServerState('offline');
      renderCapacity(null);
      renderLogs([], true);
      $$('[data-live-log]').forEach((box) => { box.innerHTML = '<div class="clog__empty"><span>Log belum bisa dimuat. Mencoba lagi…</span></div>'; });
      $$('[data-topcmd]').forEach((el) => { el.innerHTML = '<span class="chip v-dim">—</span>'; });
      $$('[data-spark], [data-chart]').forEach((el) => drawChart(el, [], { empty: 'Data belum tersedia' }));
    } else {
      renderServerState('stale');
    }
    $$('[data-live-tag]').forEach((el) => { el.textContent = `OFFLINE · coba lagi ${retry} dtk`; el.classList.add('is-off'); });
    document.dispatchEvent(new CustomEvent('varesa:live-error', { detail: { fails: LIVE.fails, error: String(err && err.message || err) } }));
  }

  function nextDelay() { return LIVE.fails ? Math.min(60000, POLL_MS * Math.pow(2, LIVE.fails)) : POLL_MS; }

  async function tick() {
    clearTimeout(LIVE.timer);
    if (document.hidden) { $$('[data-live-tag]').forEach((el) => { el.textContent = 'JEDA'; }); return; }
    if (LIVE.inflight) return;
    LIVE.inflight = true;
    const wantHist = !LIVE.lastHistAt || Date.now() - LIVE.lastHistAt > HISTORY_EVERY_MS;
    const t0 = performance.now();
    try {
      const d = await getJSON(`/api/public/live?since=${LIVE.lastId}${wantHist ? '&history=1' : ''}`, 6000);
      LIVE.fails = 0;
      LIVE.rtt = Math.round(performance.now() - t0);
      if (wantHist && Array.isArray(d.history)) LIVE.lastHistAt = Date.now();
      try { onLive(d, wantHist); } catch (e) { /* data aneh tidak boleh menghentikan polling */ console.warn('[varesa] render live:', e); }
    } catch (e) {
      LIVE.fails++;
      try { onLiveError(e); } catch (e2) { /* abaikan */ }
    } finally {
      LIVE.inflight = false;
      if (!document.hidden) LIVE.timer = setTimeout(tick, nextDelay());
    }
  }

  function startLive() {
    if (!$('[data-k], [data-live-log], [data-cap-short], [data-srv-status], [data-chart]')) return;
    tick();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { clearTimeout(LIVE.timer); $$('[data-live-tag]').forEach((el) => { el.textContent = 'JEDA'; }); }
      else tick();
    });
    // Jam & waktu relatif diperbarui tiap detik tanpa request baru.
    setInterval(() => {
      if (document.hidden) return;
      const now = new Date();
      $$('[data-clock]').forEach((el) => { el.textContent = clock(now); });
      const sNow = serverNow();
      $$('[data-at]').forEach((el) => { const at = num(el.dataset.at); if (at) el.textContent = relTime(at, sNow); });
    }, 1000);
    window.addEventListener('resize', () => { if (LIVE.data) renderCapacity(LIVE.data.capacity); });
  }

  /* =================================================================
     HALAMAN STATUS
     ================================================================= */
  function initStatusPage() {
    const SVC = {
      operational: ['v-badge--ok', '', 'Normal'],
      idle: ['v-badge--warn', 'v-dot--warn', 'Siaga'],
      busy: ['v-badge--warn', 'v-dot--warn', 'Sibuk'],
      down: ['v-badge--danger', 'v-dot--danger', 'Gangguan'],
      unknown: ['', 'v-dot--off', 'Memeriksa…'],
    };
    const setSvc = (key, state, note) => {
      const el = $(`[data-svc="${key}"]`);
      if (el) {
        const [b, d, t] = SVC[state] || SVC.down;
        el.className = `v-badge ${b}`;
        el.innerHTML = `<span class="v-dot ${d}"></span>${t}`;
        const row = el.closest('.svc__row');
        if (row) row.dataset.state = state;
      }
      const n = $(`[data-svc-note="${key}"]`);
      if (n && note) n.textContent = note;
    };
    // Dua sumber data: /api/status (ringkas, tiap 15 dtk) dan /api/public/live
    // (lengkap, tiap 3 dtk). Kalau salah satu gagal, yang lain tetap dipakai
    // supaya halaman ini tidak langsung bilang "semua mati".
    let apiStatus = null, apiOk = null, apiMs = null, liveOk = null, live = null;
    const banner = $('#stBanner');
    const ms = (v) => (v == null ? '' : `respons ${nfInt.format(v)} ms`);

    function render() {
      const liveSrv = live ? get(live, 'server.status') || 'operational' : null;
      const lay = (apiStatus && apiStatus.layanan) || {};
      const anyOk = apiOk || liveOk;

      // Website & dashboard
      const webMs = [apiMs, liveOk ? LIVE.rtt : null].filter((v) => v != null);
      if (anyOk) setSvc('web', 'operational', webMs.length ? ms(Math.min(...webMs)) : 'Merespons');
      else if (apiOk === false && liveOk === false) setSvc('web', 'down', 'Tidak merespons');
      else setSvc('web', 'unknown');

      // Database: status "degraded" di data live berarti DB terputus.
      const dbDown = apiOk ? lay.database === 'down' : liveSrv === 'degraded';
      if (apiOk || liveOk) setSvc('database', dbDown ? 'down' : 'operational', dbDown ? 'Terputus — login & pembayaran bisa tertunda' : 'Tersambung');
      else if (apiOk === false && liveOk === false) setSvc('database', 'down', 'Tidak bisa dicek');
      else setSvc('database', 'unknown');

      // Mesin bot
      const online = num(get(live, 'bots.online')) ?? num(apiStatus && apiStatus.botAktif);
      const conn = num(get(live, 'bots.connecting'));
      const botNote = online == null ? '' : `${nfInt.format(online)} bot online${conn ? ` · ${nfInt.format(conn)} menghubungkan` : ''}`;
      if (apiOk && lay.bot) setSvc('bot', lay.bot === 'idle' ? 'idle' : lay.bot === 'operational' ? 'operational' : 'down', botNote || 'Belum ada bot aktif');
      else if (liveOk) setSvc('bot', online > 0 ? 'operational' : 'idle', botNote || 'Belum ada bot aktif');
      else if (apiOk === false && liveOk === false) setSvc('bot', 'down', 'Tidak bisa dicek');
      else setSvc('bot', 'unknown');

      // Monitor real-time
      if (liveOk) setSvc('live', liveSrv === 'busy' ? 'busy' : 'operational', `${ms(LIVE.rtt)}${LIVE.rtt != null ? ' · ' : ''}tiap ${POLL_MS / 1000} dtk`);
      else if (liveOk === false) setSvc('live', 'down', 'Mencoba lagi…');
      else setSvc('live', 'unknown');

      if (!banner) return;
      let state = 'ok', title = 'Semua sistem berjalan normal', sub = 'Bot, dashboard, dan API bekerja seperti biasa.', ic = 'check';
      if (apiOk === false && liveOk === false) { state = 'bad'; title = 'Server tidak dapat dihubungi'; sub = 'Kami sedang menanganinya. Halaman ini akan mencoba lagi otomatis.'; ic = 'alert'; }
      else if (dbDown || liveSrv === 'degraded' || (apiStatus && apiStatus.status === 'degraded')) { state = 'bad'; title = 'Sebagian layanan terganggu'; sub = 'Database sedang bermasalah: login, pembayaran & pengaturan bisa tertunda. Bot yang sudah aktif umumnya tetap berjalan.'; ic = 'alert'; }
      else if (liveSrv === 'busy') { state = 'warn'; title = 'Server sedang sibuk'; sub = 'Respons bot mungkin sedikit lebih lambat dari biasanya.'; ic = 'activity'; }
      else if (apiOk === false || liveOk === false) { state = 'warn'; title = 'Sebagian data status belum bisa dimuat'; sub = 'Layanan utama masih merespons. Halaman ini mencoba lagi otomatis.'; ic = 'activity'; }
      else if (apiOk == null && liveOk == null) { state = ''; title = 'Memeriksa status…'; sub = 'Mengambil data terbaru dari server.'; ic = 'clock'; }
      banner.dataset.state = state;
      $('#stTitle').textContent = title;
      $('#stSub').textContent = sub;
      $('#stIcon').innerHTML = icon(ic);
    }
    async function loadStatus() {
      const t0 = performance.now();
      try {
        apiStatus = await getJSON('/api/status', 8000);
        apiOk = true; apiMs = Math.round(performance.now() - t0);
      } catch (e) {
        apiOk = false; apiStatus = null; apiMs = null;
      }
      render();
    }
    document.addEventListener('varesa:live', (e) => { liveOk = true; live = e.detail; render(); });
    document.addEventListener('varesa:live-error', () => { liveOk = false; render(); });
    render();
    loadStatus();
    setInterval(() => { if (!document.hidden) loadStatus(); }, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadStatus(); });
  }

  /* ------------------------------------------------- service worker */
  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    window.addEventListener('load', () => { setTimeout(() => navigator.serviceWorker.register('/sw.js').catch(() => {}), 1500); });
  }

  /* ------------------------------------------------------------ mulai */
  function boot() {
    $$('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });
    const safe = (fn) => { try { fn(); } catch (e) { console.warn('[varesa]', e); } };
    safe(applyAuth);
    safe(initNav);
    safe(initReveal);
    safe(initFaq);
    safe(initModal);
    safe(initApi);
    loadSettings().catch(() => {});
    if ($('#catGrid') || $('#pillRow')) loadFeatures().catch(() => {});
    loadPricing().catch(() => {});
    if (PAGE === 'status') safe(initStatusPage);
    safe(startLive);
    safe(registerSW);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
