// Rebuilds standard_parts/index.json by scanning for part.json files.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function buildIndex(root, log = console.log) {
  const items = [];
  const walk = (rel) => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      const p = join(rel, name);
      if (name.startsWith('.') || !statSync(join(root, p)).isDirectory()) continue;
      if (existsSync(join(root, p, 'part.json'))) {
        const d = JSON.parse(readFileSync(join(root, p, 'part.json'), 'utf8'));
        items.push({ id: d.id, name: d.name, category: d.category ?? 'Other', path: p.split('\\').join('/'), tags: d.tags ?? [] });
      } else walk(p);
    }
  };
  walk('');
  writeFileSync(join(root, 'index.json'), JSON.stringify({ schema: 1, parts: items }, null, 2) + '\n');
  log(`index.json: ${items.length} parts`);
  return items;
}
