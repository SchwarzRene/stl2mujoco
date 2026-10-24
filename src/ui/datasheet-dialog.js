// "Add part from datasheet" dialog – talks to the local editor API, which runs a headless Claude Code session.
import { Matrix4 } from 'three';
import { fetchReader, instantiate } from '../core/library.js';
import { CATEGORIES } from '../core/part-spec.js';
import { h, ib } from './kit.js';
import { icon } from './icons.js';

const API = '/api';
const HDR = { 'Content-Type': 'application/json', 'X-S2M': '1' };

async function api(method, path, body) {
  const r = await fetch(`${API}${path}`, { method, headers: HDR, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { throw Object.assign(new Error('NO_SERVER'), { code: 'NO_SERVER' }); }
  if (!r.ok) throw Object.assign(new Error(data.error ?? `HTTP ${r.status}`), { status: r.status, data });
  return data;
}
const toBase64 = (file) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(file); });

export async function checkClaude() {
  try { return await api('GET', '/claude/status'); }
  catch (e) {
    if (e.code === 'NO_SERVER' || e instanceof TypeError) return { available: false, reason: 'Not available: this page is not served by the editor server, so it cannot start Claude Code. Run the editor with `npm run dev` (or `npm run build && npm run serve`) on a computer that has the Claude Code CLI installed.' };
    return { available: false, reason: e.message };
  }
}

export function openDatasheetDialog({ app, flash, onAdded, reloadLibrary }) {
  const overlay = h('div', { class: 'modal' });
  const box = h('div', { class: 'modal-box' });
  overlay.append(box); document.body.append(overlay);
  let poll = null, jobId = null; const state = { status: null };
  const close = () => { clearInterval(poll); overlay.remove(); };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && !jobId) close(); });

  const form = {};
  const banner = h('div', { class: 'stat' }, icon('info', 14), 'checking Claude Code…');
  const create = ib('sparkles', 'Create the part from the datasheet', () => start(), { primary: true, label: 'Create', disabled: true, act: 'create' });
  const setBanner = (ok, text) => { banner.className = ok ? 'stat ok' : 'note'; banner.replaceChildren(icon(ok ? 'check' : 'error', 15), text); };
  const title = (t) => h('div', { class: 'card-title' }, h('span', {}, icon('sparkles', 18), t));

  function renderForm() {
    const t = title('Part from a datasheet'); t.append(ib('close', 'Close', close));
    box.replaceChildren(t, banner,
      h('div', { class: 'row', 'data-tip': 'PDF, image or text with the measurements, torque and speed' }, icon('file', 18), (form.files = h('input', { type: 'file', multiple: true, accept: '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv', onchange: upd }))),
      h('div', { class: 'row', 'data-tip': 'Optional: use your own STL as the shape. Claude then only places the mounting points from the datasheet.' }, icon('box', 18), (form.stl = h('input', { type: 'file', accept: '.stl' }))),
      h('div', { class: 'row' }, icon('tree', 18), (form.cat = h('select', {}, Object.keys(CATEGORIES).map((c) => h('option', { value: c }, c))))),
      h('div', { class: 'row' }, icon('file', 18), (form.name = h('input', { type: 'text', placeholder: 'name (optional)' }))),
      h('div', { class: 'row', style: 'align-items:start' }, icon('info', 18), (form.notes = h('textarea', { rows: 2, placeholder: 'hints (optional) – e.g. “use the 6 V column”' }))),
      h('div', { class: 'btns' }, create, h('span', { class: 'unit' }, 'runs locally with your Claude Code login · ~ a few cents')));
  }
  function upd() { create.disabled = !(state.status?.available && form.files?.files.length); }

  async function start() {
    create.disabled = true;
    try {
      const files = await Promise.all([...form.files.files].map(async (f) => ({ name: f.name, data: await toBase64(f) })));
      const stl = form.stl.files[0] ? { name: form.stl.files[0].name, data: await toBase64(form.stl.files[0]) } : undefined;
      const j = await api('POST', '/datasheet-jobs', { name: form.name.value, category: form.cat.value, notes: form.notes.value, files, stl });
      jobId = j.id; renderProgress(j); poll = setInterval(tick, 1000);
    } catch (e) { setBanner(false, e.message); create.disabled = false; }
  }

  async function tick() {
    try { const j = await api('GET', `/jobs/${jobId}`); renderProgress(j); if (j.state !== 'running') clearInterval(poll); }
    catch (e) { clearInterval(poll); box.append(h('div', { class: 'note' }, icon('error', 14), e.message)); }
  }

  function renderProgress(j) {
    const states = { running: 'Claude is reading the datasheet…', done: 'Review', failed: 'Failed', cancelled: 'Cancelled', installed: 'Installed' };
    const t = title(states[j.state] ?? j.state);
    t.append(ib(j.state === 'done' ? 'trash' : 'close', j.state === 'running' ? 'Cancel' : j.state === 'done' ? 'Discard' : 'Close', async () => { if (j.state === 'running' || j.state === 'done') { try { await api('DELETE', `/jobs/${jobId}`); } catch { /* gone */ } } close(); }, { danger: j.state === 'done' }));
    const kids = [t, h('pre', { class: 'log' }, j.log.join('\n') || '…')];
    if (j.state === 'failed') kids.push(h('div', { class: 'note' }, icon('error', 14), j.error), ...(j.errors ?? []).map((e) => h('div', { class: 'note' }, icon('warning', 14), e)));
    if (j.state === 'done' && j.summary) {
      const s = j.summary;
      kids.push(h('div', { class: 'ins-head' }, icon('servo', 20), h('b', {}, s.name)),
        h('div', { class: 'facts' },
          h('span', { class: 'pill', 'data-tip': 'Type' }, icon('box', 14), s.type),
          s.mass_kg ? h('span', { class: 'pill', 'data-tip': 'Mass' }, icon('mass', 14), `${(s.mass_kg * 1000).toFixed(1)} g`) : null,
          h('span', { class: 'pill', 'data-tip': 'Connectors (mounting points)' }, icon('connector', 14), s.connectors),
          ...(s.servo ? Object.entries(s.servo.voltages).map(([v, d]) => h('span', { class: 'pill', 'data-tip': `${v} V: stall torque, no-load speed` }, icon('rotate', 14), `${v} V · ${d.stall_torque.toFixed(2)} N·m · ${d.noload_speed.toFixed(1)} rad/s`)) : [])),
        h('div', { class: 'stat' }, Object.entries(s.params).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${k} ${v}`).join(' · ')),
        ...Object.entries(s.dims_status ?? {}).map(([k, v]) => { const est = /verify|estimate/i.test(v); return h('div', { class: est ? 'note' : 'stat' }, icon(est ? 'warning' : 'check', 13), `${k.replace(/_/g, ' ')}: ${v}`); }),
        ...(s.sources ?? []).map((src) => h('div', { class: 'stat' }, icon('file', 13), src.url ? h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer', style: 'color:var(--acc)' }, src.title) : src.title)),
        h('div', { class: 'btns' }, ib('box', 'Try the part in the scene without installing it', tryInScene, { label: 'Try', act: 'try' }), ib('check', 'Install into the standard parts library', () => install(false), { primary: true, label: 'Install', act: 'install' }),
          h('span', { class: 'unit' }, 'check the highlighted estimates')));
    }
    if (j.state === 'installed') kids.push(h('div', { class: 'stat ok' }, icon('check', 15), 'Installed into standard_parts/ – commit the new folder to share it.'));
    box.replaceChildren(...kids);
  }

  async function tryInScene() {
    try {
      const nodes = await instantiate(app.project, fetchReader(`${API}/jobs/${jobId}/result`), { path: '.' }, { at: new Matrix4().makeTranslation(0.1, 0, 0) });
      onAdded(nodes); flash('Added the generated part to the scene for a look (not installed yet).');
    } catch (e) { flash(`Could not preview: ${e.message}`); }
  }
  async function install(overwrite) {
    try { await api('POST', `/jobs/${jobId}/install`, { overwrite }); await reloadLibrary(); flash('Installed into standard_parts/ – it now shows up in the Parts library.'); close(); }
    catch (e) {
      if (e.status === 409 && e.data?.exists && confirm(`${e.message}\nOverwrite it?`)) return install(true);
      box.append(h('div', { class: 'note' }, icon('error', 14), e.message));
    }
  }

  renderForm();
  checkClaude().then((st) => {
    state.status = st;
    setBanner(st.available, st.available ? `Claude Code ${st.version}` : st.reason);
    upd();
  });
}
