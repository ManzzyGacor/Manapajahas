// =========================================================
// SPOTIFY LISTEN TOGETHER (FIXED AUTOPLAY & TRUSTED DOMAINS)
// Backend: JereXD API Spotify & WebSocket Server
// =========================================================

'use strict';

import { randomUUID } from 'crypto';
import axios from 'axios';
import config from "../../config.js";

const API_KEY = config.JEREXD_APIKEY; // dari .env (JEREXD_APIKEY)
const BASE_URL_SEARCH = 'https://api.jerexd.my.id/api/search/spotify';

function escapeHtml(text = '') {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

async function urlToBase64(url) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
    const mime = response.headers['content-type'] || 'image/jpeg';
    const base64Data = Buffer.from(response.data).toString('base64');
    return `data:${mime};base64,${base64Data}`;
  } catch (e) {
    return 'https://i.scdn.co/image/ab67616d0000b273462688006e00b86561f71df9';
  }
}

function createSpotifyHTML(searchResults, query, waName) {
  const safeQuery = escapeHtml(query);
  const safeWaName = escapeHtml(waName);
  
  let trackListHTML = '';
  searchResults.forEach((track) => {
    const encUrl = encodeURIComponent(track.url || '');
    const encCover = encodeURIComponent(track.cover || '');
    const encTitle = encodeURIComponent(track.name || 'Unknown');
    const encArtist = encodeURIComponent(track.artist || 'Spotify Track');

    trackListHTML += `
      <div class="track-item" data-url="${encUrl}" data-cover="${encCover}" data-title="${encTitle}" data-artist="${encArtist}">
        <img class="track-cover" src="${track.cover}" alt="Cover">
        <div class="track-info-list">
          <div class="track-title-list">${escapeHtml(track.name)}</div>
          <div class="track-artist-list">${escapeHtml(track.artist)}</div>
        </div>
        <div class="track-dur-list">🎵</div>
      </div>
    `;
  });

  return `
<style>
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; margin: 0; padding: 0; }
/* PERBAIKAN: Mengubah body menjadi flex untuk menengahkan interface (floating) */
html, body { width: 100%; height: 100vh; background: transparent; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; overflow: hidden; display: flex; align-items: center; justify-content: center; }

input { user-select: text !important; -webkit-user-select: text !important; }
button { user-select: none; -webkit-user-select: none; cursor: pointer; }

/* PERBAIKAN: Menghapus margin auto agar container bisa melayang bebas di tengah */
.wrap { width: 100%; max-width: 620px; padding: 15px; position: relative; z-index: 10; }
.card { position: relative; overflow: hidden; border-radius: 24px; background: linear-gradient(180deg, #171525 0%, #0b0a12 100%); border: 1px solid rgba(255, 255, 255, .13); box-shadow: 0 20px 55px rgba(0, 0, 0, .55), inset 0 1px rgba(255, 255, 255, .08); }
.glow { position: absolute; width: 240px; height: 240px; left: 50%; top: 190px; transform: translateX(-50%); background: rgba(29, 185, 84, .16); filter: blur(70px); pointer-events: none; }

.header { position: relative; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 15px; border-bottom: 1px solid rgba(255, 255, 255, .08); background: rgba(255, 255, 255, .025); }
.logo { width: 43px; height: 43px; display: flex; align-items: center; justify-content: center; border-radius: 14px; margin-right: 10px; font-size: 22px; background: linear-gradient(145deg, #1db954, #128c3c); box-shadow: 0 7px 25px rgba(29, 185, 84, .4); }
.brand { display: flex; align-items: center; }
.mini { font-size: 8px; letter-spacing: 2px; color: #77748c; margin-bottom: 4px; }
.title { font-size: 17px; font-weight: 900; }
.sub { margin-top: 3px; font-size: 9px; color: #77748c; }
.status { padding: 8px 10px; border-radius: 999px; font-size: 9px; font-weight: 900; white-space: nowrap; border: 1px solid rgba(29, 185, 84, .2); background: rgba(29, 185, 84, .1); color: #1db954; }

.main { position: relative; z-index: 1; padding: 14px; display: flex; flex-direction: column; gap: 12px; }

/* Views System */
.view { display: none; flex-direction: column; gap: 10px; }
.view.is-active { display: flex !important; }

/* Lobby View */
.lobby-box { text-align: center; padding: 15px 10px; }
.input-box { width: 100%; max-width: 320px; padding: 12px; margin: 6px auto; background: rgba(255, 255, 255, .05); border: 1px solid rgba(255, 255, 255, .1); color: #fff; border-radius: 10px; text-align: center; font-weight: bold; font-size: 13px; outline: none; }
.btn-lobby { width: 100%; max-width: 320px; padding: 12px; margin: 6px auto; border: none; border-radius: 10px; font-weight: 900; font-size: 12px; color: #fff; box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3); text-transform: uppercase; display: block; }
.btn-create { background: linear-gradient(135deg, #1db954, #128c3c); }
.btn-join { background: rgba(255, 255, 255, .1); border: 1px solid rgba(255, 255, 255, .2); }

.error-msg { display: none; color: #ff4757; font-size: 11px; font-weight: bold; margin-bottom: 8px; padding: 8px; background: rgba(255, 71, 87, 0.1); border-radius: 8px; border: 1px solid rgba(255, 71, 87, 0.2); }

/* Search View */
.search-area { display: flex; gap: 6px; }
.search-input { flex: 1; padding: 10px 14px; border-radius: 20px; border: 1px solid rgba(255, 255, 255, .2); background: rgba(0, 0, 0, 0.4); color: #fff; font-size: 12px; outline: none; }
.search-btn { padding: 10px 16px; border-radius: 20px; background: #1db954; color: #fff; border: none; font-weight: bold; font-size: 12px; }

.track-list { max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; scrollbar-width: none; }
.track-item { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 10px; background: rgba(255, 255, 255, .04); cursor: pointer; border: 1px solid rgba(255, 255, 255, .05); }
.track-item:active { background: rgba(255, 255, 255, .1); }
.track-cover { width: 42px; height: 42px; border-radius: 6px; object-fit: cover; background: #222; }
.track-info-list { flex: 1; min-width: 0; }
.track-title-list { font-size: 12px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
.track-artist-list { font-size: 10px; color: #b3b3b3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.track-dur-list { font-size: 10px; color: #b3b3b3; }

/* Player View */
.player-card { display: flex; flex-direction: column; align-items: center; background: rgba(255, 255, 255, .025); border: 1px solid rgba(255, 255, 255, .06); border-radius: 16px; padding: 16px; }
.vinyl { width: 140px; height: 140px; border-radius: 50%; object-fit: cover; border: 5px solid #111; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5); margin-bottom: 12px; background: #222; }
@keyframes spin { 100% { transform: rotate(360deg); } }
.is-playing .vinyl { animation: spin 8s linear infinite; }

.song-title { font-size: 15px; font-weight: 900; text-align: center; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 3px; }
.song-artist { font-size: 11px; color: #b3b3b3; text-align: center; margin-bottom: 12px; }

.bar-wrap { width: 100%; background: rgba(255, 255, 255, .15); height: 5px; border-radius: 5px; margin-bottom: 6px; position: relative; }
.is-host .bar-wrap { cursor: pointer; }
.bar-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: #1db954; border-radius: 5px; }
.time-info { width: 100%; display: flex; justify-content: space-between; font-size: 10px; color: #b3b3b3; margin-bottom: 12px; }

.controls { display: flex; align-items: center; gap: 20px; opacity: 0.4; pointer-events: none; }
.is-host .controls { opacity: 1; pointer-events: auto; }
.ctrl-btn { background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.1); color: #fff; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; transition: 0.2s; }
.ctrl-btn:active { transform: scale(0.9); background: rgba(255, 255, 255, 0.2); }
.play-btn { width: 48px; height: 48px; border-radius: 50%; background: #1db954; color: #fff; border: none; display: flex; align-items: center; justify-content: center; font-size: 18px; box-shadow: 0 4px 12px rgba(29, 185, 84, 0.4); }

/* Members */
.members-box { background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, .05); border-radius: 12px; padding: 10px; max-height: 100px; overflow-y: auto; }
.members-title { font-size: 8px; letter-spacing: 1px; color: #77748c; margin-bottom: 6px; font-weight: bold; }
.member-row { font-size: 11px; padding: 4px 0; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid rgba(255, 255, 255, .02); }

.footer { position: relative; z-index: 2; padding: 4px 0 10px; text-align: center; font-size: 7px; letter-spacing: 1px; color: #565265; }

/* Loader Overlay */
.loader { position: absolute; inset: 0; background: rgba(10, 9, 18, 0.92); z-index: 50; display: none; flex-direction: column; align-items: center; justify-content: center; backdrop-filter: blur(8px); }
.spinner { width: 36px; height: 36px; border: 3px solid rgba(29, 185, 84, 0.2); border-top: 3px solid #1db954; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 10px; }
.loader-txt { font-size: 10px; font-weight: 900; letter-spacing: 1.5px; color: #1db954; text-align: center; padding: 0 20px; }
</style>

<div class="wrap" id="app-container">
<div class="card">
<div class="glow"></div>

<div class="header">
<div class="brand">
<div class="logo">🎧</div>
<div>
<div class="mini">ManzzyID MUSIC CENTER</div>
<div class="title">SPOTIFY ROOMS</div>
<div class="sub">Listen Together & Realtime Sync</div>
</div>
</div>
<div id="statusBadge" class="status">LOBBY</div>
</div>

<div class="main">

<!-- VIEW 1: LOBBY -->
<div id="view-lobby" class="view is-active lobby-box">
  <div style="font-size:28px;margin-bottom:6px">🎶</div>
  <div style="font-size:14px;font-weight:900;margin-bottom:4px">BERGABUNG KE ROOM</div>
  <div style="font-size:10px;color:#b3b3b3;margin-bottom:10px">Dengarkan musik bersama secara sinkron</div>
  
  <div id="lobby-err" class="error-msg"></div>

  <input type="text" id="inp-name" class="input-box" value="${safeWaName}" placeholder="Nama Kamu">
  <input type="text" id="inp-room" class="input-box" placeholder="Kode Room (Kosongkan utk auto)">
  
  <button id="btn-act-create" class="btn-lobby btn-create">✨ BUAT ROOM (HOST)</button>
  <button id="btn-act-join" class="btn-lobby btn-join">👋 GABUNG ROOM (GUEST)</button>
</div>

<!-- VIEW 2: SEARCH LIST -->
<div id="view-list" class="view">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
    <span style="font-size:11px;font-weight:900;color:#1db954">PILIH ATAU CARI LAGU</span>
    <button id="btn-back-player" style="background:rgba(255,255,255,0.1);border:none;color:#fff;padding:4px 10px;border-radius:10px;font-size:9px">Kembali ✖</button>
  </div>
  
  <div class="search-area">
    <input type="text" id="inner-search" class="search-input" placeholder="Cari judul lagu..." value="${safeQuery}">
    <button id="btn-do-search" class="search-btn">Cari</button>
  </div>

  <div class="track-list" id="track-list-container">
    ${trackListHTML}
  </div>
</div>

<!-- VIEW 3: PLAYER -->
<div id="view-player" class="view">
  <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#b3b3b3;background:rgba(255,255,255,0.03);padding:6px 10px;border-radius:8px">
    <span>ROOM CODE: <b id="txt-roomcode" style="color:#1db954">---</b></span>
    <button id="btn-change-song" style="background:rgba(255,255,255,0.1);border:none;color:#fff;padding:4px 8px;border-radius:6px;font-size:9px;display:none">🔍 Ganti Lagu</button>
  </div>

  <div class="player-card" id="vinyl-wrap">
    <img id="player-cover" class="vinyl" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="Cover">
    <div class="song-title" id="player-title">Belum ada lagu</div>
    <div class="song-artist" id="player-artist">Pilih lagu dari pencarian</div>

    <div class="bar-wrap" id="bar"><div class="bar-fill" id="fill"></div></div>
    <div class="time-info"><span id="cur">0:00</span><span id="dur">0:00</span></div>

    <div class="controls">
      <button id="btn-rewind" class="ctrl-btn" title="Mundur 10 Detik">⏪</button>
      <button id="play-ico" class="play-btn">▶</button>
      <button id="btn-forward" class="ctrl-btn" title="Maju 10 Detik">⏩</button>
    </div>
  </div>

  <div class="members-box">
    <div class="members-title">ANGGOTA ROOM (LIVE)</div>
    <div class="member-list" id="member-list">
      <div style="color:#77748c;font-size:10px">Menghubungkan...</div>
    </div>
  </div>
</div>

</div>

<div class="footer">SPOTIFY LISTEN TOGETHER · REAL-TIME SYNC</div>

<div class="loader" id="loader">
  <div class="spinner"></div>
  <div class="loader-txt" id="loader-txt">MEMPROSES AUDIO...</div>
</div>

</div>
</div>

<audio id="audio" preload="auto"></audio>

<script>
(function() {
  var audio = document.getElementById('audio');
  var fill = document.getElementById('fill');
  var curEl = document.getElementById('cur');
  var durEl = document.getElementById('dur');
  var vinylWrap = document.getElementById('vinyl-wrap');
  var playIco = document.getElementById('play-ico');
  var ws = null;
  
  var isHost = false;
  var roomCode = '';
  var myName = '';

  function unlockAudio() {
    // Membuka blokir autoplay Webview WhatsApp dengan silent play saat ada user gesture
    if (audio.paused && !audio.src) {
      audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
      audio.play().then(function(){ audio.pause(); }).catch(function(){});
    }
  }

  function showView(id) {
    var views = document.querySelectorAll('.view');
    for (var i = 0; i < views.length; i++) {
      views[i].classList.remove('is-active');
      views[i].style.display = 'none';
    }
    var target = document.getElementById('view-' + id);
    if (target) {
      target.classList.add('is-active');
      target.style.display = 'flex';
    }
  }

  function showLobbyError(msg) {
    var errEl = document.getElementById('lobby-err');
    if (errEl) {
      errEl.innerText = msg;
      errEl.style.display = 'block';
    }
  }

  function joinRoom(hostMode) {
    unlockAudio();
    var errEl = document.getElementById('lobby-err');
    if (errEl) errEl.style.display = 'none';

    var roomInput = document.getElementById('inp-room').value.trim().toUpperCase();
    var nameInput = document.getElementById('inp-name').value.trim();

    if (!nameInput) {
      showLobbyError('Nama Kamu tidak boleh kosong!');
      return;
    }

    if (hostMode && !roomInput) {
      roomInput = 'M' + Math.floor(1000 + Math.random() * 9000);
    }

    if (!roomInput) {
      showLobbyError('Kode Room wajib diisi untuk bergabung!');
      return;
    }

    isHost = hostMode;
    roomCode = roomInput;
    myName = nameInput;

    document.getElementById('txt-roomcode').innerText = roomCode;
    document.getElementById('statusBadge').innerText = isHost ? 'HOST' : 'GUEST';

    if (isHost) {
      document.getElementById('app-container').classList.add('is-host');
      document.getElementById('btn-change-song').style.display = 'block';
      showView('list');
    } else {
      showView('player');
    }
    connectWS();
  }

  function connectWS() {
    try {
      ws = new WebSocket('wss://sewa.manzzy.web.id/ws-spotify');
      ws.onopen = function() {
        ws.send(JSON.stringify({ type: 'join', room: roomCode, name: myName, isHost: isHost }));
      };
      ws.onmessage = function(e) {
        var data = JSON.parse(e.data);
        if (data.type === 'room_state') {
          var mList = document.getElementById('member-list');
          mList.innerHTML = '';
          data.members.forEach(function(m) {
            var icon = m.isHost ? '👑' : '🎧';
            mList.innerHTML += '<div class="member-row">' + icon + ' ' + m.name + (m.isHost ? ' (Host)' : '') + '</div>';
          });
          if (data.currentTrack && !isHost && !audio.src) {
            syncTrack(data.currentTrack, data.currentTime, data.isPlaying);
          }
        } else if (data.type === 'play' && !isHost) {
          syncTrack(data.track, 0, true);
        } else if (data.type === 'sync' && !isHost) {
          if (Math.abs(audio.currentTime - data.time) > 1.5) audio.currentTime = data.time;
          if (data.state === 'playing' && audio.paused) audio.play().catch(function(){});
          if (data.state === 'paused' && !audio.paused) audio.pause();
        }
      };
    } catch(err) { console.log('WS error', err); }
  }

  function searchMusic() {
    var q = document.getElementById('inner-search').value.trim();
    if (!q) return;
    var listEl = document.getElementById('track-list-container');
    listEl.innerHTML = '<div style="text-align:center;color:#1db954;font-size:11px;padding:20px">Mencari lagu...</div>';

    fetch('https://api.jerexd.my.id/api/search/spotify?apikey=${API_KEY}&query=' + encodeURIComponent(q))
    .then(function(res){ return res.json(); })
    .then(function(data){
      if (data.status && data.result && data.result.top_results && data.result.top_results.length > 0) {
        var html = '';
        var tracks = data.result.top_results.slice(0, 5);
        for (var i = 0; i < tracks.length; i++) {
          var t = tracks[i];
          var trackUrl = t.url || '';
          var coverUrl = (t.images && t.images.length > 0 && t.images[0].url) ? t.images[0].url : '';
          var name = t.name || 'Unknown';
          var artist = (t.artists && t.artists.length > 0) ? t.artists.map(function(a){ return a.name; }).join(', ') : 'Spotify Track';
          
          html += '<div class="track-item" data-url="' + encodeURIComponent(trackUrl) + '" data-cover="' + encodeURIComponent(coverUrl) + '" data-title="' + encodeURIComponent(name) + '" data-artist="' + encodeURIComponent(artist) + '">' +
                  '<img class="track-cover" src="' + (coverUrl || 'https://i.scdn.co/image/ab67616d0000b273462688006e00b86561f71df9') + '">' +
                  '<div class="track-info-list"><div class="track-title-list">' + escapeHtml(name) + '</div><div class="track-artist-list">' + escapeHtml(artist) + '</div></div>' +
                  '<div class="track-dur-list">🎵</div></div>';
        }
        listEl.innerHTML = html;
      } else {
        listEl.innerHTML = '<div style="text-align:center;color:#ff7675;font-size:11px;padding:20px">Lagu tidak ditemukan.</div>';
      }
    }).catch(function(){ listEl.innerHTML = '<div style="text-align:center;color:#ff7675;font-size:11px;padding:20px">Gagal memuat pencarian.</div>'; });
  }

  function hostSelectTrack(encUrl, encCover, encTitle, encArtist, dur) {
    if (!isHost) return;
    unlockAudio();
    var trackInfo = {
      url: decodeURIComponent(encUrl),
      cover: decodeURIComponent(encCover) || 'https://i.scdn.co/image/ab67616d0000b273462688006e00b86561f71df9',
      title: decodeURIComponent(encTitle),
      artist: decodeURIComponent(encArtist),
      duration: dur
    };
    showView('player');
    loadAndPlay(trackInfo);
  }

  function hostTogglePlay() {
    if (!isHost || !audio.src) return;
    if (audio.paused) {
      audio.play().then(function() {
        if (ws) ws.send(JSON.stringify({ type: 'sync', room: roomCode, time: audio.currentTime, state: 'playing' }));
      }).catch(function(e) { console.log("Play failed", e); });
    } else {
      audio.pause();
      if (ws) ws.send(JSON.stringify({ type: 'sync', room: roomCode, time: audio.currentTime, state: 'paused' }));
    }
  }

  function hostSeek(sec) {
    if (!isHost || !audio.src) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + sec));
    if (ws) ws.send(JSON.stringify({ type: 'sync', room: roomCode, time: audio.currentTime, state: !audio.paused ? 'playing' : 'paused' }));
  }

  function updateUI(t) {
    document.getElementById('player-cover').src = t.cover;
    document.getElementById('player-title').innerText = t.title;
    document.getElementById('player-artist').innerText = t.artist;
    durEl.innerText = t.duration || '0:00';
  }

  function syncTrack(t, time, play) {
    updateUI(t);
    fetchAudio(t.url, function(streamUrl, fullData) {
      if (fullData) {
        t.cover = fullData.cover || fullData.thumbnail || fullData.image || t.cover;
        t.title = fullData.title || t.title;
        t.artist = fullData.artist || t.artist;
        t.duration = fullData.duration || t.duration;
        updateUI(t);
      }
      audio.src = streamUrl;
      audio.currentTime = time || 0;
      if (play) audio.play().catch(function(){});
    });
  }

  function loadAndPlay(t) {
    updateUI(t);
    fetchAudio(t.url, function(streamUrl, fullData) {
      var realCover = (fullData && (fullData.cover || fullData.thumbnail || fullData.image)) || t.cover;
      var realTitle = (fullData && fullData.title) || t.title;
      var realArtist = (fullData && fullData.artist) || t.artist;
      var realDur = (fullData && fullData.duration) || t.duration;

      var updatedTrack = {
        url: t.url,
        cover: realCover,
        title: realTitle,
        artist: realArtist,
        duration: realDur
      };

      updateUI(updatedTrack);

      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'play', room: roomCode, track: updatedTrack }));
      }

      audio.src = streamUrl;
      audio.play().then(function() {
        playIco.innerText = '⏸';
        vinylWrap.classList.add('is-playing');
      }).catch(function(e){
        console.log("Autoplay blocked, user needs to tap play manually", e);
        playIco.innerText = '▶';
        vinylWrap.classList.remove('is-playing');
      });
    });
  }

  // PERBAIKAN: Penambahan Multi-API Fallback jika server utama error
  function fetchAudio(spotiUrl, callback) {
    var loader = document.getElementById('loader');
    var loaderTxt = document.getElementById('loader-txt');
    loader.style.display = 'flex';
    loaderTxt.innerText = "MENGESTRAK STREAM AUDIO...";

    // Percobaan 1: JereXD API
    fetch('https://api.jerexd.my.id/api/downloader/spotify?apikey=${API_KEY}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: spotiUrl })
    })
    .then(function(res){ return res.json(); })
    .then(function(data){
      var resObj = data.result || data.data || data;
      var finalUrl = resObj && (resObj.downloadUrl || resObj.download_url || resObj.download || resObj.url || resObj.link || resObj.audio);
      
      if (finalUrl) {
        callback(finalUrl, resObj);
        loader.style.display = 'none';
      } else {
        throw new Error("Gagal mengambil link dari API JereXD");
      }
    }).catch(function(){
      // Percobaan 2: Cobalt API Fallback
      loaderTxt.innerText = "MENGALIHKAN KE SERVER CADANGAN...";
      
      fetch('https://api.cobalt.tools/api/json', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: spotiUrl, downloadMode: 'audio' })
      })
      .then(function(res2){ return res2.json(); })
      .then(function(data2){
        if(data2.url) {
          callback(data2.url, null);
        } else {
          alert("Gagal mendapatkan link audio dari semua server.");
        }
        loader.style.display = 'none';
      }).catch(function(){
        loader.style.display = 'none';
        alert("Gagal menghubungkan ke server musik.");
      });
    });
  }

  function escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmt(s) {
    if (!s || isNaN(s)) return '0:00';
    var m = Math.floor(s/60), sec = Math.floor(s%60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  // --- EVENT LISTENERS ATTACHMENT ---
  document.getElementById('btn-act-create').addEventListener('click', function() { joinRoom(true); });
  document.getElementById('btn-act-join').addEventListener('click', function() { joinRoom(false); });
  document.getElementById('btn-do-search').addEventListener('click', searchMusic);
  document.getElementById('btn-back-player').addEventListener('click', function() { showView('player'); });
  document.getElementById('btn-change-song').addEventListener('click', function() { showView('list'); });

  document.getElementById('inner-search').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') searchMusic();
  });

  document.getElementById('play-ico').addEventListener('click', hostTogglePlay);
  document.getElementById('btn-rewind').addEventListener('click', function() { hostSeek(-10); });
  document.getElementById('btn-forward').addEventListener('click', function() { hostSeek(10); });

  document.getElementById('track-list-container').addEventListener('click', function(e) {
    var item = e.target.closest('.track-item');
    if (item && isHost) {
      var encUrl = item.getAttribute('data-url');
      var encCover = item.getAttribute('data-cover');
      var encTitle = item.getAttribute('data-title');
      var encArtist = item.getAttribute('data-artist');
      hostSelectTrack(encUrl, encCover, encTitle, encArtist, '--:--');
    }
  });

  document.getElementById('bar').addEventListener('pointerdown', function(e) {
    if (!isHost || !audio.duration) return;
    var rect = this.getBoundingClientRect();
    var x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    audio.currentTime = (x / rect.width) * audio.duration;
    if (ws) ws.send(JSON.stringify({ type: 'sync', room: roomCode, time: audio.currentTime, state: !audio.paused ? 'playing' : 'paused' }));
  });

  audio.addEventListener('timeupdate', function() {
    if (!audio.duration) return;
    fill.style.width = (audio.currentTime / audio.duration) * 100 + '%';
    curEl.innerText = fmt(audio.currentTime);
    durEl.innerText = fmt(audio.duration);
  });

  audio.addEventListener('play', function() {
    playIco.innerText = '⏸';
    vinylWrap.classList.add('is-playing');
  });

  audio.addEventListener('pause', function() {
    playIco.innerText = '▶';
    vinylWrap.classList.remove('is-playing');
  });

  audio.addEventListener('error', function() {
    alert("Audio gagal diputar dari server CDN.");
    playIco.innerText = '▶';
    vinylWrap.classList.remove('is-playing');
  });
})();
</script>
`;
}

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, isQuoted, prefix, command, pushName } = messageInfo;
  const text = content && content.trim() !== "" ? content : isQuoted?.text ?? null;

  if (!text) {
    await sock.sendMessage(
      remoteJid,
      { text: `Contoh pencarian Spotify Room:\n${prefix + command} mendua` },
      { quoted: message }
    );
    return;
  }

  await sock.sendMessage(remoteJid, { react: { text: '🔍', key: message.key } }).catch(() => {});

  try {
    const res = await axios.get(`${BASE_URL_SEARCH}?apikey=${API_KEY}&query=${encodeURIComponent(text)}`, { timeout: 15000 });

    const rawResults = res.data?.result?.top_results || [];
    if (!res.data?.status || rawResults.length === 0) {
      throw new Error("Lagu tidak ditemukan.");
    }

    const searchResults = rawResults.slice(0, 5).map(track => ({
      url: track.url || '',
      name: track.name || 'Unknown',
      artist: (track.artists && track.artists.length > 0) ? track.artists.map(a => a.name).join(', ') : 'Spotify Track',
      cover: (track.images && track.images[0]?.url) ? track.images[0].url : 'https://i.scdn.co/image/ab67616d0000b273462688006e00b86561f71df9',
      duration: '--:--'
    }));

    const waName = pushName || "Guest";

    for (let track of searchResults) {
      if (track.cover && track.cover.startsWith('http')) {
        track.cover = await urlToBase64(track.cover);
      }
    }

    const htmlPayload = createSpotifyHTML(searchResults, text, waName);

    // PERBAIKAN: Menambahkan domain Cobalt API agar request fallback lolos dari pemblokiran keamanan
    const trustedDomains = new Set([
      "api.jerexd.my.id", 
      "sewa.manzzy.web.id",
      "cdn-spotify-inter.zm.io.vn",
      "i.scdn.co",
      "image-cdn-ak.spotifycdn.com",
      "api.cobalt.tools"
    ]);

    const responseId = randomUUID();

    await sock.relayMessage(
      remoteJid,
      {
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2,
          messageSecret: "0cCzjnQ5ERoqM2QrQ7KjmMfxsyeWYu+61/chr2wioyE=",
          botMetadata: {
            messageDisclaimerText: "",
            botResponseId: responseId
          }
        },
        botForwardedMessage: {
          message: {
            richResponseMessage: {
              messageType: 1,
              submessages: [
                {
                  messageType: 2,
                  messageText: "ManzzyID • SPOTIFY ROOMS"
                }
              ],
              unifiedResponse: {
                data: Buffer.from(
                  JSON.stringify({
                    response_id: responseId,
                    sections: [
                      {
                        view_model: {
                          primitive: {
                            __typename: "GenAIaeacdsnwHtmlPrimitive",
                            payload: htmlPayload,
                            trusted_sources: Array.from(trustedDomains)
                          },
                          __typename: "GenAISingleLayoutViewModel"
                        }
                      }
                    ]
                  })
                ).toString("base64")
              },
              contextInfo: {
                mentionedJid: [],
                groupMentions: [],
                statusAttributions: [],
                forwardingScore: 1,
                isForwarded: true,
                forwardedAiBotMessageInfo: {
                  botJid: "867051314767696@bot"
                },
                forwardOrigin: 4
              }
            }
          }
        }
      },
      { messageId: responseId }
    );

    await sock.sendMessage(remoteJid, { react: { text: '✅', key: message.key } }).catch(() => {});
  } catch (error) {
    console.error('[SPOTIFY ERROR]', error.message);
    await sock.sendMessage(remoteJid, { react: { text: '❌', key: message.key } }).catch(() => {});
    await sock.sendMessage(
      remoteJid,
      { text: `Gagal mencari lagu.\n\n> ${error?.message || 'Server error'}` },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["spotify", "spotisearch", "sp", "room"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1,
};