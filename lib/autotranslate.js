'use strict';

// Tự dịch câu dùng chung sang các ngôn ngữ khác bằng endpoint Google Translate
// công khai (miễn phí, không cần API key).
//
// Lưu ý: các endpoint này không có cam kết ổn định. Google hay chặn theo IP
// (HTTP 429), nên module thử lần lượt nhiều endpoint và có thử lại.

const TIMEOUT_MS = 9000;
const CONCURRENCY = 5;
const GAP_MS = 120; // giãn cách giữa các request để đỡ bị 429

// Mã ngôn ngữ trong lib/i18n.js -> mã Google Translate dùng
const GOOGLE_CODE = { 'zh-Hant': 'zh-TW', fil: 'tl' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function squash(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

// endpoints trả về 2 dạng JSON khác nhau
function parseClients5(data) {
  if (!Array.isArray(data)) return '';
  const parts = [];
  for (const item of data) {
    if (Array.isArray(item)) {
      if (typeof item[0] === 'string') parts.push(item[0]);
    } else if (typeof item === 'string') {
      parts.push(item);
    }
  }
  return parts.join('');
}

function parseSingle(data) {
  if (!Array.isArray(data) || !Array.isArray(data[0])) return '';
  return data[0].map((p) => (p && p[0]) || '').join('');
}

const ENDPOINTS = [
  {
    name: 'clients5',
    url: (tl, text) => 'https://clients5.google.com/translate_a/t'
      + `?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(text)}`,
    parse: parseClients5,
  },
  {
    name: 'translate',
    url: (tl, text) => 'https://translate.googleapis.com/translate_a/single'
      + `?client=gtx&sl=auto&dt=t&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(text)}`,
    parse: parseSingle,
  },
];

async function translateOne(text, lang) {
  const tl = GOOGLE_CODE[lang] || lang;
  let lastErr = 'không rõ lỗi';

  for (const ep of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(ep.url(tl, text), {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept-Language': 'vi,en;q=0.8',
          },
        });
        if (res.status === 429 || res.status === 403) {
          lastErr = `bị chặn (HTTP ${res.status})`;
          break; // đổi endpoint
        }
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`;
          await sleep(300 * (attempt + 1));
          continue;
        }
        const data = await res.json();
        const out = squash(ep.parse(data));
        if (out) return out.slice(0, 300);
        lastErr = 'kết quả rỗng';
        await sleep(300 * (attempt + 1));
      } catch (err) {
        lastErr = err && err.message ? err.message : String(err);
        await sleep(300 * (attempt + 1));
      }
    }
  }
  throw new Error(lastErr);
}

/**
 * Dịch 1 câu sang nhiều ngôn ngữ.
 * @returns {Promise<{ results: Record<string, string>, failed: Record<string, string> }>}
 */
async function translateMany(text, langs) {
  const results = {};
  const failed = {};
  const queue = [...langs];

  async function worker() {
    while (queue.length) {
      const lang = queue.shift();
      try {
        results[lang] = await translateOne(text, lang);
      } catch (err) {
        failed[lang] = err.message;
      }
      await sleep(GAP_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { results, failed };
}

module.exports = { translateMany };
