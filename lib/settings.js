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

async function read() {
  try {
    const raw = JSON.parse(await fsp.readFile(SETTINGS_FILE, 'utf8'));
    const languages = {};
    if (raw && raw.languages && typeof raw.languages === 'object') {
      for (const [code, entry] of Object.entries(raw.languages)) {
        if (!entry || typeof entry !== 'object') continue;
        const desktopText = clean(entry.desktopText);
        const mobileText = clean(entry.mobileText);
        if (desktopText || mobileText) languages[code] = { desktopText, mobileText };
      }
    }
    cache = {
      // "Dùng chung" cho mọi ngôn ngữ chưa nhập riêng
      desktopText: clean(raw && raw.desktopText),
      mobileText: clean(raw && raw.mobileText),
      languages,
      updatedAt: Number(raw && raw.updatedAt) || 0,
    };
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
  const languages = {};
  const src = input.languages && typeof input.languages === 'object' ? input.languages : {};
  for (const [code, entry] of Object.entries(src)) {
    if (!T[code] || !entry) continue;
    const desktopText = clean(entry.desktopText);
    const mobileText = clean(entry.mobileText);
    // Chỉ lưu ngôn ngữ có ít nhất một câu, để file gọn
    if (desktopText || mobileText) languages[code] = { desktopText, mobileText };
  }

  const next = {
    desktopText: clean(input.desktopText),
    mobileText: clean(input.mobileText),
    languages,
    updatedAt: Date.now(),
  };

  const tmp = `${SETTINGS_FILE}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
  await fsp.rename(tmp, SETTINGS_FILE);
  cache = next;
  return next;
}

/**
 * Câu hiển thị cho 1 ngôn ngữ cụ thể.
 * Thứ tự ưu tiên: riêng ngôn ngữ đó -> dùng chung -> bản dịch mặc định.
 */
function messageFor(lang, langDict) {
  const s = get();
  const per = s.languages[lang] || {};

  const desktopText = per.desktopText || s.desktopText || langDict.desktopText;
  const mobileText = per.mobileText || s.mobileText || langDict.mobileText;

  let desktopSource = 'default';
  if (per.desktopText) desktopSource = 'language';
  else if (s.desktopText) desktopSource = 'shared';

  let mobileSource = 'default';
  if (per.mobileText) mobileSource = 'language';
  else if (s.mobileText) mobileSource = 'shared';

  return { desktopText, mobileText, desktopSource, mobileSource };
}

// Số ngôn ngữ đã nhập riêng (dùng để hiển thị trạng thái trong admin).
function customCount() {
  return Object.keys(get().languages).length;
}

module.exports = {
  init,
  read,
  get,
  save,
  messageFor,
  customCount,
  languageList,
  DEFAULT_MESSAGES,
  MAX_LEN,
};
