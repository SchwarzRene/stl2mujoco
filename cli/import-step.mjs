#!/usr/bin/env node
// Build a robot from a folder of STL files + the assembly exported as STEP.
//   node cli/import-step.mjs <stl-folder> <assembly.stp> <out.s2m.zip> --config robot.json
//   node cli/import-step.mjs <stl-folder> <assembly.stp> --suggest robot.json   # write a starting config, then edit it
//   node cli/import-step.mjs <stl-folder> <assembly.stp> <out.s2m.zip> --auto    # build from the suggested config directly
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStepAssembly } from '../src/core/step-asm.js';
import { stlFolder } from '../src/core/stl-folder.js';
import { buildRobot, suggestConfig } from '../src/core/step-import.js';
import { saveProjectZip } from '../src/core/io.js';
import { loadIndex } from '../src/core/library.js';
import { fsReader } from '../src/core/fs-reader.js';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true; args.splice(i, v === true ? 1 : 2); return v; };
const configPath = flag('--config'), suggestPath = flag('--suggest'), auto = flag('--auto');
const [folder, stepFile, out] = args;
if (!folder || !stepFile || (!out && !suggestPath)) {
  console.error('usage: import-step.mjs <stl-folder> <assembly.stp> <out.s2m.zip> (--config robot.json | --auto)\n       import-step.mjs <stl-folder> <assembly.stp> --suggest robot.json');
  process.exit(2);
}

const reader = fsReader(join(dirname(fileURLToPath(import.meta.url)), '..', 'standard_parts'));
const index = await loadIndex(reader);
const asm = parseStepAssembly(readFileSync(stepFile, 'utf8'));
const userConfig = configPath ? JSON.parse(readFileSync(configPath, 'utf8')) : null;
const stl = stlFolder(folder, userConfig?.stl);
console.log(`${stepFile}: ${asm.occurrences.length} occurrences, ${asm.occurrences.filter((o) => o.leaf).length} parts, ${stl.files.length} STL files in ${folder}`);

let config = userConfig;
if (suggestPath || auto) {
  const suggested = suggestConfig({ asm, stl, index });
  for (const n of suggested.notes) console.warn(`note: ${n}`);
  if (suggestPath) { writeFileSync(suggestPath, JSON.stringify(suggested.config, null, 2) + '\n'); console.log(`Wrote ${suggestPath} – review it, then build with --config`); process.exit(0); }
  config = suggested.config;
} else if (!config) { console.error('give --config robot.json (or --auto / --suggest)'); process.exit(2); }

const { project, warnings } = await buildRobot({ asm, stl, config, reader, index, warn: (m) => console.warn(`warning: ${m}`) });
for (const a of stl.ambiguous) console.warn(`warning: several STL files match "${a.product}", used ${a.chosen} (others: ${a.candidates.filter((c) => c !== a.chosen).join(', ')})`);
writeFileSync(out, await saveProjectZip(project));
console.log(`Wrote ${out}: ${Object.keys(project.nodes).length} bodies, ${Object.keys(project.parts).length} meshes${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
