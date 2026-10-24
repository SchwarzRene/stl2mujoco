import { defineConfig } from 'vite';
import { resolve, join } from 'node:path';
import { createReadStream, existsSync, statSync, cpSync } from 'node:fs';

// Serves ./standard_parts at /standard_parts (dev + preview) and copies it into dist/ on build.
const root = resolve('standard_parts');
const serve = (req, res, next) => {
  const p = join(root, decodeURIComponent((req.url || '/').split('?')[0]));
  if (!p.startsWith(root) || !existsSync(p) || !statSync(p).isFile()) return next();
  res.setHeader('Content-Type', p.endsWith('.json') ? 'application/json' : 'application/octet-stream');
  createReadStream(p).pipe(res);
};
export default defineConfig({
  plugins: [{
    name: 'standard-parts',
    configureServer(s) { s.middlewares.use('/standard_parts', serve); },
    configurePreviewServer(s) { s.middlewares.use('/standard_parts', serve); },
    closeBundle() { cpSync(root, resolve('dist/standard_parts'), { recursive: true }); },
  }],
});
