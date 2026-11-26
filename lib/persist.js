'use strict';

// Đồng bộ cấu hình thông báo qua nơi lưu bền (GitHub Gist hoặc URL công khai).
//
// Vì sao cần: Render free dùng ổ đĩa TẠM, nên data/settings.json (câu admin nhập)
// sẽ mất mỗi lần service khởi động lại → quay về câu dịch mặc định.
// Module này giải quyết 2 chiều:
//   - KÉO VỀ lúc khởi động  (giống RESTORE_ZIP_URL của file ZIP)
//   - ĐẨY LÊN mỗi lần admin bấm "Lưu thông báo"
//
// Cấu hình (đặt trong Environment của Render):
//   GITHUB_TOKEN      token GitHub có quyền "gist"  → bật cả kéo về + đẩy lên
//   MESSAGES_GIST_ID  (tùy chọn) id gist có sẵn; bỏ trống thì tự tìm/tự tạo
//   RESTORE_MESSAGES_URL  (tùy chọn) URL JSON công khai, chỉ để kéo về
//
// Không đặt biến nào → tính năng tắt hoàn toàn, web chạy như cũ.

const GIST_DESCRIPTION = 'web-download: cau thong bao (tu dong dong bo)';
const GIST_FILENAME = 'settings.json';
const TIMEOUT_MS = 15000;
const MAX_BYTES = 64 * 1024;

// Cho phép đổi base API (GitHub Enterprise, hoặc server giả khi test).
function apiBase() {
  const custom = String(process.env.GITHUB_API_BASE || '').trim();
  return (custom || 'https://api.github.com').replace(/\/+$/, '');
}

function log(...args) {
  console.log('[sync]', ...args);
}

function githubToken() {
  return String(process.env.GITHUB_TOKEN || '').trim();
}

function configuredGistId() {
  return String(process.env.MESSAGES_GIST_ID || '').trim();
}

function publicUrl() {
  return String(process.env.RESTORE_MESSAGES_URL || '').trim();
}

// Đã bật ít nhất một kênh kéo về?
function isConfigured() {
  return Boolean(githubToken() || publicUrl());
}

// Chỉ có thể đẩy lên khi có token GitHub.
function canPush() {
  return Boolean(githubToken());
}

function headers(token) {
  const h = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'webdownload-sync/1.0',
  };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(res) {
  const len = Number(res.headers.get('content-length') || 0);
  if (len && len > MAX_BYTES) throw new Error(`Nội dung quá lớn (${len} bytes)`);

  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > MAX_BYTES) throw new Error('Nội dung vượt quá giới hạn cho phép');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ---------------------------------------------------------------------------
// Gist
// ---------------------------------------------------------------------------

// Tìm gist đã tạo trước đó theo mô tả (để không cần lưu id).
async function findGistId(token) {
  const res = await request(`${apiBase()}/gists?per_page=100`, { headers: headers(token) });
  if (!res.ok) {
    if (res.status === 401) throw new Error('GITHUB_TOKEN không hợp lệ');
    if (res.status === 403) throw new Error('GITHUB_TOKEN thiếu quyền "gist"');
    throw new Error(`Không liệt kê được gist (HTTP ${res.status})`);
  }
  const list = await res.json();
  if (!Array.isArray(list)) return '';
  const hit = list.find((g) => g && g.description === GIST_DESCRIPTION);
  return hit ? hit.id : '';
}

async function createGist(token, content) {
  const res = await request(`${apiBase()}/gists`, {
    method: 'POST',
    headers: { ...headers(token), 'content-type': 'application/json' },
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: { [GIST_FILENAME]: { content } },
    }),
  });
  if (!res.ok) throw new Error(`Không tạo được gist (HTTP ${res.status})`);
  const data = await res.json();
  log(`Đã tạo gist riêng tư ${data.id} để lưu câu thông báo`);
  return data.id;
}

// Tìm gist để dùng: id trong env → gist đã tạo trước đó.
async function resolveGistId(token, { create = false, content = '{}' } = {}) {
  const fixed = configuredGistId();
  if (fixed) return fixed;

  const found = await findGistId(token);
  if (found) return found;
  if (!create) return '';
  return createGist(token, content);
}

// ---------------------------------------------------------------------------
// Kéo về
// ---------------------------------------------------------------------------

async function fetchGistSettings(token) {
  const id = await resolveGistId(token);
  if (!id) return null;

  const res = await request(`${apiBase()}/gists/${id}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Không đọc được gist (HTTP ${res.status})`);

  const data = await res.json();
  const file = data && data.files && data.files[GIST_FILENAME];
  if (!file) return null;

  // Gist cắt bớt nội dung file lớn, phải tải raw
  let text = file.content;
  if (file.truncated && file.raw_url) {
    const raw = await request(file.raw_url, { headers: headers(token) });
    if (!raw.ok) throw new Error(`Không tải được nội dung gist (HTTP ${raw.status})`);
    text = await readLimited(raw);
  }
  return JSON.parse(text);
}

async function fetchUrlSettings(url) {
  const res = await request(url, { headers: { 'user-agent': 'webdownload-sync/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(await readLimited(res));
}

/**
 * Kéo cấu hình từ nơi lưu bền về máy, nếu bản trên đó mới hơn bản đang có.
 * Gọi lúc khởi động, sau settings.init().
 * reason: 'disabled' | 'not_found' | 'nothing_saved' | 'local_newer' | lỗi mạng.
 * @param {object} settings module settings
 */
async function restoreInto(settings) {
  if (!isConfigured()) return { pulled: false, reason: 'disabled' };

  let remote;
  try {
    if (publicUrl()) {
      remote = await fetchUrlSettings(publicUrl());
    } else {
      remote = await fetchGistSettings(githubToken());
    }
  } catch (err) {
    return { pulled: false, reason: err.message };
  }

  if (remote === null) return { pulled: false, reason: 'not_found' };
  if (!remote || typeof remote !== 'object') return { pulled: false, reason: 'invalid' };

  const local = settings.get();
  const remoteHas = Boolean(
    remote.desktopText || remote.mobileText
      || (remote.languages && Object.keys(remote.languages).length),
  );
  if (!remoteHas) return { pulled: false, reason: 'nothing_saved' };

  const localHas = Boolean(
    local.desktopText || local.mobileText || Object.keys(local.languages || {}).length,
  );
  // Máy đang có bản mới hơn (ví dụ gắn ổ đĩa bền) → không ghi đè
  if (localHas && local.updatedAt > (Number(remote.updatedAt) || 0)) {
    return { pulled: false, reason: 'local_newer' };
  }

  const applied = await settings.applyRemote(remote);
  return {
    pulled: true,
    languages: Object.keys(applied.languages).length,
    shared: Boolean(applied.desktopText || applied.mobileText),
  };
}

// ---------------------------------------------------------------------------
// Đẩy lên
// ---------------------------------------------------------------------------

/**
 * Ghi cấu hình hiện tại lên nơi lưu bền.
 * Gọi sau mỗi lần admin lưu thông báo.
 * @param {object} snapshot kết quả settings.get()
 */
async function push(snapshot) {
  const token = githubToken();
  if (!token) {
    if (publicUrl()) return { pushed: false, reason: 'read_only' };
    return { pushed: false, reason: 'disabled' };
  }

  const content = JSON.stringify(snapshot, null, 2);

  try {
    const id = await resolveGistId(token, { create: true, content });

    const res = await request(`${apiBase()}/gists/${id}`, {
      method: 'PATCH',
      headers: { ...headers(token), 'content-type': 'application/json' },
      body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${detail.slice(0, 140)}`);
    }
    return { pushed: true, gistId: id };
  } catch (err) {
    log('Đẩy cấu hình thất bại:', err.message);
    return { pushed: false, reason: err.message };
  }
}

module.exports = { isConfigured, canPush, restoreInto, push, GIST_DESCRIPTION };
