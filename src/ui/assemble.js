// Guided "Mate" workflow (Solid Edge style):
//   1. click the surface / hole / marker on the part to MOVE   2. click the surface / hole / marker on the TARGET
//   3. choose the relationship (rigid / revolute / slider / ball), flip, offset, rotation – the part snaps live.
import { addConnector } from '../core/mates.js';
import { applyMate, defaultMate, MATE_TYPES } from '../core/mates.js';
import { isDescendant } from '../core/project.js';

const KIND = { circle: 'hole/boss centre', face: 'face centre', vertex: 'vertex', 'edge-mid': 'edge midpoint', point: 'point' };

export function createAssembler({ app, viewport, el, h, flash, refresh }) {
  const st = { active: false, A: null, B: null, spec: null, backup: null };

  const node = (id) => app.project.nodes[id];
  const connName = (ref) => (ref ? `${node(ref.node).name} › ${node(ref.node).connectors.find((c) => c.id === ref.id)?.name}` : '—');

  function snapshot(id) {
    const ids = [], walk = (i) => { ids.push(i); Object.values(app.project.nodes).filter((n) => n.parent === i).forEach((c) => walk(c.id)); };
    walk(id);
    return ids.map((i) => [i, JSON.parse(JSON.stringify(node(i)))]);
  }
  function restore(b) { for (const [i, n] of b) app.project.nodes[i] = n; }

  function connectorFromSnap(nodeId, s) {
    const n = node(nodeId), part = app.project.parts[n.part], k = part.unitScale;
    const pos = s.pos.map((v) => v * k);
    const dup = n.connectors.find((c) => Math.hypot(c.pos[0] - pos[0], c.pos[1] - pos[1], c.pos[2] - pos[2]) < 2e-4);
    if (dup) return { node: nodeId, id: dup.id };
    const nm = `${s.kind === 'circle' ? 'hole' : s.kind === 'edge-mid' ? 'edge' : s.kind}_${n.connectors.length + 1}`;
    return { node: nodeId, id: addConnector(n, { name: nm, pos, normal: s.normal }).id };
  }

  function pick(ref) {
    if (!st.A) { st.A = ref; }
    else if (!st.B) {
      if (ref.node === st.A.node) { flash('Pick the second connector on a different part.'); return; }
      if (isDescendant(app.project, ref.node, st.A.node)) { flash(`"${node(ref.node).name}" is attached to the part you are moving – pick another target or mate in the other direction.`); return; }
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

  const num = (value, on, step) => { const i = h('input', { type: 'number', value: +value.toFixed(4), step }); i.addEventListener('change', () => on(parseFloat(i.value) || 0)); return i; };

  function render() {
    if (!st.active) { el.style.display = 'none'; el.replaceChildren(); return; }
    el.style.display = 'block';
    const step = !st.A ? 1 : !st.B ? 2 : 3;
    const row = (n, label, done, text) => h('div', { class: 'step' + (step === n ? ' now' : '') + (done ? ' done' : '') }, h('b', {}, done ? '✔' : n), h('span', {}, h('em', {}, label), h('br'), text));
    const kids = [
      h('div', { class: 'card-title' }, '⚙ Mate parts', h('button', { onclick: () => stop(true) }, step === 3 ? 'Done' : 'Cancel')),
      row(1, 'Part to move', !!st.A, st.A ? connName(st.A) : 'Click a hole, face, edge, or a green marker on the part that should move.'),
      row(2, 'Target', !!st.B, st.B ? connName(st.B) : 'Click the hole / face / marker it should attach to.'),
      h('div', { class: 'row' }, h('label', {}, 'Snap to'), h('select', { onchange: (e) => (viewport.snapMode = e.target.value) },
        [['auto', 'Auto (hole centre → face centre)'], ['point', 'Exact point'], ['vertex', 'Vertex'], ['edge', 'Edge midpoint']].map(([v, t]) => h('option', { value: v, selected: viewport.snapMode === v }, t)))),
    ];
    if (step === 3) {
      const sp = st.spec, upd = (f) => { f(); apply(); render(); };
      kids.push(
        h('div', { class: 'row' }, h('label', {}, 'Relationship'), h('select', { onchange: (e) => upd(() => (sp.type = e.target.value)) },
          Object.entries(MATE_TYPES).map(([k, t]) => h('option', { value: k, selected: sp.type === k }, t.label)))),
        h('div', { class: 'row' }, h('label', {}, 'Flip'), h('input', { type: 'checkbox', checked: sp.flip, onchange: (e) => upd(() => (sp.flip = e.target.checked)) })),
        h('div', { class: 'row' }, h('label', {}, 'Offset mm'), num(sp.offset * 1000, (v) => upd(() => (sp.offset = v / 1000)), 0.5)),
        h('div', { class: 'row' }, h('label', {}, 'Rotate °'), num((sp.rotation * 180) / Math.PI, (v) => upd(() => (sp.rotation = (v * Math.PI) / 180)), 15)),
      );
      if (['revolute', 'slider'].includes(sp.type)) {
        const k = sp.type === 'slider' ? 1000 : 180 / Math.PI, r = sp.range ?? [-Math.PI / 2, Math.PI / 2];
        kids.push(h('div', { class: 'row' }, h('label', {}, 'Limits'), h('div', { style: 'display:flex;gap:4px' },
          num(r[0] * k, (v) => upd(() => (sp.range = [v / k, (sp.range ?? r)[1]])), 5), num(r[1] * k, (v) => upd(() => (sp.range = [(sp.range ?? r)[0], v / k])), 5))));
      }
      kids.push(h('div', { class: 'help' }, 'Z axes of the two connectors face each other (like a face-to-face mate). Use Flip to align them instead. Revolute / slider act along the connector Z axis.'),
        h('div', { class: 'btns' }, h('button', { onclick: () => { stop(false); } }, 'Undo mate'), h('button', { class: 'primary', onclick: () => { const t = node(st.A.node); stop(true); flash(`"${t.name}" is now ${st.spec.type} to "${node(st.spec.targetNode).name}".`); } }, 'Accept')));
    } else kids.push(h('div', { class: 'help' }, 'Library parts show green markers at their mounting holes and shaft – click a marker for an exact connection.'));
    el.replaceChildren(...kids);
  }
  return { start, stop, render, get active() { return st.active; } };
}
