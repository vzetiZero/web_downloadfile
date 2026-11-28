'use strict';

// Tự dịch câu dùng chung sang các ngôn ngữ khác bằng endpoint Google Translate
// công khai (không cần API key). Endpoint này không có cam kết ổn định: lỗi thì
// ngôn ngữ đó giữ bản dịch tự động cũ (nếu có) hoặc rơi về bản dịch mặc định.

const TIMEOUT_MS = 8000;
const CONCURRENCY = 6;
const FIELDS = ['desktopText', 'mobileText'];
const AUTO_KEY = { desktopText: 'desktopAuto', mobileText: 'mobileAuto' };

// Mã ngôn ngữ trong lib/i18n.js -> mã Google Translate dùng
const GOOGLE_CODE = { 'zh-Hant': 'zh-TW', fil: 'tl' };

function squash(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

async function translateOne(text, lang) {
  const tl = GOOGLE_CODE[lang] || lang;
  const url = 'https://translate.googleapis.com/translate_a/single'
    + `?client=gtx&sl=auto&dt=t&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const out = squash((data[0] || []).map((part) => (part && part[0]) || '').join(''));
  if (!out) throw new Error('kết quả rỗng');
  return out.slice(0, 300);
}

// Dịch 1 câu sang nhiều ngôn ngữ. Trả về bản dịch thành công và danh sách ngôn ngữ lỗi.
async function translateMany(text, langs) {
  const results = {};
  const failed = [];
  const queue = [...langs];

  async function worker() {
    while (queue.length) {
      const lang = queue.shift();
      try {
        results[lang] = await translateOne(text, lang);
      } catch {
        failed.push(lang);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { results, failed };
}

/**
 * Tính lại bảng câu riêng theo từng ngôn ngữ khi admin bấm Lưu.
 *  - Ô admin nhập tay (khác bản tự dịch) được giữ nguyên.
 *  - Ô còn lại được tự dịch từ câu dùng chung. Nếu câu dùng chung không đổi,
 *    bản dịch cũ được giữ, không gọi lại dịch vụ.
 *  - Ô lỗi dịch giữ bản tự dịch cũ (nếu có).
 *
 * @param {{ prev: object, form: Record<string, object>, shared: object, codes: string[] }} input
 * @returns {Promise<{ languages: object, failed: string[] }>}
 */
async function resolveLanguages({ prev, form, shared, codes }) {
  const languages = {};
  const pending = {};
  const failed = new Set();

  for (const code of codes) {
    const p = (prev.languages || {})[code] || {};
    const f = form[code] || {};
    const entry = {};

    for (const field of FIELDS) {
      const autoKey = AUTO_KEY[field];
      const userVal = squash(f[field]);
      const prevAuto = p[autoKey] ? p[field] || '' : '';
      const sharedText = squash(shared[field]);

      if (userVal && userVal !== prevAuto) {
        entry[field] = userVal;
        entry[autoKey] = false;
      } else if (sharedText && prevAuto && squash(prev[field]) === sharedText) {
        entry[field] = prevAuto;
        entry[autoKey] = true;
      } else if (sharedText) {
        (pending[field] = pending[field] || []).push(code);
        entry[autoKey] = true;
      }
    }
    languages[code] = entry;
  }

  for (const field of FIELDS) {
    const langs = pending[field];
    if (!langs || !langs.length) continue;
    const { results, failed: lost } = await translateMany(squash(shared[field]), langs);
    for (const code of langs) {
      const p = (prev.languages || {})[code] || {};
      if (results[code]) {
        languages[code][field] = results[code];
      } else {
        failed.add(code);
        if (p[AUTO_KEY[field]] && p[field]) languages[code][field] = p[field];
        else languages[code][AUTO_KEY[field]] = false;
      }
    }
    lost.forEach((code) => failed.add(code));
  }

  for (const code of Object.keys(languages)) {
    const entry = languages[code];
    const hasAny = FIELDS.some((field) => entry[field]);
    if (!hasAny) delete languages[code];
  }

  return { languages, failed: [...failed] };
}

module.exports = { resolveLanguages };
