'use strict';

// Tự khôi phục file đang phát hành sau khi ổ đĩa tạm bị xoá.
//
// Vì sao cần: trên các host miễn phí (Render free, v.v.) ổ đĩa là TẠM — mọi
// file upload sẽ mất khi server khởi động lại hoặc bị "ngủ".
//
// Có 2 nguồn khôi phục, tự chọn theo cấu hình:
//   1. GitHub Release riêng của web (lib/release.js) — file upload mới nhất,
//      tự đẩy lên sau mỗi lần admin upload. Đây là cách dùng bình thường.
//   2. RESTORE_ZIP_URL — URL cố định bên ngoài (.zip/.rar/.exe/.msi), nếu có đặt.
//
// Server tự khôi phục khi:
//   - khởi động mà chưa có file,
//   - admin mở trang quản trị mà file đã mất,
//   - có khách vào trang chủ / bấm tải mà file đã mất.
//
// Xoá file có chủ đích trong trang admin thì KHÔNG tự khôi phục lại.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const release = require('./release');

const MAX_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 500) * 1024 * 1024;
const TIMEOUT_MS = 60000;

// Tránh gọi liên tục khi URL lỗi: nghỉ 5 phút giữa hai lần thử.
const RETRY_COOLDOWN_MS = 5 * 60 * 1000;

let lastAttempt = 0;
let lastError = '';
let inflight = null;
let lastResult = null; // { restored, reason, size, at }

// Cache thông tin link tải trực tiếp trên release (xem downloadTarget()).
const TARGET_TTL_MS = 30 * 1000;
// Kết quả "chưa có file" chỉ giữ 5 giây: vừa upload xong mà GitHub chưa cập nhật
// danh sách asset thì lượt tải kế tiếp phải thử lại ngay, không chờ 30 giây.
const TARGET_MISS_TTL_MS = 5 * 1000;
// Khi đã biết link tốt mà GitHub API tạm lỗi, vẫn dùng link cũ trong 10 phút.
// Nếu không, một lần GitHub chập chờn sẽ đẩy khách về chế độ tải cả file qua
// Render — đúng thứ kiến trúc này muốn tránh.
const TARGET_STALE_MS = 10 * 60 * 1000;
let targetCache = null; // { value, at }
let targetInflight = null;

function url() {
  return String(process.env.RESTORE_ZIP_URL || '').trim();
}

function isConfigured() {
  return Boolean(url()) || release.isConfigured();
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
    const ext = (fileNameFromUrl(srcUrl).match(/\.(zip|rar|exe|msi)$/i) || ['', '.zip'])[1].toLowerCase();
    const headOk = ext === '.zip'
      ? buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b
      : ext === '.rar'
        ? buf.length >= 7 && buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72 && buf[3] === 0x21 && buf[4] === 0x1a && buf[5] === 0x07
        : buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a;
    if (!headOk) throw new Error(`Nội dung tải về không khớp định dạng ${ext}`);

    await fsp.writeFile(destPath, buf);
    return buf.length;
  } finally {
    clearTimeout(timer);
  }
}

async function doRestore(store) {
  const tempPath = path.join(store.TEMP_DIR, `restore-${Date.now()}.part`);

  // Ưu tiên release riêng của web (file upload mới nhất), sau đó mới tới URL cố định.
  if (release.isConfigured()) {
    try {
      const found = await release.fetchPublished(tempPath);
      if (found) {
        const meta = await store.replace({
          tempPath,
          originalName: found.name,
          size: found.size,
        });
        return { restored: true, size: meta.size, source: 'release', at: Date.now() };
      }
      await fsp.unlink(tempPath).catch(() => {});
      // Đã cấu hình release nhưng trên release chưa có file: không rơi xuống
      // nhánh RESTORE_ZIP_URL (thường để trống) để tránh lỗi "Failed to parse URL".
      return { restored: false, reason: 'release_empty', at: Date.now() };
    } catch (err) {
      await fsp.unlink(tempPath).catch(() => {});
      lastError = err && err.message ? err.message : String(err);
      return { restored: false, reason: lastError, at: Date.now() };
    }
  }

  if (!isConfigured()) {
    return { restored: false, reason: release.isConfigured() ? (lastError || 'release_empty') : 'disabled' };
  }

  const srcUrl = url();
  if (!srcUrl) {
    return { restored: false, reason: 'not_configured', at: Date.now() };
  }
  try {
    const size = await downloadTo(srcUrl, tempPath);
    const meta = await store.replace({
      tempPath,
      originalName: fileNameFromUrl(srcUrl),
      size,
    });
    return { restored: true, size: meta.size, source: 'url', at: Date.now() };
  } catch (err) {
    await fsp.unlink(tempPath).catch(() => {});
    lastError = err && err.message ? err.message : String(err);
    return { restored: false, reason: lastError, at: Date.now() };
  }
}

/**
 * Thông tin để chuyển khách sang tải trực tiếp trên GitHub Release.
 * CHỈ đọc metadata (vài trăm byte) — không tải nội dung file về máy chủ.
 *
 * Trả null khi: chưa cấu hình release, release trống, hoặc repo riêng tư
 * (repo riêng tư thì link GitHub không dùng được cho khách vô danh).
 *
 * @returns {Promise<{name:string,size:number,checksum:string|null,
 *                    updatedAt:number,url:string}|null>}
 */
async function downloadTarget() {
  if (!release.isConfigured()) return null;

  // Kết quả cũ vô hiệu ngay khi admin vừa đẩy/xoá file (release.version()).
  // Reuse trong 30 giây: trang chủ + mỗi lượt tải đều gọi hàm này.
  // Riêng kết quả "chưa có file" thì chỉ giữ vài giây.
  if (targetCache) {
    const stale = targetCache.version !== release.version();
    const ttl = targetCache.value ? TARGET_TTL_MS : TARGET_MISS_TTL_MS;
    if (!stale && Date.now() - targetCache.at < ttl) return targetCache.value;
  }

  if (targetInflight) return targetInflight;

  targetInflight = (async () => {
    try {
      const asset = await release.publishedAsset();
      const value = asset && asset.url ? asset : null;
      targetCache = { value, at: Date.now(), version: release.version() };
      return value;
    } catch (err) {
      lastError = err && err.message ? err.message : String(err);
      // GitHub API lỗi tạm thời -> vẫn dùng link tốt gần nhất nếu còn mới.
      // Nhờ vậy khách không bị đẩy sang chế độ tải cả file qua Render.
      if (targetCache && targetCache.value && Date.now() - targetCache.at < TARGET_STALE_MS) {
        // Đẩy mốc thời gian lên để không gọi lại GitHub quá dày khi đang lỗi.
        targetCache.at = Date.now();
        return targetCache.value;
      }
      targetCache = { value: null, at: Date.now(), version: release.version() };
      return null;
    }
  })().finally(() => { targetInflight = null; });

  return targetInflight;
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

// Gọi sau khi admin upload/xoá file để lần tải kế tiếp đọc metadata mới.
function clearTargetCache() {
  targetCache = null;
  targetInflight = null;
}

function status() {
  const viaRelease = release.isConfigured();
  const rel = release.status();
  return {
    configured: isConfigured(),
    viaRelease,
    viaUrl: Boolean(url()),
    repo: rel.repo,
    tag: rel.tag,
    url: url(),
    fileName: viaRelease ? 'file trên release' : (url() ? fileNameFromUrl(url()) : ''),
    lastResult,
    // Ưu tiên lỗi của lần đọc release gần nhất: đó mới là lý do khôi phục hỏng.
    lastError: lastError || rel.lastError || '',
  };
}

module.exports = { restoreIfEmpty, ensureFile, downloadTarget, clearTargetCache, isConfigured, status };
