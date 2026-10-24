import { defineConfig } from 'vite';
import { resolve, join } from 'node:path';
import { createReadStream, existsSync, statSync, cpSync } from 'node:fs';
import { createApi } from './server/api.mjs';

// Serves ./standard_parts at /standard_parts and the local /api (dev + preview), copies the library into dist/ on build.
const root = resolve('standard_parts');
const serve = (req, res, next) => {
  const p = join(root, decodeURIComponent((req.url || '/').split('?')[0]));
  if (!p.startsWith(root) || !existsSync(p) || !statSync(p).isFile()) return next();
  res.setHeader('Content-Type', p.endsWith('.json') ? 'application/json' : 'application/octet-stream');
  createReadStream(p).pipe(res);
};
const api = createApi({ partsRoot: root });
export default defineConfig({
  plugins: [{
    name: 'standard-parts',
    configureServer(s) { s.middlewares.use('/standard_parts', serve); s.middlewares.use(api.handler); },
    configurePreviewServer(s) { s.middlewares.use('/standard_parts', serve); s.middlewares.use(api.handler); },
    closeBundle() { cpSync(root, resolve('dist/standard_parts'), { recursive: true }); },
  }],
});
