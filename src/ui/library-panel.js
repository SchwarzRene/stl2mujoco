import { Matrix4 } from 'three';
import { fetchReader, loadIndex, instantiate } from '../core/library.js';
import { bbox } from '../core/mesh.js';
import { poseToMatrix } from '../core/project.js';

const reader = fetchReader(`${import.meta.env.BASE_URL}standard_parts`);
let index = null, error = '', rerenderFn = null;
const open = new Set(['Servos']);

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

export function renderLibrary({ h, app, onAdded, flash, onDatasheet }) {
  const box = h('div', {});
  if (error) return h('div', { class: 'empty' }, error);
  if (!index) return h('div', { class: 'empty' }, 'Loading library…');
  let q = '';
  const list = h('div', {});
  const draw = () => {
    const cats = {};
    for (const e of index) if (!q || `${e.name} ${e.category} ${(e.tags || []).join(' ')}`.toLowerCase().includes(q)) (cats[e.category] ??= []).push(e);
    list.replaceChildren(...Object.entries(cats).map(([cat, items]) => h('details', { open: open.has(cat) || !!q, ontoggle: (ev) => (ev.target.open ? open.add(cat) : open.delete(cat)) },
      h('summary', {}, `${cat} (${items.length})`),
      items.map((e) => h('div', { class: 'lib-item', title: `Add ${e.name} to the assembly`, onclick: () => add(e) }, h('span', {}, e.name), h('button', {}, '＋'))))));
  };
  async function add(entry) {
    try {
      const mx = robotMaxX(app.project);
      const count = new Set(Object.values(app.project.nodes).filter((n) => n.library?.id === entry.id).map((n) => n.library.group)).size;
      const at = new Matrix4().makeTranslation(mx == null ? 0 : mx + 0.06, 0, 0);
      const nodes = await instantiate(app.project, reader, entry, { at, count: count ? count + 1 : 0 });
      onAdded(nodes);
      flash(`Added ${entry.name}. Use “Mate parts” to attach it to your robot (green markers = mounting points).`);
    } catch (e) { flash(`Could not add ${entry.name}: ${e.message}`); }
  }
  box.append(
    h('button', { class: 'primary', style: 'width:100%;margin-bottom:8px', title: 'Let a headless Claude Code session read a datasheet and create the part', onclick: onDatasheet }, '✨ Add part from datasheet'),
    h('input', { type: 'text', placeholder: 'Search servos, screws, M3…', oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } }),
    h('div', { class: 'help' }, 'Standard parts live in the standard_parts/ folder of the repo (add your own there).'), list);
  draw();
  return box;
}
