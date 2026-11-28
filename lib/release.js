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

// Dịch phản hồi lỗi của GitHub thành câu dễ hiểu. Quan trọng: 403 KHÔNG chỉ có
// nghĩa "thiếu quyền" — GitHub còn trả 403 khi hết hạn mức request, và bản thân
// token đúng vẫn bị chặn nếu gọi API mà QUÊN gửi kèm token.
async function explainFailure(res, action) {
  const detail = await res.text().catch(() => '');
  const json = (() => { try { return JSON.parse(detail); } catch { return {}; } })();
  const message = String(json.message || '');
  const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
  const waitMin = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60000)) : 0;

  if (res.status === 401) return 'GITHUB_TOKEN không hợp lệ hoặc đã hết hạn';

  if (res.status === 403 && /rate limit/i.test(message)) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    return `GitHub tạm giới hạn số lần gọi API (còn ${remaining == null ? '?' : remaining} lượt)`
      + (waitMin ? `, thử lại sau khoảng ${waitMin} phút` : '');
  }
  if (res.status === 403) {
    return `GITHUB_TOKEN không đủ quyền để ${action} (cần "Contents: Read and write")`;
  }
  if (res.status === 404) {
    return `Không tìm thấy repo hoặc release (kiểm tra GITHUB_REPO, và quyền của token)`;
  }
  if (res.status === 422) {
    return `GitHub từ chối yêu cầu (HTTP 422) ${message.slice(0, 140)}`.trim();
  }
  return `Không ${action} được (HTTP ${res.status}) ${message.slice(0, 140)}`.trim();
}

async function getRelease() {
  const res = await api(repoUrl(`/releases/tags/${encodeURIComponent(tag())}`), { headers: headers() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await explainFailure(res, 'đọc release'));
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
  if (!res.ok) throw new Error(await explainFailure(res, 'tạo release'));
  const created = await res.json();
  log(`Đã tạo release "${tag()}" để lưu file phát hành`);
  return created;
}

async function deleteAsset(id) {
  const res = await api(repoUrl(`/releases/assets/${id}`), { method: 'DELETE', headers: headers() });
  if (!res.ok && res.status !== 404) {
    throw new Error(await explainFailure(res, 'xoá asset cũ'));
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
  if (!res.ok) throw new Error(await explainFailure(res, `đẩy "${name}" lên release`));
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
  if (!res.ok) throw new Error(await explainFailure(res, `đẩy "${name}" lên release`));
  return res.json();
}

/**
 * Đẩy file hiện tại lên release, thay asset cũ.
 *
 * Các lần đẩy được XẾP HÀNG: bấm upload hai lần liên tiếp mà chạy song song sẽ
 * đụng nhau ở asset "release-meta.json" (GitHub trả 422 vì trùng tên) và để lại
 * file cũ trên release.
 *
 * @param {{ filePath: string, name: string, size: number, checksum?: string, updatedAt?: number }} input
 */
function publish(input) {
  const run = pushQueue.then(() => publishNow(input));
  // Nuốt lỗi trong chuỗi để một lần hỏng không chặn các lần sau.
  pushQueue = run.catch(() => {});
  return run;
}

let pushQueue = Promise.resolve();

async function publishNow({ filePath, name, size, checksum, updatedAt }) {
  if (!isConfigured()) return { pushed: false, reason: 'disabled' };
  if (!size) return { pushed: false, reason: 'empty' };
  if (size > MAX_BYTES) return { pushed: false, reason: 'too_large' };

  try {
    const release = await ensureRelease();
    const assets = (Array.isArray(release.assets) ? release.assets : []).filter(Boolean);

    // GitHub không cho hai asset cùng tên -> xoá bản trùng tên trước khi upload.
    for (const asset of assets.filter((a) => a.name === name)) {
      await deleteAsset(asset.id);
    }

    // Upload file mới trước: khách chỉ được chuyển sang link mới khi file mới đã
    // thật sự nằm trên release. Metadata cũ để nguyên cho tới bước sau, nên nếu
    // upload hỏng thì bản cũ vẫn tải được bình thường.
    const upload = await uploadFile(release.id, name, filePath, size);
    const direct = await isRepoPublic();

    // Tăng phiên bản TRƯỚC khi ghi nhớ để lớp cache bên ngoài thấy thay đổi.
    assetVersion += 1;
    lastPublishAt = Date.now();
    rememberAsset({
      name,
      size,
      checksum: checksum || null,
      updatedAt: updatedAt || Date.now(),
      url: direct
        ? (upload.browser_download_url
          || `https://github.com/${repo()}/releases/download/${encodeURIComponent(tag())}/${encodeURIComponent(name)}`)
        : null,
    });

    // File mới đã an toàn -> giờ mới thay metadata (phải xoá bản cũ vì trùng tên).
    for (const asset of assets.filter((a) => a.name === META_ASSET)) {
      await deleteAsset(asset.id);
    }
    const meta = {
      name,
      size,
      checksum: checksum || null,
      updatedAt: updatedAt || Date.now(),
    };
    await uploadText(release.id, META_ASSET, JSON.stringify(meta, null, 2));

    // Cuối cùng mới dọn các bản cũ khác tên.
    const keep = new Set([name, META_ASSET]);
    for (const asset of assets) {
      if (keep.has(asset.name)) continue;
      await deleteAsset(asset.id).catch(() => {});
    }

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
  if (!res.ok) throw new Error(await explainFailure(res, 'tải file từ release'));
  if (!res.body) throw new Error('Release không trả về nội dung');

  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destPath));
  return (await fsp.stat(destPath)).size;
}

async function downloadAssetText(assetId) {
  const res = await api(
    repoUrl(`/releases/assets/${assetId}`),
    { headers: headers({ accept: 'application/octet-stream' }), redirect: 'follow' },
  );
  if (!res.ok) throw new Error(await explainFailure(res, 'đọc thông tin release'));
  return res.text();
}

// ---------------------------------------------------------------------------
// Đọc thông tin file trên release mà KHÔNG tải nội dung về
// ---------------------------------------------------------------------------

// Repo công khai thì link tải của GitHub dùng được cho khách vô danh.
// Repo riêng tư thì phải proxy qua máy chủ (tốn băng thông), nên phải biết
// trước. Cache 10 phút để không gọi API mỗi lượt tải.
let repoVisibility = { private: null, at: 0 };

async function isRepoPublic() {
  const cached = repoVisibility;
  if (cached.private !== null && Date.now() - cached.at < 10 * 60 * 1000) {
    return !cached.private;
  }
  try {
    // Phải gửi token: gọi vô danh chỉ được 60 request/giờ (dùng chung IP của
    // nhà cung cấp hosting) nên rất dễ bị 403 oan.
    const res = await api(repoUrl(''), { headers: headers() });
    if (!res.ok) return cached.private !== null ? !cached.private : true;
    const data = await res.json();
    repoVisibility = { private: Boolean(data.private), at: Date.now() };
    return !data.private;
  } catch {
    // Không kiểm tra được thì giữ kết quả cũ; chưa từng biết thì mặc định coi
    // là công khai (link GitHub vẫn tải được nếu repo thật sự công khai).
    return cached.private !== null ? !cached.private : true;
  }
}

// GitHub cập nhật danh sách asset của release không đồng bộ: ngay sau khi
// upload, `releases/tags/...` có thể vẫn trả về asset CŨ (hoặc rỗng) trong vài
// giây. Vì vậy chỉ trong ~1 phút sau khi đẩy file mới thử lại vài lần; ngoài
// khoảng đó thì đọc một lần để trang không bị chậm.
const MISS_RETRY_DELAYS_MS = [400, 1000, 2000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Link tốt gần nhất: dùng lại khi GitHub API đang lỗi/chậm để khách không bị
// đẩy sang tải file qua Render.
const ASSET_MEMO_MS = 10 * 60 * 1000;
// Ngay sau khi đẩy file, dùng luôn thông tin vừa có — không cần chờ GitHub
// cập nhật danh sách asset (nó trễ vài giây và sẽ trả về bản CŨ).
const ASSET_MEMO_FRESH_MS = 60 * 1000;
let assetMemo = null; // { value, at, version }
let lastPublishAt = 0;
let lastReadError = '';
// Tăng mỗi lần đẩy/xoá file. Lớp cache bên ngoài so sánh số này để biết phải
// bỏ kết quả cũ ngay, không phải chờ hết hạn cache.
let assetVersion = 0;

function version() {
  return assetVersion;
}

function rememberAsset(value) {
  if (value && value.url) assetMemo = { value, at: Date.now(), version: assetVersion };
  else if (!value) assetMemo = null;
  return value;
}

/**
 * Thông tin file đang phát hành trên release — chỉ vài trăm byte metadata,
 * KHÔNG tải file về máy chủ.
 *
 * `url` là link tải trực tiếp trên GitHub (chỉ có khi repo công khai).
 * `url` = null nghĩa là phải proxy qua máy chủ.
 *
 * @returns {Promise<{name:string,size:number,checksum:string|null,
 *                    updatedAt:number,url:string|null}|null>}
 */
async function publishedAsset() {
  if (!isConfigured()) return null;

  // Vừa đẩy file xong: thông tin này CHÍNH XÁC hơn API (API còn trả bản cũ),
  // nên trả ngay để khách nhận đúng file mới, không chờ, không sai tên.
  if (assetMemo
    && assetMemo.version === assetVersion
    && Date.now() - assetMemo.at < ASSET_MEMO_FRESH_MS) {
    return assetMemo.value;
  }

  // Sau đó, trong ~1 phút kể từ lần đẩy cuối, vẫn thử lại vài lần vì GitHub có
  // thể chưa cập nhật danh sách asset.
  const fresh = lastPublishAt && Date.now() - lastPublishAt < 60 * 1000;
  const delays = fresh ? MISS_RETRY_DELAYS_MS : [];

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    let value = null;
    try {
      value = await readAssetOnce();
    } catch (err) {
      // Lỗi tạm thời (mạng, hạn mức API). Ghi lại rồi thử lần sau / dùng memo.
      lastReadError = err && err.message ? err.message : String(err);
    }
    if (value) return rememberAsset(value);
    if (attempt < delays.length) await sleep(delays[attempt]);
  }

  // Không đọc được lần này. Nếu vừa có link tốt thì vẫn dùng (GitHub chập chờn).
  if (assetMemo && Date.now() - assetMemo.at < ASSET_MEMO_MS) return assetMemo.value;
  return null;
}

async function readAssetOnce() {
  const rel = await getRelease();
  if (!rel) return null;

  const assets = Array.isArray(rel.assets) ? rel.assets : [];
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
  if (!dataAsset) return null;

  const direct = await isRepoPublic();
  return {
    name: meta.name,
    size: Number(meta.size) || Number(dataAsset.size) || 0,
    checksum: meta.checksum || null,
    updatedAt: Number(meta.updatedAt) || 0,
    url: direct
      ? (dataAsset.browser_download_url
        || `https://github.com/${repo()}/releases/download/${encodeURIComponent(tag())}/${encodeURIComponent(meta.name)}`)
      : null,
  };
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
    assetMemo = null;
    assetVersion += 1;
    return { cleared: true };
  } catch (err) {
    return { cleared: false, reason: err && err.message ? err.message : String(err) };
  }
}

function status() {
  return {
    configured: isConfigured(),
    repo: repo(),
    tag: tag(),
    lastError: lastReadError,
  };
}

module.exports = {
  isConfigured,
  pushRelease: publish,
  fetchPublished,
  publishedAsset,
  version,
  clearRelease,
  status,
};
