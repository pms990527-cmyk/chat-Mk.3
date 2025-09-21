/**
 * Multi-user Chat — Cloud Cat / Fox (Slim, esc-eval fix)
 * - 기준본 기능 동일: 테마 전환, 탭 깜빡임, 데스크톱/소리 알림, 읽음 카운트, 이모지/파일, 타이핑, 재연결, keep-alive
 * - 서버 템플릿 문자열 내 클라이언트 `${...}` 평가되던 부분 제거
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// 타임아웃
server.headersTimeout = 65_000;
server.keepAliveTimeout = 61_000;

const io = new Server(server, {
  cors: { origin: '*' },
  serveClient: true,
  pingInterval: 10_000,
  pingTimeout: 180_000,
  maxHttpBufferSize: 8_000_000
});

const APP_VERSION = 'v-2025-09-22-slim-02-escfix';

// ===== In-memory rooms =======================================================
/** room = { key, users:Set<sid>, lastMsgs:[], unread: Map<msgId, Set<sid>> } */
const rooms = new Map();
const getRoom = id => rooms.get(id) || rooms.set(id, { key: null, users: new Set(), lastMsgs: [], unread: new Map() }).get(id);
const now = () => Date.now();
const sanitize = (s, max = 200) => typeof s === 'string' ? s.replace(/[<>]/g, '').slice(0, max) : '';
function isThrottled(room, socketId, limit = 8, windowMs = 10_000) {
  const t = now();
  room.lastMsgs = room.lastMsgs.filter(m => t - m.t < windowMs);
  return room.lastMsgs.reduce((n, m) => n + (m.from === socketId ? 1 : 0), 0) >= limit;
}

// ===== Routes =================================================================
app.get('/healthz', (_, res) => res.status(200).type('text/plain').send('ok'));

app.get('/', (req, res) => {
  const { room = '', nick = '' } = req.query;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
<html lang="ko" data-theme="cloud">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Cloud Cat / Fox Chat</title>
<link id="favicon" rel="icon" href="">
<style>
  :root{
    --app-bg: linear-gradient(180deg,#e0f2fe,#ffffff);
    --chat-bg: linear-gradient(180deg,#f0f9ff,#ffffff);
    --card-bg: rgba(255,255,255,.86);
    --border: rgba(14,165,233,.18);
    --accent:#0ea5e9; --accent-weak:#38bdf8;
    --ink:#0f172a; --muted:#64748b;
    --meBg:#dff3ff; --meText:#083344;
    --themBg:#ffffff; --themText:#0f172a;
    --avatar-bg:#bae6fd;
    --shadow-soft: rgba(2,6,23,.08); --shadow-strong: rgba(2,132,199,.25);
    --header-h:58px;
  }
  :root[data-theme="cloud"]{
    --app-bg:
      radial-gradient(900px 500px at 15% -10%, rgba(255,255,255,.40), transparent 60%),
      radial-gradient(900px 600px at 85% 0%, rgba(186,230,253,.35), transparent 55%),
      radial-gradient(1200px 700px at 50% 120%, rgba(125,211,252,.20), transparent 60%),
      linear-gradient(180deg,#e0f2fe,#ffffff);
    --chat-bg: linear-gradient(180deg,#f0f9ff,#ffffff);
    --accent:#0ea5e9; --accent-weak:#38bdf8;
    --avatar-bg:#bae6fd;
    --meBg:#dff3ff; --meText:#083344;
    --themBg:#ffffff; --themText:#0f172a;
    --border: rgba(14,165,233,.18);
    --shadow-strong: rgba(2,132,199,.25);
  }
  :root[data-theme="fox"]{
    --app-bg:
      radial-gradient(900px 500px at 15% -10%, rgba(255,255,255,.45), transparent 60%),
      radial-gradient(900px 600px at 85% 0%, rgba(254,215,170,.35), transparent 55%),
      radial-gradient(1200px 700px at 50% 120%, rgba(253,186,116,.22), transparent 60%),
      linear-gradient(180deg,#fff5ec,#ffffff);
    --chat-bg: linear-gradient(180deg,#fff7ef,#ffffff);
    --accent:#f97316; --accent-weak:#fb923c;
    --avatar-bg:#fed7aa;
    --meBg:#ffe8d6; --meText:#4a2b13;
    --themBg:#ffffff; --themText:#1f2937;
    --border: rgba(244,114,33,.18);
    --shadow-strong: rgba(249,115,22,.25);
  }

  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans KR",Arial;color:var(--ink);background:var(--app-bg);
    -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
  .wrap{max-width:740px;margin:0 auto;min-height:100%;padding:0 12px}
  .card{height:100dvh;height:100svh;background:var(--card-bg);backdrop-filter:blur(8px) saturate(110%);
    border:1px solid var(--border);border-radius:24px;box-shadow:0 16px 50px var(--shadow-soft), inset 0 0 0 1px rgba(255,255,255,.04);
    overflow:hidden;display:flex;flex-direction:column}
  .appbar{height:var(--header-h);display:flex;align-items:center;justify-content:space-between;padding:0 12px 0 16px;background:rgba(255,255,255,.92);border-bottom:1px solid var(--border)}
  .brand{display:flex;gap:10px;align-items:center}
  .cat{width:36px;height:36px;border-radius:999px;background:var(--avatar-bg);display:flex;align-items:center;justify-content:center;box-shadow:0 0 18px var(--accent-weak)}
  .title{font-weight:800;color:var(--accent)}
  .subtitle{font-size:12px;color:var(--muted);font-family:ui-serif, Georgia, serif}
  .right{display:flex;gap:8px;align-items:center}
  .status{display:flex;gap:6px;align-items:center;color:var(--accent);font-size:12px}
  .btn-flat{height:32px;padding:0 10px;border:1px solid var(--border);border-radius:10px;background:#fff;cursor:pointer}
  .btn-flat.active{border-color:var(--accent);box-shadow:0 0 0 2px rgba(14,165,233,.15) inset}
  .badge{background:var(--accent);color:#fff;border-radius:999px;padding:2px 8px;font-size:11px}

  .chat{flex:1;min-height:0;overflow:auto;background:var(--chat-bg);padding:14px 14px 110px}
  .divider{display:flex;align-items:center;gap:8px;margin:8px 0}
  .divider .line{height:1px;background:var(--border);flex:1}
  .divider .txt{font-size:12px;color:var(--accent);font-family:ui-serif, Georgia, serif}
  .sys{color:var(--muted);font-size:13px;text-align:center;margin:8px 0}

  .msg{display:flex;gap:10px;margin:10px 0;align-items:flex-end}
  .msg.me{justify-content:flex-end}
  .avatar{width:32px;height:32px;border-radius:50%;background:var(--avatar-bg);display:flex;align-items:center;justify-content:center;font-size:18px}
  .msg.me .avatar{display:none}

  .stack{display:flex;flex-direction:column;max-width:60%}
  @media (max-width:480px){ .stack{max-width:80%} }

  .name{font-size:11px;color:var(--muted);margin:0 0 2px 4px}
  .msg.me .name{display:none}

  .content{display:flex;flex-direction:column;gap:4px}
  .text{display:inline-block;background:var(--themBg);color:var(--themText);line-height:1.24;word-break:break-word;padding:6px 10px;border-radius:12px;box-shadow:0 2px 8px var(--shadow-soft)}
  .msg.me .text{background:var(--meBg);color:var(--meText);box-shadow:0 4px 12px var(--shadow-strong)}
  .content img{display:block;max-width:320px;height:auto;border-radius:12px;cursor:zoom-in;box-shadow:0 12px 28px rgba(8,12,26,.18)}
  .att{font-size:12px}
  .att a{color:var(--accent);text-decoration:none;word-break:break-all}
  .att .size{color:var(--muted);margin-left:6px}

  .time{font-size:10px;color:#94a3b8;align-self:flex-end;min-width:34px;text-align:center;opacity:.9}
  .msg.me .time{margin-right:6px}
  .msg.them .time{margin-left:6px}
  .unread{font-size:10px;color:#94a3b8;align-self:flex-end;margin-left:6px;opacity:.95;display:none}

  .inputbar{position:fixed;left:0;right:0;bottom:0;margin:0 auto;max-width:740px;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-top:1px solid var(--border);padding:10px}
  .inputrow{display:flex;gap:8px;align-items:center}
  .textinput{flex:1;border:1px solid var(--border);border-radius:14px;padding:12px 12px;font:inherit}
  .btn{height:40px;padding:0 14px;border:none;border-radius:12px;font-weight:700;cursor:pointer}
  .btn-emoji{background:#e2f2ff;color:#0c4a6e}
  .btn-attach{background:#e2e8f0;color:var(--ink)}
  .btn-send{background:var(--accent);color:#fff}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="appbar">
      <div class="brand">
        <div class="cat" id="brandIcon">🐱</div>
        <div>
          <div class="title" id="brandTitle">Cloud Cat Chat</div>
          <div class="subtitle">테마 전환 · ${APP_VERSION}</div>
        </div>
      </div>
      <div class="right">
        <select id="themeSel" class="btn-flat">
          <option value="cloud">구름 고양이</option>
          <option value="fox">여우</option>
        </select>
        <button id="flashBtn"  class="btn-flat active" type="button" title="탭 깜빡임">⚡</button>
        <button id="notifyBtn" class="btn-flat"         type="button" title="데스크톱 알림">🔕</button>
        <button id="soundBtn"  class="btn-flat"         type="button" title="소리 알림">🔈</button>
        <span id="unseenBadge" class="badge" style="display:none">0</span>
        <div class="status"><span id="statusIcon">☁️</span><span id="online">offline</span></div>
      </div>
    </div>

    <div class="chat" id="chat">
      <div class="divider"><div class="line"></div><div class="txt">오늘</div><div class="line"></div></div>
    </div>

    <div class="inputbar" id="inputbar" style="display:none">
      <div class="inputrow">
        <input id="text" class="textinput" type="text" placeholder="메시지를 입력하세요" />
        <input id="file" type="file" style="display:none" accept="image/*,.pdf,.txt,.zip,.doc,.docx,.ppt,.pptx,.xls,.xlsx"/>
        <button id="attach" class="btn btn-attach" type="button">📎</button>
        <button id="emojiBtn" class="btn btn-emoji" type="button">😊</button>
        <button id="send" class="btn btn-send" type="button">보내기</button>
      </div>
      <div class="subtitle" style="margin-top:4px">Enter 전송 · 2MB 이하 첨부 지원</div>
    </div>

    <div id="setup" class="setup" style="padding:14px 14px 120px;background:var(--chat-bg)">
      <div class="panel" style="background:#fff;border:1px solid var(--border);border-radius:16px;padding:14px">
        <label class="label">대화방 코드</label>
        <input id="room" class="field" type="text" placeholder="예: myroom123" value="${room}" />
        <label class="label">닉네임</label>
        <input id="nick" class="field" type="text" placeholder="예: 민성" value="${nick}" />
        <label class="label">방 키 (선택)</label>
        <input id="key" class="field" type="password" placeholder="비밀번호" />
        <div class="row" style="display:flex;gap:8px;margin-top:12px">
          <button id="create" class="btn btn-send" type="button">입장</button>
          <button id="makeLink" class="btn btn-emoji" type="button">초대 링크</button>
        </div>
        <div class="subtitle" id="status" style="margin-top:6px">대기</div>
        <div class="link" style="font-size:12px;color:var(--accent);margin-top:6px">Invite link: <span id="invite"></span></div>
      </div>
    </div>
  </div>
</div>

<script src="/socket.io/socket.io.js?v=${APP_VERSION}"></script>
<script>
(() => {
  // ===== Helpers =============================================================
  const $ = s => document.querySelector(s);
  const on = (el, ev, fn, opt) => el.addEventListener(ev, fn, opt);
  const fmt = ts => { const d=new Date(ts); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };
  const esc = s => (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const genId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  const scrollBottom = box => box.scrollTop = box.scrollHeight;

  const chatBox = $('#chat'), setup = $('#setup'), inputbar = $('#inputbar');
  const roomInput = $('#room'), nickInput = $('#nick'), keyInput = $('#key');
  const invite = $('#invite'), statusTag = $('#status'), online = $('#online');
  const fileInput = $('#file'), textInput = $('#text');
  const themeSel = $('#themeSel'), brandTitle = $('#brandTitle'), brandIcon = $('#brandIcon'), statusIcon = $('#statusIcon');
  const favLink = $('#favicon');
  const baseTitle = document.title;

  // ===== Theme & Favicon =====================================================
  const THEME_KEY='chat_theme';
  let favBaseEmoji = '🐱', favAlertEmoji = '🔔';
  let favBaseURL = '', favAlertURL = '';

  const drawFavicon = emoji => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,64,64);
    ctx.font = '48px serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(emoji, 32, 40);
    return c.toDataURL('image/png');
  };
  const setFavicon = url => { if (favLink) favLink.href = url; };

  function applyTheme(t){
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem(THEME_KEY, t);
    if (t === 'fox'){ brandTitle.textContent='Fox Chat'; brandIcon.textContent='🦊'; statusIcon.textContent='🔥'; favBaseEmoji='🦊'; }
    else           { brandTitle.textContent='Cloud Cat Chat'; brandIcon.textContent='🐱'; statusIcon.textContent='☁️'; favBaseEmoji='🐱'; }
    favBaseURL = drawFavicon(favBaseEmoji);
    favAlertURL = drawFavicon(favAlertEmoji);
    setFavicon(favBaseURL);
  }
  themeSel.value = localStorage.getItem(THEME_KEY) || 'cloud';
  applyTheme(themeSel.value);
  on(themeSel, 'change', () => applyTheme(themeSel.value));
  const peerEmoji = () => (document.documentElement.getAttribute('data-theme') === 'fox') ? '🦊' : '🐾';

  // ===== Visibility & Notify =================================================
  const State = {
    hasFocus: document.hasFocus(),
    visible: document.visibilityState === 'visible',
    get attended(){ return this.hasFocus && this.visible; }
  };
  on(window, 'focus', () => { State.hasFocus = true; Notify.clearUnseen(); rescanUnread(); Notify.stopFlash(); setFavicon(favBaseURL); });
  on(window, 'blur', () => { State.hasFocus = false; });
  on(document, 'visibilitychange', () => {
    State.visible = document.visibilityState === 'visible';
    if (State.visible) { Notify.clearUnseen(); rescanUnread(); Notify.stopFlash(); setFavicon(favBaseURL); }
  });

  const LS = { flash:'flash_on', notify:'notify_on', sound:'sound_on' };
  const Notify = (() => {
    let unseenTotal = 0, flasher = null, flip = false;
    let flashOn  = (localStorage.getItem(LS.flash)  ?? '1') === '1';
    let deskOn   = (localStorage.getItem(LS.notify) ?? '0') === '1';
    let soundOn  = (localStorage.getItem(LS.sound)  ?? '0') === '1';

    const badge = $('#unseenBadge');
    const flashBtn = $('#flashBtn'), notifyBtn = $('#notifyBtn'), soundBtn = $('#soundBtn');

    // Audio
    let audioCtx = null, unlocked = false;
    const unlock = () => {
      if (unlocked) return;
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        g.gain.value = 0; o.connect(g); g.connect(audioCtx.destination); o.start(); setTimeout(()=>o.stop(), 30);
        unlocked = true;
      } catch {}
    };
    on(document, 'click', unlock, { once:true }); on(document, 'keydown', unlock, { once:true });
    const beep = () => {
      if (!soundOn) return;
      if (!audioCtx) try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type='triangle'; o.frequency.value=880;
      g.gain.setValueAtTime(0, audioCtx.currentTime);
      g.gain.linearRampToValueAtTime(0.03, audioCtx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.2);
      o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.22);
    };

    // Toggles
    const updateUI = () => {
      flashBtn.classList.toggle('active', flashOn);
      notifyBtn.classList.toggle('active', deskOn);
      soundBtn.classList.toggle('active', soundOn);
      notifyBtn.textContent = deskOn ? '🔔' : '🔕';
      soundBtn.textContent  = soundOn ? '🔊' : '🔈';
    };
    updateUI();

    flashBtn.onclick = () => { flashOn = !flashOn; localStorage.setItem(LS.flash, flashOn?'1':'0'); updateUI(); if (!flashOn) stopFlash(); };
    notifyBtn.onclick = async () => {
      if (!('Notification' in window)) return alert('이 브라우저는 데스크톱 알림을 지원하지 않습니다.');
      if (Notification.permission !== 'granted') {
        deskOn = (await Notification.requestPermission()) === 'granted';
      } else deskOn = !deskOn;
      localStorage.setItem(LS.notify, deskOn?'1':'0'); updateUI();
    };
    soundBtn.onclick = () => { soundOn = !soundOn; localStorage.setItem(LS.sound, soundOn?'1':'0'); updateUI(); };

    // Flash
    const startFlash = () => {
      if (!flashOn || flasher) return;
      flasher = setInterval(() => {
        flip = !flip;
        document.title = flip ? '🔔 ' + unseenTotal + ' 새 메시지' : baseTitle;
        setFavicon(flip ? favAlertURL : favBaseURL);
      }, 900);
    };
    const stopFlash = () => { if (flasher){ clearInterval(flasher); flasher=null; } document.title = baseTitle; setFavicon(favBaseURL); };

    const bump = () => { unseenTotal++; badge.textContent=String(unseenTotal); badge.style.display='inline-block'; startFlash(); if (soundOn) beep(); };
    const clearUnseen = () => { unseenTotal=0; badge.style.display='none'; stopFlash(); };
    const desktop = (title, body) => {
      if (!deskOn || !('Notification' in window) || Notification.permission !== 'granted') return;
      try {
        const n = new Notification(title, { body, tag: 'room-'+(window.myRoom||'') });
        n.onclick = () => { window.focus(); n.close(); };
        setTimeout(()=>{ try{ n.close(); }catch{} }, 5000);
      } catch {}
    };

    return { bump, clearUnseen, startFlash, stopFlash, desktop };
  })();

  // ===== Invite link =====
  const setInviteLink = r => { const u=new URL(window.location); u.searchParams.set('room', r); invite.textContent=u.toString(); };
  $('#makeLink').onclick = () => { const r=(roomInput.value||'').trim(); if(!r) return alert('방 코드를 입력하세요'); setInviteLink(r); };

  // ===== System line =====
  const addSys = msg => { const d = document.createElement('div'); d.className='sys'; d.textContent = msg; chatBox.appendChild(d); scrollBottom(chatBox); };

  // ===== Read tracking (IntersectionObserver) ================================
  const readSent = new Set();
  const sendRead = id => { if (!window.socket || readSent.has(id)) return; readSent.add(id); window.socket.emit('read', { room: myRoom, id }); };
  const OBS_THRESHOLD = 0.75;
  const observer = new IntersectionObserver((entries)=>{
    if (!State.attended) return;
    entries.forEach(e => {
      if (e.intersectionRatio >= OBS_THRESHOLD) {
        const id = e.target.getAttribute('data-mid');
        if (id && !readSent.has(id)) sendRead(id);
      }
    });
  }, { root: chatBox, threshold: [OBS_THRESHOLD] });
  function rescanUnread(){
    if (!State.attended) return;
    document.querySelectorAll('.msg.them[data-mid]').forEach(el=>{
      const id = el.getAttribute('data-mid'); if (!id || readSent.has(id)) return;
      observer.observe(el);
    });
  }

  // ===== Typing indicator ====================================================
  const typingFlag = (() => {
    const box = document.createElement('div');
    box.className = 'typing-flag';
    box.style.cssText = 'position:sticky;bottom:8px;left:0;display:none;align-items:center;gap:8px;background:#fff;border:1px solid rgba(14,165,233,.22);padding:6px 10px;border-radius:12px;color:#0f172a;font-size:12px;box-shadow:0 8px 24px rgba(2,6,23,.08);max-width:70%';
    box.innerHTML = '<span class="who" style="color:var(--accent);font-weight:600"></span> 입력 중 <span class="dots"><i></i><i></i><i></i></span>';
    document.body.appendChild(box);
    return { box, who: box.querySelector('.who'), hideTimer: null,
      show(name){ this.who.textContent = name || '상대'; this.box.style.display='inline-flex'; chatBox.appendChild(this.box); clearTimeout(this.hideTimer); this.hideTimer = setTimeout(()=>this.hide(), 1500); },
      hide(){ this.box.style.display='none'; }
    };
  })();

  // ===== Renderer (text/file 통합) ===========================================
  const makeStack = () => { const s=document.createElement('div'); s.className='stack'; return s; };

  function renderMessage({fromMe, name, text, file, ts, id}){
    const row = document.createElement('div'); row.className='msg ' + (fromMe?'me':'them'); if (id) row.dataset.mid = id;

    if(!fromMe){ const av=document.createElement('div'); av.className='avatar'; av.textContent = peerEmoji(); row.appendChild(av); }
    else { const t=document.createElement('span'); t.className='time'; t.textContent=fmt(ts||Date.now()); row.appendChild(t); }

    const stack = makeStack();
    if(!fromMe){ const nm = document.createElement('div'); nm.className='name'; nm.textContent = name || '상대'; stack.appendChild(nm); }

    const content = document.createElement('div'); content.className='content';
    if (file){
      if ((file.type||'').startsWith('image/')){
        const img = document.createElement('img'); img.src = file.data; img.alt = file.name || 'image';
        on(img, 'click', () => openViewer(img.src, img.alt));
        content.appendChild(img);
        const meta = document.createElement('div'); meta.className='att';
        meta.innerHTML = '<a href="'+file.data+'" download="'+esc(file.name||'image')+'">이미지 저장</a><span class="size"> '+humanSize(file.size||0)+'</span>';
        content.appendChild(meta);
      } else {
        const meta = document.createElement('div'); meta.className='att';
        meta.innerHTML = '파일: <a href="'+file.data+'" download="'+esc(file.name||'file')+'">'+esc(file.name||'file')+'</a><span class="size"> '+humanSize(file.size||0)+'</span>';
        content.appendChild(meta);
      }
    } else {
      const p = document.createElement('div'); p.className='text'; p.textContent = text || ''; content.appendChild(p);
    }
    stack.appendChild(content);
    row.appendChild(stack);

    if(fromMe){ const b=document.createElement('span'); b.className='unread'; b.textContent=''; row.appendChild(b); }
    else { const t2=document.createElement('span'); t2.className='time'; t2.textContent = fmt(ts||Date.now()); row.appendChild(t2); }

    chatBox.appendChild(row); scrollBottom(chatBox); chatBox.appendChild(typingFlag.box);
    if(!fromMe && id){ observer.observe(row); if (State.attended) rescanUnread(); }
  }

  const humanSize = b => b<1024 ? b+' B' : b<1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(2)+' MB';

  // ===== Lightbox ============================================================
  const viewer = (() => {
    const el = document.createElement('div');
    el.style.cssText='position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(2,6,23,.7);z-index:50';
    el.innerHTML = '<div id="vClose" style="position:absolute;top:16px;right:20px;font-size:26px;color:#e5e7eb;cursor:pointer">✕</div><div style="max-width:92vw;max-height:92vh;border-radius:12px;overflow:hidden;background:#000"><img id="vImg" alt=""></div>';
    document.body.appendChild(el);
    const img = el.querySelector('#vImg'), close = el.querySelector('#vClose');
    const open = (src, alt) => { img.src=src; img.alt=alt||''; el.style.display='flex'; };
    const hide = () => { el.style.display='none'; img.src=''; };
    on(el, 'click', e => { if (e.target === el) hide(); });
    on(close, 'click', hide);
    on(window, 'keydown', e => { if (e.key==='Escape') hide(); });
    return { open, hide };
  })();
  const openViewer = viewer.open;

  // ===== Emoji minimal =======================================================
  $('#emojiBtn').onclick = () => {
    const em = ['😀','😆','😊','😉','😍','😘','😎','🤗','🤔','😴','😇','🥳','😭','😡','👍','👏','🙏','💪','🔥','✨'];
    const s = prompt('이모지 선택: ' + em.join(' '));
    if (s) {
      const pos = textInput.selectionStart ?? textInput.value.length;
      textInput.value = textInput.value.slice(0,pos) + s + textInput.value.slice(pos);
      textInput.focus(); textInput.setSelectionRange(pos+s.length, pos+s.length);
    }
  };

  // ===== Socket / Join / Keep-alive =========================================
  let socket, myNick, myRoom, myKey = '', joined = false, typingTimerSend, typingActive=false, lastTyping=0, composing=false, keepAlive=null;

  const enableCreate = () => { const b=$('#create'); if(b) b.disabled=false; };
  const disableCreate = () => { const b=$('#create'); if(b) b.disabled=true; };

  $('#create').onclick = () => {
    if (socket) return; disableCreate();
    const r = (roomInput.value||'').trim(), n = (nickInput.value||'').trim(), k=(keyInput.value||'').trim();
    if(!r || !n){ alert('방 코드와 닉네임을 입력하세요'); enableCreate(); return; }
    myRoom=r; myNick=n; myKey=k;

    socket = io({ path:'/socket.io', transports:['websocket','polling'], forceNew:true, reconnection:true, reconnectionAttempts:Infinity, reconnectionDelay:1000, reconnectionDelayMax:5000, timeout:15000 });
    const join = () => socket.emit('join', { room: myRoom, nick: myNick, key: myKey||'' });
    const joinGuard = setTimeout(()=>{ if(!joined){ enableCreate(); addSys('서버 응답 지연. 다시 시도하세요.'); } }, 16000);

    socket.on('connect',  () => { online.textContent='online'; if (joined) join(); });
    socket.on('reconnect',() => { join(); });
    socket.on('connect_error', err => { addSys('연결 실패: '+(err?.message||err)); enableCreate(); });

    join();

    socket.on('joined', info => {
      joined = true; window.socket = socket; window.myRoom = myRoom; window.myNick = myNick;
      setInviteLink(myRoom); setup.style.display='none'; inputbar.style.display='block';
      addSys(info.msg); history.replaceState(null, '', '?room='+encodeURIComponent(myRoom)+'&nick='+encodeURIComponent(myNick));
      rescanUnread();
      if (keepAlive) clearInterval(keepAlive);
      keepAlive = setInterval(()=>{ if (socket?.connected) socket.emit('ka', Date.now()); }, 10_000);
      clearTimeout(joinGuard);
    });

    socket.on('disconnect', reason => {
      online.textContent='offline';
      if (keepAlive) { clearInterval(keepAlive); keepAlive=null; }
      addSys('연결이 끊어졌습니다: ' + reason + ' (자동 재연결 시도)'); enableCreate();
    });

    socket.on('join_error', err => { addSys('입장 실패: ' + err); alert('입장 실패: ' + err); enableCreate(); });
    socket.on('peer_joined', name => addSys(name + ' 님이 입장했습니다'));
    socket.on('peer_left',  name => addSys(name + ' 님이 퇴장했습니다'));

    socket.on('msg',  p => { renderMessage({fromMe:false, name:p.nick, text:p.text, ts:p.ts, id:p.id}); if (p.id && State.attended) sendRead(p.id); if (!State.attended) { const icon = document.documentElement.getAttribute('data-theme')==='fox'?'🦊':'🐱'; Notify.desktop(icon+' 새 메시지', (p.nick||'상대')+': '+String(p.text||'').slice(0,80)); Notify.bump(); }});
    socket.on('file', p => { renderMessage({fromMe:false, name:p.nick, file:{ name:p.name, type:p.type, size:p.size, data:p.data, ts:p.ts }, ts:p.ts, id:p.id}); if (p.id && State.attended) sendRead(p.id); if (!State.attended) { const icon = document.documentElement.getAttribute('data-theme')==='fox'?'🦊':'🐱'; Notify.desktop(icon+' 파일 도착', (p.nick||'상대')+'님이 '+(p.name||'파일')+'을 보냈습니다'); Notify.bump(); }});

    socket.on('unread', u => {
      const row = document.querySelector('.msg.me[data-mid="'+u.id+'"]'); if (!row) return;
      const badge = row.querySelector('.unread'); if (!badge) return;
      if (u.count > 0) { badge.textContent = String(u.count); badge.style.display = 'inline'; } else { badge.remove(); }
    });

    socket.on('typing', p => { p?.state ? typingFlag.show(p.nick||'상대') : typingFlag.hide(); });
    socket.on('ka', () => {});
  };

  // 입력/타이핑/엔터
  $('#send').onclick = sendMsg;
  on(textInput, 'compositionstart', () => composing=true);
  on(textInput, 'compositionend',  () => composing=false);
  on(textInput, 'keydown', e => {
    if ((e.key==='Enter' || e.key==='NumpadEnter') && !e.shiftKey) { if (!composing){ e.preventDefault(); sendMsg(); return; } }
    handleTyping();
  });
  on(textInput, 'input', handleTyping);
  on(textInput, 'blur', () => { if(window.socket){ window.socket.emit('typing', { room: myRoom, state: 0 }); typingActive=false; } });

  function handleTyping(){
    if(!window.socket || !joined) return;
    const now = Date.now();
    if(!typingActive || now - lastTyping > 1000){
      window.socket.emit('typing', { room: myRoom, state: 1 });
      typingActive = true; lastTyping = now;
    }
    clearTimeout(typingTimerSend);
    typingTimerSend = setTimeout(()=>{ if(window.socket){ window.socket.emit('typing', { room: myRoom, state: 0 }); typingActive=false; } }, 1500);
  }

  function sendMsg(){
    if(!window.socket){ addSys('연결되지 않음'); return; }
    const val = (textInput.value||'').trim(); if(!val) return;
    const id = genId();
    window.socket.emit('msg', { room: myRoom, id, text: val });
    renderMessage({fromMe:true, name:myNick, text:val, ts:Date.now(), id});
    textInput.value = '';
    if(typingActive){ window.socket.emit('typing', { room: myRoom, state: 0 }); typingActive=false; }
    Notify.clearUnseen();
  }

  // 파일 전송
  const ALLOWED_TYPES = new Set(['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel']);
  const MAX_BYTES = 2_000_000;

  $('#attach').onclick = () => fileInput.click();
  fileInput.onchange = () => { [...(fileInput.files||[])].forEach(sendFile); fileInput.value=''; };
  on(document, 'paste', e => {
    if(!joined) return;
    const items = [...(e.clipboardData?.items||[])];
    items.forEach(it => { if (it.kind === 'file'){ const f = it.getAsFile(); if (f) sendFile(f); } });
  });

  function sendFile(file){
    if (!file) return;
    if (file.size > MAX_BYTES) return addSys('파일이 너무 큽니다(최대 2MB).');
    if (!(ALLOWED_TYPES.has(file.type) || (file.type||'').startsWith('image/'))) return addSys('허용되지 않은 파일 형식입니다.');
    const rd = new FileReader();
    rd.onload = () => {
      const dataUrl = rd.result, id = genId();
      renderMessage({fromMe:true, name:myNick, file:{ name:file.name, type:file.type, size:file.size, data:dataUrl, ts:Date.now() }, ts:Date.now(), id});
      window.socket.emit('file', { room: myRoom, id, name:file.name, type:file.type, size:file.size, data:dataUrl });
    };
    rd.readAsDataURL(file);
  }

  on(chatBox, 'scroll', () => { if (State.attended) rescanUnread(); });

  // Prefill
  const url = new URL(window.location);
  const r = url.searchParams.get('room'), n = url.searchParams.get('nick');
  if(r){ roomInput.value = r; setInviteLink(r); }
  if(n){ nickInput.value = n; }
})();
</script>
</body>
</html>`);
});

// ===== Socket handlers =======================================================
io.on('connection', (socket) => {
  socket.on('join', ({ room, nick, key }) => {
    room = sanitize(room, 40);
    nick = sanitize(nick, 24);
    key = sanitize(key, 50);
    if (!room || !nick) return socket.emit('join_error', '잘못된 파라미터');

    const r = getRoom(room);
    if (r.users.size === 0) { if (key) r.key = key; }
    else {
      if (r.key && key !== r.key) return socket.emit('join_error', '방 키가 일치하지 않습니다');
      if (!r.key && key) return socket.emit('join_error', '이미 만들어진 방에는 키를 새로 설정할 수 없어요');
    }

    socket.data.nick = nick;
    socket.data.room = room;

    socket.join(room);
    r.users.add(socket.id);

    socket.emit('joined', { msg: nick + ' 님, ' + room + ' 방에 입장했습니다' + (r.key ? ' (키 적용됨)' : '') });
    socket.to(room).emit('peer_joined', nick);
  });

  // 텍스트
  socket.on('msg', ({ room, id, text }) => {
    room = sanitize(room, 40);
    id = sanitize(id, 64);
    const r = rooms.get(room);
    if (!r) return;
    const nick = sanitize(socket.data.nick, 24) || '게스트';
    text = sanitize(text, 2000);
    if (isThrottled(r, socket.id)) return socket.emit('info', '메시지가 너무 빠릅니다. 잠시 후 다시 시도하세요.');

    r.lastMsgs.push({ t: now(), from: socket.id });

    const recipients = [...r.users].filter(sid => sid !== socket.id);
    r.unread.set(id, new Set(recipients));

    socket.to(room).emit('msg', { id, nick, text, ts: now() });
    io.to(room).emit('unread', { id, count: recipients.length });
  });

  // 파일
  const ALLOWED_TYPES = new Set(['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel']);
  const MAX_BYTES = 2_000_000;
  const MAX_DATAURL = 7_000_000;

  socket.on('file', ({ room, id, name, type, size, data }) => {
    room = sanitize(room, 40);
    id = sanitize(id, 64);
    const r = rooms.get(room);
    if (!r) return;
    const nick = sanitize(socket.data.nick, 24) || '게스트';
    name = sanitize(name, 140);
    type = sanitize(type, 100);
    size = Number(size) || 0;

    if (size > MAX_BYTES) return socket.emit('info', '파일이 너무 큽니다(최대 2MB).');
    if (!(ALLOWED_TYPES.has(type) || (type||'').startsWith('image/'))) return socket.emit('info', '허용되지 않은 파일 형식입니다.');
    if (typeof data !== 'string' || data.slice(0,5) !== 'data:' || data.length > MAX_DATAURL) return socket.emit('info', '파일 데이터가 올바르지 않습니다.');
    if (isThrottled(r, socket.id, 5, 15_000)) return socket.emit('info', '전송이 너무 빠릅니다. 잠시 후 다시 시도하세요.');

    const recipients = [...r.users].filter(sid => sid !== socket.id);
    r.unread.set(id, new Set(recipients));

    socket.to(room).emit('file', { id, nick, name, type, size, data, ts: now() });
    io.to(room).emit('unread', { id, count: recipients.length });
  });

  // 읽음
  socket.on('read', ({ room, id }) => {
    room = sanitize(room, 40);
    id = sanitize(id, 64);
    if (!room || !id) return;
    const r = rooms.get(room);
    if (!r) return;
    const set = r.unread.get(id);
    if (!set) return;
    if (set.delete(socket.id)) {
      const count = set.size;
      io.to(room).emit('unread', { id, count });
      if (count === 0) r.unread.delete(id);
    }
  });

  // 타이핑
  socket.on('typing', ({ room, state }) => {
    room = sanitize(room, 40);
    const nick = sanitize(socket.data.nick, 24) || '게스트';
    socket.to(room).emit('typing', { nick, state: !!state });
  });

  // keep-alive echo
  socket.on('ka', () => socket.emit('ka', now()));

  socket.on('disconnect', (reason) => {
    const room = socket.data.room;
    const nick = socket.data.nick;
    if (room && rooms.has(room)) {
      const r = rooms.get(room);
      for (const [mid, set] of r.unread.entries()) {
        if (set.delete(socket.id)) {
          const count = set.size;
          io.to(room).emit('unread', { id: mid, count });
          if (count === 0) r.unread.delete(mid);
        }
      }
      r.users.delete(socket.id);
      socket.to(room).emit('peer_left', nick || '게스트');
      if (r.users.size === 0) rooms.delete(room);
    }
    console.log('disconnect', reason);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('multi-user chat running on http://localhost:' + PORT);
});
