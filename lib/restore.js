'use strict';

// Tự khôi phục file ZIP đang phát hành từ một URL cố định.
//
// Vì sao cần: trên các host miễn phí (Render free, v.v.) ổ đĩa là TẠM —
// mọi file upload sẽ mất khi server khởi động lại hoặc bị "ngủ".
// Nếu bạn đặt biến môi trường RESTORE_ZIP_URL trỏ tới một file ZIP công khai
// (GitHub Release, R2 public link, Drive direct link, v.v.), server sẽ tự tải
// file đó về khi khởi động mà chưa có file nào → khách vẫn tải được ngay.
//
// Để trống biến này thì tính năng bị bỏ qua hoàn toàn.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const MAX_BYTES = 200 * 1024 * 1024; // chặn tải quá lớn
const TIMEOUT_MS = 60000;

async function downloadTo(url, destPath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
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
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      throw new Error('Nội dung tải về không phải file ZIP');
    }

    await fsp.writeFile(destPath, buf);
    return buf.length;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gọi lúc khởi động, sau store.init().
 * Chỉ chạy khi CHƯA có file nào được phát hành.
 * @param {object} store module store
 * @returns {Promise<{restored:boolean, reason?:string, size?:number}>}
 */
async function restoreIfEmpty(store) {
  const url = (process.env.RESTORE_ZIP_URL || '').trim();
  if (!url) return { restored: false, reason: 'disabled' };

  // Đã có file (kể cả trạng thái "đã xoá có chủ đích") thì không khôi phục
  const existing = await store.current();
  if (existing.size > 0) return { restored: false, reason: 'already_present' };

  const metaExists = await store.metaExists();
  if (metaExists) return { restored: false, reason: 'explicitly_empty' };

  const tempPath = path.join(store.TEMP_DIR, `restore-${Date.now()}.zip`);

  try {
    const size = await downloadTo(url, tempPath);
    const nameFromUrl = decodeURIComponent(String(url).split('/').pop() || '').split('?')[0];
    const meta = await store.replace({
      tempPath,
      originalName: nameFromUrl || 'tai-lieu.zip',
      size,
    });
    return { restored: true, size: meta.size };
  } catch (err) {
    await fsp.unlink(tempPath).catch(() => {});
    return { restored: false, reason: err.message };
  }
}

module.exports = { restoreIfEmpty };
