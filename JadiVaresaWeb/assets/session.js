/*
 * Varesa — penjaga sesi login di browser (window.VaresaSession).
 *
 * Kenapa ada file ini: dulu "bukti login" hanyalah id user yang disimpan di
 * localStorage dan dikirim di setiap request (userId / x-user-id). Siapa pun
 * yang tahu id itu bisa mengaku sebagai pemiliknya. Sekarang server memberi
 * cookie sesi bertanda tangan (vrs_sid, HttpOnly — tidak bisa dibaca skrip),
 * dan setiap request yang mengaku sebagai user tertentu harus cocok dengan
 * cookie itu. Bentuk request lama (userId di body/query) TETAP dipakai.
 *
 * Tugas file ini:
 *   - membungkus window.fetch: jawaban 401 dengan code "SESSION_EXPIRED"
 *     berarti cookie hilang/kedaluwarsa -> data login lokal dibersihkan dan
 *     user diarahkan SEKALI ke /login?next=<halaman ini>;
 *   - VaresaSession.logout({ all }) — keluar (all: dari semua perangkat);
 *   - VaresaSession.check() — tanya server siapa yang sedang login.
 *
 * Wajib dimuat PALING AWAL (sebelum app.js/admin.js/skrip invoice), supaya
 * semua fetch sudah lewat pembungkus ini:
 *   <script src="/assets/session.js?v=1"></script>
 */
(function () {
  'use strict';
  if (window.VaresaSession) return; // jangan membungkus fetch dua kali

  var STORAGE_KEY = 'currentUser';
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  var redirecting = false;   // satu kali alihkan per halaman, walau banyak request gagal bersamaan
  var checking = null;       // check() yang sedang berjalan dipakai bersama

  function clearLocalUser() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* storage diblokir: abaikan */ }
  }

  // Halaman asal hanya path di situs ini sendiri (bukan URL lengkap) —
  // login.html juga menolak nilai lain, ini sekadar menjaga bentuknya rapi.
  function currentPath() {
    var p = (location.pathname || '/') + (location.search || '') + (location.hash || '');
    return p.charAt(0) === '/' && p.charAt(1) !== '/' ? p : '/dashboard';
  }

  function isLoginPage() {
    return /^\/login(?:\.html)?\/?$/.test(location.pathname || '');
  }

  function goLogin() {
    if (redirecting) return;
    redirecting = true;
    clearLocalUser();
    // Sudah di halaman login: cukup bersihkan data lokal, jangan memuat ulang
    // (tidak ada yang perlu diarahkan, dan reload hanya membuat kedip).
    if (isLoginPage()) return;
    location.replace('/login?next=' + encodeURIComponent(currentPath()));
  }

  // Hanya request ke API situs ini sendiri yang dinilai. 401 dari layanan
  // luar (mis. CDN) bukan urusan sesi Varesa.
  function isOwnApi(input) {
    try {
      var raw = typeof input === 'string' ? input : (input && input.url) || String(input || '');
      var u = new URL(raw, location.href);
      return u.origin === location.origin && u.pathname.indexOf('/api/') === 0;
    } catch (e) {
      return false;
    }
  }

  if (nativeFetch) {
    window.fetch = function (input, init) {
      return nativeFetch(input, init).then(function (res) {
        if (res.status !== 401 || redirecting || !isOwnApi(input)) return res;
        // Body dibaca dari salinan supaya pemanggil tetap bisa membaca
        // jawaban aslinya seperti biasa.
        return res.clone().json().then(function (data) {
          if (data && data.code === 'SESSION_EXPIRED') goLogin();
          return res;
        }, function () { return res; });
      });
    };
  }

  function check() {
    if (checking) return checking;
    var f = nativeFetch || window.fetch;
    checking = f('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          if (res.ok && data && data.success && data.user) {
            // Data user di localStorage disegarkan dari server (paket, nama, dst).
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data.user)); } catch (e) { /* abaikan */ }
            return { success: true, user: data.user };
          }
          return { success: false, status: res.status, message: (data && data.message) || '' };
        });
      })
      .catch(function () {
        // Jaringan putus BUKAN berarti sesi habis — jangan keluarkan user.
        return { success: false, offline: true, message: 'Tidak bisa terhubung ke server.' };
      })
      .then(function (out) { checking = null; return out; });
    return checking;
  }

  function logout(opts) {
    var all = !!(opts && opts.all);
    var f = nativeFetch || window.fetch;
    redirecting = true; // 401 dari request lain yang masih berjalan tidak perlu mengalihkan lagi
    return f('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(all ? { all: true } : {})
    })
      .catch(function () { /* tetap keluar di sisi browser */ })
      .then(function () {
        clearLocalUser();
        try { localStorage.removeItem('active_bot_num'); } catch (e) { /* abaikan */ }
        location.replace('/login');
      });
  }

  // Data user lokal (hanya untuk tampilan — bukan bukti login).
  function getUser() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { return null; }
  }

  window.VaresaSession = {
    check: check,
    logout: logout,
    getUser: getUser,
    // Dipanggil halaman yang mendeteksi sesi habis dengan caranya sendiri.
    expired: goLogin
  };
})();
