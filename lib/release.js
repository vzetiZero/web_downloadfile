'use strict';

// Tự đẩy file phát hành lên GitHub Release để không mất khi Render khởi động lại.
//
// Vì sao cần: Render free dùng ổ đĩa TẠM — file upload mất sau mỗi lần restart
// hoặc khi service "ngủ". Nếu chỉ dùng RESTORE_ZIP_URL thì mỗi lần đổi file lại
// phải sửa biến môi trường. Module này giải quyết bằng một Release cố định:
//   - ĐẨY LÊN sau mỗi lần admin upload
//   - KÉO VỀ khi khởi động / mở trang admin / có khách tải mà file đã mất
//
// Cấu hình (Environment của Render):
//   GITHUB_TOKEN        token có quyền ghi vào repo (classic: scope "repo",
//                       fine-grained: Contents = Read and write)
//   GITHUB_REPO         "chu-so-huu/ten-repo", ví dụ vzetiZero/web_downloadfile
//   GITHUB_RELEASE_TAG  (tuỳ chọn) mặc định "published-file"
//
// Không đặt GITHUB_TOKEN + GITHUB_REPO thì tính năng tắt hoàn toàn.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const crypto = require('crypto');

const META_ASSET = 'release-meta.json';
const MAX_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 500) * 1024 * 1024;

function log(...args) {
  console.log('[release]', ...args);
}

function token() {
  return String(process.env.GITHUB_TOKEN || '').trim();
}

function repo() {
  return String(process.env.GITHUB_REPO || '').trim();
}

function tag() {
  return String(process.env.GITHUB_RELEASE_TAG || 'published-file').trim();
}

function apiBase() {
  const custom = String(process.env.GITHUB_API_BASE || '').trim();
  return (custom || 'https://api.github.com').replace(/\/+$/, '');
}

// GitHub BẮT BUỘC upload asset qua uploads.github.com. Gọi api.github.com cho
// endpoint này sẽ luôn trả 404 "Not Found" dù token hợp lệ và có quyền.
// Chỉ khi trỏ vào server giả lập (GITHUB_API_BASE) mới dùng chung một host.
function uploadBase() {
  const custom = String(process.env.GITHUB_API_BASE || '').trim();
  return (custom || 'https://uploads.github.com').replace(/\/+$/, '');
}

function isConfigured() {
  return Boolean(token() && repo());
}

function headers(extra = {}) {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'webdownload-release/1.0',
    authorization: `Bearer ${token()}`,
    ...extra,
  };
}

async function api(url, options = {}, timeoutMs = 30000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

function repoUrl(suffix) {
  return `${apiBase()}/repos/${repo()}${suffix}`;
}

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

async function getRelease() {
  const res = await api(repoUrl(`/releases/tags/${encodeURIComponent(tag())}`));
  if (res.status === 404) return null;
  if (res.status === 401) throw new Error('GITHUB_TOKEN không hợp lệ');
  if (res.status === 403) throw new Error('GITHUB_TOKEN thiếu quyền ghi vào repo');
  if (!res.ok) throw new Error(`Không đọc được release (HTTP ${res.status})`);
  return res.json();
}

async function ensureRelease() {
  const found = await getRelease();
  if (found) return found;

  const res = await api(repoUrl('/releases'), {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      tag_name: tag(),
      name: 'File phát hành (tự động)',
      body: 'File do web-download tự đẩy lên để không mất khi máy chủ khởi động lại. Đừng xoá release này.',
      draft: false,
      prerelease: false,
    }),
  });

  if (res.status === 422) {
    const again = await getRelease();
    if (again) return again;
  }
  if (res.status === 401) throw new Error('GITHUB_TOKEN không hợp lệ');
  if (res.status === 403 || res.status === 404) {
    throw new Error('GITHUB_TOKEN thiếu quyền ghi vào repo (cần "Contents: Read and write")');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Không tạo được release (HTTP ${res.status}) ${detail.slice(0, 160)}`);
  }
  const created = await res.json();
  log(`Đã tạo release "${tag()}" để lưu file phát hành`);
  return created;
}

async function deleteAsset(id) {
  const res = await api(repoUrl(`/releases/assets/${id}`), { method: 'DELETE', headers: headers() });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Không xoá được asset cũ (HTTP ${res.status})`);
  }
}

async function uploadFile(releaseId, name, filePath, size) {
  const stream = fs.createReadStream(filePath);
  const res = await api(
    `${uploadBase()}/repos/${repo()}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: headers({
        'content-type': 'application/octet-stream',
        'content-length': String(size),
      }),
      body: Readable.toWeb(stream),
      duplex: 'half',
    },
    10 * 60 * 1000,
  );

  stream.destroy();
  if (res.status === 401) throw new Error('GITHUB_TOKEN không hợp lệ');
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Không tải được "${name}" lên release (HTTP ${res.status}) ${detail.slice(0, 160)}`);
  }
  return res.json();
}

async function uploadText(releaseId, name, text) {
  const res = await api(
    `${uploadBase()}/repos/${repo()}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: headers({
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(text)),
      }),
      body: text,
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Không tải được "${name}" (HTTP ${res.status}) ${detail.slice(0, 160)}`);
  }
  return res.json();
}

/**
 * Đẩy file hiện tại lên release, thay toàn bộ asset cũ.
 * @param {{ filePath: string, name: string, size: number, checksum?: string, updatedAt?: number }} input
 */
async function publish({ filePath, name, size, checksum, updatedAt }) {
  if (!isConfigured()) return { pushed: false, reason: 'disabled' };
  if (!size) return { pushed: false, reason: 'empty' };
  if (size > MAX_BYTES) return { pushed: false, reason: 'too_large' };

  try {
    const release = await ensureRelease();

    // Xoá sạch asset cũ để tên file không bị trùng.
    const assets = Array.isArray(release.assets) ? release.assets : [];
    for (const asset of assets) {
      await deleteAsset(asset.id);
    }

    const meta = {
      name,
      size,
      checksum: checksum || null,
      updatedAt: updatedAt || Date.now(),
    };
    await uploadText(release.id, META_ASSET, JSON.stringify(meta, null, 2));
    await uploadFile(release.id, name, filePath, size);

    log(`Đã đẩy "${name}" (${size} byte) lên release "${tag()}"`);
    return { pushed: true, tag: tag(), name, size };
  } catch (err) {
    const reason = err && err.message ? err.message : String(err);
    log(`Chưa đẩy được file lên release: ${reason}`);
    return { pushed: false, reason };
  }
}

// ---------------------------------------------------------------------------
// Kéo về
// ---------------------------------------------------------------------------

async function downloadAsset(assetId, destPath) {
  const res = await api(
    repoUrl(`/releases/assets/${assetId}`),
    { headers: headers({ accept: 'application/octet-stream' }), redirect: 'follow' },
    10 * 60 * 1000,
  );
  if (!res.ok) throw new Error(`Không tải được file từ release (HTTP ${res.status})`);
  if (!res.body) throw new Error('Release không trả về nội dung');

  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destPath));
  return (await fsp.stat(destPath)).size;
}

async function downloadAssetText(assetId) {
  const res = await api(
    repoUrl(`/releases/assets/${assetId}`),
    { headers: headers({ accept: 'application/octet-stream' }), redirect: 'follow' },
  );
  if (!res.ok) throw new Error(`Không đọc được thông tin release (HTTP ${res.status})`);
  return res.text();
}

/**
 * Tải file đã đẩy lên release về đĩa.
 * @param {string} destPath
 * @returns {Promise<{name:string,size:number,checksum?:string,updatedAt?:number}|null>}
 *          null khi chưa có gì trên release.
 */
async function fetchPublished(destPath) {
  if (!isConfigured()) return null;

  const release = await getRelease();
  if (!release) return null;

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const metaAsset = assets.find((a) => a && a.name === META_ASSET);
  if (!metaAsset) return null;

  let meta;
  try {
    meta = JSON.parse(await downloadAssetText(metaAsset.id));
  } catch {
    return null;
  }
  if (!meta || !meta.name) return null;

  const dataAsset = assets.find((a) => a && a.name === meta.name);
  if (!dataAsset) {
    throw new Error(`Release có thông tin nhưng thiếu file "${meta.name}"`);
  }

  const size = await downloadAsset(dataAsset.id, destPath);
  if (!size) throw new Error('File tải từ release rỗng');

  if (meta.checksum) {
    const hash = crypto.createHash('sha256');
    await pipeline(fs.createReadStream(destPath), hash);
    const got = hash.digest('hex');
    if (got !== meta.checksum) {
      throw new Error('File tải từ release không khớp checksum');
    }
  }

  return { name: meta.name, size, checksum: meta.checksum, updatedAt: meta.updatedAt };
}

/**
 * Xoá toàn bộ asset trên release (dùng khi admin xoá file phát hành).
 */
async function clearRelease() {
  if (!isConfigured()) return { cleared: false, reason: 'disabled' };
  try {
    const found = await getRelease();
    if (!found) return { cleared: true, reason: 'no_release' };
    const assets = Array.isArray(found.assets) ? found.assets : [];
    for (const asset of assets) {
      await deleteAsset(asset.id);
    }
    log('Đã xoá file trên release theo yêu cầu của admin');
    return { cleared: true };
  } catch (err) {
    return { cleared: false, reason: err && err.message ? err.message : String(err) };
  }
}

function status() {
  return { configured: isConfigured(), repo: repo(), tag: tag() };
}

module.exports = { isConfigured, pushRelease: publish, fetchPublished, clearRelease, status };
