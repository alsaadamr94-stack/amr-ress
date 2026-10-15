// Copies the shared document/calc module to /public so the browser and the server use the same code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src/shared/rass-doc.js');
if (!fs.existsSync(src)) { console.error('[prep] الملف src/shared/rass-doc.js غير موجود في المستودع — أضف المجلد src/shared كاملاً إلى GitHub (راجع README).'); process.exit(1); }
fs.copyFileSync(src, path.join(root, 'public/doc.js'));
console.log('[prep] public/doc.js updated');
