#!/usr/bin/env node
// Production server: serves dist/ + standard_parts/ + the local API on 127.0.0.1.   npm run build && npm run serve
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist'), parts = join(root, 'standard_parts');
const api = createApi({ partsRoot: parts });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.stl': 'application/octet-stream' };
const port = Number(process.env.PORT ?? 4173);
createServer((req, res) => api.handler(req, res, () => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const base = rel.startsWith('/standard_parts/') ? parts : dist;
  let f = resolve(base, '.' + (base === parts ? rel.slice('/standard_parts'.length) : rel));
  if (f !== base && !f.startsWith(base + sep)) { res.writeHead(403); return res.end(); } // not startsWith(base): '../dist-x' would pass
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] ?? 'application/octet-stream' });
  createReadStream(f).pipe(res);
})).listen(port, '127.0.0.1', () => console.log(`stl2mujoco on http://127.0.0.1:${port}`));
