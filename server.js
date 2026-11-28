'use strict';

// Nạp .env trước khi đọc cấu hình
require('./lib/env').loadEnv();

// Web tải file ZIP tự động + trang quản trị (đăng nhập, quên mật khẩu OTP, upload).
// Chạy: node server.js  hoặc  start.bat

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const { detectCountry, acceptLanguage, clientIp } = require('./lib/geo');
const { normalizeLang, langForCountry, t } = require('./lib/i18n');
const { renderHome } = require('./lib/pages');
const auth = require('./lib/auth');
const mailer = require('./lib/mailer');
const store = require('./lib/store');
const settings = require('./lib/settings');
const persist = require('./lib/persist');
const restore = require('./lib/restore');
const release = require('./lib/release');
const views = require('./lib/admin-views');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 500;
const MAX_UPLOAD = MAX_UPLOAD_MB * 1024 * 1024;
const PUBLIC_DIR = path.join(__dirname, 'public');

function log(...args) {
  console.log(`[${new Date().toLocaleTimeString('vi-VN')}]`, ...args);
}

// ---------------------------------------------------------------------------
// Tiện ích HTTP
// ---------------------------------------------------------------------------

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'SAMEORIGIN',
    ...headers,
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  send(res, status, html, { 'Content-Type': 'text/html; charset=utf-8' });
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function redirect(res, location, cookie) {
  const headers = { Location: location, 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(303, headers);
  res.end();
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of String(raw).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    let value = part.slice(idx + 1).trim();
    try { value = decodeURIComponent(value); } catch {}
    out[key] = value;
  }
  return out;
}

function currentSession(req) {
  const cookies = parseCookies(req);
  return auth.validSession(cookies[auth.SESSION_COOKIE]);
}

function requireAdmin(req, res) {
  const session = currentSession(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.' });
    return null;
  }
  return session;
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Body quá lớn'), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readForm(req) {
  const body = await readBody(req, 512 * 1024);
  const params = new URLSearchParams(body.toString('utf8'));
  const out = {};
  for (const [key, value] of params) out[key] = value;
  return out;
}

async function readJsonBody(req) {
  try {
    const body = await readBody(req, 64 * 1024);
    return JSON.parse(body.toString('utf8') || '{}');
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Nhận diện thiết bị + ngôn ngữ
// ---------------------------------------------------------------------------

const MOBILE_UA = /Android|webOS|iPhone|iPod|iPad|BlackBerry|IEMobile|Opera Mini|Windows Phone|Silk|Kindle|PlayBook|Mobile|Tablet|Mobi/i;

function isMobileRequest(req) {
  const ua = String(req.headers['user-agent'] || '');
  if (!ua) return false;
  if (/iPad|Tablet/i.test(ua)) return true;
  return MOBILE_UA.test(ua);
}

const langCache = new Map();

async function resolveLang(req, country) {
  if (!country) {
    for (const tag of acceptLanguage(req)) {
      const lang = normalizeLang(tag);
      if (lang) return lang;
    }
    return 'en';
  }
  if (langCache.has(country)) return langCache.get(country);
  const lang = langForCountry(country, 'en');
  if (langCache.size > 3000) langCache.clear();
  langCache.set(country, lang);
  return lang;
}

// ---------------------------------------------------------------------------
// Trang chủ + tải file
// ---------------------------------------------------------------------------

// Xác định file đang phát hành: bản trên GitHub Release hay bản cục bộ vừa upload.
//
// `useLocal` = true khi bản cục bộ MỚI HƠN bản trên release — tức admin vừa
// upload và tiến trình đẩy lên GitHub chưa xong. Lúc đó phải phục vụ bản cục bộ,
// nếu không khách sẽ nhận link của bản CŨ (tên file và nội dung đều sai).
//
// @returns {Promise<{remote:object|null, local:object|null, useLocal:boolean}>}
async function publishedChoice() {
  const remote = await restore.downloadTarget();
  const meta = await store.readMeta();
  const hasLocal = Boolean(meta && meta.id && meta.size) && await store.hasPublishedFile();
  const useLocal = hasLocal && (!remote || (meta.updatedAt || 0) > (remote.updatedAt || 0));
  return { remote: remote || null, local: hasLocal ? meta : null, useLocal };
}

async function handleHome(req, res) {
  const country = await detectCountry(req);
  const lang = await resolveLang(req, country);
  const mobile = isMobileRequest(req);

  // Ưu tiên metadata trên GitHub Release: chỉ vài trăm byte, không tải file về
  // ổ tạm của Render. Nếu file cục bộ mới hơn (vừa upload, đang đẩy dở) thì
  // hiển thị file cục bộ để khách thấy đúng bản vừa đăng.
  const choice = await publishedChoice();
  const file = choice.useLocal
    ? { name: choice.local.name, size: choice.local.size }
    : choice.remote
      ? { name: choice.remote.name, size: choice.remote.size }
      : await (async () => {
        await restore.ensureFile(store);
        return store.current();
      })();

  const dict = t(lang);
  log(`${clientIp(req) || 'unknown'} · ${country || '??'} · ${lang} · ${mobile ? 'mobile' : 'desktop'} · /`);

  // Nếu ngôn ngữ này chưa có bản dịch (ví dụ lần đầu có khách từ nước đó),
  // dịch ngay và lưu lại. Dịch lỗi thì trang vẫn dùng câu gốc.
  const messages = await settings.messageForLang(lang, dict);

  sendHtml(res, 200, renderHome({
    lang,
    device: mobile ? 'mobile' : 'desktop',
    zipName: file.name,
    zipSize: file.size,
    messages,
  }));
}

async function handleDownload(req, res) {
  // Đường nhanh: chuyển thẳng khách sang GitHub Release. File không đi qua
  // Render nên không tốn băng thông của Render và tải nhanh hơn nhiều.
  //
  // Ngoại lệ: vừa upload xong mà bản trên release chưa đẩy xong (file cục bộ
  // mới hơn) thì trả file cục bộ, tránh đưa khách link của bản CŨ.
  const choice = await publishedChoice();

  if (choice.remote && choice.remote.url && !choice.useLocal) {
    const remote = choice.remote;
    log(`Chuyển tải "${remote.name}" sang GitHub Release (${clientIp(req)})`);
    // Đếm lượt tải chạy nền, không chặn phản hồi.
    store.bumpDownload(remote.name).catch(() => {});
    res.writeHead(302, {
      Location: remote.url,
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end();
    return;
  }

  // Dự phòng: chưa có release (hoặc repo riêng tư), hoặc bản cục bộ mới hơn
  // bản trên release -> trả file từ máy chủ.
  // Khách bấm tải mà file đã mất -> tự khôi phục rồi mới trả file.
  await restore.ensureFile(store);
  const file = await store.current();
  if (!file.size || !file.id) {
    send(res, 404, 'Chưa có file nào được tải lên.');
    return;
  }

  const source = store.storedFilePath(file);
  let size = 0;
  try {
    size = (await fsp.stat(source)).size;
  } catch {
    send(res, 404, 'File không còn trên máy chủ.');
    return;
  }

  const ext = store.extOf(file.name);
  const asciiFallback = `file${ext || '.zip'}`;
  const encoded = encodeURIComponent(file.name);

  res.writeHead(200, {
    'Content-Type': store.contentTypeFor(file.name),
    'Content-Length': String(size),
    'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Content-Type-Options': 'nosniff',
  });

  const stream = fs.createReadStream(source);
  stream.on('error', (err) => {
    log('Lỗi đọc file:', err.message);
    res.destroy();
  });
  stream.on('end', () => { store.bumpDownload().catch(() => {}); });
  stream.pipe(res);
}

// ---------------------------------------------------------------------------
// Đăng nhập / đăng xuất
// ---------------------------------------------------------------------------

async function handleLoginPage(req, res) {
  if (currentSession(req)) {
    redirect(res, '/admin/dashboard');
    return;
  }
  sendHtml(res, 200, views.loginPage({}));
}

async function handleLoginPost(req, res) {
  const ip = clientIp(req) || 'unknown';
  const locked = auth.loginLocked(ip);
  if (locked) {
    sendHtml(res, 429, views.loginPage({
      error: `Bạn đã nhập sai quá nhiều lần. Vui lòng thử lại sau ${locked} phút.`,
      lockedMinutes: locked,
    }));
    return;
  }

  let form = {};
  try {
    form = await readForm(req);
  } catch {
    sendHtml(res, 400, views.loginPage({ error: 'Yêu cầu không hợp lệ.' }));
    return;
  }

  const email = String(form.email || '').trim();
  const password = String(form.password || '');

  if (!email || !password) {
    sendHtml(res, 400, views.loginPage({ email, error: 'Vui lòng nhập tên đăng nhập và mật khẩu.' }));
    return;
  }

  if (!auth.matchesIdentity(email)) {
    auth.recordLoginFail(ip);
    log(`Đăng nhập sai tài khoản: ${email} từ ${ip}`);
    sendHtml(res, 401, views.loginPage({
      email,
      error: 'Tài khoản hoặc mật khẩu không đúng.',
    }));
    return;
  }

  if (!auth.verifyPassword(password)) {
    auth.recordLoginFail(ip);
    log(`Đăng nhập sai mật khẩu từ ${ip}`);
    sendHtml(res, 401, views.loginPage({
      email,
      error: 'Tài khoản hoặc mật khẩu không đúng.',
    }));
    return;
  }

  auth.clearLoginFails(ip);
  const token = auth.createSession(email);
  log(`Đăng nhập thành công: ${email} từ ${ip}`);
  redirect(res, '/admin/dashboard', auth.sessionCookie(token));
}

async function handleLogout(req, res) {
  const cookies = parseCookies(req);
  auth.destroySession(cookies[auth.SESSION_COOKIE]);
  redirect(res, '/admin', auth.clearCookie());
}

// ---------------------------------------------------------------------------
// Quên mật khẩu: gửi OTP
// ---------------------------------------------------------------------------

function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) return email;
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${'*'.repeat(Math.max(1, user.length - visible.length))}@${domain}`;
}

async function handleForgotPage(req, res) {
  sendHtml(res, 200, views.forgotPage({}));
}

async function handleForgotPost(req, res) {
  const ip = clientIp(req) || 'unknown';
  let form = {};
  try {
    form = await readForm(req);
  } catch {
    sendHtml(res, 400, views.forgotPage({ error: 'Yêu cầu không hợp lệ.' }));
    return;
  }

  const email = auth.normalizeEmail(form.email);
  if (!email) {
    sendHtml(res, 400, views.forgotPage({ error: 'Vui lòng nhập email quản trị.' }));
    return;
  }

  // Không tiết lộ email có đúng hay không
  if (email !== auth.normalizeEmail(auth.accountEmail())) {
    log(`Yêu cầu OTP cho email không khớp: ${email} từ ${ip}`);
    sendHtml(res, 200, views.forgotPage({
      email,
      notice: 'Nếu email này là email quản trị, mã xác minh đã được gửi. Hãy kiểm tra hộp thư.',
    }));
    return;
  }

  const gate = auth.canRequestOtp(email);
  if (!gate.ok) {
    sendHtml(res, 429, views.forgotPage({
      email,
      error: gate.hourly
        ? 'Bạn đã yêu cầu quá nhiều mã. Vui lòng thử lại sau ít phút.'
        : `Vui lòng chờ ${gate.wait} giây trước khi yêu cầu mã mới.`,
      cooldown: gate.wait,
    }));
    return;
  }

  const code = auth.issueOtp(email);
  const baseUrl = publicBaseUrl(req);
  const template = mailer.otpEmailTemplate({
    code,
    email,
    minutes: Math.round(auth.OTP_TTL / 60000),
    ip,
    requestedAt: new Date().toLocaleString('vi-VN'),
    resetUrl: `${baseUrl}/admin/reset?email=${encodeURIComponent(email)}&code=${code}`,
  });

  const result = await mailer.sendMail({
    to: email,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });

  if (!result.ok && result.reason === 'not_configured') {
    await auth.saveOtpPreview(email, code);
    log(`Chưa cấu hình gửi thư. Mã OTP đã ghi ra data/last-otp.txt`);
    redirect(res, `/admin/reset?email=${encodeURIComponent(email)}&sent=preview`);
    return;
  }

  if (!result.ok) {
    log('Gửi email OTP thất bại:', result.error || result.reason);
    await auth.saveOtpPreview(email, code);
    const detail = String(result.error || result.reason || '');
    const smtpBlocked = /ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(detail);
    sendHtml(res, 502, views.forgotPage({
      email,
      error: smtpBlocked
        ? 'Máy chủ này chặn cổng SMTP (Render free). Hãy khai báo RESEND_API_KEY trong tab Environment để gửi mã qua HTTPS.'
        : 'Không gửi được email. Kiểm tra cấu hình gửi thư hoặc thử lại sau.',
    }));
    return;
  }

  log(`Đã gửi mã OTP tới ${maskEmail(email)} (yêu cầu từ ${ip})`);
  redirect(res, `/admin/reset?email=${encodeURIComponent(email)}&sent=1`);
}

// Địa chỉ công khai của web (ưu tiên header của proxy/hosting)
function publicBaseUrl(req) {
  if (process.env.PUBLIC_URL) return String(process.env.PUBLIC_URL).replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).split(',')[0].trim();
  return `${proto}://${host}`;
}

async function handleResendOtp(req, res) {
  const body = await readJsonBody(req);
  const email = auth.normalizeEmail(body.email || auth.accountEmail());
  const ip = clientIp(req) || 'unknown';

  if (email !== auth.normalizeEmail(auth.accountEmail())) {
    sendJson(res, 200, { ok: true, wait: 60 });
    return;
  }

  const gate = auth.canRequestOtp(email);
  if (!gate.ok) {
    sendJson(res, 429, { ok: false, wait: gate.wait, error: `Vui lòng chờ ${gate.wait} giây.` });
    return;
  }

  const code = auth.issueOtp(email);
  const baseUrl = publicBaseUrl(req);
  const template = mailer.otpEmailTemplate({
    code,
    email,
    minutes: Math.round(auth.OTP_TTL / 60000),
    ip,
    requestedAt: new Date().toLocaleString('vi-VN'),
    resetUrl: `${baseUrl}/admin/reset?email=${encodeURIComponent(email)}&code=${code}`,
  });

  const result = await mailer.sendMail({
    to: email,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });

  if (!result.ok) {
    await auth.saveOtpPreview(email, code);
    sendJson(res, result.reason === 'not_configured' ? 200 : 502, {
      ok: result.reason === 'not_configured',
      wait: Math.round(auth.OTP_RESEND_COOLDOWN / 1000),
      error: result.reason === 'not_configured'
        ? 'Chưa cấu hình SMTP, mã được ghi ra data/last-otp.txt'
        : 'Không gửi được email.',
    });
    return;
  }

  sendJson(res, 200, { ok: true, wait: Math.round(auth.OTP_RESEND_COOLDOWN / 1000) });
}

// ---------------------------------------------------------------------------
// Đặt lại mật khẩu
// ---------------------------------------------------------------------------

async function handleResetPage(req, res, url) {
  const email = auth.normalizeEmail(url.searchParams.get('email') || auth.accountEmail());
  const sent = url.searchParams.get('sent');
  const prefill = String(url.searchParams.get('code') || '').replace(/\D/g, '').slice(0, 6);
  const notice = sent === 'preview'
    ? 'Chưa cấu hình SMTP. Mã xác minh đã được ghi ra file data/last-otp.txt trên máy chủ.'
    : sent
      ? 'Mã xác minh đã được gửi tới email quản trị.'
      : '';

  sendHtml(res, 200, views.resetPage({
    email,
    maskedEmail: maskEmail(email),
    notice,
    prefill,
    cooldown: sent ? Math.round(auth.OTP_RESEND_COOLDOWN / 1000) : 0,
  }));
}

async function handleResetPost(req, res) {
  const ip = clientIp(req) || 'unknown';
  let form = {};
  try {
    form = await readForm(req);
  } catch {
    sendHtml(res, 400, views.resetPage({ error: 'Yêu cầu không hợp lệ.' }));
    return;
  }

  const email = auth.normalizeEmail(form.email || auth.accountEmail());
  const otp = String(form.otp || '').replace(/\D/g, '');
  const password = String(form.password || '');
  const confirm = String(form.confirm || '');

  const render = (error, status = 400) => sendHtml(res, status, views.resetPage({
    email,
    maskedEmail: maskEmail(email),
    error,
  }));

  if (email !== auth.normalizeEmail(auth.accountEmail())) {
    render('Email không khớp với tài khoản quản trị.');
    return;
  }
  if (otp.length !== 6) {
    render('Mã xác minh phải gồm 6 chữ số.');
    return;
  }
  if (password.length < 8) {
    render('Mật khẩu mới phải có ít nhất 8 ký tự.');
    return;
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    render('Mật khẩu mới phải có cả chữ và số.');
    return;
  }
  if (password !== confirm) {
    render('Mật khẩu nhập lại không khớp.');
    return;
  }

  const check = auth.verifyOtp(email, otp);
  if (!check.ok) {
    render(check.error, 401);
    return;
  }

  auth.consumeOtp(email);
  await auth.changePassword(password);
  await auth.clearOtpPreview();
  auth.clearLoginFails(ip);

  log(`Đặt lại mật khẩu thành công cho ${email} từ ${ip}`);

  const token = auth.createSession(email);
  redirect(res, '/admin/dashboard?reset=1', auth.sessionCookie(token));
}

// ---------------------------------------------------------------------------
// Bảng điều khiển
// ---------------------------------------------------------------------------

async function handleDashboard(req, res) {
  const session = currentSession(req);
  if (!session) {
    redirect(res, '/admin');
    return;
  }

  // Ưu tiên metadata trên release: KHÔNG tải file về ổ tạm của Render.
  // Nếu vừa upload mà bản đẩy lên chưa xong thì hiển thị bản cục bộ.
  const choice = await publishedChoice();
  let restoreState;
  let file;

  if (choice.remote && !choice.useLocal) {
    const remote = choice.remote;
    const stats = await store.readStats();
    restoreState = {
      ...restore.status(),
      mode: 'redirect',
      wasMissing: false,
      published: { name: remote.name, size: remote.size, updatedAt: remote.updatedAt },
      // Lần đẩy gần nhất hỏng thì phải nói rõ, kẻo admin tưởng file đã an toàn.
      pushFailed: stats.push && !stats.push.ok ? stats.push : null,
    };
    file = {
      id: 'release',
      name: remote.name,
      originalName: remote.name,
      size: remote.size,
      humanSize: store.humanSize(remote.size),
      updatedAt: remote.updatedAt || Date.now(),
      checksum: remote.checksum,
      downloads: stats.downloads || 0,
    };
  } else {
    const before = await store.hasPublishedFile();
    await restore.ensureFile(store);
    const after = await store.hasPublishedFile();
    if (!before && after) {
      log('Đã tự khôi phục file phát hành khi admin mở trang quản trị');
    }
    const stats = await store.readStats();
    restoreState = {
      ...restore.status(),
      mode: 'proxy',
      wasMissing: !before && !after,
      pushFailed: stats.push && !stats.push.ok ? stats.push : null,
    };
    file = await store.current();
  }

  const messages = settings.get();
  const query = new URL(req.url, 'http://localhost').searchParams;
  const msgFlag = query.get('msg');
  const noticeText = msgFlag === 'ok'
    ? 'Đã lưu. Hệ thống đang tự dịch sang 54 ngôn ngữ ở chế độ nền, khách vào là thấy đúng ngôn ngữ của họ.'
    : msgFlag === 'saved'
      ? 'Đã lưu thông báo, nhưng chưa đồng bộ được lên nơi lưu bền (kiểm tra GITHUB_TOKEN).'
      : msgFlag === 'err'
        ? 'Không lưu được thông báo.'
        : '';
  sendHtml(res, 200, views.dashboardPage({
    file,
    email: session.email,
    maxUploadMb: MAX_UPLOAD_MB,
    mailConfigured: mailer.isConfigured(),
    messages,
    languages: settings.languageList(),
    defaults: settings.DEFAULT_MESSAGES,
    syncState: {
      enabled: persist.isConfigured(),
      canPush: persist.canPush(),
      mode: persist.canPush() ? 'gist' : persist.isConfigured() ? 'url' : 'off',
    },
    restoreState,
    notice: noticeText,
    noticeKind: msgFlag === 'err' || msgFlag === 'saved' ? 'err' : 'ok',
  }));
}

// Lưu thông báo hiển thị cho người truy cập
async function handleSaveMessages(req, res) {
  const session = currentSession(req);
  if (!session) {
    redirect(res, '/admin');
    return;
  }

  let form = {};
  try {
    form = await readForm(req);
  } catch {
    redirect(res, '/admin/dashboard?msg=err');
    return;
  }

  // Form chỉ còn 2 ô: câu cho máy tính và câu cho điện thoại.
  // Bản dịch từng ngôn ngữ do server tự sinh, không nhập tay.
  const desktopText = form.desktopText;
  const mobileText = form.mobileText;

  // Câu đổi thì bản dịch cũ của ô đó không còn đúng -> xoá để dịch lại.
  const before = settings.get();
  const sq = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, settings.MAX_LEN);
  const desktopChanged = before.desktopText !== sq(desktopText);
  const mobileChanged = before.mobileText !== sq(mobileText);

  const keep = {};
  if (!desktopChanged || !mobileChanged) {
    for (const [code, entry] of Object.entries(before.languages || {})) {
      const next = {};
      if (!desktopChanged && entry.desktopText) next.desktopText = entry.desktopText;
      if (!mobileChanged && entry.mobileText) next.mobileText = entry.mobileText;
      if (next.desktopText || next.mobileText) keep[code] = next;
    }
  }

  await settings.save({ desktopText, mobileText, languages: keep });

  log(`Cập nhật thông báo từ ${clientIp(req)}`);

  // Dịch nền cho mọi ngôn ngữ rồi đẩy lên nơi lưu bền; lỗi thì khách vào sẽ được dịch bù.
  const codes = settings.languageList().map((l) => l.code);
  settings.prefillAll(codes).then(async (pre) => {
    if (pre.failed.length) log(`Tự dịch lỗi ${pre.failed.length} ngôn ngữ, sẽ dịch bù khi có khách`);
    const sync = await persist.push(settings.get());
    if (sync.pushed) log(`Đã đồng bộ thông báo lên gist ${sync.gistId}`);
    else if (sync.reason && sync.reason !== 'disabled' && sync.reason !== 'read_only') {
      log(`Chưa đồng bộ được thông báo: ${sync.reason}`);
    }
  }).catch((err) => log(`Lỗi dịch nền: ${err && err.message}`));

  redirect(res, '/admin/dashboard?msg=ok');
}

async function handleUpload(req, res) {
  if (!requireAdmin(req, res)) return;

  if (req.headers['x-admin-upload'] !== '1') {
    sendJson(res, 400, { ok: false, error: 'Thiếu header tải lên.' });
    return;
  }

  const declared = Number(req.headers['content-length']) || 0;
  if (declared && declared > MAX_UPLOAD) {
    sendJson(res, 413, { ok: false, error: `File quá lớn. Tối đa ${MAX_UPLOAD_MB} MB.` });
    return;
  }

  const rawName = handleUploadName(req);
  const tempPath = path.join(store.TEMP_DIR, `up-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.part`);

  try {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tempPath);
      let written = 0;
      let tooLarge = false;

      req.on('data', (chunk) => {
        written += chunk.length;
        if (written > MAX_UPLOAD) {
          tooLarge = true;
          req.destroy();
          out.destroy();
        }
      });
      req.on('aborted', () => reject(new Error('Client huỷ tải lên')));
      req.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => {
        if (tooLarge) reject(Object.assign(new Error('too large'), { code: 'TOO_LARGE' }));
        else resolve();
      });
      req.pipe(out);
    });

    if (!store.isAllowed(rawName)) {
      sendJson(res, 400, { ok: false, error: `Chỉ nhận file ${store.ALLOWED_LABEL}.` });
      return;
    }

    const size = (await fsp.stat(tempPath)).size;
    if (!size) throw Object.assign(new Error('File rỗng'), { code: 'EMPTY' });

    const saved = await store.replace({
      tempPath,
      originalName: rawName,
      size,
    });

    log(`Đã thay file: ${saved.name} (${saved.humanSize}) từ ${clientIp(req)}`);

    // Đẩy lên GitHub Release để không mất khi Render khởi động lại.
    // Chạy nền để trang admin phản hồi ngay.
    sendJson(res, 200, { ok: true, name: saved.name, size: saved.size, humanSize: saved.humanSize });
    release.pushRelease({
      filePath: store.storedFilePath(saved),
      name: saved.name,
      size: saved.size,
      checksum: saved.checksum,
      updatedAt: saved.updatedAt,
    }).then((out) => {
      // Đẩy xong thì bỏ cache để lượt tải kế tiếp chuyển thẳng sang release.
      restore.clearTargetCache();
      if (out.pushed) {
        store.recordPush({ ok: true, name: saved.name }).catch(() => {});
        return;
      }
      if (out.reason !== 'disabled') {
        // Không đẩy được nghĩa là file chỉ nằm trên ổ tạm: Render restart là mất.
        // Ghi lại để trang quản trị cảnh báo admin ngay, không im lặng.
        log(`Chưa đẩy file lên release: ${out.reason}`);
        store.recordPush({ ok: false, name: saved.name, error: out.reason }).catch(() => {});
      }
    }).catch((err) => {
      const reason = err && err.message ? err.message : String(err);
      log('Lỗi đẩy release:', reason);
      store.recordPush({ ok: false, name: saved.name, error: reason }).catch(() => {});
    });
  } catch (err) {
    await fsp.unlink(tempPath).catch(() => {});
    if (err.code === 'TOO_LARGE') {
      sendJson(res, 413, { ok: false, error: `File quá lớn. Tối đa ${MAX_UPLOAD_MB} MB.` });
      return;
    }
    if (err.code === 'EMPTY') {
      sendJson(res, 400, { ok: false, error: 'File rỗng, vui lòng chọn file khác.' });
      return;
    }
    if (err.code === 'BAD_FORMAT') {
      sendJson(res, 400, { ok: false, error: err.message });
      return;
    }
    log('Lỗi upload:', err.message);
    sendJson(res, 500, { ok: false, error: 'Không lưu được file. Vui lòng thử lại.' });
  }
}

function handleUploadName(req) {
  const raw = req.headers['x-file-name'];
  if (typeof raw !== 'string' || !raw) return store.DEFAULT_ZIP_NAME;
  let name = raw;
  try { name = decodeURIComponent(raw); } catch {}
  return store.sanitizeName(name);
}

async function handleDelete(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    await store.remove();
    restore.clearTargetCache();
    log(`Đã xoá file hiện tại (${clientIp(req)})`);
    // Xoá luôn trên release để lần khôi phục sau không mang file cũ về.
    release.clearRelease().then((out) => {
      restore.clearTargetCache();
      if (!out.cleared && out.reason !== 'disabled') {
        log(`Chưa xoá được file trên release: ${out.reason}`);
      }
    }).catch((err) => log('Lỗi xoá release:', err && err.message));
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: 'Không xoá được file.' });
  }
}

async function handleAccountEmail(req, res) {
  if (!requireAdmin(req, res)) return;
  const body = await readJsonBody(req);
  const email = auth.normalizeEmail(body.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    sendJson(res, 400, { ok: false, error: 'Email không hợp lệ.' });
    return;
  }
  await auth.setEmail(email);
  sendJson(res, 200, { ok: true, email });
}

// ---------------------------------------------------------------------------
// File tĩnh
// ---------------------------------------------------------------------------

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function serveStatic(req, res, pathname) {
  const rel = pathname.replace(/^\/+/, '');
  const target = path.join(PUBLIC_DIR, rel);
  if (!target.startsWith(PUBLIC_DIR)) {
    send(res, 403, 'Forbidden');
    return;
  }
  try {
    const data = await fsp.readFile(target);
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': String(data.length),
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  } catch {
    send(res, 404, 'Not found');
  }
}

// ---------------------------------------------------------------------------
// Định tuyến
// ---------------------------------------------------------------------------

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method || 'GET';

  try {
    if (pathname.startsWith('/vendor/') || pathname === '/admin.css') {
      await serveStatic(req, res, pathname);
      return;
    }

    if (pathname === '/favicon.ico') { send(res, 204, ''); return; }

    if (pathname === '/robots.txt') {
      send(res, 200, 'User-agent: *\nDisallow: /admin\n', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }

    if (pathname === '/' && (method === 'GET' || method === 'HEAD')) {
      await handleHome(req, res);
      return;
    }

    if (pathname === '/download' && (method === 'GET' || method === 'HEAD')) {
      await handleDownload(req, res);
      return;
    }

    if (pathname === '/admin') {
      if (method === 'GET') { await handleLoginPage(req, res); return; }
      if (method === 'POST') { await handleLoginPost(req, res); return; }
    }

    if (pathname === '/admin/login' && method === 'POST') {
      await handleLoginPost(req, res);
      return;
    }

    if (pathname === '/admin/logout' && method === 'POST') {
      await handleLogout(req, res);
      return;
    }

    if (pathname === '/admin/forgot' && method === 'GET') {
      await handleForgotPage(req, res);
      return;
    }

    if (pathname === '/admin/forgot' && method === 'POST') {
      await handleForgotPost(req, res);
      return;
    }

    if (pathname === '/admin/reset' && method === 'GET') {
      await handleResetPage(req, res, url);
      return;
    }

    if (pathname === '/admin/reset' && method === 'POST') {
      await handleResetPost(req, res);
      return;
    }

    if (pathname === '/admin/resend-otp' && method === 'POST') {
      await handleResendOtp(req, res);
      return;
    }

    if (pathname === '/admin/dashboard' && method === 'GET') {
      await handleDashboard(req, res);
      return;
    }

    if (pathname === '/admin/upload' && method === 'POST') {
      await handleUpload(req, res);
      return;
    }

    if (pathname === '/admin/delete' && method === 'POST') {
      await handleDelete(req, res);
      return;
    }

    if (pathname === '/admin/messages' && method === 'POST') {
      await handleSaveMessages(req, res);
      return;
    }

    if (pathname === '/admin/email' && method === 'POST') {
      await handleAccountEmail(req, res);
      return;
    }

    if (pathname.startsWith('/admin')) {
      sendHtml(res, 404, '<!doctype html><meta charset="utf-8"><title>404</title><body style="font-family:system-ui;background:#f5f7fa;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1>404</h1><p style="color:#6b7280">Không tìm thấy trang. <a href="/admin">Về đăng nhập</a></p></div></body>');
      return;
    }

    sendHtml(res, 404, '<!doctype html><meta charset="utf-8"><title>404</title><body style="font-family:system-ui;background:#08090d;color:#f2f3f7;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-size:26px">404</h1><p style="color:#9aa1b2">Trang không tồn tại. <a href="/" style="color:#6c8cff">Về trang chính</a></p></div></body>');
  } catch (err) {
    log('Lỗi xử lý', pathname, err && err.stack ? err.stack : err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Lỗi máy chủ.' });
    else res.destroy();
  }
}

// ---------------------------------------------------------------------------
// Khởi động
// ---------------------------------------------------------------------------

async function main() {
  await store.init();
  // Khi có URL khôi phục thì không tạo file ZIP mẫu, để file mẫu không
  // "chiếm chỗ" khiến việc khôi phục bị bỏ qua.
  store.setAllowDefault(!restore.isConfigured());
  await store.ensureDefault();
  await settings.init();

  // Render free dùng ổ đĩa tạm: tự tải lại file phát hành nếu có
  // GITHUB_REPO+GITHUB_TOKEN (GitHub Release) hoặc RESTORE_ZIP_URL.
  //
  // Chế độ chuyển hướng: nếu release đã có file thì KHÔNG tải về ổ tạm nữa.
  // Khách bấm tải sẽ được chuyển thẳng sang GitHub -> tiết kiệm băng thông
  // Render và khởi động nhanh (không chờ tải 100 MB).
  const direct = await restore.downloadTarget();
  if (direct) {
    log(`Chế độ chuyển hướng: "${direct.name}" (${store.humanSize(direct.size)}) nằm trên GitHub Release`);
  } else {
    const restored = await restore.restoreIfEmpty(store);
    if (restored.restored) {
      const src = restored.source === 'release' ? 'GitHub Release' : 'RESTORE_ZIP_URL';
      log(`Đã tự khôi phục file phát hành từ ${src} (${store.humanSize(restored.size)})`);
    } else if (restored.reason && restored.reason !== 'disabled') {
      log(`Không khôi phục file tự động: ${restored.reason}`);
    }
  }

  // Câu thông báo admin đã nhập cũng nằm trên ổ tạm → kéo lại từ gist/URL
  const synced = await persist.restoreInto(settings);
  if (synced.pulled) {
    log(`Đã khôi phục thông báo đã lưu (${synced.languages} ngôn ngữ riêng${synced.shared ? ' + câu dùng chung' : ''})`);
  } else if (synced.reason && synced.reason !== 'disabled' && synced.reason !== 'nothing_saved') {
    log(`Không khôi phục thông báo: ${synced.reason}`);
  }

  const info = await auth.init({});

  const server = http.createServer((req, res) => { route(req, res); });

  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  server.listen(PORT, HOST, () => {
    console.log('');
    console.log(`  Web tải file:   http://localhost:${PORT}`);
    console.log(`  Trang quản trị: http://localhost:${PORT}/admin`);
    console.log(`  Email quản trị: ${info.email}`);
    console.log(`  Upload tối đa:  ${MAX_UPLOAD_MB} MB`);
    console.log(`  SMTP:           ${mailer.isConfigured() ? 'đã cấu hình' : 'chưa cấu hình (OTP ghi ra data/last-otp.txt)'}`);
    console.log('');
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      log('Đang dừng server…');
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2500).unref();
    });
  }
}

main().catch((err) => {
  console.error('Không khởi động được:', err);
  process.exit(1);
});
