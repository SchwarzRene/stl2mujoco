// "Add part from datasheet" dialog – talks to the local editor API, which runs a headless Claude Code session.
import { Matrix4 } from 'three';
import { fetchReader, instantiate } from '../core/library.js';
import { CATEGORIES } from '../core/part-spec.js';

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

export function openDatasheetDialog({ app, h, flash, onAdded, reloadLibrary }) {
  const overlay = h('div', { class: 'modal' });
  const box = h('div', { class: 'modal-box' });
  overlay.append(box); document.body.append(overlay);
  let poll = null, jobId = null, state = { status: null };
  const close = () => { clearInterval(poll); overlay.remove(); };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && !jobId) close(); });

  const form = {};
  const banner = h('div', { class: 'note' }, 'Checking whether Claude Code is available…');
  const create = h('button', { class: 'primary', disabled: true }, '✨ Create part');

  function renderForm() {
    box.replaceChildren(
      h('div', { class: 'card-title' }, '✨ Add a standard part from a datasheet', h('button', { onclick: close }, '✕')),
      h('div', { class: 'help' }, 'Upload the datasheet (PDF, image, text). A headless Claude Code session reads it, extracts dimensions, mounting holes, mass and torque/speed, and the editor generates the part. You review it before it is added to the library.'),
      banner,
      h('div', { class: 'row' }, h('label', {}, 'Datasheet'), (form.files = h('input', { type: 'file', multiple: true, accept: '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv', onchange: upd }))),
      h('div', { class: 'row' }, h('label', {}, 'Link my STL'), (form.stl = h('input', { type: 'file', accept: '.stl' }))),
      h('div', { class: 'help' }, 'Optional: use your own STL as the shape. Claude then only places the mounting points (connectors) from the datasheet. Without an STL a parametric model is generated from the drawing.'),
      h('div', { class: 'row' }, h('label', {}, 'Name'), (form.name = h('input', { type: 'text', placeholder: 'optional, e.g. ACME S100 servo' }))),
      h('div', { class: 'row' }, h('label', {}, 'Category'), (form.cat = h('select', {}, Object.keys(CATEGORIES).map((c) => h('option', { value: c }, c))))),
      h('div', { class: 'row' }, h('label', {}, 'Hints'), (form.notes = h('textarea', { rows: 3, placeholder: 'optional: e.g. “use the 6 V column”, “ears are 2.5 mm thick”', style: 'width:100%' }))),
      h('div', { class: 'btns' }, create),
      h('div', { class: 'help' }, 'Runs locally with your Claude Code login and counts against your usage (typically a few cents). The session can only read your upload and write one JSON spec; no shell or web access.'),
    );
  }
  function upd() { create.disabled = !(state.status?.available && form.files?.files.length); }

  async function start() {
    create.disabled = true;
    try {
      const files = await Promise.all([...form.files.files].map(async (f) => ({ name: f.name, data: await toBase64(f) })));
      const stl = form.stl.files[0] ? { name: form.stl.files[0].name, data: await toBase64(form.stl.files[0]) } : undefined;
      const j = await api('POST', '/datasheet-jobs', { name: form.name.value, category: form.cat.value, notes: form.notes.value, files, stl });
      jobId = j.id; renderProgress(j); poll = setInterval(tick, 1000);
    } catch (e) { banner.className = 'note'; banner.textContent = e.message; create.disabled = false; }
  }
  create.addEventListener('click', start);

  async function tick() {
    try { const j = await api('GET', `/jobs/${jobId}`); renderProgress(j); if (j.state !== 'running') clearInterval(poll); }
    catch (e) { clearInterval(poll); box.append(h('div', { class: 'note' }, e.message)); }
  }

  function renderProgress(j) {
    const kids = [h('div', { class: 'card-title' }, `Datasheet import – ${({ running: 'Claude is reading the datasheet…', done: 'Review the result', failed: 'Failed', cancelled: 'Cancelled', installed: 'Installed' })[j.state] ?? j.state}`,
      h('button', { onclick: async () => { if (j.state === 'running' || j.state === 'done') { try { await api('DELETE', `/jobs/${jobId}`); } catch { /* gone */ } } close(); } }, j.state === 'running' ? 'Cancel' : j.state === 'done' ? 'Discard' : 'Close'))];
    kids.push(h('pre', { class: 'log' }, j.log.join('\n') || '…'));
    if (j.state === 'failed') {
      kids.push(h('div', { class: 'note' }, `✖ ${j.error}`), ...(j.errors ?? []).map((e) => h('div', { class: 'note' }, `• ${e}`)));
    }
    if (j.state === 'done' && j.summary) {
      const s = j.summary;
      kids.push(h('h3', {}, s.name), h('div', { class: 'stat' }, `${s.id} · ${s.category} · ${s.type} · ${s.connectors} connectors${s.mass_kg ? ` · ${(s.mass_kg * 1000).toFixed(1)} g` : ''}`));
      if (s.servo) for (const [v, d] of Object.entries(s.servo.voltages)) kids.push(h('div', { class: 'stat' }, `${v} V: ${d.stall_torque.toFixed(3)} N·m stall, ${d.noload_speed.toFixed(2)} rad/s no-load · travel ${s.servo.range_deg[0]}…${s.servo.range_deg[1]}°`));
      kids.push(h('div', { class: 'stat' }, Object.entries(s.params).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${k} ${v}`).join(' · ')));
      for (const [k, v] of Object.entries(s.dims_status ?? {})) kids.push(h('div', { class: /verify|estimate/i.test(v) ? 'note' : 'stat' }, `${k.replace(/_/g, ' ')}: ${v}`));
      for (const src of s.sources ?? []) kids.push(h('div', { class: 'stat' }, src.url ? h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer', style: 'color:var(--acc)' }, src.title) : src.title));
      if (s.summary) kids.push(h('div', { class: 'help' }, s.summary));
      kids.push(h('div', { class: 'btns' },
        h('button', { onclick: tryInScene }, 'Try in scene'),
        h('button', { class: 'primary', onclick: () => install(false) }, 'Install into library')),
      h('div', { class: 'help' }, 'Values marked “estimate – verify” could not be read from the datasheet – check them against your part before relying on them.'));
    }
    if (j.state === 'installed') kids.push(h('div', { class: 'stat' }, '✔ Installed into standard_parts/ – it is now in the Parts library (commit the new folder to share it).'));
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
      box.append(h('div', { class: 'note' }, e.message));
    }
  }

  renderForm();
  checkClaude().then((st) => {
    state.status = st;
    banner.className = st.available ? 'stat' : 'note';
    banner.textContent = st.available ? `✔ Claude Code found (${st.version}).` : `✖ ${st.reason}`;
    upd();
  });
}
