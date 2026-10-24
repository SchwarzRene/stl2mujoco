// DOM-free: find the STL file that belongs to a STEP part by name. Used by the CLI (files on disk) and the editor (uploaded files).
//   const stl = createStlLookup(['a1/stl/1_base_plate.stl', …], (path) => positions, { '1_baseplate': '1_base_plate.stl' });
//   stl.find('1_baseplate', ['a1_base'])  →  { file, positions } | null
/** "1_baseplate", "1_Base-Plate" and "1 base plate" all become "1baseplate". */
export const normalizeName = (s) => String(s).toLowerCase().replace(/\.stl$/, '').replace(/[^a-z0-9]/g, '');

const base = (p) => String(p).split(/[\\/]/).pop();

/**
 * @param paths      STL file paths (relative, any separator)
 * @param load       path → positions (Float32Array); called on demand, results are cached
 * @param overrides  { stepProductName: 'file name or path' } – wins over name matching
 */
export function createStlLookup(paths, load, overrides = {}) {
  const byKey = new Map();
  for (const p of paths) {
    const k = normalizeName(base(p));
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(p);
  }
  const cache = new Map();
  const get = (p) => { if (!cache.has(p)) cache.set(p, load(p)); return cache.get(p); };
  const ambiguous = [];
  return {
    files: paths,
    ambiguous,
    /** `ancestors`: names of the assemblies above the part, used to choose between files with the same name. */
    find(product, ancestors = []) {
      if (overrides[product]) {
        const want = normalizeName(overrides[product]);
        const hit = paths.find((p) => normalizeName(p) === want || normalizeName(base(p)) === want);
        if (!hit) throw new Error(`stl override for "${product}": no file matches "${overrides[product]}"`);
        return { file: hit, positions: get(hit) };
      }
      const cands = byKey.get(normalizeName(product));
      if (!cands) return null;
      let pick = cands[0];
      if (cands.length > 1) {
        const ctx = ancestors.map(normalizeName);
        pick = cands.find((p) => String(p).split(/[\\/]/).some((seg) => ctx.includes(normalizeName(seg)))) ?? cands[0];
        ambiguous.push({ product, chosen: pick, candidates: [...cands] });
      }
      return { file: pick, positions: get(pick) };
    },
  };
}
