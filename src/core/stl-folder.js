// Node-only: find the STL file that belongs to a STEP part by name.
//   const stl = stlFolder('Crabsy/construction', { '1_baseplate': '1_base_plate' });
//   stl.find('1_baseplate', ['a1_base', '1_baseplate'])  →  { file, positions } | null
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, relative, sep } from 'node:path';
import { parseSTL } from './stl.js';

const SKIP = new Set(['node_modules', '.git']);
/** "1_baseplate", "1_Base-Plate" and "1 base plate" all become "1baseplate". */
export const normalizeName = (s) => String(s).toLowerCase().replace(/\.stl$/, '').replace(/[^a-z0-9]/g, '');

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
  const files = walk(dir);
  const byKey = new Map();
  for (const f of files) {
    const k = normalizeName(basename(f));
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(f);
  }
  const cache = new Map();
  const load = (file) => { if (!cache.has(file)) cache.set(file, parseSTL(readFileSync(file))); return cache.get(file); };
  const ambiguous = [];
  return {
    files,
    ambiguous,
    /** `ancestors`: names of the assemblies above the part, used to choose between files with the same name. */
    find(product, ancestors = []) {
      if (overrides[product]) {
        const want = normalizeName(overrides[product]);
        const hit = files.find((f) => normalizeName(relative(dir, f)) === want || normalizeName(basename(f)) === want);
        if (!hit) throw new Error(`stl override for "${product}": no file matches "${overrides[product]}" in ${dir}`);
        return { file: hit, positions: load(hit) };
      }
      const cands = byKey.get(normalizeName(product));
      if (!cands) return null;
      let pick = cands[0];
      if (cands.length > 1) {
        const ctx = ancestors.map(normalizeName);
        pick = cands.find((f) => relative(dir, f).split(sep).some((seg) => ctx.includes(normalizeName(seg)))) ?? cands[0];
        ambiguous.push({ product, chosen: relative(dir, pick), candidates: cands.map((c) => relative(dir, c)) });
      }
      return { file: pick, positions: load(pick) };
    },
  };
}
