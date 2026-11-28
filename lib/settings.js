'use strict';

// Nội dung thông báo hiển thị cho người truy cập, do admin tự chỉnh.
//
// Mỗi ngôn ngữ có 2 câu riêng (máy tính / điện thoại). Ô nào admin để trống
// thì ngôn ngữ đó dùng câu dịch mặc định trong lib/i18n.js.
//
// Có thêm 1 cặp "dùng chung": áp dụng cho MỌI ngôn ngữ chưa được nhập riêng.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { DATA_DIR } = require('./paths');
const { T } = require('./i18n');

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const MAX_LEN = 300;

const DEFAULT_MESSAGES = {
  desktopText: 'Mở tập tin bạn vừa tải xuống để cùng nhau trò chuyện nhé',
  mobileText: 'Vui lòng sử dụng máy tính để truy cập, hiện tại chưa hỗ trợ bằng điện thoại',
};

// Thứ tự hiển thị trong admin: tiếng Việt và tiếng Anh lên đầu, phần còn lại theo bảng chữ cái.
const PINNED = ['vi', 'en'];

function languageList() {
  const codes = Object.keys(T);
  const rest = codes.filter((c) => !PINNED.includes(c)).sort();
  return [...PINNED.filter((c) => codes.includes(c)), ...rest].map((code) => ({
    code,
    // Tên ngôn ngữ bản địa lấy từ Intl, không cần bảng tay
    label: languageLabel(code),
  }));
}

function languageLabel(code) {
  try {
    const base = code.split('-')[0];
    const dn = new Intl.DisplayNames([code], { type: 'language' });
    const name = dn.of(code) || dn.of(base) || code;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return code;
  }
}

let cache = null;

// Gộp khoảng trắng + xuống dòng thành một dòng, cắt độ dài.
function clean(value) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LEN);
}

function emptyState() {
  return { desktopText: '', mobileText: '', languages: {}, updatedAt: 0 };
}

// Ghi nguyên tử: ghi file tạm rồi đổi tên, tránh hỏng file khi mất điện.
async function writeFile(next) {
  const tmp = `${SETTINGS_FILE}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
  await fsp.rename(tmp, SETTINGS_FILE);
}

async function read() {
  try {
    cache = normalize(JSON.parse(await fsp.readFile(SETTINGS_FILE, 'utf8')));
  } catch {
    cache = emptyState();
  }
  return cache;
}

async function init() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  return read();
}

function get() {
  return cache || emptyState();
}

/**
 * Lưu cấu hình.
 * @param {{ desktopText?: string, mobileText?: string, languages?: Record<string, {desktopText?: string, mobileText?: string}> }} input
 */
async function save(input = {}) {
  const next = normalize(input);
  next.updatedAt = Date.now();
  await writeFile(next);
  cache = next;
  return next;
}

// Chuẩn hoá một object cấu hình bất kỳ (từ đĩa hoặc từ nơi lưu bền) về dạng dùng được.
function normalize(raw) {
  const languages = {};
  const src = raw && raw.languages && typeof raw.languages === 'object' ? raw.languages : {};
  for (const [code, entry] of Object.entries(src)) {
    if (!T[code] || !entry || typeof entry !== 'object') continue;
    const desktopText = clean(entry.desktopText);
    const mobileText = clean(entry.mobileText);
    if (desktopText || mobileText) languages[code] = { desktopText, mobileText };
  }
  return {
    desktopText: clean(raw && raw.desktopText),
    mobileText: clean(raw && raw.mobileText),
    languages,
    updatedAt: Number(raw && raw.updatedAt) || 0,
  };
}

/**
 * Ghi đè cấu hình đang chạy bằng bản tải về từ nơi lưu bền.
 * Chỉ dùng nội bộ cho lib/persist.js (đã kiểm tra bản nào mới hơn).
 */
async function applyRemote(raw) {
  const next = normalize(raw);
  await writeFile(next);
  cache = next;
  return next;
}

/**
 * Câu hiển thị cho 1 ngôn ngữ cụ thể.
 * Thứ tự ưu tiên: bản dịch tự động -> bản dịch mặc định của ngôn ngữ đó.
 * (Không bao giờ trả câu gốc admin nhập, để khách nước ngoài không thấy
 * tiếng Việt khi dịch vụ tạm lỗi.)
 */
function messageFor(lang, langDict) {
  const s = get();
  const per = s.languages[lang] || {};
  return {
    desktopText: per.desktopText || langDict.desktopText,
    mobileText: per.mobileText || langDict.mobileText,
  };
}

// ---------------------------------------------------------------------------
// Dịch theo nhu cầu (khi khách truy cập mà chưa có bản dịch trong cache)
// ---------------------------------------------------------------------------

const inflight = new Map();

/**
 * Bảo đảm đã có bản dịch cho 1 ngôn ngữ. Gọi khi khách truy cập.
 * Không ném lỗi: dịch hỏng thì trả về câu gốc để trang vẫn hiển thị.
 * @returns {Promise<object>} kết quả như messageFor()
 */
async function messageForLang(lang, langDict) {
  const s = get();
  const per = s.languages[lang] || {};
  const missing = [];
  if (s.desktopText && !per.desktopText) missing.push('desktopText');
  if (s.mobileText && !per.mobileText) missing.push('mobileText');
  if (!missing.length) return messageFor(lang, langDict);

  const key = `${lang}|${s.desktopText}|${s.mobileText}`;
  if (inflight.has(key)) {
    await inflight.get(key);
    return messageFor(lang, langDict);
  }

  const job = (async () => {
    const { translateMany } = require('./autotranslate');
    const texts = missing.map((field) => s[field]);
    const found = {};

    for (let i = 0; i < missing.length; i++) {
      const field = missing[i];
      const { results } = await translateMany(texts[i], [lang]);
      if (results[lang]) found[field] = results[lang];
    }
    if (!Object.keys(found).length) return;

    // Ghi vào cache. Bỏ qua nếu admin vừa đổi câu trong lúc đang dịch.
    const now = get();
    if (now.desktopText !== s.desktopText || now.mobileText !== s.mobileText) return;
    const next = {
      desktopText: now.desktopText,
      mobileText: now.mobileText,
      languages: { ...now.languages, [lang]: { ...(now.languages[lang] || {}), ...found } },
    };
    await save(next);
  })();

  inflight.set(key, job);
  try {
    await job;
  } catch {
    // bỏ qua: trang vẫn hiển thị câu gốc
  } finally {
    inflight.delete(key);
  }
  return messageFor(lang, langDict);
}

// Số ngôn ngữ đã có bản dịch tự động.
function customCount() {
  return Object.keys(get().languages).length;
}

/**
 * Dịch sẵn câu hiện tại cho danh sách ngôn ngữ (chạy nền sau khi admin Lưu).
 * Ngôn ngữ nào lỗi thì bỏ qua, khách vào sẽ được dịch bù ở messageForLang.
 * @param {string[]} codes
 * @returns {Promise<{ done: number, failed: string[] }>}
 */
async function prefillAll(codes) {
  const s = get();
  const fields = ['desktopText', 'mobileText'].filter((f) => s[f]);
  if (!fields.length) return { done: 0, failed: [] };

  const { translateMany } = require('./autotranslate');
  const failed = [];
  let done = 0;

  for (const field of fields) {
    const need = codes.filter((c) => !(s.languages[c] || {})[field]);
    if (!need.length) continue;
    const { results, failed: lost } = await translateMany(s[field], need);
    failed.push(...Object.keys(lost || {}));
    if (!Object.keys(results).length) continue;

    const now = get();
    // Admin đổi câu trong lúc đang dịch -> bỏ kết quả cũ.
    if (now[field] !== s[field]) continue;

    const languages = { ...now.languages };
    for (const [code, text] of Object.entries(results)) {
      languages[code] = { ...(languages[code] || {}), [field]: text };
      done++;
    }
    await save({ desktopText: now.desktopText, mobileText: now.mobileText, languages });
  }

  return { done, failed };
}

module.exports = {
  init,
  read,
  get,
  save,
  applyRemote,
  messageFor,
  messageForLang,
  prefillAll,
  customCount,
  languageList,
  DEFAULT_MESSAGES,
  MAX_LEN,
};
