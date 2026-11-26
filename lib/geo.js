'use strict';

// Nhận diện quốc gia của người truy cập.
// Thứ tự ưu tiên:
//   1. Header do CDN/hosting gắn sẵn (Cloudflare, Vercel, CloudFront, Fastly...)
//   2. Tra cứu IP qua API miễn phí (có cache trong RAM)
//   3. Ngôn ngữ trình duyệt (Accept-Language) nếu không xác định được IP

const PRIVATE_IP = /^(::1|::ffff:127\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd|fe80|0\.0\.0\.0)/i;

const HEADER_COUNTRY = [
  'cf-ipcountry', // Cloudflare
  'x-vercel-ip-country', // Vercel
  'cloudfront-viewer-country', // AWS CloudFront
  'x-country-code', // Fastly / một số proxy
  'x-geoip-country', // proxy chung
  'x-real-country',
];

// Cache: ip -> { country, expires }
const cache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 giờ
const CACHE_MAX = 5000;

const LOOKUP_TIMEOUT = 2500;

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  let ip = '';
  if (typeof forwarded === 'string' && forwarded.length) {
    ip = forwarded.split(',')[0].trim();
  } else if (Array.isArray(forwarded) && forwarded.length) {
    ip = String(forwarded[0]).split(',')[0].trim();
  }
  if (!ip) ip = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || '';
  if (!ip) {
    ip = (req.socket && (req.socket.remoteAddress || '')) || '';
  }
  ip = String(ip).trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

function isPrivate(ip) {
  if (!ip) return true;
  return PRIVATE_IP.test(ip);
}

function countryFromHeaders(req) {
  for (const name of HEADER_COUNTRY) {
    const value = req.headers[name];
    if (typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim())) {
      const code = value.trim().toUpperCase();
      if (code !== 'XX' && code !== 'T1') return code;
    }
  }
  return null;
}

async function lookupCountry(ip) {
  const cached = cache.get(ip);
  if (cached && cached.expires > Date.now()) return cached.country;

  const endpoints = [
    { url: `https://ipwho.is/${ip}?fields=country_code`, parse: (txt) => { try { const j = JSON.parse(txt); return j && j.success !== false ? j.country_code : null; } catch { return null; } } },
    { url: `https://freeipapi.com/api/json/${ip}`, parse: (txt) => { try { return JSON.parse(txt).countryCode || null; } catch { return null; } } },
    { url: `https://ip-api.com/json/${ip}?fields=countryCode`, parse: (txt) => { try { return JSON.parse(txt).countryCode || null; } catch { return null; } } },
    { url: `https://ipapi.co/${ip}/country/`, parse: (txt) => (/^[A-Za-z]{2}$/.test(txt.trim()) ? txt.trim() : null) },
  ];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT);
      const res = await fetch(endpoint.url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'WebDownload/1.0' },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const txt = await res.text();
      const code = endpoint.parse(txt);
      if (typeof code === 'string' && /^[A-Za-z]{2}$/.test(code.trim())) {
        const country = code.trim().toUpperCase();
        remember(ip, country);
        return country;
      }
    } catch {
      // thử endpoint kế tiếp
    }
  }
  remember(ip, null);
  return null;
}

function remember(ip, country) {
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(ip, { country, expires: Date.now() + CACHE_TTL });
}

async function detectCountry(req) {
  const fromHeader = countryFromHeaders(req);
  if (fromHeader) return fromHeader;

  const ip = clientIp(req);
  if (isPrivate(ip)) return null;

  const cached = cache.get(ip);
  if (cached && cached.expires > Date.now()) return cached.country;

  return lookupCountry(ip);
}

// Lấy ngôn ngữ ưu tiên trong Accept-Language (dùng khi không xác định được quốc gia)
function acceptLanguage(req) {
  const header = req.headers['accept-language'];
  if (!header) return [];
  return String(header)
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';');
      const quality = q && q.startsWith('q=') ? parseFloat(q.slice(2)) : 1;
      return { tag: tag.trim(), q: Number.isFinite(quality) ? quality : 1 };
    })
    .filter((item) => item.tag)
    .sort((a, b) => b.q - a.q)
    .map((item) => item.tag);
}

module.exports = { detectCountry, clientIp, acceptLanguage, isPrivate };
