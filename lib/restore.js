'use strict';

// Tự khôi phục file đang phát hành từ một URL cố định.
//
// Vì sao cần: trên các host miễn phí (Render free, v.v.) ổ đĩa là TẠM — mọi
// file upload sẽ mất khi server khởi động lại hoặc bị "ngủ".
//
// Đặt biến môi trường RESTORE_ZIP_URL trỏ tới một file công khai cố định
// (GitHub Release asset, R2 public link, Drive direct link, v.v.), file có thể
// là .zip, .exe hoặc .msi. Server sẽ tự tải lại khi:
//   - khởi động mà chưa có file,
//   - admin mở trang quản trị mà file đã mất,
//   - có khách vào trang chủ / bấm tải mà file đã mất.
//
// Xoá file có chủ đích trong trang admin thì KHÔNG tự khôi phục lại.
// Để trống biến này thì tính năng bị bỏ qua hoàn toàn.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const MAX_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 500) * 1024 * 1024;
const TIMEOUT_MS = 60000;

// Tránh gọi liên tục khi URL lỗi: nghỉ 5 phút giữa hai lần thử.
const RETRY_COOLDOWN_MS = 5 * 60 * 1000;

let lastAttempt = 0;
let lastError = '';
let inflight = null;
let lastResult = null; // { restored, reason, size, at }

function url() {
  return String(process.env.RESTORE_ZIP_URL || '').trim();
}

function isConfigured() {
  return Boolean(url());
}

function fileNameFromUrl(raw) {
  try {
    const clean = String(raw).split('#')[0].split('?')[0];
    const base = decodeURIComponent(clean.split('/').pop() || '');
    return base || 'tai-lieu.zip';
  } catch {
    return 'tai-lieu.zip';
  }
}

async function downloadTo(srcUrl, destPath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(srcUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'webdownload-restore/1.0' },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > MAX_BYTES) throw new Error(`File quá lớn (${len} bytes)`);

    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > MAX_BYTES) throw new Error('File vượt quá giới hạn cho phép');
      chunks.push(chunk);
    }

    const buf = Buffer.concat(chunks);
    const ext = (fileNameFromUrl(srcUrl).match(/\.(zip|exe|msi)$/i) || ['', '.zip'])[1].toLowerCase();
    const headOk = ext === '.zip'
      ? buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b
      : buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a;
    if (!headOk) throw new Error(`Nội dung tải về không khớp định dạng ${ext}`);

    await fsp.writeFile(destPath, buf);
    return buf.length;
  } finally {
    clearTimeout(timer);
  }
}

async function doRestore(store) {
  const srcUrl = url();
  const tempPath = path.join(store.TEMP_DIR, `restore-${Date.now()}.part`);

  try {
    const size = await downloadTo(srcUrl, tempPath);
    const meta = await store.replace({
      tempPath,
      originalName: fileNameFromUrl(srcUrl),
      size,
    });
    return { restored: true, size: meta.size, at: Date.now() };
  } catch (err) {
    await fsp.unlink(tempPath).catch(() => {});
    lastError = err && err.message ? err.message : String(err);
    return { restored: false, reason: lastError, at: Date.now() };
  }
}

/**
 * Bảo đảm đang có file phát hành. Gọi ở trang admin và trang khách.
 * Không ném lỗi, không chặn lâu: nếu đang có file thì trả về ngay.
 *
 * @param {object} store
 * @param {{ force?: boolean }} [options] force = bỏ qua cooldown
 * @returns {Promise<{restored:boolean, reason?:string, size?:number}>}
 */
async function ensureFile(store, options = {}) {
  if (!isConfigured()) return { restored: false, reason: 'disabled' };

  // Đang có file thật thì không làm gì (trường hợp bình thường, rất nhanh).
  if (await store.hasPublishedFile()) return { restored: false, reason: 'already_present' };

  // Admin đã xoá có chủ đích (file.json ghi id = null) -> không tự khôi phục.
  // Còn nếu file.json vẫn trỏ tới một file mà file đó biến mất thì đó là do
  // ổ đĩa tạm bị xoá -> phải khôi phục.
  const meta = await store.readMeta();
  if (meta && !meta.id) return { restored: false, reason: 'explicitly_empty' };

  if (inflight) return inflight;

  if (!options.force && lastAttempt && Date.now() - lastAttempt < RETRY_COOLDOWN_MS) {
    return { restored: false, reason: lastError || 'cooldown' };
  }

  lastAttempt = Date.now();
  inflight = doRestore(store).then((result) => {
    lastResult = result;
    if (result.restored) {
      lastError = '';
      lastAttempt = 0; // thành công thì lần mất file sau vẫn khôi phục ngay
    }
    return result;
  }).finally(() => {
    inflight = null;
  });

  return inflight;
}

/**
 * Chạy lúc khởi động server.
 * @param {object} store
 */
async function restoreIfEmpty(store) {
  const result = await ensureFile(store, { force: true });
  if (result.restored) lastAttempt = 0;
  return result;
}

function status() {
  return {
    configured: isConfigured(),
    url: url(),
    fileName: isConfigured() ? fileNameFromUrl(url()) : '',
    lastResult,
    lastError,
  };
}

module.exports = { restoreIfEmpty, ensureFile, isConfigured, status };
