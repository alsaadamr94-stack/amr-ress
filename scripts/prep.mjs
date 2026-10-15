// Copies the shared document/calc module to /public so the browser and the server use the same code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.copyFileSync(path.join(root, 'src/shared/rass-doc.js'), path.join(root, 'public/doc.js'));
console.log('[prep] public/doc.js updated');
