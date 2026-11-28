'use strict';

// Quản lý file ZIP hiện tại do admin tải lên.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { createZip } = require('./zip');
const { DATA_DIR } = require('./paths');

const FILE_DIR = path.join(DATA_DIR, 'files');
const META_FILE = path.join(DATA_DIR, 'file.json');
const TEMP_DIR = path.join(DATA_DIR, 'tmp');

const DEFAULT_ZIP_NAME = 'tai-lieu.zip';

// Định dạng được phép phát hành -> Content-Type khi tải về.
const ALLOWED_TYPES = {
  '.zip': 'application/zip',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.msi': 'application/x-msi',
};

const ALLOWED_LABEL = '.zip, .exe, .msi';

// Đuôi file (chữ thường, kèm dấu chấm). Trả '' nếu không có.
function extOf(name) {
  const m = /(\.[a-z0-9]+)$/i.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
}

function isAllowed(name) {
  return Boolean(ALLOWED_TYPES[extOf(name)]);
}

function contentTypeFor(name) {
  return ALLOWED_TYPES[extOf(name)] || 'application/octet-stream';
}

async function init() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(FILE_DIR, { recursive: true });
  await fsp.mkdir(TEMP_DIR, { recursive: true });
}

function humanSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

async function metaExists() {
  try {
    await fsp.access(META_FILE);
    return true;
  } catch {
    return false;
  }
}

async function readMeta() {
  try {
    const meta = JSON.parse(await fsp.readFile(META_FILE, 'utf8'));
    return {
      id: meta.id || null,
      name: meta.name || '',
      originalName: meta.originalName || meta.name || '',
      size: Number(meta.size) || 0,
      updatedAt: Number(meta.updatedAt) || 0,
      checksum: meta.checksum || null,
      downloads: Number(meta.downloads) || 0,
    };
  } catch {
    return null;
  }
}

async function writeMeta(meta) {
  const tmp = `${META_FILE}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(meta, null, 2), 'utf8');
  await fsp.rename(tmp, META_FILE);
}

function filePath(id, name) {
  const ext = ALLOWED_TYPES[extOf(name)] ? extOf(name) : '.zip';
  return path.join(FILE_DIR, `${id}${ext}`);
}

// Tên file của bản ghi hiện tại (bỏ phần id, giữ đúng đuôi đã lưu).
function storedFilePath(meta) {
  return filePath(meta.id, meta.name || meta.originalName || '.zip');
}

// Tạo file ZIP mẫu — chỉ chạy ở lần khởi động đầu tiên (chưa có file.json)
async function ensureDefault() {
  if (await metaExists()) return readMeta();

  const readme = [
    'Xin chào!',
    '',
    'Đây là file ZIP mẫu do hệ thống tạo sẵn để thử chức năng tải xuống.',
    'Đăng nhập /admin rồi tải lên file ZIP của bạn để thay thế.',
    '',
    `Tạo lúc: ${new Date().toISOString()}`,
  ].join('\n');

  const buf = createZip([
    { name: 'README.txt', data: readme },
    { name: 'huong-dan/ghi-chu.txt', data: 'Thay file ZIP này trong trang quản trị.\n' },
  ]);

  const id = crypto.randomBytes(8).toString('hex');
  await fsp.writeFile(filePath(id, DEFAULT_ZIP_NAME), buf);

  const meta = {
    id,
    name: DEFAULT_ZIP_NAME,
    originalName: DEFAULT_ZIP_NAME,
    size: buf.length,
    updatedAt: Date.now(),
    checksum: crypto.createHash('sha256').update(buf).digest('hex'),
    downloads: 0,
  };
  await writeMeta(meta);
  return meta;
}

/**
 * File đang phát hành. Trả về object với size = 0 khi chưa có file nào.
 */
async function current() {
  let meta = await readMeta();

  if (!meta) {
    meta = await ensureDefault();
    if (!meta) return emptyFile();
  }

  if (!meta.id || !meta.size) return emptyFile();

  try {
    const st = await fsp.stat(storedFilePath(meta));
    if (!st.size) return emptyFile();
    return {
      ...meta,
      size: st.size,
      humanSize: humanSize(st.size),
    };
  } catch {
    return emptyFile();
  }
}

function emptyFile() {
  return {
    id: null,
    name: '',
    originalName: '',
    size: 0,
    updatedAt: 0,
    checksum: null,
    downloads: 0,
    humanSize: '0 B',
  };
}

async function bumpDownload() {
  const meta = await readMeta();
  if (!meta || !meta.id) return;
  meta.downloads = (meta.downloads || 0) + 1;
  await writeMeta(meta).catch(() => {});
}

// Kiểm tra nội dung có khớp định dạng không.
// ZIP: có chữ ký "PK". EXE/MSI: bắt đầu bằng "MZ" (cả hai đều là PE).
async function looksLikeFormat(file, size, name) {
  const ext = extOf(name);
  const fd = await fsp.open(file, 'r');
  try {
    const head = Buffer.alloc(4);
    await fd.read(head, 0, Math.min(4, size), 0);

    if (ext === '.exe' || ext === '.msi') {
      // 'MZ' - file thực thi Windows (EXE và MSI đều dùng định dạng PE)
      return head[0] === 0x4d && head[1] === 0x5a;
    }

    if (ext !== '.zip') return false;
    if (head[0] !== 0x50 || head[1] !== 0x4b) return false;

    const tailLen = Math.min(size, 66 * 1024);
    const tail = Buffer.alloc(tailLen);
    await fd.read(tail, 0, tailLen, size - tailLen);
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
        return true;
      }
    }
    return false;
  } finally {
    await fd.close();
  }
}

function sanitizeName(raw) {
  let name = String(raw || '').trim();
  if (!name) return DEFAULT_ZIP_NAME;

  // Sửa tên bị giải mã sai (mojibake)
  if (/[\u00c0-\u00ef][\u0080-\u00bf]/.test(name)) {
    try {
      const fixed = Buffer.from(name, 'latin1').toString('utf8');
      if (!fixed.includes('\uFFFD')) name = fixed;
    } catch {}
  }

  name = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  if (!name) return DEFAULT_ZIP_NAME;

  // Không có đuôi thì mặc định là .zip; đuôi lạ giữ nguyên để báo lỗi đúng tên.
  if (!extOf(name)) name = `${name}.zip`;
  return name.slice(0, 120);
}

/**
 * Lưu file mới thay cho file cũ.
 * @param {{ tempPath: string, originalName: string, size: number }} input
 */
async function replace({ tempPath, originalName, size }) {
  const safeName = sanitizeName(originalName);

  if (!isAllowed(safeName)) {
    const err = new Error(`Chỉ nhận file ${ALLOWED_LABEL}.`);
    err.code = 'BAD_FORMAT';
    throw err;
  }
  if (!(await looksLikeFormat(tempPath, size, safeName))) {
    const err = new Error(`Nội dung file không khớp định dạng ${extOf(safeName)}. Hãy kiểm tra lại file.`);
    err.code = 'BAD_FORMAT';
    throw err;
  }

  const checksum = await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(tempPath);
    stream.on('data', (c) => hash.update(c));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });

  const id = crypto.randomBytes(8).toString('hex');
  const target = filePath(id, safeName);
  await fsp.rename(tempPath, target);

  const meta = {
    id,
    name: safeName,
    originalName: String(originalName || DEFAULT_ZIP_NAME).slice(0, 200),
    size,
    updatedAt: Date.now(),
    checksum,
    downloads: 0,
  };
  await writeMeta(meta);

  // Dọn các file cũ
  const files = await fsp.readdir(FILE_DIR).catch(() => []);
  const target7 = path.basename(target);
  await Promise.all(files
    .filter((f) => f !== target7 && isAllowed(f))
    .map((f) => fsp.unlink(path.join(FILE_DIR, f)).catch(() => {})));

  return { ...meta, humanSize: humanSize(meta.size) };
}

// Xoá file đang phát hành nhưng vẫn giữ file.json để không tạo lại file mẫu
async function remove() {
  const files = await fsp.readdir(FILE_DIR).catch(() => []);
  await Promise.all(files
    .filter((f) => isAllowed(f))
    .map((f) => fsp.unlink(path.join(FILE_DIR, f)).catch(() => {})));

  await writeMeta({
    id: null,
    name: '',
    originalName: '',
    size: 0,
    updatedAt: Date.now(),
    checksum: null,
    downloads: 0,
  });
}

module.exports = {
  init,
  current,
  replace,
  remove,
  bumpDownload,
  ensureDefault,
  metaExists,
  readMeta,
  sanitizeName,
  humanSize,
  looksLikeFormat,
  isAllowed,
  extOf,
  contentTypeFor,
  storedFilePath,
  ALLOWED_TYPES,
  ALLOWED_LABEL,
  DEFAULT_ZIP_NAME,
  FILE_DIR,
  DATA_DIR,
  TEMP_DIR,
};
