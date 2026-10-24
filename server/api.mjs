// Local editor API (127.0.0.1 only): datasheet → standard part via a headless Claude Code session.
//   GET    /api/claude/status
//   POST   /api/datasheet-jobs         { name?, category, notes?, files:[{name,data(base64)}], stl?:{name,data} }
//   GET    /api/jobs/:id               state, log, summary
//   GET    /api/jobs/:id/result/<file> generated part.json / meshes (for previewing in the editor)
//   POST   /api/jobs/:id/install       copy the generated part into standard_parts/ and rebuild the index
//   DELETE /api/jobs/:id               cancel / discard
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, cpSync, statSync } from 'node:fs';
import { join, basename, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { claudeStatus, runClaude, buildPrompt, SCHEMA_DOC } from './claude.mjs';
import { validateSpec, CATEGORIES } from '../src/core/part-spec.js';
import { buildPart } from '../tools/part-builders.mjs';
import { buildIndex } from '../tools/library-index.mjs';
import { writeBinarySTL } from '../src/core/stl.js';
import { massProperties } from '../src/core/mesh.js';

const DATASHEET_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.txt', '.md', '.csv']);
const MAX_BODY = 64 * 1024 * 1024, MAX_FILE = 25 * 1024 * 1024, MAX_FILES = 6;

const safeName = (n) => basename(String(n)).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 80) || 'file';
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

export function createApi({ partsRoot, jobsRoot = join(tmpdir(), 's2m-jobs') }) {
  const jobs = new Map();
  const TTL = 24 * 3600 * 1000;
  // uploaded datasheets and generated meshes must not pile up in the temp folder
  const sweep = () => { for (const [id, j] of jobs) if (j.state !== 'running' && Date.now() - j.createdAt > TTL) { if (j.dir) rmSync(j.dir, { recursive: true, force: true }); jobs.delete(id); } };
  setInterval(sweep, 3600 * 1000).unref();
  let statusCache = null;
  const status = () => { if (!statusCache || Date.now() - statusCache.t > 15000) statusCache = { t: Date.now(), v: claudeStatus() }; return statusCache.v; };

  const readBody = (req) => new Promise((resolveBody, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Upload too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON'), { code: 400 })); } });
    req.on('error', reject);
  });

  // The API can start paid Claude sessions and write files: accept only same-origin requests to localhost.
  const originOk = (req) => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return false;
    const origin = req.headers.origin;
    if (origin && new URL(origin).host.toLowerCase() !== host) return false;
    if (req.method !== 'GET' && (req.headers['x-s2m'] !== '1' || !String(req.headers['content-type'] ?? '').startsWith('application/json'))) return false;
    return true;
  };

  const log = (job, m) => { job.log.push(m); if (job.log.length > 200) job.log.shift(); };
  const pub = (j) => ({ id: j.id, state: j.state, log: j.log, error: j.error ?? null, summary: j.summary ?? null, costUsd: j.costUsd ?? null, errors: j.errors ?? null });

  async function execute(job, input) {
    try {
      const dir = join(jobsRoot, job.id); job.dir = dir;
      for (const d of ['input', 'out', 'result']) mkdirSync(join(dir, d), { recursive: true });
      const names = [];
      for (const f of input.files) { const n = safeName(f.name); writeFileSync(join(dir, 'input', n), Buffer.from(f.data, 'base64')); names.push(n); }
      let stlName = null; const stlFiles = {};
      if (input.stl) { stlName = safeName(input.stl.name); const buf = Buffer.from(input.stl.data, 'base64'); writeFileSync(join(dir, 'input', stlName), buf); stlFiles[stlName] = buf; }
      writeFileSync(join(dir, 'input', 'SCHEMA.md'), SCHEMA_DOC);
      let prompt = buildPrompt({ name: input.name, category: input.category, notes: input.notes, files: names, stl: stlName });
      for (let attempt = 1; attempt <= 2; attempt++) {
        log(job, attempt === 1 ? 'Starting headless Claude Code session…' : 'Asking Claude to fix the validation errors…');
        const run = runClaude({ cwd: dir, prompt, onEvent: (m) => log(job, m) });
        job.handle = run.handle;
        const r = await run.promise;
        job.costUsd = (job.costUsd ?? 0) + (r.costUsd ?? 0);
        if (job.cancelled) { job.state = 'cancelled'; return; }
        if (!r.ok) { job.state = 'failed'; job.error = r.error; return; }
        const specPath = join(dir, 'out', 'spec.json');
        let raw, verdict;
        try { if (statSync(specPath).size > 300000) throw new Error('spec.json is too large'); raw = JSON.parse(readFileSync(specPath, 'utf8')); verdict = validateSpec(raw, { stlFiles: Object.keys(stlFiles) }); }
        catch (e) { verdict = { ok: false, errors: [`out/spec.json is missing or not valid JSON (${e.message})`] }; }
        if (!verdict.ok) {
          job.errors = verdict.errors; log(job, `Validation failed: ${verdict.errors.slice(0, 3).join('; ')}`);
          if (attempt === 2) { job.state = 'failed'; job.error = 'The generated spec did not pass validation.'; return; }
          prompt = `Your previous ./out/spec.json failed validation with these errors:\n${verdict.errors.map((e) => `- ${e}`).join('\n')}\nRead ./out/spec.json and ./input/SCHEMA.md, fix the problems (re-check the datasheet if needed) and overwrite ./out/spec.json. Write no other files.`;
          continue;
        }
        const spec = verdict.spec;
        const stlRaw = {}; for (const [k, v] of Object.entries(stlFiles)) stlRaw[k] = v;
        const built = buildPart(spec, stlRaw);
        for (const [n, m] of Object.entries(built.meshes)) if (!(massProperties(m).volume > 0)) throw new Error(`Generated mesh ${n} has no volume`);
        const out = join(dir, 'result'); rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
        writeFileSync(join(out, 'part.json'), JSON.stringify(built.json, null, 2) + '\n');
        for (const [n, m] of Object.entries(built.meshes)) writeFileSync(join(out, n), writeBinarySTL(m, 'stl2mujoco standard part'));
        job.spec = spec; job.built = built;
        job.summary = {
          id: spec.id, name: spec.name, category: spec.category, type: spec.type, params: spec.params, mass_kg: spec.mass_kg ?? null,
          servo: spec.servo ? { range_deg: spec.servo.range_deg, voltages: spec.servo.voltages } : null, connectors: built.json.bodies.reduce((s, b) => s + (b.connectors?.length ?? 0), 0),
          dims_status: spec.dims_status, sources: spec.sources, files: ['part.json', ...Object.keys(built.meshes)], summary: r.summary?.slice(0, 600) ?? '',
        };
        job.state = 'done'; log(job, `Part "${spec.name}" generated – review it, then install it into the library.`);
        return;
      }
    } catch (e) { job.state = 'failed'; job.error = e.message; }
  }

  async function handler(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return next?.();
    try {
      if (!originOk(req)) return json(res, 403, { error: 'Forbidden: the editor API only accepts same-origin requests on localhost.' });
      const p = url.pathname;
      if (req.method === 'GET' && p === '/api/claude/status') return json(res, 200, status());

      if (req.method === 'POST' && p === '/api/datasheet-jobs') {
        const st = status();
        if (!st.available) return json(res, 503, { error: st.reason });
        if ([...jobs.values()].some((j) => j.state === 'running')) return json(res, 409, { error: 'Another datasheet import is still running.' });
        const b = await readBody(req);
        const files = Array.isArray(b.files) ? b.files : [];
        if (!files.length || files.length > MAX_FILES) return json(res, 400, { error: `Upload 1–${MAX_FILES} datasheet files.` });
        for (const f of files) {
          if (!DATASHEET_EXT.has(extname(String(f?.name)).toLowerCase()) || typeof f.data !== 'string' || f.data.length * 0.75 > MAX_FILE) return json(res, 400, { error: `Unsupported or too large datasheet file: ${safeName(f?.name)} (allowed: ${[...DATASHEET_EXT].join(' ')}, ≤ 25 MB)` });
        }
        if (b.stl && (extname(String(b.stl.name)).toLowerCase() !== '.stl' || typeof b.stl.data !== 'string' || b.stl.data.length * 0.75 > MAX_FILE * 2)) return json(res, 400, { error: 'The linked model must be an .stl file (≤ 50 MB).' });
        const category = Object.hasOwn(CATEGORIES, b.category) ? b.category : 'Other';
        const job = { id: randomBytes(6).toString('hex'), state: 'running', log: [], createdAt: Date.now() };
        jobs.set(job.id, job);
        execute(job, { files, stl: b.stl, name: String(b.name ?? '').slice(0, 80), category, notes: String(b.notes ?? '').slice(0, 1000) });
        return json(res, 202, pub(job));
      }

      const m = p.match(/^\/api\/jobs\/([0-9a-f]{12})(\/.*)?$/);
      if (m) {
        const job = jobs.get(m[1]);
        if (!job) return json(res, 404, { error: 'Unknown job' });
        if (req.method === 'GET' && !m[2]) return json(res, 200, pub(job));
        if (req.method === 'GET' && m[2]?.startsWith('/result/')) {
          const f = safeName(m[2].slice(8));
          const fp = join(job.dir ?? '', 'result', f);
          if (job.state !== 'done' && job.state !== 'installed' || !existsSync(fp)) return json(res, 404, { error: 'No such file' });
          res.writeHead(200, { 'Content-Type': f.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'Cache-Control': 'no-store' });
          return res.end(readFileSync(fp));
        }
        if (req.method === 'POST' && m[2] === '/install') {
          if (job.state !== 'done') return json(res, 409, { error: 'Nothing to install (job is not finished).' });
          const b = await readBody(req).catch(() => ({}));
          const spec = job.spec, dest = resolve(partsRoot, CATEGORIES[spec.category], spec.id);
          if (!dest.startsWith(resolve(partsRoot) + '/')) return json(res, 400, { error: 'Invalid destination' });
          const idx = existsSync(join(partsRoot, 'index.json')) ? JSON.parse(readFileSync(join(partsRoot, 'index.json'), 'utf8')).parts : [];
          if ((existsSync(dest) || idx.some((e) => e.id === spec.id)) && !b.overwrite) return json(res, 409, { error: `A standard part with id "${spec.id}" already exists.`, exists: true });
          if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
          mkdirSync(dest, { recursive: true });
          cpSync(join(job.dir, 'result'), dest, { recursive: true });
          writeFileSync(join(dest, 'spec.json'), JSON.stringify(spec, null, 2) + '\n'); // keep the source spec for later regeneration
          buildIndex(partsRoot, () => {});
          job.state = 'installed';
          return json(res, 200, { installed: true, path: `${CATEGORIES[spec.category]}/${spec.id}` });
        }
        if (req.method === 'DELETE' && !m[2]) {
          job.cancelled = true; job.handle?.cancel();
          if (job.state === 'running') job.state = 'cancelled';
          if (job.dir && job.state !== 'installed') rmSync(job.dir, { recursive: true, force: true });
          jobs.delete(job.id);
          return json(res, 200, { ok: true });
        }
      }
      return json(res, 404, { error: 'Not found' });
    } catch (e) { return json(res, e.code === 413 || e.code === 400 ? e.code : 500, { error: e.message }); }
  }
  return { handler, jobs };
}
