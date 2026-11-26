'use strict';

// Thư mục lưu dữ liệu (auth.json, file.json, file ZIP).
// Trên Render có thể gắn Persistent Disk và trỏ DATA_DIR vào đó để file không bị mất.
// Mặc định: <project>/data

const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

module.exports = { DATA_DIR };
