#!/usr/bin/env node
// Headless export: node cli/convert.mjs <project.s2m.zip> <outDir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadProjectZip } from '../src/core/io.js';
import { buildMJCF } from '../src/core/mjcf.js';

const [, , input, outDir] = process.argv;
if (!input || !outDir) { console.error('usage: convert.mjs <project.s2m.zip> <outDir>'); process.exit(2); }
const project = await loadProjectZip(readFileSync(input));
const { files, report, issues } = buildMJCF(project);
for (const [path, bytes] of Object.entries(files)) {
  mkdirSync(dirname(join(outDir, path)), { recursive: true });
  writeFileSync(join(outDir, path), bytes);
}
for (const i of issues) console.warn(`${i.level}: ${i.msg}`);
console.log(`Wrote ${join(outDir, 'model.xml')} – ${report.length} bodies, total mass ${report.reduce((s, r) => s + r.mass, 0).toFixed(3)} kg`);
