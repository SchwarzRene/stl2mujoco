// Node-only: find the STL file that belongs to a STEP part by name, searching a folder on disk.
//   const stl = stlFolder('Crabsy/construction', { '1_baseplate': '1_base_plate' });
//   stl.find('1_baseplate', ['a1_base', '1_baseplate'])  →  { file, positions } | null
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseSTL } from './stl.js';
import { createStlLookup } from './stl-lookup.js';

export { normalizeName } from './stl-lookup.js';

const SKIP = new Set(['node_modules', '.git']);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.stl$/i.test(name)) out.push(p);
  }
  return out;
}

/**
 * @param dir        folder searched recursively for *.stl
 * @param overrides  { stepProductName: 'file name or path relative to dir' } – wins over name matching
 */
export function stlFolder(dir, overrides = {}) {
  const paths = walk(dir).map((f) => relative(dir, f).split(sep).join('/'));
  return createStlLookup(paths, (p) => parseSTL(readFileSync(join(dir, p))), overrides);
}
