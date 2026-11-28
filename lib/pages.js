'use strict';

const { t, isRtl, htmlLang } = require('./i18n');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

const BASE_CSS = `
:root{
  color-scheme: dark;
  --bg:#08090d;
  --card:rgba(22,24,31,.72);
  --border:rgba(255,255,255,.08);
  --text:#f2f3f7;
  --muted:#9aa1b2;
  --accent:#6c8cff;
  --accent-2:#8f6cff;
  --ok:#3ddc97;
  --err:#ff6b6b;
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;
  font-family:"Segoe UI Variable Text","Segoe UI",Inter,-apple-system,BlinkMacSystemFont,"Noto Sans","Helvetica Neue",Arial,sans-serif;
  background:var(--bg);
  color:var(--text);
  display:flex;
  align-items:center;
  justify-content:center;
  padding:24px;
  -webkit-font-smoothing:antialiased;
  overflow-x:hidden;
}
body::before,body::after{
  content:"";
  position:fixed;
  border-radius:50%;
  filter:blur(90px);
  opacity:.5;
  pointer-events:none;
  z-index:0;
}
body::before{width:520px;height:520px;background:#2f3ea8;top:-220px;left:-140px}
body::after{width:460px;height:460px;background:#5b2f8f;bottom:-220px;right:-120px}
.card{
  position:relative;
  z-index:1;
  width:100%;
  max-width:520px;
  background:var(--card);
  border:1px solid var(--border);
  border-radius:22px;
  padding:40px 36px;
  backdrop-filter:blur(22px);
  -webkit-backdrop-filter:blur(22px);
  box-shadow:0 30px 70px rgba(0,0,0,.55);
  text-align:center;
}
.icon{
  width:74px;height:74px;
  margin:0 auto 22px;
  display:flex;align-items:center;justify-content:center;
  border-radius:20px;
  background:linear-gradient(145deg,rgba(108,140,255,.22),rgba(143,108,255,.12));
  border:1px solid rgba(108,140,255,.35);
}
.icon svg{width:38px;height:38px;stroke:var(--accent);fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
h1{
  font-size:23px;
  line-height:1.35;
  margin:0 0 12px;
  font-weight:650;
  letter-spacing:-.01em;
}
p{
  margin:0;
  color:var(--muted);
  font-size:15.5px;
  line-height:1.65;
}
.actions{margin-top:26px;display:flex;flex-direction:column;gap:10px;align-items:center}
.btn{
  appearance:none;
  display:inline-flex;align-items:center;justify-content:center;gap:9px;
  width:100%;
  padding:13px 20px;
  border-radius:12px;
  border:1px solid rgba(255,255,255,.14);
  background:rgba(255,255,255,.05);
  color:var(--text);
  font-size:14.5px;
  font-weight:600;
  text-decoration:none;
  cursor:pointer;
  transition:background .15s ease,border-color .15s ease,transform .12s ease;
}
.btn:hover{background:rgba(255,255,255,.09);border-color:rgba(255,255,255,.22)}
.btn:active{transform:translateY(1px)}
.btn.primary{
  border:none;
  background:linear-gradient(135deg,var(--accent),var(--accent-2));
  color:#fff;
  box-shadow:0 8px 26px rgba(108,140,255,.32);
}
.btn.primary:hover{filter:brightness(1.07)}
.btn svg{width:17px;height:17px;flex:0 0 auto;display:block}
.btn.ghost{background:transparent}
.btn[disabled]{opacity:.55;cursor:not-allowed}
.meta{
  margin-top:22px;
  font-size:12.5px;
  color:#6f7686;
  line-height:1.6;
  word-break:break-all;
}
.pill{
  display:inline-flex;align-items:center;gap:6px;
  padding:5px 11px;
  border-radius:999px;
  font-size:12px;
  letter-spacing:.02em;
  background:rgba(61,220,151,.1);
  border:1px solid rgba(61,220,151,.28);
  color:var(--ok);
}
.dot{width:6px;height:6px;border-radius:50%;background:var(--ok);box-shadow:0 0 8px var(--ok)}
.hidden{display:none!important}
/* Trang PC: chỉ một dòng chữ duy nhất */
.solo{
  position:relative;
  z-index:1;
  width:100%;
  max-width:560px;
  text-align:center;
  padding:8px 4px;
  animation:rise .55s ease both;
}
.solo p{
  margin:0;
  font-size:21px;
  line-height:1.65;
  font-weight:500;
  color:var(--text);
  letter-spacing:.004em;
  text-wrap:balance;
}
@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@media (max-width:520px){
  .card{padding:32px 22px;border-radius:18px}
  h1{font-size:20px}
  .solo p{font-size:18px;line-height:1.7}
}
@media (prefers-reduced-motion:reduce){
  .solo{animation:none}
}
`;

function pageShell({ lang, title, bodyClass, body, head = '', script = '' }) {
  const dir = isRtl(lang) ? 'rtl' : 'ltr';
  return `<!doctype html>
<html lang="${escapeHtml(htmlLang(lang))}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title>
<style>${BASE_CSS}${head}</style>
</head>
<body class="${bodyClass}">
${body}
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;
}

const ICON_MONITOR = `<svg viewBox="0 0 24 24"><rect x="2.5" y="3.5" width="19" height="13" rx="2.2"/><path d="M8.5 20.5h7M12 16.5v4"/></svg>`;
const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24"><path d="M12 3.5v12"/><path d="M7.5 11l4.5 4.5 4.5-4.5"/><path d="M4 20.5h16"/></svg>`;
const ICON_LOCK = `<svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2.6"/><path d="M8 10V7.2a4 4 0 0 1 8 0V10"/></svg>`;

function renderHome({ lang, device, zipName, zipSize, messages }) {
  const dict = t(lang);
  const isMobile = device === 'mobile';

  const desktopText = (messages && messages.desktopText) || dict.desktopText;
  const mobileText = (messages && messages.mobileText) || dict.mobileText;
  const mobileBody = `
<main class="card${isMobile ? '' : ' hidden'}" id="view-mobile">
  <div class="icon">${ICON_MONITOR}</div>
  <p>${escapeHtml(mobileText)}</p>
</main>`;

  // Trang PC: chỉ đúng một dòng chữ, không icon, không nút, không thông tin file
  const desktopBody = `
<main class="solo${isMobile ? ' hidden' : ''}" id="view-desktop">
  <p>${escapeHtml(desktopText)}</p>
</main>`;

  const script = `
(function(){
  var serverDevice = ${JSON.stringify(device)};
  var ua = navigator.userAgent || '';
  var mobile = /Android|webOS|iPhone|iPod|iPad|BlackBerry|IEMobile|Opera Mini|Windows Phone|Silk|Kindle|PlayBook|Tablet|Mobile/i.test(ua);
  if (!mobile && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) mobile = true;
  if (!mobile && navigator.userAgentData && navigator.userAgentData.mobile) mobile = true;

  var viewMobile = document.getElementById('view-mobile');
  var viewDesktop = document.getElementById('view-desktop');
  var isMobile = mobile;
  if (!isMobile && serverDevice === 'mobile') isMobile = true;

  if (isMobile) {
    viewDesktop.classList.add('hidden');
    viewMobile.classList.remove('hidden');
    document.body.setAttribute('data-device','mobile');
    return;
  }

  viewMobile.classList.add('hidden');
  viewDesktop.classList.remove('hidden');
  document.body.setAttribute('data-device','desktop');

  var status = null;
  var started = false;

  function start(){
    if (started) return;
    started = true;
    try {
      var a = document.createElement('a');
      a.href = '/download?auto=1';
      a.download = ${JSON.stringify(zipName)};
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function(){ if (a.parentNode) a.remove(); }, 4000);
    } catch (e) {
      try { window.location.href = '/download?auto=1'; } catch (err) {}
    }
  }

  // Tự động tải xuống ngay khi trang sẵn sàng
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
})();`;

  return pageShell({
    lang,
    title: isMobile ? dict.mobileTitle : dict.desktopTitle,
    bodyClass: 'home',
    body: mobileBody + desktopBody,
    script,
  });
}

function renderAdminLogin({ lang = 'vi', error = '', hasPassword }) {
  const body = `
<main class="card" style="max-width:420px;text-align:left">
  <div class="icon" style="margin-left:0">${ICON_LOCK}</div>
  <h1 style="text-align:left">Quản trị</h1>
  <p style="text-align:left">Nhập mật khẩu để thay file ZIP trên web.</p>
  <form method="post" action="/admin/login" style="margin-top:24px">
    ${error ? `<div class="alert">${escapeHtml(error)}</div>` : ''}
    <label class="label" for="password">Mật khẩu</label>
    <input class="input" id="password" name="password" type="password" autocomplete="current-password" autofocus required>
    <button class="btn primary" type="submit" style="margin-top:18px">Đăng nhập</button>
  </form>
</main>`;
  return pageShell({
    lang,
    title: 'Quản trị',
    bodyClass: 'admin',
    body,
    head: ADMIN_CSS,
  });
}

const ADMIN_CSS = `
.card .label{display:block;font-size:12.5px;color:var(--muted);margin-bottom:8px;letter-spacing:.02em}
.input{
  width:100%;
  padding:12px 14px;
  border-radius:11px;
  border:1px solid rgba(255,255,255,.12);
  background:rgba(0,0,0,.28);
  color:var(--text);
  font-size:15px;
  font-family:inherit;
  outline:none;
  transition:border-color .15s ease,box-shadow .15s ease;
}
.input:focus{border-color:rgba(108,140,255,.65);box-shadow:0 0 0 3px rgba(108,140,255,.16)}
.alert{
  padding:11px 13px;
  border-radius:10px;
  background:rgba(255,107,107,.1);
  border:1px solid rgba(255,107,107,.32);
  color:#ffb4b4;
  font-size:13.5px;
  margin-bottom:16px;
}
.topbar{
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  margin-bottom:26px;text-align:left;
}
.topbar h1{margin:0;font-size:19px}
.dropzone{
  margin-top:8px;
  padding:34px 20px;
  border-radius:16px;
  border:1.6px dashed rgba(255,255,255,.18);
  background:rgba(255,255,255,.02);
  text-align:center;
  cursor:pointer;
  transition:border-color .15s ease,background .15s ease;
}
.dropzone:hover,.dropzone.drag{border-color:rgba(108,140,255,.7);background:rgba(108,140,255,.07)}
.dropzone strong{display:block;font-size:15px;margin-bottom:6px;font-weight:600}
.dropzone span{font-size:13px;color:var(--muted)}
.progress{
  height:7px;border-radius:999px;background:rgba(255,255,255,.08);
  overflow:hidden;margin-top:16px;
}
.progress > i{
  display:block;height:100%;width:0;
  background:linear-gradient(90deg,var(--accent),var(--accent-2));
  transition:width .18s ease;
}
.status{margin-top:12px;font-size:13px;min-height:19px;color:var(--muted);text-align:left}
.status.ok{color:var(--ok)}
.status.err{color:var(--err)}
.filebox{
  display:flex;align-items:center;gap:14px;
  padding:16px;
  border-radius:14px;
  border:1px solid var(--border);
  background:rgba(255,255,255,.035);
  text-align:left;
  margin-bottom:22px;
}
.filebox .fi{
  flex:0 0 auto;width:42px;height:42px;border-radius:11px;
  display:flex;align-items:center;justify-content:center;
  background:rgba(108,140,255,.14);border:1px solid rgba(108,140,255,.3);
}
.filebox .fi svg{width:20px;height:20px;stroke:var(--accent);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.filebox .fn{font-size:14.5px;font-weight:600;word-break:break-all;line-height:1.4}
.filebox .fm{font-size:12.5px;color:var(--muted);margin-top:3px}
.link-out{color:var(--accent);text-decoration:none;font-size:13px}
.link-out:hover{text-decoration:underline}
form.inline{display:inline}
`;

function renderAdminPanel({ lang = 'vi', zipName, zipSize, updatedAt, passwordGenerated }) {
  const body = `
<main class="card" style="max-width:560px">
  <div class="topbar">
    <h1>Quản trị file ZIP</h1>
    <form class="inline" method="post" action="/admin/logout">
      <button class="btn ghost" type="submit" style="width:auto;padding:8px 14px;font-size:13px">Đăng xuất</button>
    </form>
  </div>

  <div class="filebox">
    <div class="fi">${ICON_DOWNLOAD}</div>
    <div>
      <div class="fn">${escapeHtml(zipName)}</div>
      <div class="fm">${escapeHtml(formatBytes(zipSize))} · cập nhật ${escapeHtml(updatedAt)}</div>
    </div>
  </div>

  <label class="label">Tải lên file ZIP mới</label>
  <div class="dropzone" id="dropzone">
    <strong>Bấm để chọn file .zip, .rar, .exe hoặc .msi</strong>
    <span>hoặc kéo thả file vào đây · tối đa 500 MB</span>
  </div>
  <input type="file" id="file" accept=".zip,.rar,.exe,.msi,application/zip,application/vnd.rar,application/vnd.microsoft.portable-executable,application/x-msi" class="hidden">

  <div class="progress hidden" id="progressWrap"><i id="progress"></i></div>
  <div class="status" id="status"></div>

  <div style="margin-top:26px;text-align:left">
    <a class="link-out" href="/" target="_blank" rel="noopener">Mở trang tải xuống →</a>
  </div>
</main>`;

  const script = `
(function(){
  var dropzone = document.getElementById('dropzone');
  var input = document.getElementById('file');
  var progressWrap = document.getElementById('progressWrap');
  var progress = document.getElementById('progress');
  var status = document.getElementById('status');
  var busy = false;

  function setStatus(text, kind){
    status.textContent = text || '';
    status.className = 'status' + (kind ? ' ' + kind : '');
  }

  dropzone.addEventListener('click', function(){ if (!busy) input.click(); });
  input.addEventListener('change', function(){ if (input.files && input.files[0]) upload(input.files[0]); });

  ['dragenter','dragover'].forEach(function(ev){
    dropzone.addEventListener(ev, function(e){ e.preventDefault(); dropzone.classList.add('drag'); });
  });
  ['dragleave','drop'].forEach(function(ev){
    dropzone.addEventListener(ev, function(e){ e.preventDefault(); dropzone.classList.remove('drag'); });
  });
  dropzone.addEventListener('drop', function(e){
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) upload(f);
  });

  function upload(file){
    if (busy) return;
    if (!/\\.(zip|rar|exe|msi)$/i.test(file.name)) { setStatus('Chỉ nhận file .zip, .rar, .exe hoặc .msi', 'err'); return; }
    busy = true;
    progressWrap.classList.remove('hidden');
    progress.style.width = '0%';
    setStatus('Đang tải lên ' + file.name + ' …');

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/admin/upload');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-Admin-Upload', '1');

    xhr.upload.onprogress = function(e){
      if (!e.lengthComputable) return;
      var pct = Math.round(e.loaded / e.total * 100);
      progress.style.width = pct + '%';
      setStatus('Đang tải lên ' + pct + '%');
    };

    xhr.onload = function(){
      busy = false;
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status === 200 && data && data.ok) {
        progress.style.width = '100%';
        setStatus('Đã thay file thành công. Đang tải lại…', 'ok');
        setTimeout(function(){ location.reload(); }, 700);
        return;
      }
      if (xhr.status === 401) { setStatus('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.', 'err'); return; }
      setStatus((data && data.error) || ('Tải lên thất bại (mã ' + xhr.status + ')'), 'err');
    };

    xhr.onerror = function(){ busy = false; setStatus('Lỗi kết nối khi tải lên', 'err'); };
    xhr.send(file);
  }
})();`;

  return pageShell({
    lang,
    title: 'Quản trị file ZIP',
    bodyClass: 'admin',
    body,
    head: ADMIN_CSS,
    script,
  });
}

module.exports = { renderHome, renderAdminLogin, renderAdminPanel, escapeHtml, formatBytes };
