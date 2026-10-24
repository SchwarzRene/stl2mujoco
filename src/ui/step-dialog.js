// "Build from STEP" dialog: upload a STEP assembly + the STL files (+ optional robot.json), check which parts found their STL,
// suggest / edit the robot.json, build. Same code path as cli/import-step.mjs (src/core/step-import.js).
import { parseStepAssembly } from '../core/step-asm.js';
import { createStlLookup } from '../core/stl-lookup.js';
import { buildRobot, suggestConfig } from '../core/step-import.js';
import { fetchReader, loadIndex } from '../core/library.js';
import { parseSTL } from '../core/stl.js';
import { h, ib } from './kit.js';
import { icon } from './icons.js';

export function openStepDialog({ flash, onBuilt }) {
  const overlay = h('div', { class: 'modal' });
  const box = h('div', { class: 'modal-box step-box' });
  overlay.append(box); document.body.append(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

  const S = { asm: null, stl: new Map(), manual: {} };    // stl: path → File; manual: STEP part → path (picked per part, wins over name matching)
  const pick = h('input', { type: 'file', accept: '.stl', style: 'display:none', 'data-act': 'part-file' });
  const buffers = new Map();                              // path → ArrayBuffer (read once, parsed on demand)

  const stepIn = h('input', { type: 'file', accept: '.stp,.step', 'data-act': 'step-file', onchange: () => loadStep() });
  const stlIn = h('input', { type: 'file', multiple: true, accept: '.stl', 'data-act': 'stl-files', onchange: () => addStl(stlIn) });
  const dirIn = h('input', { type: 'file', multiple: true, webkitdirectory: true, 'data-act': 'stl-folder', style: 'display:none', onchange: () => addStl(dirIn) });
  const jsonIn = h('input', { type: 'file', accept: '.json', 'data-act': 'config-file', onchange: () => loadJson() });
  const cfg = h('textarea', { class: 'mono', rows: 12, spellcheck: false, placeholder: 'robot.json – click “Suggest”, or load your own', 'data-act': 'config', oninput: () => refresh() });
  const matches = h('div', { class: 'step-table' });
  const status = h('div', { class: 'stat' });
  const stepInfo = h('div', { class: 'stat' });
  const stlInfo = h('div', { class: 'stat' });
  const partsInfo = h('div', { class: 'stat', 'data-act': 'parts-info' });
  const suggest = ib('sparkles', 'Write a starting robot.json from the assembly (check it against your CAD)', () => doSuggest(), { label: 'Suggest', act: 'suggest', disabled: true });
  const build = ib('assembly', 'Build the robot and load it into the editor', () => doBuild(), { primary: true, label: 'Build', act: 'build', disabled: true });

  const setStatus = (kind, text) => { status.className = kind === 'ok' ? 'stat ok' : kind === 'err' ? 'note' : 'stat'; status.replaceChildren(icon(kind === 'ok' ? 'check' : kind === 'err' ? 'error' : 'info', 14), text); };
  const parsedConfig = () => { try { return cfg.value.trim() ? JSON.parse(cfg.value) : null; } catch (e) { return { __error: e.message }; } };
  const lookup = (overrides) => createStlLookup([...S.stl.keys()], (p) => parseSTL(buffers.get(p)), { ...overrides, ...S.manual });
  const isServoPart = (c, product) => (c?.servoModel ? [c.servoModel.case, c.servoModel.shaft].includes(product) : /^(case|body|housing|shaft|output|horn|axis)$/i.test(product));

  /** Click on a part in the list: choose its STL file directly. */
  function pickFor(product) {
    pick.onchange = async () => {
      const f = pick.files[0]; if (!f) return;
      let path = f.name, i = 2; while (S.stl.has(path)) path = `${i++}_${f.name}`;
      S.stl.set(path, f); buffers.set(path, await f.arrayBuffer()); S.manual[product] = path; pick.value = ''; refresh();
    };
    pick.click();
  }

  async function loadStep() {
    const f = stepIn.files[0]; if (!f) return;
    stepInfo.replaceChildren(icon('info', 14), 'reading…');
    try {
      S.asm = parseStepAssembly(await f.text());
      if (!S.asm.occurrences.length) throw new Error('no assembly structure found – export the whole assembly, not a single part');
      const leaves = S.asm.occurrences.filter((o) => o.leaf).length;
      stepInfo.className = 'stat ok'; stepInfo.replaceChildren(icon('check', 14), `${S.asm.root}: ${S.asm.occurrences.length} occurrences, ${leaves} parts`);
    } catch (e) { S.asm = null; stepInfo.className = 'note'; stepInfo.replaceChildren(icon('error', 14), e.message); }
    refresh();
  }
  async function addStl(input) {
    for (const f of input.files) {
      if (!/\.stl$/i.test(f.name)) continue;
      const path = f.webkitRelativePath || f.name;
      S.stl.set(path, f); buffers.set(path, await f.arrayBuffer());
    }
    input.value = ''; refresh();
  }
  async function loadJson() {
    const f = jsonIn.files[0]; if (!f) return;
    cfg.value = await f.text(); refresh();
  }

  function refresh() {
    stlInfo.className = S.stl.size ? 'stat ok' : 'stat'; stlInfo.replaceChildren(icon(S.stl.size ? 'check' : 'info', 14), `${S.stl.size} STL file${S.stl.size === 1 ? '' : 's'}`);
    const c = parsedConfig();
    const rows = [];
    let missing = 0, total = 0;
    if (S.asm) {
      let stl; try { stl = lookup(c?.stl); } catch (e) { stl = lookup(); rows.push(h('div', { class: 'note' }, icon('warning', 13), e.message)); }
      const byProduct = new Map();
      for (const o of S.asm.occurrences.filter((x) => x.leaf)) {
        const e = byProduct.get(o.product) ?? { n: 0, o }; e.n++; byProduct.set(o.product, e);
      }
      const items = [...byProduct].map(([product, { n, o }]) => {
        const hit = stl.find(product, o.path.slice(0, -1));
        const servo = isServoPart(c, product), ignored = c?.ignore?.includes(product);
        return { product, n, hit, servo, ignored, ok: Boolean(hit || servo || ignored) };
      }).sort((a, b) => Number(a.ok) - Number(b.ok)); // parts that still need a file come first
      for (const it of items) {
        if (!it.servo && !it.ignored) { total++; if (!it.hit) missing++; }
        const label = it.hit ? it.hit.file : it.servo ? `library servo${c?.servoModel ? ` ${c.servoModel.library}` : ''}` : it.ignored ? 'ignored' : 'needs an STL';
        rows.push(h('div', { class: it.ok ? 'stat' : 'note', 'data-product': it.product },
          icon(it.hit ? 'check' : it.servo ? 'servo' : it.ignored ? 'info' : 'warning', 13), `${it.product}${it.n > 1 ? ` ×${it.n}` : ''}`,
          h('span', { class: 'unit' }, label),
          it.servo || it.ignored ? h('span', { class: 'ib-slot' }) : ib('import', it.hit ? `Use a different STL for ${it.product}` : `Choose the STL file for ${it.product}`, () => pickFor(it.product), { act: 'pick-part', size: 15 })));
      }
    }
    matches.replaceChildren(...rows);
    partsInfo.replaceChildren(...(S.asm ? [icon(missing ? 'warning' : 'check', 14), missing ? `${total - missing}/${total} parts have an STL – use the import icon on a row, or add a folder` : `all ${total} parts have an STL`] : []));
    partsInfo.className = !S.asm ? 'stat' : missing ? 'note' : 'stat ok';
    suggest.disabled = !(S.asm && S.stl.size);
    build.disabled = !(S.asm && S.stl.size && c && !c.__error);
    if (c?.__error) setStatus('err', `robot.json: ${c.__error}`);
    else if (!S.asm) setStatus('info', 'choose the STEP file exported from your CAD assembly');
    else if (!S.stl.size) setStatus('info', 'add the STL files (or a whole folder) of the parts');
    else if (!c) setStatus('info', 'click Suggest for a starting robot.json, or load your own');
    else setStatus('ok', 'ready to build');
  }

  async function doSuggest() {
    try {
      const { config, notes } = suggestConfig({ asm: S.asm, stl: lookup(parsedConfig()?.stl), index: await loadIndex(fetchReader()) });
      cfg.value = JSON.stringify(config, null, 2); refresh();
      if (notes.length) setStatus('err', notes.join(' · '));
    } catch (e) { setStatus('err', e.message); }
  }

  async function doBuild() {
    build.disabled = true; setStatus('info', 'building…');
    try {
      const config = JSON.parse(cfg.value);
      const reader = fetchReader();
      const { project, warnings } = await buildRobot({ asm: S.asm, stl: lookup(config.stl), config, reader, index: await loadIndex(reader) });
      if (onBuilt(project, warnings) !== false) close(); else refresh();
    } catch (e) { setStatus('err', e.message); build.disabled = false; }
  }

  const t = h('div', { class: 'card-title' }, h('span', {}, icon('assembly', 18), 'Build from STEP'), ib('close', 'Close', close));
  box.replaceChildren(t,
    h('div', { class: 'row', 'data-tip': 'The assembly exported from your CAD as STEP (.stp / .step)' }, icon('assembly', 18), stepIn), stepInfo,
    h('div', { class: 'row', 'data-tip': 'STL files of the parts – matched to the STEP parts by name (case and _ - are ignored). Or pick a file for one part in the list below.' }, icon('box', 18), stlIn),
    h('div', { class: 'btns' }, ib('open', 'Search a whole folder (including sub-folders) for the parts of the list below', () => dirIn.click(), { label: 'Folder', act: 'pick-folder' }), dirIn, stlInfo),
    h('div', { class: 'row', 'data-tip': 'Optional: a robot.json you already have' }, icon('file', 18), jsonIn),
    partsInfo, matches, pick,
    cfg,
    status,
    h('div', { class: 'btns' }, suggest, build, h('span', { class: 'unit' }, 'check the robot.json against your CAD')));
  refresh();
}
