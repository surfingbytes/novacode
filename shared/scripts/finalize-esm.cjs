/**
 * Marks dist/esm as ESM. The package root stays CommonJS (default), so the
 * dual build needs a nested package.json with "type": "module" next to the
 * ESM output for Node/Vite to interpret it correctly.
 */
// node_modules
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const esmDir = join(__dirname, '..', 'dist', 'esm');
mkdirSync(esmDir, { recursive: true });
writeFileSync(join(esmDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');
