'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./paths');

const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const OTP_FILE = path.join(DATA_DIR, 'last-otp.txt');

const SESSION_TTL = 12 * 60 * 60 * 1000;   // 12 giờ
const OTP_TTL = 10 * 60 * 1000;            // 10 phút
const OTP_RESEND_COOLDOWN = 60 * 1000;     // 60 giây
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_HOUR = 6;

const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;

const SESSION_COOKIE = 'wd_session';

let config = null;
const sessions = new Map();          // token -> { exp, email }
const otps = new Map();              // email -> { code, exp, attempts, sentAt, sentCount, windowStart }
const loginFails = new Map();        // ip -> { count, first }

function log(...args) {
  console.log('[auth]', ...args);
}

function scrypt(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

async function init({ email, password } = {}) {
  await fsp.mkdir(DATA_DIR, { recursive: true });

  let loaded = null;
  try {
    loaded = JSON.parse(await fsp.readFile(AUTH_FILE, 'utf8'));
  } catch {
    loaded = null;
  }

  const defaultEmail = email || process.env.ADMIN_EMAIL || 'tmviet98@gmail.com';

  if (!loaded || !loaded.hash) {
    const initial = password || process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    const salt = crypto.randomBytes(16).toString('hex');
    loaded = {
      email: defaultEmail,
      salt,
      hash: scrypt(initial, salt),
      secret: crypto.randomBytes(32).toString('hex'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      generated: !password && !process.env.ADMIN_PASSWORD,
    };
    await writeJson(AUTH_FILE, loaded);

    if (loaded.generated) {
      const line = '='.repeat(58);
      console.log(line);
      console.log('  MẬT KHẨU QUẢN TRỊ ĐƯỢC TẠO TỰ ĐỘNG');
      console.log(`  ${initial}`);
      console.log(`  Email đăng nhập: ${loaded.email}`);
      console.log('  Đổi mật khẩu: dùng "Quên mật khẩu?" ở trang đăng nhập.');
      console.log(line);
    }
    config = loaded;
    config.initialPassword = initial;
    return { generated: loaded.generated, password: initial, email: loaded.email };
  }

  config = loaded;
  if (!config.secret) {
    config.secret = crypto.randomBytes(32).toString('hex');
    await writeJson(AUTH_FILE, config);
  }
  // Chỉ dùng ADMIN_PASSWORD từ .env cho lần tạo tài khoản đầu tiên.
  // Nếu đã có auth.json thì giữ mật khẩu hiện tại (kể cả đã đổi qua OTP).
  if (!loaded.hash) {
    const initial = password || process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    const salt = crypto.randomBytes(16).toString('hex');
    config.salt = salt;
    config.hash = scrypt(initial, salt);
    config.updatedAt = Date.now();
    await writeJson(AUTH_FILE, config);
  }
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_EMAIL !== config.email) {
    config.email = process.env.ADMIN_EMAIL;
    await writeJson(AUTH_FILE, config);
  }
  return { generated: false, email: config.email };
}

function accountEmail() {
  return (config && config.email) || process.env.ADMIN_EMAIL || 'tmviet98@gmail.com';
}

async function setEmail(email) {
  config.email = email;
  config.updatedAt = Date.now();
  await writeJson(AUTH_FILE, config);
}

function verifyPassword(password) {
  if (!config || !config.hash) return false;
  try {
    const candidate = scrypt(password, config.salt);
    return safeEqual(candidate, config.hash);
  } catch {
    return false;
  }
}

async function changePassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  config.salt = salt;
  config.hash = scrypt(password, salt);
  config.updatedAt = Date.now();
  config.generated = false;
  await writeJson(AUTH_FILE, config);
  sessions.clear();
  log('Mật khẩu quản trị đã được đổi. Tất cả phiên đăng nhập đã bị huỷ.');
}

// ---------------------------------------------------------------------------
// Phiên đăng nhập
// ---------------------------------------------------------------------------

function createSession(email) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { exp: Date.now() + SESSION_TTL, email: email || accountEmail() });
  pruneSessions();
  return token;
}

function validSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.exp < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

function pruneSessions() {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (s.exp < now) sessions.delete(token);
  }
}

function cookieOptions() {
  return {
    name: SESSION_COOKIE,
    maxAge: Math.floor(SESSION_TTL / 1000),
  };
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL / 1000)}`;
}

function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ---------------------------------------------------------------------------
// Giới hạn đăng nhập sai
// ---------------------------------------------------------------------------

function loginLocked(ip) {
  const entry = loginFails.get(ip);
  if (!entry) return 0;
  if (Date.now() - entry.first > LOGIN_WINDOW) {
    loginFails.delete(ip);
    return 0;
  }
  if (entry.count < LOGIN_MAX_FAILS) return 0;
  return Math.ceil((LOGIN_WINDOW - (Date.now() - entry.first)) / 60000);
}

function recordLoginFail(ip) {
  const entry = loginFails.get(ip);
  const now = Date.now();
  if (!entry || now - entry.first > LOGIN_WINDOW) {
    loginFails.set(ip, { count: 1, first: now });
    return;
  }
  entry.count += 1;
}

function clearLoginFails(ip) {
  loginFails.delete(ip);
}

// ---------------------------------------------------------------------------
// OTP quên mật khẩu
// ---------------------------------------------------------------------------

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function canRequestOtp(email) {
  const key = normalizeEmail(email);
  const entry = otps.get(key);
  if (!entry) return { ok: true };
  const now = Date.now();
  if (entry.sentAt && now - entry.sentAt < OTP_RESEND_COOLDOWN) {
    return { ok: false, wait: Math.ceil((OTP_RESEND_COOLDOWN - (now - entry.sentAt)) / 1000) };
  }
  if (now - entry.windowStart > 60 * 60 * 1000) {
    entry.sentCount = 0;
    entry.windowStart = now;
  }
  if (entry.sentCount >= OTP_MAX_PER_HOUR) {
    return { ok: false, wait: Math.ceil((60 * 60 * 1000 - (now - entry.windowStart)) / 60000), hourly: true };
  }
  return { ok: true };
}

function issueOtp(email) {
  const key = normalizeEmail(email);
  const now = Date.now();
  const entry = otps.get(key) || { sentCount: 0, windowStart: now };
  if (now - entry.windowStart > 60 * 60 * 1000) {
    entry.sentCount = 0;
    entry.windowStart = now;
  }
  const code = String(crypto.randomInt(100000, 1000000));
  entry.code = code;
  entry.exp = now + OTP_TTL;
  entry.attempts = 0;
  entry.sentAt = now;
  entry.sentCount += 1;
  otps.set(key, entry);
  return code;
}

function verifyOtp(email, code) {
  const key = normalizeEmail(email);
  const entry = otps.get(key);
  if (!entry || !entry.code) {
    return { ok: false, error: 'Chưa có mã xác minh. Hãy yêu cầu gửi mã trước.' };
  }
  if (entry.exp < Date.now()) {
    return { ok: false, error: 'Mã xác minh đã hết hạn. Hãy yêu cầu mã mới.' };
  }
  if (entry.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, error: 'Bạn đã nhập sai quá nhiều lần. Hãy yêu cầu mã mới.' };
  }
  entry.attempts += 1;
  if (!safeEqual(String(code), entry.code)) {
    return { ok: false, error: `Mã xác minh không đúng. Còn ${Math.max(0, OTP_MAX_ATTEMPTS - entry.attempts)} lần thử.` };
  }
  return { ok: true };
}

function consumeOtp(email) {
  otps.delete(normalizeEmail(email));
}

// ---------------------------------------------------------------------------
// Lưu OTP ra file khi chưa cấu hình email (dùng khi chạy nội bộ)
// ---------------------------------------------------------------------------

async function saveOtpPreview(email, code) {
  try {
    const text = [
      'MÃ OTP QUÊN MẬT KHẨU (chưa cấu hình email nên mã được ghi ra file này)',
      `Email: ${email}`,
      `Mã: ${code}`,
      `Hết hạn: ${new Date(Date.now() + OTP_TTL).toLocaleString('vi-VN')}`,
      '',
    ].join('\n');
    await fsp.writeFile(OTP_FILE, text, 'utf8');
  } catch (err) {
    log('Không ghi được file OTP tạm:', err.message);
  }
}

async function clearOtpPreview() {
  await fsp.unlink(OTP_FILE).catch(() => {});
}

// ---------------------------------------------------------------------------

module.exports = {
  init,
  accountEmail,
  setEmail,
  verifyPassword,
  changePassword,
  createSession,
  validSession,
  destroySession,
  cookieOptions,
  sessionCookie,
  clearCookie,
  SESSION_COOKIE,
  loginLocked,
  recordLoginFail,
  clearLoginFails,
  normalizeEmail,
  canRequestOtp,
  issueOtp,
  verifyOtp,
  consumeOtp,
  saveOtpPreview,
  clearOtpPreview,
  OTP_TTL,
  OTP_RESEND_COOLDOWN,
};
