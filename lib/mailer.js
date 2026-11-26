'use strict';

// Gửi email qua SMTP, không cần thư viện ngoài.
// Cấu hình bằng biến môi trường (xem .env.example):
//   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM

const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const IP_LIKE = /^\d{1,3}(\.\d{1,3}){3}$|:/;

function tlsOptions(host, socket) {
  const options = { rejectUnauthorized: false };
  if (socket) options.socket = socket;
  else { options.host = host; options.port = undefined; }
  // Không đặt servername khi host là IP (Node.js từ chối giá trị này)
  if (!IP_LIKE.test(host)) options.servername = host;
  return options;
}

function smtpConfig() {
  const host = process.env.SMTP_HOST || (process.env.SMTP_USER && /@gmail\.com$/i.test(process.env.SMTP_USER) ? 'smtp.gmail.com' : '');
  const port = Number(process.env.SMTP_PORT) || (process.env.SMTP_SECURE === 'false' ? 587 : 465);
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE !== 'false' : port === 465;
  const user = (process.env.SMTP_USER || '').trim();
  // App Password Gmail thường hiển thị dạng "abcd efgh ijkl mnop" — bỏ khoảng trắng
  const pass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
  const from = process.env.MAIL_FROM || (user ? `"Web Download" <${user}>` : '');
  return { host, port, secure, user, pass, from };
}

function isConfigured() {
  if (resendConfig()) return true;
  const c = smtpConfig();
  return Boolean(c.host && c.user && c.pass && c.from);
}

// Gửi qua API HTTPS (Resend). Dùng khi host chặn cổng SMTP (vd: Render free).
function resendConfig() {
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) return null;
  const from = (process.env.RESEND_FROM || '').trim()
    || 'Web Download <onboarding@resend.dev>';
  return { key, from };
}

async function sendViaResend({ to, subject, text, html }, cfg, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [extractAddress(to)],
        subject,
        text,
        html,
      }),
    });

    const body = await res.text();
    if (!res.ok) {
      let detail = body.slice(0, 300);
      try {
        const j = JSON.parse(body);
        detail = j.message || j.error || detail;
      } catch {}
      return { ok: false, reason: 'error', error: `Resend ${res.status}: ${detail}` };
    }
    return { ok: true, via: 'resend' };
  } catch (err) {
    return { ok: false, reason: 'error', error: `Resend: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

function encodeHeader(value) {
  // RFC 2047 cho tiêu đề có ký tự ngoài ASCII
  const text = String(value);
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function dotStuff(text) {
  return text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function buildMessage({ from, to, subject, text, html }) {
  const boundary = `----=_Part_${crypto.randomBytes(12).toString('hex')}`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Message-ID: <${crypto.randomBytes(16).toString('hex')}@webdownload>`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  const body = [
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return dotStuff(headers.join('\r\n') + '\r\n' + body);
}

// ---------------------------------------------------------------------------
// SMTP tối giản
// ---------------------------------------------------------------------------

class SmtpSession {
  constructor(socket, onReply) {
    this.socket = socket;
    this.buffer = '';
    this.waiters = [];
    this.lines = [];
    this.onReply = onReply;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => this.handleData(chunk));
    socket.on('error', (err) => this.fail(err));
    socket.on('close', () => this.fail(new Error('Kết nối SMTP đã đóng')));
  }

  handleData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\r\n')) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      this.lines.push(line);
      // Dòng cuối của phản hồi có dạng "250 xxx" (dấu cách ở vị trí 3)
      if (line.length >= 4 && line[3] === ' ') {
        const reply = this.lines.join('\n');
        const code = Number(line.slice(0, 3));
        this.lines = [];
        const waiter = this.waiters.shift();
        if (waiter) waiter.resolve({ code, text: reply });
        else if (this.onReply) this.onReply({ code, text: reply });
      }
    }
  }

  fail(err) {
    while (this.waiters.length) {
      const waiter = this.waiters.shift();
      waiter.reject(err);
    }
    this.rejectAll = err;
  }

  read(timeout = 20000) {
    if (this.rejectAll) return Promise.reject(this.rejectAll);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      this.waiters.push(waiter);
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error('SMTP quá thời gian chờ'));
      }, timeout);
      const wrapResolve = (v) => { clearTimeout(timer); resolve(v); };
      const wrapReject = (e) => { clearTimeout(timer); reject(e); };
      waiter.resolve = wrapResolve;
      waiter.reject = wrapReject;
      if (this.rejectAll) wrapReject(this.rejectAll);
    });
  }

  async command(line, expect = [250]) {
    this.socket.write(`${line}\r\n`);
    const reply = await this.read();
    if (!expect.includes(reply.code)) {
      throw new Error(`SMTP ${reply.code}: ${reply.text.split('\n').slice(-1)[0]}`);
    }
    return reply;
  }

  async upgrade() {
    await this.command('STARTTLS', [220]);

    const raw = this.socket;
    // Gỡ listener plaintext TRƯỚC khi bọc TLS để không đọc nhầm handshake
    raw.removeAllListeners('data');
    raw.removeAllListeners('close');
    raw.removeAllListeners('error');
    raw.removeAllListeners('timeout');

    const secure = await new Promise((resolve, reject) => {
      const sock = tls.connect(tlsOptions(smtpConfig().host, raw), () => resolve(sock));
      sock.once('error', reject);
    });

    this.socket = secure;
    secure.setEncoding('utf8');
    secure.on('data', (chunk) => this.handleData(chunk));
    secure.on('error', (err) => this.fail(err));
    secure.on('close', () => this.fail(new Error('Kết nối TLS đã đóng')));
  }

  close() {
    try { this.socket.write('QUIT\r\n'); } catch {}
    try { this.socket.end(); } catch {}
  }
}

function connect(host, port, secure) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ ...tlsOptions(host), port }, () => resolve(socket))
      : net.connect({ host, port }, () => resolve(socket));
    socket.setTimeout(25000, () => socket.destroy(new Error('Kết nối SMTP quá thời gian chờ')));
    socket.once('error', reject);
  });
}

async function sendMail({ to, subject, text, html, timeout = 30000 }) {
  const resend = resendConfig();
  if (resend) {
    const r = await sendViaResend({ to, subject, text, html }, resend, timeout);
    // Nếu Resend lỗi nhưng có cấu hình SMTP dự phòng thì thử SMTP
    if (r.ok) return r;
    const c = smtpConfig();
    if (!(c.host && c.user && c.pass && c.from)) return r;
  }

  const cfg = smtpConfig();
  if (!isConfigured()) {
    return { ok: false, reason: 'not_configured' };
  }

  let smtp = null;

  const run = async () => {
    const socket = await connect(cfg.host, cfg.port, cfg.secure);
    smtp = new SmtpSession(socket);

    const greeting = await smtp.read();
    if (greeting.code !== 220) throw new Error(`SMTP chào không hợp lệ: ${greeting.text}`);

    await smtp.command('EHLO webdownload.local', [250]);

    if (!cfg.secure) {
      await smtp.upgrade();
      await smtp.command('EHLO webdownload.local', [250]);
    }

    await smtp.command('AUTH LOGIN', [334]);
    await smtp.command(Buffer.from(cfg.user, 'utf8').toString('base64'), [334]);
    await smtp.command(Buffer.from(cfg.pass, 'utf8').toString('base64'), [235]);

    await smtp.command(`MAIL FROM:<${extractAddress(cfg.from)}>`, [250]);
    await smtp.command(`RCPT TO:<${extractAddress(to)}>`, [250, 251]);
    await smtp.command('DATA', [354]);

    const message = buildMessage({ from: cfg.from, to, subject, text, html });
    smtp.socket.write(`${message}\r\n.\r\n`);
    const done = await smtp.read();
    if (done.code !== 250) throw new Error(`SMTP gửi thất bại: ${done.text}`);

    smtp.close();
    return { ok: true };
  };

  try {
    return await Promise.race([
      run(),
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('Gửi email quá thời gian chờ')), timeout);
        if (timer.unref) timer.unref();
      }),
    ]);
  } catch (err) {
    if (smtp) smtp.close();
    const detail = [err.code, err.message].filter(Boolean).join(' ');
    return { ok: false, reason: 'error', error: detail || 'lỗi không xác định' };
  }
}

function extractAddress(value) {
  const m = String(value).match(/<([^>]+)>/);
  return m ? m[1] : String(value).trim();
}

// ---------------------------------------------------------------------------
// Template email
// ---------------------------------------------------------------------------

function otpEmailTemplate({ code, email, minutes = 10, ip, requestedAt, resetUrl }) {
  const subject = `Mã xác minh đặt lại mật khẩu: ${code}`;

  const text = [
    'WEB DOWNLOAD — ĐẶT LẠI MẬT KHẨU QUẢN TRỊ',
    '',
    `Mã xác minh của bạn: ${code}`,
    `Mã có hiệu lực trong ${minutes} phút.`,
    '',
    'Bôi đen mã bên trên rồi nhấn Ctrl+C (Command+C trên Mac) để sao chép.',
    '',
    resetUrl ? `Hoặc mở liên kết này để hệ thống tự điền và sao chép mã: ${resetUrl}` : '',
    '',
    `Tài khoản: ${email}`,
    ip ? `IP yêu cầu: ${ip}` : '',
    requestedAt ? `Thời điểm: ${requestedAt}` : '',
    '',
    'Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.',
    'Không chia sẻ mã này với bất kỳ ai.',
  ].filter((line) => line !== '').join('\n');

  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
        <tr><td style="height:4px;background:linear-gradient(90deg,#1677ff,#6c8cff);font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:34px 36px 8px;">
          <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#1677ff;font-weight:600;">Web Download</div>
          <h1 style="margin:12px 0 8px;font-size:22px;line-height:1.35;color:#111827;">Đặt lại mật khẩu quản trị</h1>
          <p style="margin:0;font-size:14.5px;line-height:1.65;color:#6b7280;">Bôi đen mã bên dưới rồi nhấn Ctrl+C, hoặc bấm nút <strong style="color:#374151;">Mở trang &amp; tự điền mã</strong> để hệ thống tự điền và sao chép sẵn.</p>
        </td></tr>
        <tr><td style="padding:26px 36px 0;" align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr><td align="center" style="background:#f3f6fb;border:1px solid #dbe4f0;border-radius:14px;padding:18px 32px;">
              <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#8894a8;font-weight:600;padding-bottom:8px;">Mã xác minh</div>
              <div style="font-family:'Courier New',Courier,monospace;font-size:34px;line-height:1.15;font-weight:700;color:#0f172a;letter-spacing:9px;text-indent:9px;-webkit-user-select:all;-moz-user-select:all;-ms-user-select:all;user-select:all;white-space:nowrap;">${escapeHtml(code)}</div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:14px 36px 0;" align="center">
          <div style="display:inline-block;padding:7px 14px;border-radius:999px;background:#fff7e6;border:1px solid #ffe1a8;color:#b45309;font-size:12.5px;font-weight:600;">Mã hết hạn sau ${minutes} phút</div>
        </td></tr>
        ${resetUrl ? `<tr><td style="padding:22px 36px 0;" align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr><td align="center" style="background:#1677ff;border-radius:10px;">
              <a href="${escapeHtml(resetUrl)}" target="_blank" style="display:inline-block;padding:13px 28px;font-size:14.5px;font-weight:600;color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">Mở trang &amp; tự điền mã</a>
            </td></tr>
          </table>
        </td></tr>` : ''}
        <tr><td style="padding:24px 36px 30px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #eef0f3;border-radius:12px;">
            <tr><td style="padding:16px 18px;font-size:13px;color:#6b7280;line-height:1.9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
              <strong style="color:#374151;">Tài khoản:</strong> ${escapeHtml(email)}<br>
              ${ip ? `<strong style="color:#374151;">IP yêu cầu:</strong> ${escapeHtml(ip)}<br>` : ''}
              ${requestedAt ? `<strong style="color:#374151;">Thời điểm:</strong> ${escapeHtml(requestedAt)}` : ''}
            </td></tr>
          </table>
          <p style="margin:20px 0 0;font-size:12.5px;line-height:1.7;color:#9ca3af;">Nhấn giữ (trên điện thoại) hoặc bôi đen mã để sao chép. Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.</p>
        </td></tr>
        <tr><td style="padding:16px 36px 24px;border-top:1px solid #f1f2f4;">
          <p style="margin:0;font-size:11.5px;color:#b0b5bd;">Email tự động, vui lòng không trả lời.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, text, html };
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendMail, isConfigured, smtpConfig, otpEmailTemplate };
