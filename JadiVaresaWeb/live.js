/* ==========================================================================
   live.js — utilitas bersama halaman aplikasi Varesa
   --------------------------------------------------------------------------
   Dipakai dashboard.html, admin.html dan invoice.html. Isinya:
   - toast (pengganti alert() yang memblokir layar)
   - format angka/waktu, sensor nomor, sparkline & grafik garis SVG ringan
   - poller /api/.../live yang hemat: berhenti saat tab disembunyikan,
     mundur bertahap (backoff) saat server error, tanpa melempar error ke
     konsol kalau API sedang mati
   - umpan log command (dipakai dashboard & admin)
   - widget "Server" + "Log command live" di dashboard
   Semua diekspos lewat window.VLive.
   ========================================================================== */
(function () {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* mode privat: abaikan */ } },
  };

  /* ------------------------------------------------------------------
     TOAST
     ------------------------------------------------------------------ */
  function toast(msg, kind = 'info', ms) {
    if (!msg) return;
    let wrap = document.getElementById('toastWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'v-toast-wrap'; wrap.id = 'toastWrap';
      wrap.setAttribute('aria-live', 'polite');
      document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.className = 'v-toast' + (kind === 'ok' ? ' v-toast--ok' : kind === 'err' ? ' v-toast--err' : '');
    el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    const icon = kind === 'ok' ? 'fa-circle-check' : kind === 'err' ? 'fa-circle-exclamation' : 'fa-circle-info';
    el.innerHTML = `<i class="fa-solid ${icon}"></i><span></span><button type="button" aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button>`;
    el.querySelector('span').textContent = String(msg);
    const close = () => { el.classList.add('is-out'); setTimeout(() => el.remove(), 260); };
    el.querySelector('button').addEventListener('click', close);
    wrap.appendChild(el);
    while (wrap.children.length > 4) wrap.firstElementChild.remove();
    // Pesan error dibiarkan sedikit lebih lama supaya sempat terbaca.
    setTimeout(close, ms || (kind === 'err' ? 6500 : 4200));
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Cadangan untuk browser lama / konteks tanpa izin clipboard.
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  }

  /* ------------------------------------------------------------------
     FORMAT
     ------------------------------------------------------------------ */
  const nf1 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const nfCompact = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });
  const fmtInt = (n) => Number(n || 0).toLocaleString('id-ID');
  const fmt1 = (n) => nf1.format(Number(n) || 0);
  const fmtCompact = (n) => (n == null ? '–' : nfCompact.format(Number(n) || 0));
  const fmtMB = (mb) => {
    const v = Number(mb) || 0;
    return v >= 1024 ? `${fmt1(v / 1024)} GB` : `${Math.round(v)} MB`;
  };
  const fmtMs = (ms) => {
    const v = Number(ms) || 0;
    return v >= 1000 ? `${fmt1(v / 1000)}s` : `${Math.round(v)}ms`;
  };
  function fmtUptime(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}h ${h}j ${m}m`;
    if (h > 0) return `${h}j ${m}m`;
    return `${m}m`;
  }
  function fmtClock(ts) {
    const d = new Date(ts || Date.now());
    if (isNaN(d)) return '--:--:--';
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':');
  }
  // HARUS sama dengan maskNumber() di lib/monitor.js supaya filter "Bot saya"
  // bisa mencocokkan nomor yang sudah disensor server.
  function maskNumber(number) {
    const n = String(number || '').replace(/\D/g, '');
    if (!n) return '';
    if (n.length < 8) return `${n.slice(0, 2)}xxxx`;
    return `${n.slice(0, 4)}xxxx${n.slice(-3)}`;
  }

  function statusInfo(status) {
    if (status === 'busy') return { label: 'Sibuk', dot: 'v-dot--warn', badge: 'v-badge--warn' };
    if (status === 'degraded') return { label: 'Gangguan', dot: 'v-dot--danger', badge: 'v-badge--danger' };
    if (status === 'operational') return { label: 'Normal', dot: '', badge: 'v-badge--ok' };
    return { label: 'Offline', dot: 'v-dot--off', badge: '' };
  }

  // Kalimat kapasitas yang mudah dimengerti user awam.
  function capacityInfo(cap) {
    if (!cap || cap.max == null) {
      return { html: 'Kapasitas server belum bisa dihitung.', tone: 'muted', short: '–', remaining: null };
    }
    const max = Number(cap.max) || 0;
    const used = Number(cap.used) || 0;
    const rem = Math.max(0, cap.remaining != null ? Number(cap.remaining) : max - used);
    if (cap.status === 'full' || rem <= 0) {
      return { html: 'Server sedang <b>penuh</b>. Bot baru belum bisa dijalankan dulu.', tone: 'danger', short: 'penuh', remaining: 0 };
    }
    if (cap.status === 'limited') {
      return { html: `Server hampir penuh — tinggal <b>±${fmtInt(rem)}</b> slot bot lagi.`, tone: 'warn', short: `${fmtInt(rem)} slot tersisa`, remaining: rem };
    }
    return { html: `Server masih bisa menampung <b>±${fmtInt(rem)}</b> bot lagi.`, tone: 'ok', short: `${fmtInt(rem)} slot kosong`, remaining: rem };
  }

  function setMeter(el, pct, tone) {
    if (!el) return;
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    el.style.setProperty('--v', `${v}%`);
    el.classList.toggle('is-warn', tone === 'warn');
    el.classList.toggle('is-danger', tone === 'danger');
  }
  const toneOf = (pct, warn = 75, danger = 90) => (pct >= danger ? 'danger' : pct >= warn ? 'warn' : 'ok');

  function setDot(el, extra, live = true) {
    if (!el) return;
    el.className = `v-dot${live ? ' v-dot--live' : ''}${extra ? ' ' + extra : ''}`;
  }

  /* ------------------------------------------------------------------
     SPARKLINE & GRAFIK
     ------------------------------------------------------------------ */
  function sparkPaths(values, w, h, { pad = 3, maxHint = 0 } = {}) {
    const vals = (values || []).map((v) => Math.max(0, Number(v) || 0));
    if (vals.length < 2) {
      const y = h - pad;
      return { line: `M0,${y}L${w},${y}`, area: `M0,${y}L${w},${y}L${w},${h}L0,${h}Z` };
    }
    const max = Math.max(maxHint, ...vals, 0.001) * 1.15;
    const step = w / (vals.length - 1);
    const pts = vals.map((v, i) => `${(i * step).toFixed(2)},${(h - pad - (v / max) * (h - pad * 2)).toFixed(2)}`);
    const line = `M${pts.join('L')}`;
    return { line, area: `${line}L${w},${h}L0,${h}Z` };
  }

  function drawSpark(svg, values, opts) {
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    const p = sparkPaths(values, vb.width || 160, vb.height || 40, opts);
    svg.querySelector('.spark__line')?.setAttribute('d', p.line);
    svg.querySelector('.spark__area')?.setAttribute('d', p.area);
  }

  // Angka "bulat" untuk batas atas sumbu Y (1, 2, 5, 10, 20, 50, ...).
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    const f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  let chartSeq = 0;
  /**
   * Grafik garis ringan (SVG inline, tanpa library).
   * el: wadah .chart. points: [{t, ...}]. key: nama field nilai.
   */
  function lineChart(el, points, { key, max, color = '#5cf0b4', fmt = (v) => fmt1(v), unit = '' } = {}) {
    if (!el) return;
    const W = 600, H = 150;
    if (!el._built) {
      const id = `cg${++chartSeq}`;
      el.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
          </linearGradient></defs>
          <g class="chart__grid"></g>
          <path class="chart__area" fill="url(#${id})"/>
          <path class="chart__line" stroke="${color}"/>
        </svg>
        <div class="chart__labels"></div>
        <span class="chart__cross"></span><span class="chart__tip"></span>`;
      el._built = true;
      const cross = el.querySelector('.chart__cross');
      const tip = el.querySelector('.chart__tip');
      const move = (clientX) => {
        const pts = el._pts || [];
        if (pts.length < 2) return;
        const r = el.getBoundingClientRect();
        const x = Math.max(0, Math.min(r.width, clientX - r.left));
        const i = Math.round((x / r.width) * (pts.length - 1));
        const px = (i / (pts.length - 1)) * r.width;
        el.classList.add('is-hover');
        cross.style.left = `${px}px`;
        tip.textContent = `${el._fmt(pts[i].v)}${el._unit} · ${fmtClock(pts[i].t)}`;
        const tw = tip.offsetWidth;
        tip.style.left = `${Math.max(0, Math.min(r.width - tw, px - tw / 2))}px`;
      };
      el.addEventListener('mousemove', (e) => move(e.clientX));
      el.addEventListener('touchmove', (e) => { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
      el.addEventListener('mouseleave', () => el.classList.remove('is-hover'));
      el.addEventListener('touchend', () => el.classList.remove('is-hover'));
    }
    const pts = (points || []).map((p) => ({ t: p.t, v: Math.max(0, Number(p[key]) || 0) }));
    el._pts = pts; el._fmt = fmt; el._unit = unit;
    const top = max || niceMax(Math.max(0.5, ...pts.map((p) => p.v)) * 1.15);
    const grid = el.querySelector('.chart__grid');
    const labels = el.querySelector('.chart__labels');
    let g = '', l = '';
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
      const y = (H - 1) - f * (H - 12);
      g += `<line x1="0" x2="${W}" y1="${y}" y2="${y}"/>`;
      if (f > 0) l += `<span class="chart__yl" style="top:${(y / H) * 100}%">${fmt(top * f)}${unit}</span>`;
    });
    grid.innerHTML = g; labels.innerHTML = l;
    let line = '', area = '';
    if (pts.length >= 2) {
      const step = W / (pts.length - 1);
      const xy = pts.map((p, i) => `${(i * step).toFixed(1)},${((H - 1) - Math.min(1, p.v / top) * (H - 12)).toFixed(1)}`);
      line = `M${xy.join('L')}`;
      area = `${line}L${W},${H}L0,${H}Z`;
    }
    el.querySelector('.chart__line').setAttribute('d', line);
    el.querySelector('.chart__area').setAttribute('d', area);
  }

  /* ------------------------------------------------------------------
     POLLER
     ------------------------------------------------------------------ */
  function createPoller({ url, interval = 3000, maxBackoff = 60000, timeout = 8000, headers, onData, onError }) {
    let timer = null, failures = 0, stopped = true, busy = false;

    async function tick() {
      timer = null;
      if (stopped || busy) return;
      // Tab tidak terlihat: jangan membebani server untuk layar yang tidak ditonton.
      if (document.hidden) return;
      busy = true;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const to = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
      try {
        const res = await fetch(typeof url === 'function' ? url() : url, {
          headers: typeof headers === 'function' ? headers() : headers,
          cache: 'no-store',
          signal: ctrl?.signal,
        });
        let data = null;
        try { data = await res.json(); } catch { data = null; }
        if (!res.ok || !data || data.success === false) {
          const err = new Error(data?.message || `HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        failures = 0;
        try { onData?.(data); } catch (e) { /* bug render tidak boleh mematikan polling */ }
      } catch (err) {
        failures++;
        try { onError?.(err, failures); } catch { /* abaikan */ }
      } finally {
        if (to) clearTimeout(to);
        busy = false;
      }
      schedule();
    }

    function schedule() {
      if (stopped) return;
      clearTimeout(timer);
      // Gagal berturut-turut -> jeda makin panjang (3s, 6s, 12s, ... maks 60s).
      const wait = failures ? Math.min(maxBackoff, interval * 2 ** Math.min(failures, 5)) : interval;
      timer = setTimeout(tick, wait);
    }

    document.addEventListener('visibilitychange', () => {
      if (stopped) return;
      clearTimeout(timer);
      if (!document.hidden) { failures = Math.min(failures, 1); tick(); }
    });

    return {
      start() { if (!stopped) return; stopped = false; tick(); },
      stop() { stopped = true; clearTimeout(timer); timer = null; },
      refresh() { if (stopped) return; clearTimeout(timer); tick(); },
      get running() { return !stopped; },
    };
  }

  /* ------------------------------------------------------------------
     UMPAN LOG COMMAND
     ------------------------------------------------------------------ */
  function logRowHTML(l, { full = false, mine = false, isNew = false } = {}) {
    const bot = full ? (l.botFull || l.bot) : l.bot;
    const ms = Number(l.ms) || 0;
    const cmd = String(l.cmd || '').replace(/^[.!#/]+/, '');
    const err = l.ok === false;
    return `<div class="v-log__row cl-row${err ? ' is-err' : ''}${mine ? ' is-mine' : ''}${isNew ? ' is-new' : ''}">`
      + `<span class="cl-time">${fmtClock(l.at)}</span>`
      + `<span class="cl-tag">${err ? 'ERR' : 'OK'}</span>`
      + `<span class="cl-bot" title="${esc(bot)}">${esc(bot)}</span>`
      + `<span class="cl-cmd" title=".${esc(cmd)}">${esc(cmd)}</span>`
      + `<span class="cl-chat">${l.chat === 'group' ? 'grup' : 'pribadi'}</span>`
      + `<span class="cl-ms${ms >= 2000 ? ' is-slow' : ''}">${fmtMs(ms)}</span>`
      + `</div>`;
  }

  function createLogFeed({ list, max = 60, full = false, getMine, scope = 'all', onPending } = {}) {
    let rows = [];
    let lastId = 0;
    let paused = false;
    let pending = 0;
    let loaded = false;
    let errorText = '';

    function emptyHTML() {
      if (errorText && !rows.length) return `<p class="cmdlog__empty"><i class="fa-solid fa-plug-circle-xmark"></i>${esc(errorText)}</p>`;
      if (!loaded) return `<p class="cmdlog__empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Menyambung ke log server…</p>`;
      if (scope === 'mine' && !getMine?.()) {
        return `<p class="cmdlog__empty"><i class="fa-solid fa-robot"></i>Jalankan bot kamu dulu untuk melihat log bot sendiri.</p>`;
      }
      if (scope === 'mine') {
        return `<p class="cmdlog__empty"><i class="fa-regular fa-hourglass"></i>Belum ada command di bot kamu. Coba ketik <b>.menu</b> ke bot.</p>`;
      }
      return `<p class="cmdlog__empty"><i class="fa-regular fa-hourglass"></i>Belum ada command yang dipakai. Log muncul begitu ada yang memakai bot.</p>`;
    }

    function render(newIds) {
      if (!list) return;
      const mine = getMine?.() || '';
      const view = scope === 'mine' ? (mine ? rows.filter((r) => r.bot === mine) : []) : rows;
      if (!view.length) { list.innerHTML = emptyHTML(); return; }
      list.innerHTML = view.map((l) => logRowHTML(l, {
        full, mine: !!mine && l.bot === mine && scope !== 'mine', isNew: !!newIds && newIds.has(l.id),
      })).join('');
    }

    return {
      ingest(logs) {
        errorText = '';
        const first = !loaded;
        loaded = true;
        const fresh = (logs || []).filter((l) => l && Number(l.id) > lastId).sort((a, b) => b.id - a.id);
        if (fresh.length) {
          lastId = Math.max(lastId, ...fresh.map((l) => Number(l.id)));
          rows = fresh.concat(rows).slice(0, max);
        }
        if (paused) {
          if (!first) { pending += fresh.length; onPending?.(pending); }
          return;
        }
        if (fresh.length || first) render(first ? null : new Set(fresh.map((l) => l.id)));
      },
      fail(text) {
        errorText = text;
        if (!rows.length) render();
      },
      setScope(s) { scope = s; render(); },
      setPaused(p) {
        paused = !!p;
        if (!paused) { pending = 0; onPending?.(0); render(); }
      },
      render: () => render(),
      get lastId() { return lastId; },
      get paused() { return paused; },
    };
  }

  /* ------------------------------------------------------------------
     WIDGET DASHBOARD: kartu Server, status di sidebar/top bar, log live
     ------------------------------------------------------------------ */
  function mountDashboard({ getMyBot } = {}) {
    const $ = (id) => document.getElementById(id);
    if (!$('liveServerCard') && !$('cmdLogPanel') && !$('sideSrv')) return null;

    const myMask = () => maskNumber(typeof getMyBot === 'function' ? getMyBot() : '');
    let history = [];
    let polls = 0;
    let lastData = null;

    const pauseBtn = $('cmdLogPause');
    const syncPauseBtn = (pending) => {
      if (!pauseBtn) return;
      const paused = feed.paused;
      pauseBtn.classList.toggle('is-paused', paused);
      pauseBtn.setAttribute('aria-pressed', String(paused));
      pauseBtn.innerHTML = paused
        ? `<i class="fa-solid fa-play"></i> <span>Lanjut${pending ? ` (${pending} baru)` : ''}</span>`
        : `<i class="fa-solid fa-pause"></i> <span>Jeda</span>`;
    };

    const savedScope = store.get('vrs_log_scope', 'all') === 'mine' ? 'mine' : 'all';
    const feed = createLogFeed({
      list: $('cmdLogList'), getMine: myMask, scope: savedScope,
      onPending: (n) => syncPauseBtn(n),
    });

    document.querySelectorAll('#cmdLogPanel .seg__btn').forEach((b) => {
      const on = b.dataset.scope === savedScope;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
      b.addEventListener('click', () => {
        document.querySelectorAll('#cmdLogPanel .seg__btn').forEach((x) => {
          x.classList.toggle('is-active', x === b);
          x.setAttribute('aria-selected', String(x === b));
        });
        store.set('vrs_log_scope', b.dataset.scope);
        feed.setScope(b.dataset.scope);
      });
    });
    pauseBtn?.addEventListener('click', () => { feed.setPaused(!feed.paused); syncPauseBtn(0); });

    function renderServer(d) {
      const srv = d.server || {};
      const cap = d.capacity || {};
      const tr = d.traffic || {};
      const st = statusInfo(srv.status);
      const ci = capacityInfo(cap);

      const name = srv.name || 'Server';
      const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };

      setText('srvName', name);
      const badge = $('srvStatus');
      if (badge) { badge.className = `v-badge ${st.badge}`; badge.textContent = st.label; }
      setDot($('srvDot'), st.dot);
      setText('srvLiveTag', 'LIVE · 3S');

      const sentence = $('capSentence');
      if (sentence) {
        sentence.innerHTML = ci.html;
        sentence.className = `cap-sentence is-${ci.tone}`;
      }
      setMeter($('capMeter'), cap.percent ?? (cap.max ? (cap.used / cap.max) * 100 : 0), ci.tone === 'ok' ? '' : ci.tone);
      setText('capUsed', cap.used != null ? fmtInt(cap.used) : '–');
      setText('capMax', cap.max != null ? fmtInt(cap.max) : '–');
      setText('capRemain', ci.remaining == null ? '–' : ci.remaining === 0 ? 'slot habis' : `${fmtInt(ci.remaining)} slot kosong`);

      const cpu = Number(srv.cpu?.percent) || 0;
      const ram = Number(srv.ram?.percent) || 0;
      const cpuEl = $('srvCpu'); if (cpuEl) cpuEl.innerHTML = `${fmt1(cpu)}<small>%</small>`;
      setMeter($('srvCpuMeter'), cpu, toneOf(cpu, 70, 85));
      setText('srvCpuSub', `${srv.cpu?.cores ?? '–'} core · load ${srv.cpu?.load1 != null ? fmt1(srv.cpu.load1) : '–'}`);
      const ramEl = $('srvRam'); if (ramEl) ramEl.innerHTML = `${fmt1(ram)}<small>%</small>`;
      setMeter($('srvRamMeter'), ram, toneOf(ram, 75, 90));
      setText('srvRamSub', `${fmtMB(srv.ram?.usedMB)} / ${fmtMB(srv.ram?.limitMB)}`);
      setText('srvMps', fmt1(tr.msgPerSec));
      setText('srvMpsSub', `puncak ${fmt1(tr.peakMsgPerSec)} · ${fmtCompact(tr.messagesToday)} pesan hari ini`);
      drawSpark($('srvSpark'), history.slice(-60).map((h) => h.mps), { maxHint: 1 });
      const bots = d.bots || {};
      setText('srvBotsOnline', bots.online != null ? fmtInt(bots.online) : '–');
      setText('srvBotsConn', bots.connecting != null ? fmtInt(bots.connecting) : '–');
      setText('srvBotsReg', bots.registered != null ? fmtInt(bots.registered) : '–');
      setText('srvGroups', bots.groups != null ? fmtCompact(bots.groups) : '–');
      setText('srvRegion', srv.region || '–');
      setText('srvUptime', srv.uptimeSec != null ? `uptime ${fmtUptime(srv.uptimeSec)}` : '–');
      setText('srvNode', srv.node || '–');

      // Ringkasan di sidebar & top bar
      setText('sideSrvName', name);
      setText('sideSrvState', st.label);
      setDot($('sideSrvDot'), st.dot);
      setMeter($('sideSrvMeter'), cap.percent ?? 0, ci.tone === 'ok' ? '' : ci.tone);
      setText('sideSrvCap', cap.max != null ? `${fmtInt(cap.used)}/${fmtInt(cap.max)} bot · ${ci.short}` : 'kapasitas –');
      setDot($('topSrvDot'), ci.tone === 'danger' ? 'v-dot--danger' : ci.tone === 'warn' ? 'v-dot--warn' : st.dot);
      setText('topSrvText', `${name} · ${ci.short}`);

      // Command terpopuler hari ini
      const top = $('cmdTopList');
      if (top) {
        const list = (tr.topCommands || []).slice(0, 6);
        top.innerHTML = list.length
          ? list.map((c) => `<span class="cmd-chip">.${esc(String(c.cmd || '').replace(/^[.!#/]+/, ''))}<em>${fmtInt(c.count)}×</em></span>`).join('')
          : '<span class="v-dim">belum ada</span>';
      }
      setDot($('cmdLogDot'), '');
    }

    function renderDown() {
      const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      setDot($('srvDot'), 'v-dot--off', false);
      setDot($('sideSrvDot'), 'v-dot--off', false);
      setDot($('topSrvDot'), 'v-dot--off', false);
      setDot($('cmdLogDot'), 'v-dot--off', false);
      const badge = $('srvStatus');
      if (badge) { badge.className = 'v-badge'; badge.textContent = 'tak terjangkau'; }
      setText('srvLiveTag', 'MENCOBA LAGI…');
      setText('sideSrvState', 'offline');
      setText('topSrvText', 'server tak terjangkau');
      if (!lastData) {
        const s = $('capSentence');
        if (s) { s.textContent = 'Data server belum bisa dimuat. Mencoba lagi…'; s.className = 'cap-sentence is-muted'; }
        setText('sideSrvCap', 'data belum tersedia');
      }
      feed.fail('Log belum bisa dimuat. Mencoba lagi otomatis…');
    }

    const poller = createPoller({
      interval: 3000,
      url: () => {
        const p = new URLSearchParams();
        if (feed.lastId) p.set('since', String(feed.lastId));
        // Riwayat grafik cukup diambil sesekali (awal + tiap ±15 detik);
        // di antaranya titik baru ditambahkan dari data terkini.
        if (!history.length || polls % 5 === 0) p.set('history', '1');
        polls++;
        return `/api/public/live?${p}`;
      },
      onData: (d) => {
        lastData = d;
        if (Array.isArray(d.history) && d.history.length) {
          history = d.history.slice(-120);
        } else {
          const last = history[history.length - 1];
          const now = d.now || Date.now();
          if (!last || now - last.t >= 4500) {
            history.push({ t: now, cpu: d.server?.cpu?.percent, ram: d.server?.ram?.percent, mps: d.traffic?.msgPerSec });
            if (history.length > 120) history.shift();
          }
        }
        renderServer(d);
        feed.ingest(d.logs || []);
        window.dispatchEvent(new CustomEvent('varesa:live', { detail: d }));
      },
      onError: (err, n) => {
        if (n >= 2 || !lastData) renderDown();
        window.dispatchEvent(new CustomEvent('varesa:live-error', { detail: { failures: n } }));
      },
    });
    poller.start();
    syncPauseBtn(0);

    return { poller, feed, get data() { return lastData; } };
  }

  window.VLive = {
    esc, store, toast, copyText,
    fmtInt, fmt1, fmtCompact, fmtMB, fmtMs, fmtUptime, fmtClock, maskNumber,
    statusInfo, capacityInfo, setMeter, setDot, toneOf,
    sparkPaths, drawSpark, lineChart, niceMax,
    createPoller, createLogFeed, logRowHTML,
    mountDashboard,
  };
})();
