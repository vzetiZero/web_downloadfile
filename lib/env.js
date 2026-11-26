'use strict';

// Nạp file .env (không cần thư viện ngoài)

const fs = require('fs');
const path = require('path');

function loadEnv(file = path.join(__dirname, '..', '.env')) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 0) continue;

    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(eq + 1).trim();

    // Bỏ comment cuối dòng (chỉ khi không nằm trong ngoặc kép)
    if (!/^["']/.test(value)) {
      const hash = value.indexOf(' #');
      if (hash > 0) value = value.slice(0, hash).trim();
    }

    // Bỏ ngoặc kép bao ngoài
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    value = value.replace(/\\n/g, '\n');
    process.env[key] = value;
  }
  return true;
}

module.exports = { loadEnv };
