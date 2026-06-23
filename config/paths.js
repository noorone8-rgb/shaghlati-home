const path = require('path');
const fs = require('fs');

// On Railway (or any host) set DATA_DIR to a persistent volume mount, e.g. /data
// DB_PATH and UPLOADS_DIR can also be overridden individually.
const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || ROOT;
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'shaghlati.db');
// Defaults to the original public/uploads location for backward compatibility.
// On a host with a persistent volume, set UPLOADS_DIR (e.g. /data/uploads).
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(ROOT, 'public', 'uploads');

// Make sure the upload directory exists wherever it points.
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

module.exports = { DATA_DIR, DB_PATH, UPLOADS_DIR };
