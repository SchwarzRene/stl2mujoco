// Left panel: structure tree / parts library, plus the start screen for an empty project.
import { h, ib, seg, put } from './kit.js';
import { icon } from './icons.js';
import { children, roots } from '../core/project.js';
import { roleIcon } from './inspector.js';
import { renderLibrary } from './library-panel.js';

export function renderLeft(ctx) {
  const { app } = ctx, L = document.getElementById('left'), p = app.project;
  const tabs = h('div', { class: 'tabs' }, seg([
    { icon: 'tree', tip: 'Robot structure', on: app.leftTab === 'structure', onclick: () => { app.leftTab = 'structure'; renderLeft(ctx); } },
    { icon: 'library', tip: 'Standard parts library – servos, screws …', on: app.leftTab === 'library', onclick: () => { app.leftTab = 'library'; renderLeft(ctx); } },
  ]));
  if (app.leftTab === 'library') { put(L, tabs, renderLibrary(ctx)); return; }
  const items = [];
  const walk = (n, d) => {
    items.push(h('div', { class: `tree-item${n.id === app.selected ? ' sel' : ''}${n.actuator ? ' drive' : ''}`, style: `padding-left:${6 + d * 14}px`, 'data-tip': n.name, onclick: () => ctx.select(n.id) },
      d ? h('span', { class: 'guide', style: `left:${d * 14 - 2}px` }) : null, icon(roleIcon(n), 16), h('span', { class: 'nm' }, n.name)));
    for (const c of children(p, n.id)) walk(c, d + 1);
  };
  for (const r of roots(p)) walk(r, 0);
  put(L, tabs, items.length ? items : h('div', { class: 'empty' }, icon('tree', 28), h('div', {}, 'empty')));
}

export function renderStart(ctx) {
  const S = document.getElementById('start');
  if (Object.keys(ctx.app.project.nodes).length) { put(S); return; }
  const card = (ic, title, sub, fn, act) => h('button', { class: 'start-card', 'data-act': act, onclick: fn }, icon(ic, 34), h('b', {}, title), h('span', {}, sub));
  put(S, h('div', { class: 'start-box' },
    h('h2', {}, 'Build your robot'),
    h('p', {}, 'Start with parts'),
    h('div', { class: 'start-cards' },
      card('import', 'Import', 'STL from your CAD', ctx.act.import, 'start-import'),
      card('library', 'Library', 'servos, screws …', () => { ctx.app.leftTab = 'library'; ctx.renderLeft(); }, 'start-library'),
      card('open', 'Open', 'a saved project', ctx.act.open, 'start-open')),
    h('div', { class: 'drop-hint' }, icon('import', 14), ' drop STL files anywhere')));
}

export function renderGizmoBar(ctx) {
  const { app, viewport } = ctx, G = document.getElementById('gizbar');
  const n = app.project.nodes[app.selected];
  if (!n) { put(G); return; }
  const r = () => renderGizmoBar(ctx);
  put(G,
    seg([{ icon: 'move', tip: 'Move  (W)', on: viewport.gizmo.mode === 'translate', onclick: () => { viewport.setMode('translate'); r(); } }, { icon: 'rotate', tip: 'Rotate  (E)', on: viewport.gizmo.mode === 'rotate', onclick: () => { viewport.setMode('rotate'); r(); } }]),
    seg([{ icon: 'both', tip: 'Move part and joint together', on: viewport.target === 'both', onclick: () => { viewport.target = 'both'; viewport.refresh(); r(); } },
      { icon: 'partOnly', tip: 'Move the part only (joint stays)', on: viewport.target === 'part', onclick: () => { viewport.target = 'part'; viewport.refresh(); r(); } },
      { icon: 'frameOnly', tip: 'Move the joint frame only (part stays)', on: viewport.target === 'frame', onclick: () => { viewport.target = 'frame'; viewport.refresh(); r(); } }]),
    ib('subtree', 'Take all children along', () => { viewport.withSubtree = !viewport.withSubtree; r(); }, { on: viewport.withSubtree }),
  );
}
