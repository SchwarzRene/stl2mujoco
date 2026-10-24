import { Matrix4 } from 'three';
import { fetchReader, loadIndex, instantiate } from '../core/library.js';
import { bbox } from '../core/mesh.js';
import { poseToMatrix } from '../core/project.js';
import { h, ib } from './kit.js';
import { icon } from './icons.js';

const reader = fetchReader(`${import.meta.env.BASE_URL}standard_parts`);
let index = null, error = '', rerenderFn = null;
const open = new Set(['Servos']);
const CAT_ICON = { Servos: 'servo', Fasteners: 'fastener', Motors: 'motor', Sensors: 'chip', Brackets: 'link', Structure: 'box', Other: 'box' };

export async function initLibrary(rerender) {
  rerenderFn = rerender;
  try { index = await loadIndex(reader); error = ''; } catch (e) { error = `standard_parts/ not available (${e.message})`; }
  rerender();
}
export const reloadLibrary = () => initLibrary(rerenderFn ?? (() => {}));

function robotMaxX(project) {
  let mx = null;
  for (const n of Object.values(project.nodes)) {
    const p = project.parts[n.part]; if (!p) continue;
    const m = poseToMatrix(n.partPose).multiply(new Matrix4().makeScale(p.unitScale, p.unitScale, p.unitScale));
    const b = bbox(p.positions, m.elements); mx = mx == null ? b.max[0] : Math.max(mx, b.max[0]);
  }
  return mx;
}

export function renderLibrary(ctx) {
  const { app, flash } = ctx;
  if (error) return h('div', { class: 'empty' }, icon('warning', 26), h('div', {}, error));
  if (!index) return h('div', { class: 'empty' }, icon('library', 26), h('div', {}, 'loading…'));
  let q = '';
  const list = h('div', {});
  const draw = () => {
    const cats = {};
    for (const e of index) if (!q || `${e.name} ${e.category} ${(e.tags || []).join(' ')}`.toLowerCase().includes(q)) (cats[e.category] ??= []).push(e);
    list.replaceChildren(...Object.entries(cats).map(([cat, items]) => h('details', { open: open.has(cat) || !!q, ontoggle: (ev) => (ev.target.open ? open.add(cat) : open.delete(cat)) },
      h('summary', {}, icon(CAT_ICON[cat] ?? 'box', 16), `${cat}`, h('span', { class: 'unit' }, items.length)),
      items.map((e) => h('div', { class: 'lib-item', 'data-tip': `Add ${e.name}`, onclick: () => add(e) }, icon(CAT_ICON[cat] ?? 'box', 16), h('span', { class: 'nm' }, e.name), plusIcon())))));
  };
  const plusIcon = () => { const i = icon('plus', 15); i.classList.add('plus'); return i; };
  async function add(entry) {
    try {
      const mx = robotMaxX(app.project);
      const count = new Set(Object.values(app.project.nodes).filter((n) => n.library?.id === entry.id).map((n) => n.library.group)).size;
      const at = new Matrix4().makeTranslation(mx == null ? 0 : mx + 0.06, 0, 0);
      const nodes = await instantiate(app.project, reader, entry, { at, count: count ? count + 1 : 0 });
      ctx.onLibraryAdded(nodes);
      flash(`Added ${entry.name} – use Mate (link icon) to attach it.`);
    } catch (e) { flash(`Could not add ${entry.name}: ${e.message}`); }
  }
  const box = h('div', {},
    ib('sparkles', 'Let a headless Claude Code session read a datasheet and create the part', () => ctx.act.openDatasheet(), { primary: true, label: 'From datasheet', act: 'datasheet' }),
    h('label', { class: 'search' }, icon('search', 15), h('input', { type: 'text', placeholder: 'servo, M3 …', oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } })), list);
  draw();
  return box;
}
