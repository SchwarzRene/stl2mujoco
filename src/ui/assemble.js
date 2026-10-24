// Guided "Mate" workflow (Solid Edge style):
//   1. click the surface / hole / marker on the part to MOVE   2. click the surface / hole / marker on the TARGET
//   3. choose the relationship (rigid / revolute / slider / ball), flip, offset, rotation – the part snaps live.
import { addConnector, applyMate, defaultMate } from '../core/mates.js';
import { isDescendant } from '../core/project.js';
import { h, ib, seg, num } from './kit.js';
import { icon } from './icons.js';

const zAxis = (q) => { const [x, y, z, w] = q; return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)]; };
const RELS = [['rigid', 'link', 'Rigid – welded together'], ['revolute', 'hinge', 'Revolute – hinge about the connector Z axis'], ['slider', 'slider', 'Slider – moves along the connector Z axis'], ['ball', 'ball', 'Ball – rotates freely']];
const SNAPS = [['auto', 'sparkles', 'Auto snap – hole centre, then face centre'], ['point', 'connector', 'Exact point'], ['vertex', 'vertex', 'Nearest corner'], ['edge', 'edge', 'Edge midpoint']];

export function createAssembler({ app, viewport, el, flash, refresh }) {
  const st = { active: false, A: null, B: null, spec: null, backup: null };
  const node = (id) => app.project.nodes[id];
  const connName = (ref) => (ref ? `${node(ref.node).name} › ${node(ref.node).connectors.find((c) => c.id === ref.id)?.name}` : '');

  function snapshot(id) {
    const ids = [], walk = (i) => { ids.push(i); Object.values(app.project.nodes).filter((n) => n.parent === i).forEach((c) => walk(c.id)); };
    walk(id);
    return ids.map((i) => [i, JSON.parse(JSON.stringify(node(i)))]);
  }
  function restore(b) { for (const [i, n] of b) app.project.nodes[i] = n; }

  function connectorFromSnap(nodeId, s) {
    const n = node(nodeId), part = app.project.parts[n.part], k = part.unitScale;
    const pos = s.pos.map((v) => v * k);
    const nrm = s.normal, dup = n.connectors.find((c) => Math.hypot(c.pos[0] - pos[0], c.pos[1] - pos[1], c.pos[2] - pos[2]) < 2e-4
      && Math.abs(zAxis(c.quat).reduce((t, v, i) => t + v * nrm[i], 0)) > 0.99);
    if (dup) return { node: nodeId, id: dup.id };
    const nm = `${s.kind === 'circle' ? 'hole' : s.kind === 'edge-mid' ? 'edge' : s.kind}_${n.connectors.length + 1}`;
    return { node: nodeId, id: addConnector(n, { name: nm, pos, normal: s.normal }).id };
  }

  function pick(ref) {
    if (!st.A) { st.A = ref; }
    else if (!st.B) {
      if (ref.node === st.A.node) { flash('Pick the second point on a different part.'); return; }
      if (isDescendant(app.project, ref.node, st.A.node)) { flash(`“${node(ref.node).name}” is attached to the part you are moving – pick another target.`); return; }
      st.B = ref;
      st.backup = snapshot(st.A.node);
      st.spec = { ...defaultMate(), moverConn: st.A.id, targetNode: st.B.node, targetConn: st.B.id };
      apply();
    } else return;
    viewport.highlightConnectors([st.A?.id, st.B?.id].filter(Boolean));
    render();
  }

  function apply() {
    try { applyMate(app.project, st.A.node, st.spec); viewport.setProject(app.project); viewport.select(st.A.node); app.selected = st.A.node; refresh(); }
    catch (e) { flash(e.message); }
  }

  function start() {
    Object.assign(st, { active: true, A: null, B: null, spec: null, backup: null });
    viewport.setPickMode(true); viewport.highlightConnectors([]); render();
  }
  function stop(keep = true) {
    if (!keep && st.backup) { restore(st.backup); viewport.setProject(app.project); refresh(); }
    st.active = false; viewport.setPickMode(false); viewport.highlightConnectors([]); render();
  }

  viewport.onSurface = ({ node: id, snap }) => { if (st.active) pick(connectorFromSnap(id, snap)); };
  viewport.onMarker = (ref) => { if (st.active) pick(ref); };

  function render() {
    if (!st.active) { el.style.display = 'none'; el.replaceChildren(); return; }
    el.style.display = 'block';
    const step = !st.A ? 1 : !st.B ? 2 : 3;
    const row = (n, ic, tip, ref) => h('div', { class: `step${step === n ? ' now' : ''}${ref ? ' done' : ''}`, 'data-tip': tip }, h('b', {}, ref ? icon('check', 14) : n), icon(ic, 18), h('div', {}, ref ? h('em', {}, connName(ref)) : h('span', {}, step === n ? 'click here in the 3D view' : '')));
    const kids = [
      h('div', { class: 'card-title' }, h('span', {}, icon('mate', 18), 'Mate'), h('span', {}, step === 3 ? ib('undo', 'Undo the mate', () => stop(false)) : null, ib(step === 3 ? 'check' : 'close', step === 3 ? 'Accept' : 'Cancel  (Esc)', () => { if (step === 3) flash(`“${node(st.A.node).name}” is now ${st.spec.type} to “${node(st.spec.targetNode).name}”.`); stop(true); }, { primary: step === 3 }))),
      row(1, 'box', 'Step 1 – the part that moves: click a hole, face, edge or a green marker', st.A),
      row(2, 'partOnly', 'Step 2 – the part it attaches to', st.B),
      h('div', { class: 'r' }, icon('sparkles', 16), seg(SNAPS.map(([k, ic, tip]) => ({ icon: ic, tip, on: viewport.snapMode === k, onclick: () => { viewport.snapMode = k; render(); } })))),
    ];
    if (step === 3) {
      const sp = st.spec, upd = (f) => { f(); apply(); render(); };
      kids.push(
        h('div', { class: 'r' }, icon('mate', 16), seg(RELS.map(([k, ic, tip]) => ({ icon: ic, tip, on: sp.type === k, onclick: () => upd(() => (sp.type = k)) }))),
          ib('flip', 'Flip – align the Z axes instead of facing each other', () => upd(() => (sp.flip = !sp.flip)), { on: sp.flip })),
        h('div', { class: 'r' }, num(sp.offset * 1000, (v) => upd(() => (sp.offset = v / 1000)), { step: 0.5, unit: 'mm', icon: 'move', tip: 'Offset along the connector Z axis' }),
          num((sp.rotation * 180) / Math.PI, (v) => upd(() => (sp.rotation = (v * Math.PI) / 180)), { step: 15, unit: '°', icon: 'rotate', tip: 'Rotation about the connector Z axis' })),
      );
      if (['revolute', 'slider'].includes(sp.type)) {
        const k = sp.type === 'slider' ? 1000 : 180 / Math.PI, r = sp.range ?? [-Math.PI / 2, Math.PI / 2], u = sp.type === 'slider' ? 'mm' : '°';
        kids.push(h('div', { class: 'r' }, icon('limits', 16), num(r[0] * k, (v) => upd(() => (sp.range = [v / k, (sp.range ?? r)[1]])), { step: 5, unit: u, tip: 'Lower limit' }), num(r[1] * k, (v) => upd(() => (sp.range = [(sp.range ?? r)[0], v / k])), { step: 5, unit: u, tip: 'Upper limit' })));
      }
    } else kids.push(h('div', { class: 'help' }, icon('connector', 13), ' green markers = ready-made mounting points'));
    el.replaceChildren(...kids);
  }
  return { start, stop, render, get active() { return st.active; } };
}
