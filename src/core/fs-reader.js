// Node-only helper: read the standard_parts folder from disk (tests, CLI, example builder).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export const fsReader = (dir) => ({
  json: async (p) => JSON.parse(readFileSync(join(dir, p), 'utf8')),
  binary: async (p) => { const b = readFileSync(join(dir, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
});
