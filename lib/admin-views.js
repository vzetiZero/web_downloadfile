'use strict';

// Giao diện quản trị (Bootstrap 5).

const { escapeHtml, formatBytes } = require('./pages');
const { T } = require('./i18n');

const FOLDER_ART = `
<svg width="132" height="84" viewBox="0 0 132 84" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="folderGrad" x1="26" y1="8" x2="104" y2="72" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#A9CBFF"/>
      <stop offset="1" stop-color="#7FAEF5"/>
    </linearGradient>
    <linearGradient id="folderBack" x1="30" y1="12" x2="96" y2="60" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#C8DDFF"/>
      <stop offset="1" stop-color="#A6C6F7"/>
    </linearGradient>
  </defs>
  <path d="M28 16c0-3.3 2.7-6 6-6h18.6c1.6 0 3.1.6 4.3 1.8l4.9 4.9c.8.8 1.8 1.2 2.8 1.2H98c3.3 0 6 2.7 6 6v6H28V16z" fill="url(#folderBack)"/>
  <path d="M24 34c0-3.3 2.7-6 6-6h72c3.3 0 6 2.7 6 6v30c0 3.3-2.7 6-6 6H30c-3.3 0-6-2.7-6-6V34z" fill="url(#folderGrad)"/>
  <path d="M56 39v16M48 47h16" stroke="#FFFFFF" stroke-width="4.6" stroke-linecap="round" opacity=".92"/>
  <rect x="76" y="44" width="30" height="24" rx="5" fill="#FFFFFF" fill-opacity=".92"/>
  <circle cx="85" cy="52" r="3" fill="#9FC0F0"/>
  <path d="M79 65l7.6-8.2 5.2 5.2 3.6-3.4L103 65H79z" fill="#9FC0F0"/>
</svg>`;

const ICON_FILE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>`;
const ICON_ZIP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M10 3v2M10 7v2M10 11v2"/><rect x="9" y="15" width="3" height="4" rx="1"/></svg>`;
const ICON_EYE = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_EYE_OFF = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 6.1A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.1 3.9"/><path d="M6.3 8.2A16.7 16.7 0 0 0 2.5 12S6 18 12 18c1.4 0 2.7-.3 3.8-.8"/><path d="M9.9 10.1a3 3 0 0 0 4.2 4.2"/></svg>`;
const ICON_LOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.4"/><path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7"/></svg>`;
const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M7.6 10.6L12 15l4.4-4.4"/><path d="M5 19.5h14"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.5 7l.8 12a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5l.8-12"/></svg>`;
const ICON_BRAND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="M7.5 9.5L12 14l4.5-4.5"/><path d="M4.5 20h15"/></svg>`;

function layout({ title, body, scripts = '', head = '', bodyClass = '' }) {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/vendor/bootstrap.min.css">
<link rel="stylesheet" href="/admin.css">
${head}
</head>
<body class="${bodyClass}">
${body}
<script src="/vendor/bootstrap.bundle.min.js"></script>
${scripts}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Đăng nhập
// ---------------------------------------------------------------------------

function loginPage({ email = '', error = '', notice = '', lockedMinutes = 0 }) {
  const body = `
<div class="auth-wrap">
  <div class="auth-card">
    <div class="auth-logo">${ICON_LOCK}</div>
    <h1 class="auth-title">Đăng nhập quản trị</h1>
    <p class="auth-sub">Quản lý file ZIP mà người dùng tải về.</p>

    ${error ? `<div class="alert alert-danger d-flex align-items-start gap-2" role="alert">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="flex:0 0 auto;margin-top:1px"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.4v.1"/></svg>
      <span>${escapeHtml(error)}</span>
    </div>` : ''}

    ${notice ? `<div class="alert alert-success" role="alert">${escapeHtml(notice)}</div>` : ''}

    <form id="loginForm" method="post" action="/admin/login">
      <div class="mb-3">
        <label class="form-label" for="email">Tài khoản</label>
        <input class="form-control" id="email" name="email" type="text"
               autocomplete="username" placeholder="admin" value="${escapeHtml(email)}" required autofocus>
      </div>

      <div class="mb-2">
        <label class="form-label" for="password">Mật khẩu</label>
        <div class="input-group">
          <input class="form-control" id="password" name="password" type="password"
                 autocomplete="current-password" placeholder="Nhập mật khẩu" required>
          <span class="input-group-text" id="togglePassword" role="button" tabindex="0" aria-label="Hiện mật khẩu">${ICON_EYE}</span>
        </div>
      </div>

      <div class="d-flex justify-content-between align-items-center mb-3 mt-3">
        <div class="form-check">
          <input class="form-check-input" type="checkbox" id="remember" checked>
          <label class="form-check-label" for="remember" style="font-size:13px;color:#4b5563">Ghi nhớ đăng nhập</label>
        </div>
        <a href="/admin/forgot" class="text-decoration-none" style="font-size:13px;font-weight:600">Quên mật khẩu?</a>
      </div>

      <button class="btn btn-primary btn-lg w-100" type="submit" id="submitBtn"${lockedMinutes ? ' disabled' : ''}>
        Đăng nhập
      </button>
      ${lockedMinutes ? `<div class="alert alert-warning mt-3 mb-0">Bạn đã nhập sai quá nhiều lần. Thử lại sau ${lockedMinutes} phút.</div>` : ''}
    </form>

    <div class="auth-foot">
      <a href="/">← Về trang tải xuống</a>
    </div>
  </div>
</div>`;

  const scripts = `
<script>
(function(){
  var password = document.getElementById('password');
  var toggle = document.getElementById('togglePassword');
  var submit = document.getElementById('submitBtn');
  var EYE = ${JSON.stringify(ICON_EYE)};
  var EYE_OFF = ${JSON.stringify(ICON_EYE_OFF)};

  toggle.addEventListener('click', function(){
    var show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.innerHTML = show ? EYE_OFF : EYE;
    toggle.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    password.focus();
  });
  toggle.addEventListener('keydown', function(e){
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle.click(); }
  });

  document.getElementById('loginForm').addEventListener('submit', function(){
    submit.disabled = true;
    submit.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Đang kiểm tra…';
  });

  password.focus();
})();
</script>`;

  return layout({ title: 'Đăng nhập quản trị', body, scripts });
}

// ---------------------------------------------------------------------------
// Quên mật khẩu — nhập email
// ---------------------------------------------------------------------------

function forgotPage({ email = '', error = '', notice = '', cooldown = 0 }) {
  const body = `
<div class="auth-wrap">
  <div class="auth-card">
    <div class="auth-logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M3 7l9 6 9-6"/></svg></div>
    <h1 class="auth-title">Quên mật khẩu</h1>
    <p class="auth-sub">Nhập email quản trị. Chúng tôi sẽ gửi mã xác minh 6 chữ số tới hộp thư của bạn.</p>

    ${error ? `<div class="alert alert-danger" role="alert">${escapeHtml(error)}</div>` : ''}
    ${notice ? `<div class="alert alert-success" role="alert">${escapeHtml(notice)}</div>` : ''}

    <form id="forgotForm" method="post" action="/admin/forgot">
      <div class="mb-3">
        <label class="form-label" for="email">Email quản trị</label>
        <input class="form-control" id="email" name="email" type="email" inputmode="email"
               autocomplete="email" placeholder="you@example.com" value="${escapeHtml(email)}" required>
      </div>

      <button class="btn btn-primary btn-lg w-100" type="submit" id="submitBtn">
        Gửi mã xác minh
      </button>
    </form>

    <div class="auth-foot">
      <a href="/admin">← Quay lại đăng nhập</a>
    </div>
  </div>
</div>`;

  const scripts = `
<script>
(function(){
  var email = document.getElementById('email');
  var submit = document.getElementById('submitBtn');
  var cooldown = ${Number(cooldown) || 0};

  function tick(){
    if (cooldown <= 0) {
      submit.disabled = false;
      submit.textContent = 'Gửi mã xác minh';
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Gửi lại sau ' + cooldown + 's';
    cooldown -= 1;
    setTimeout(tick, 1000);
  }
  if (cooldown > 0) tick();

  document.getElementById('forgotForm').addEventListener('submit', function(){
    submit.disabled = true;
    submit.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Đang gửi…';
  });

  email.focus();
})();
</script>`;

  return layout({ title: 'Quên mật khẩu', body, scripts });
}

// ---------------------------------------------------------------------------
// Đặt lại mật khẩu bằng OTP
// ---------------------------------------------------------------------------

function resetPage({ email = '', maskedEmail = '', error = '', notice = '', cooldown = 0, prefill = '' }) {
  const initial = String(prefill || '').replace(/\D/g, '').slice(0, 6);
  const body = `
<div class="auth-wrap">
  <div class="auth-card">
    <div class="auth-logo">${ICON_LOCK}</div>
    <h1 class="auth-title">Đặt lại mật khẩu</h1>
    <p class="auth-sub">Nhập mã xác minh đã gửi tới <strong>${escapeHtml(maskedEmail || email)}</strong> và chọn mật khẩu mới.</p>

    ${error ? `<div class="alert alert-danger" role="alert">${escapeHtml(error)}</div>` : ''}
    ${notice ? `<div class="alert alert-info" role="alert">${escapeHtml(notice)}</div>` : ''}
    ${initial ? `<div class="alert alert-success" role="alert">Đã tự điền mã xác minh từ liên kết trong email. Chỉ cần đặt mật khẩu mới.</div>` : ''}

    <form id="resetForm" method="post" action="/admin/reset">
      <input type="hidden" name="email" value="${escapeHtml(email)}">

      <div class="mb-3">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <label class="form-label mb-0">Mã xác minh (OTP)</label>
          <span class="d-inline-flex gap-3">
            <button type="button" class="btn btn-link btn-sm p-0 text-decoration-none" id="copyBtn" style="font-size:12.5px;font-weight:600">
              Sao chép mã
            </button>
            <button type="button" class="btn btn-link btn-sm p-0 text-decoration-none" id="pasteBtn" style="font-size:12.5px;font-weight:600">
              Dán mã
            </button>
          </span>
        </div>
        <div class="otp-inputs" id="otpInputs">
          ${[0, 1, 2, 3, 4, 5].map((i) => `<input type="text" inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="Chữ số ${i + 1}" value="${initial[i] || ''}"${initial[i] ? ' class="filled"' : ''}>`).join('')}
        </div>
        <input type="hidden" name="otp" id="otpValue" value="${escapeHtml(initial)}">
      </div>

      <div class="mb-2">
        <label class="form-label" for="password">Mật khẩu mới</label>
        <div class="input-group">
          <input class="form-control" id="password" name="password" type="password"
                 autocomplete="new-password" placeholder="Nhập mật khẩu mới" required>
          <span class="input-group-text toggle" data-target="password" role="button" tabindex="0" aria-label="Hiện mật khẩu">${ICON_EYE}</span>
        </div>
      </div>

      <div class="mb-3">
        <label class="form-label" for="confirm">Nhập lại mật khẩu mới</label>
        <div class="input-group">
          <input class="form-control" id="confirm" name="confirm" type="password"
                 autocomplete="new-password" placeholder="Nhập lại mật khẩu" required>
          <span class="input-group-text toggle" data-target="confirm" role="button" tabindex="0" aria-label="Hiện mật khẩu">${ICON_EYE}</span>
        </div>
      </div>

      <button class="btn btn-primary btn-lg w-100 mt-3" type="submit" id="submitBtn">
        Xác minh & đổi mật khẩu
      </button>

      <div class="text-center mt-3">
        <span style="font-size:13px;color:#6b7280">Không nhận được mã?</span>
        <button type="button" class="btn btn-link btn-sm text-decoration-none" id="resendBtn"${cooldown > 0 ? ' disabled' : ''}>
          ${cooldown > 0 ? `Gửi lại sau ${cooldown}s` : 'Gửi lại mã'}
        </button>
      </div>
    </form>

    <div class="auth-foot">
      <a href="/admin">← Quay lại đăng nhập</a>
    </div>
  </div>
</div>`;

  const scripts = `
<script>
(function(){
  var form = document.getElementById('resetForm');
  var otpInputs = Array.prototype.slice.call(document.querySelectorAll('#otpInputs input'));
  var otpValue = document.getElementById('otpValue');
  var password = document.getElementById('password');
  var submit = document.getElementById('submitBtn');
  var resend = document.getElementById('resendBtn');
  var EYE = ${JSON.stringify(ICON_EYE)};
  var EYE_OFF = ${JSON.stringify(ICON_EYE_OFF)};

  document.querySelectorAll('.toggle').forEach(function(btn){
    function toggle(){
      var input = document.getElementById(btn.getAttribute('data-target'));
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE;
      input.focus();
    }
    btn.addEventListener('click', toggle);
    btn.addEventListener('keydown', function(e){
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });

  otpInputs.forEach(function(input, index){
    input.addEventListener('input', function(){
      input.value = input.value.replace(/\\D/g, '').slice(0, 1);
      input.classList.toggle('filled', !!input.value);
      if (input.value && index < otpInputs.length - 1) otpInputs[index + 1].focus();
      syncOtp();
    });
    input.addEventListener('keydown', function(e){
      if (e.key === 'Backspace' && !input.value && index > 0) {
        otpInputs[index - 1].focus();
        otpInputs[index - 1].value = '';
        otpInputs[index - 1].classList.remove('filled');
        syncOtp();
      }
      if (e.key === 'ArrowLeft' && index > 0) otpInputs[index - 1].focus();
      if (e.key === 'ArrowRight' && index < otpInputs.length - 1) otpInputs[index + 1].focus();
    });
    input.addEventListener('paste', function(e){
      var text = (e.clipboardData || window.clipboardData).getData('text') || '';
      var digits = text.replace(/\\D/g, '').slice(0, 6);
      if (!digits) return;
      e.preventDefault();
      digits.split('').forEach(function(d, i){
        if (otpInputs[i]) { otpInputs[i].value = d; otpInputs[i].classList.add('filled'); }
      });
      var next = Math.min(digits.length, otpInputs.length - 1);
      otpInputs[next].focus();
      syncOtp();
    });
    input.addEventListener('focus', function(){ input.select(); });
  });

  function syncOtp(){
    otpValue.value = otpInputs.map(function(i){ return i.value; }).join('');
  }

  // Sao chép mã ra clipboard (1 chạm)
  var copyBtn = document.getElementById('copyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async function(){
      var code = otpValue.value || otpInputs.map(function(i){ return i.value; }).join('');
      if (code.length !== 6) return;
      var ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(code);
          ok = true;
        }
      } catch (e) {}
      if (!ok) {
        try {
          var ta = document.createElement('textarea');
          ta.value = code;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          ok = document.execCommand('copy');
          document.body.removeChild(ta);
        } catch (e) {}
      }
      var original = copyBtn.textContent;
      copyBtn.textContent = ok ? 'Đã sao chép ✓' : 'Không sao chép được';
      copyBtn.classList.toggle('text-success', ok);
      copyBtn.classList.toggle('text-danger', !ok);
      setTimeout(function(){
        copyBtn.textContent = original;
        copyBtn.classList.remove('text-success', 'text-danger');
      }, 2200);
    });
  }

  // Nếu mở từ liên kết trong email: mã đã điền sẵn → tự sao chép vào clipboard
  if (otpValue.value.length === 6) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(otpValue.value).then(function(){
        if (copyBtn) {
          copyBtn.textContent = 'Đã sao chép ✓';
          copyBtn.classList.add('text-success');
          setTimeout(function(){
            copyBtn.textContent = 'Sao chép mã';
            copyBtn.classList.remove('text-success');
          }, 3000);
        }
      }).catch(function(){});
    }
  }

  // Dán mã nhanh từ clipboard
  var pasteBtn = document.getElementById('pasteBtn');
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async function(){
      var text = '';
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          text = await navigator.clipboard.readText();
        }
      } catch (e) {}

      if (!text) {
        var typed = prompt('Dán hoặc nhập mã xác minh 6 chữ số:');
        text = typed || '';
      }

      var digits = String(text).replace(/\\D/g, '').slice(0, 6);
      if (digits.length !== 6) return;
      digits.split('').forEach(function(d, i){
        otpInputs[i].value = d;
        otpInputs[i].classList.add('filled');
      });
      syncOtp();
      password.focus();
    });
  }

  // Điền sẵn mã từ liên kết trong email
  syncOtp();
  if (otpValue.value.length === 6) {
    if (password) password.focus();
  }

  form.addEventListener('submit', function(){
    syncOtp();
    submit.disabled = true;
    submit.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Đang xử lý…';
  });

  // Gửi lại mã
  var cooldown = ${Number(cooldown) || 0};
  function updateResend(){
    resend.disabled = cooldown > 0;
    resend.textContent = cooldown > 0 ? ('Gửi lại sau ' + cooldown + 's') : 'Gửi lại mã';
  }
  if (cooldown > 0) {
    var timer = setInterval(function(){
      cooldown -= 1;
      if (cooldown <= 0) { clearInterval(timer); cooldown = 0; }
      updateResend();
    }, 1000);
  }
  resend.addEventListener('click', function(){
    resend.disabled = true;
    resend.textContent = 'Đang gửi…';
    fetch('/admin/resend-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ${JSON.stringify(email)} })
    }).then(function(r){ return r.json(); }).then(function(d){
      cooldown = d.wait || 60;
      var note = document.getElementById('resendNote');
      if (!note) {
        note = document.createElement('div');
        note.id = 'resendNote';
        note.className = 'alert mt-3 mb-0 ' + (d.ok ? 'alert-success' : 'alert-warning');
        resend.parentNode.after(note);
      }
      note.className = 'alert mt-3 mb-0 ' + (d.ok ? 'alert-success' : 'alert-warning');
      note.textContent = d.ok ? 'Đã gửi lại mã xác minh.' : (d.error || 'Không gửi được mã.');
      var t = setInterval(function(){
        cooldown -= 1;
        if (cooldown <= 0) { clearInterval(t); cooldown = 0; }
        updateResend();
      }, 1000);
      updateResend();
    }).catch(function(){
      resend.disabled = false;
      resend.textContent = 'Gửi lại mã';
    });
  });

  otpInputs[0].focus();
  if (otpValue.value.length === 6 && password) password.focus();
})();
</script>`;

  return layout({ title: 'Đặt lại mật khẩu', body, scripts });
}

// ---------------------------------------------------------------------------
// Bảng điều khiển
// ---------------------------------------------------------------------------

function dashboardPage({ file, email, maxUploadMb, mailConfigured, messages, defaults, languages, customCount, syncState, notice = '', noticeKind = 'ok' }) {
  const hasFile = Boolean(file && file.size);
  const msg = messages || {};
  const def = defaults || {};
  const langs = Array.isArray(languages) ? languages : [];
  const perLang = (msg && msg.languages) || {};
  const customTotal = Number(customCount) || Object.keys(perLang).length;
  const sync = syncState || { enabled: false, canPush: false, mode: 'off' };

  const fileRow = hasFile ? `
<tr>
  <td>
    <div class="file-chip">
      <span class="fi">${ICON_ZIP}</span>
      <span>
        <span class="nm">${escapeHtml(file.name)}</span>
        <span class="sb d-block">${escapeHtml(file.humanSize)} · ${escapeHtml(file.originalName && file.originalName !== file.name ? `gốc: ${file.originalName}` : 'ZIP')}</span>
      </span>
    </div>
  </td>
  <td class="text-nowrap" data-label="Dung lượng">${escapeHtml(file.humanSize)}</td>
  <td class="text-nowrap" data-label="Cập nhật">${escapeHtml(new Date(file.updatedAt).toLocaleString('vi-VN'))}</td>
  <td class="text-nowrap" data-label="Lượt tải">${Number(file.downloads || 0).toLocaleString('vi-VN')}</td>
  <td class="text-end text-nowrap">
    <a class="btn btn-sm btn-outline-primary" href="/download" title="Tải về">${ICON_DOWNLOAD}<span class="d-md-none ms-1">Tải về</span></a>
    <button class="btn btn-sm btn-outline-danger" id="deleteBtn" title="Xoá file" data-name="${escapeHtml(file.name)}">${ICON_TRASH}<span class="d-md-none ms-1">Xoá</span></button>
  </td>
</tr>` : `
<tr>
  <td colspan="5">
    <div class="empty-state">
      ${ICON_FILE}
      <div style="font-weight:600;color:#374151">Chưa có file nào</div>
      <div style="font-size:13px;margin-top:4px">Tải lên file ZIP đầu tiên để người dùng có thể tải về.</div>
    </div>
  </td>
</tr>`;

  const body = `
<div class="topbar">
  <div class="topbar-inner">
    <div class="brand">
      <span class="brand-mark">${ICON_BRAND}</span>
      <span>Web Download · Quản trị</span>
    </div>
    <div class="d-flex align-items-center gap-3">
      <span class="d-none d-sm-inline" style="font-size:13px;color:#6b7280">${escapeHtml(email)}</span>
      <form method="post" action="/admin/logout" class="m-0">
        <button class="btn btn-sm btn-outline-secondary" type="submit">Đăng xuất</button>
      </form>
    </div>
  </div>
</div>

<div class="page">

  <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
    <div>
      <h1 style="font-size:22px;font-weight:700;margin:0 0 4px">File đang phát hành</h1>
      <p style="margin:0;font-size:14px;color:#6b7280">Người truy cập bằng máy tính sẽ tự động nhận file này.</p>
    </div>
    <a class="btn btn-sm btn-outline-primary" href="/" target="_blank" rel="noopener">Xem trang tải xuống ↗</a>
  </div>

  <div class="stat-grid">
    <div class="stat">
      <div class="stat-label">Trạng thái</div>
      <div class="stat-value small mt-2">
        ${hasFile
          ? '<span class="badge-soft"><span class="dot"></span>Đang phát hành</span>'
          : '<span class="badge-soft warn"><span class="dot"></span>Chưa có file</span>'}
      </div>
    </div>
    <div class="stat">
      <div class="stat-label">Dung lượng</div>
      <div class="stat-value">${hasFile ? escapeHtml(file.humanSize) : '—'}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Lượt tải</div>
      <div class="stat-value">${hasFile ? Number(file.downloads || 0).toLocaleString('vi-VN') : '0'}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Cập nhật lúc</div>
      <div class="stat-value small">${hasFile ? escapeHtml(new Date(file.updatedAt).toLocaleString('vi-VN')) : '—'}</div>
    </div>
  </div>

  <div class="panel mb-4">
    <div class="panel-head">
      <h2 class="panel-title">${hasFile ? 'Upload new — thay file hiện tại' : 'Upload file mới'}</h2>
      <span style="font-size:12.5px;color:#6b7280">Chỉ nhận .zip · tối đa ${escapeHtml(maxUploadMb)} MB</span>
    </div>
    <div class="panel-body">
      <div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="Chọn hoặc kéo thả file ZIP">
        <div class="dz-art">${FOLDER_ART}</div>
        <div>
          <span class="choose-btn" id="chooseBtn">Choose File</span>
        </div>
        <p class="dz-title" style="margin-top:16px">Click the button to upload or drag and drop files to the page</p>
        <p class="dz-hint" id="dzHint">${hasFile ? 'File mới sẽ thay thế file đang phát hành.' : 'Hỗ trợ định dạng ZIP, dung lượng tối đa ' + escapeHtml(maxUploadMb) + 'MB.'}</p>
        <input type="file" id="fileInput" accept=".zip,application/zip,application/x-zip-compressed" hidden>
      </div>

      <div class="upload-list" id="uploadList"></div>
    </div>
  </div>

  <div class="panel mb-4">
    <div class="panel-head">
      <h2 class="panel-title">Thông báo hiển thị cho người truy cập</h2>
      <span style="font-size:12.5px;color:#6b7280">
        ${customTotal > 0 ? `${customTotal} ngôn ngữ đã nhập riêng` : 'Đang dùng bản dịch sẵn có'}
      </span>
    </div>
    <div class="panel-body">
      ${notice ? `<div class="alert alert-${noticeKind === 'err' ? 'danger' : 'success'} py-2 mb-3" role="alert">${escapeHtml(notice)}</div>` : ''}

      <p class="text-muted" style="font-size:13px;margin:0 0 14px">
        Nhập câu hiển thị cho từng ngôn ngữ. Ô nào để trống thì ngôn ngữ đó dùng
        <strong>câu dùng chung</strong> bên dưới, và nếu câu dùng chung cũng trống thì dùng bản dịch mặc định.
      </p>

      ${syncState.enabled
        ? `<div class="sync-strip ok">
             <span class="sync-dot"></span>
             <span>
               ${syncState.canPush
                 ? 'Đã bật đồng bộ: mỗi lần bấm Lưu, câu được ghi lên gist riêng tư và tự tải lại khi web khởi động lại.'
                 : 'Đang đọc câu đã lưu từ RESTORE_MESSAGES_URL. Chưa có GITHUB_TOKEN nên không ghi lên được.'}
             </span>
           </div>`
        : `<div class="sync-strip warn">
             <span class="sync-dot"></span>
             <span>
               Chưa bật đồng bộ: câu sẽ mất khi web khởi động lại (ổ đĩa tạm).
               Đặt <code>GITHUB_TOKEN</code> trong Environment của Render để giữ lại.
             </span>
           </div>`}

      <form method="post" action="/admin/messages" id="msgForm">
        <h3 class="msg-section">Dùng chung cho mọi ngôn ngữ</h3>
        <div class="mb-3">
          <label class="form-label" for="desktopText">Câu hiện trên máy tính</label>
          <textarea class="form-control" id="desktopText" name="desktopText" rows="2" maxlength="300"
                    placeholder="Để trống nếu muốn mỗi nước thấy bản dịch riêng">${escapeHtml(msg.desktopText || '')}</textarea>
          <div class="form-text">Khách dùng máy tính: file ZIP tự tải về, sau đó chỉ thấy đúng câu này.</div>
        </div>

        <div class="mb-3">
          <label class="form-label" for="mobileText">Câu hiện trên điện thoại</label>
          <textarea class="form-control" id="mobileText" name="mobileText" rows="2" maxlength="300"
                    placeholder="Để trống nếu muốn mỗi nước thấy bản dịch riêng">${escapeHtml(msg.mobileText || '')}</textarea>
          <div class="form-text">Khách dùng điện thoại sẽ thấy câu này và không tải được file.</div>
        </div>

        <h3 class="msg-section">Riêng từng ngôn ngữ</h3>
        <p class="text-muted" style="font-size:12.5px;margin:-4px 0 14px">
          Chỉ cần điền ngôn ngữ bạn muốn kiểm soát. Mặc định đã có ${langs.length} bản dịch.
        </p>

        <div class="lang-list">
          ${langs.map((l) => {
            const entry = perLang[l.code] || {};
            const hasCustom = Boolean(entry.desktopText || entry.mobileText);
            // Placeholder = câu dùng chung (nếu có) hoặc bản dịch của ngôn ngữ này
            const dict = T[l.code] || T.en;
            const sharedDesktop = msg.desktopText || '';
            const sharedMobile = msg.mobileText || '';
            const phDesktop = sharedDesktop || dict.desktopText;
            const phMobile = sharedMobile || dict.mobileText;
            // "đang hiện" = câu thật sự ra ngoài trang: riêng -> dùng chung -> mặc định
            const nowDesktop = entry.desktopText || phDesktop;
            const nowMobile = entry.mobileText || phMobile;
            const cut = (s) => escapeHtml(s.length > 60 ? `${s.slice(0, 60)}…` : s);
            return `
          <details class="lang-item${hasCustom ? ' has-custom' : ''}">
            <summary>
              <span class="lang-name">${escapeHtml(l.label)}</span>
              <code class="lang-code">${escapeHtml(l.code)}</code>
              <span class="lang-flag">${hasCustom ? 'đã nhập riêng' : 'mặc định'}</span>
            </summary>
            <div class="lang-fields">
              <label class="form-label" for="mi-${escapeHtml(l.code)}">
                Máy tính <span class="ph-hint">đang hiện: ${cut(nowDesktop)}</span>
              </label>
              <textarea class="form-control form-control-sm" id="mi-${escapeHtml(l.code)}"
                        name="lang[${escapeHtml(l.code)}][desktopText]" rows="2" maxlength="300"
                        placeholder="${escapeHtml(phDesktop)}">${escapeHtml(entry.desktopText || '')}</textarea>
              <label class="form-label mt-2" for="mm-${escapeHtml(l.code)}">
                Điện thoại <span class="ph-hint">đang hiện: ${cut(nowMobile)}</span>
              </label>
              <textarea class="form-control form-control-sm" id="mm-${escapeHtml(l.code)}"
                        name="lang[${escapeHtml(l.code)}][mobileText]" rows="2" maxlength="300"
                        placeholder="${escapeHtml(phMobile)}">${escapeHtml(entry.mobileText || '')}</textarea>
            </div>
          </details>`;
          }).join('')}
        </div>

        <div class="d-flex flex-wrap gap-2 align-items-center mt-4">
          <button class="btn btn-primary" type="submit">Lưu thông báo</button>
          <button class="btn btn-outline-secondary" type="button" id="resetMsgBtn">Xoá hết, dùng bản mặc định</button>
          <a class="btn btn-link text-decoration-none" href="/" target="_blank" rel="noopener" style="font-size:13.5px">Xem thử ↗</a>
        </div>
      </form>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head">
      <h2 class="panel-title">Danh sách file</h2>
      <span style="font-size:12.5px;color:#6b7280">${hasFile ? '1 file đang phục vụ người dùng' : 'Chưa có file nào'}</span>
    </div>
    <div class="table-responsive">
      <table class="table align-middle">
        <thead>
          <tr>
            <th>File</th>
            <th class="d-none d-md-table-cell">Dung lượng</th>
            <th class="d-none d-md-table-cell">Cập nhật</th>
            <th class="d-none d-md-table-cell">Lượt tải</th>
            <th class="text-end d-none d-md-table-cell">Thao tác</th>
          </tr>
        </thead>
        <tbody>${fileRow}</tbody>
      </table>
    </div>
  </div>

  <p style="font-size:12.5px;color:#9aa3af;margin:16px 0 0">
    Trang quản trị được bảo vệ bằng mật khẩu và mã OTP gửi tới email quản trị.
    ${mailConfigured ? '' : '<span style="color:#b54708">Chưa cấu hình SMTP — mã OTP được ghi ra data/last-otp.txt.</span>'}
  </p>
</div>

<div class="toast-stack" id="toasts"></div>`;

  const scripts = `
<script>
(function(){
  var MAX = ${Number(maxUploadMb) || 500} * 1024 * 1024;
  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('fileInput');
  var chooseBtn = document.getElementById('chooseBtn');
  var hint = document.getElementById('dzHint');
  var list = document.getElementById('uploadList');
  var originalHint = hint.textContent;
  var busy = false;

  function toast(text, kind){
    var el = document.createElement('div');
    el.className = 'toast-note ' + (kind || '');
    el.textContent = text;
    document.getElementById('toasts').appendChild(el);
    setTimeout(function(){
      el.style.transition = 'opacity .25s ease, transform .25s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(function(){ el.remove(); }, 260);
    }, 4200);
  }

  function sizeText(bytes){
    if (bytes < 1024) return bytes + ' B';
    var u = ['KB','MB','GB'], v = bytes / 1024, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i];
  }

  chooseBtn.addEventListener('click', function(e){
    e.stopPropagation();
    if (!busy) fileInput.click();
  });
  dropzone.addEventListener('click', function(){ if (!busy) fileInput.click(); });
  dropzone.addEventListener('keydown', function(e){
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!busy) fileInput.click(); }
  });

  ['dragenter','dragover'].forEach(function(ev){
    dropzone.addEventListener(ev, function(e){ e.preventDefault(); e.stopPropagation(); dropzone.classList.add('dragover'); });
  });
  ['dragleave','dragend'].forEach(function(ev){
    dropzone.addEventListener(ev, function(e){
      e.preventDefault();
      if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', function(e){
    e.preventDefault();
    dropzone.classList.remove('dragover');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) upload(f);
  });

  fileInput.addEventListener('change', function(){
    if (fileInput.files && fileInput.files[0]) upload(fileInput.files[0]);
  });

  function setHint(text, isError){
    hint.textContent = text;
    hint.classList.toggle('is-error', !!isError);
  }

  function upload(file){
    if (busy) return;

    if (!/\\.zip$/i.test(file.name)) {
      setHint('Chỉ chấp nhận file .zip — file bạn chọn không hợp lệ.', true);
      toast('Chỉ chấp nhận file .zip', 'err');
      return;
    }
    if (file.size > MAX) {
      setHint('File vượt quá dung lượng cho phép (' + sizeText(MAX) + ').', true);
      toast('File quá lớn', 'err');
      return;
    }
    if (file.size === 0) {
      setHint('File rỗng, vui lòng chọn file khác.', true);
      return;
    }

    busy = true;
    dropzone.classList.add('busy');
    setHint('Đang tải lên ' + file.name + '…');
    list.innerHTML = '';

    var item = document.createElement('div');
    item.className = 'upload-item';
    item.innerHTML = [
      '<span class="ficon">' + ${JSON.stringify(ICON_ZIP)} + '</span>',
      '<span class="fbody">',
        '<span class="fname"></span>',
        '<span class="fmeta"></span>',
        '<div class="progress mt-2"><div class="progress-bar" style="width:0%"></div></div>',
      '</span>',
      '<span class="fstate" style="font-size:12px;color:#6b7280">0%</span>'
    ].join('');
    item.querySelector('.fname').textContent = file.name;
    item.querySelector('.fmeta').textContent = sizeText(file.size) + ' · đang tải lên';
    list.appendChild(item);

    var bar = item.querySelector('.progress-bar');
    var state = item.querySelector('.fstate');
    var meta = item.querySelector('.fmeta');

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/admin/upload');
    xhr.setRequestHeader('Content-Type', 'application/zip');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-Admin-Upload', '1');

    xhr.upload.onprogress = function(e){
      if (!e.lengthComputable) return;
      var pct = Math.round(e.loaded / e.total * 100);
      bar.style.width = pct + '%';
      state.textContent = pct + '%';
      setHint('Đang tải lên ' + pct + '%');
    };

    xhr.onload = function(){
      busy = false;
      dropzone.classList.remove('busy');
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) {}

      if (xhr.status === 200 && data && data.ok) {
        bar.style.width = '100%';
        state.textContent = '✓';
        state.style.color = '#067647';
        meta.textContent = sizeText(file.size) + ' · đã cập nhật';
        setHint('Đã cập nhật file thành công. Đang tải lại…');
        toast('Đã thay file thành công', 'ok');
        setTimeout(function(){ location.reload(); }, 900);
        return;
      }

      if (xhr.status === 401) {
        setHint('Phiên đăng nhập đã hết hạn. Đang chuyển tới trang đăng nhập…', true);
        toast('Phiên đăng nhập đã hết hạn', 'err');
        setTimeout(function(){ location.href = '/admin'; }, 1200);
        return;
      }

      var msg = (data && data.error) || ('Tải lên thất bại (mã ' + xhr.status + ')');
      setHint(msg, true);
      toast(msg, 'err');
      state.textContent = '✕';
      state.style.color = '#b42318';
      meta.textContent = sizeText(file.size) + ' · lỗi';
      fileInput.value = '';
    };

    xhr.onerror = function(){
      busy = false;
      dropzone.classList.remove('busy');
      setHint('Mất kết nối khi đang tải lên. Vui lòng thử lại.', true);
      toast('Mất kết nối khi tải lên', 'err');
      fileInput.value = '';
    };

    xhr.send(file);
  }

  // Xoá file
  var del = document.getElementById('deleteBtn');
  if (del) {
    del.addEventListener('click', function(){
      if (!confirm('Xoá "' + del.getAttribute('data-name') + '"? Người dùng sẽ không tải được cho tới khi bạn tải file mới.')) return;
      del.disabled = true;
      fetch('/admin/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        .then(function(r){ return r.json(); })
        .then(function(d){
          if (d.ok) { toast('Đã xoá file', 'ok'); setTimeout(function(){ location.reload(); }, 600); }
          else { toast(d.error || 'Không xoá được file', 'err'); del.disabled = false; }
        })
        .catch(function(){ toast('Lỗi kết nối', 'err'); del.disabled = false; });
    });
  }

  // Nút "Xoá hết, dùng bản mặc định" — xoá cả ô dùng chung lẫn 54 ô ngôn ngữ
  var resetMsg = document.getElementById('resetMsgBtn');
  if (resetMsg) {
    resetMsg.addEventListener('click', function(){
      if (!confirm('Xoá toàn bộ câu bạn đã nhập và quay về bản dịch mặc định của 54 ngôn ngữ?')) return;
      document.getElementById('msgForm').querySelectorAll('textarea').forEach(function(ta){ ta.value = ''; });
      var form = document.getElementById('msgForm');
      if (form.requestSubmit) form.requestSubmit(); else form.submit();
    });
  }
})();
</script>`;

  return layout({ title: 'Quản trị file', body, scripts });
}

module.exports = { loginPage, forgotPage, resetPage, dashboardPage };
