// Top toolbar: icon buttons, status chip (model checks) and settings popover.
import { h, ib, num, put } from './kit.js';
import { icon } from './icons.js';
import { validate } from '../core/project.js';

const UNITS = { mm: 0.001, cm: 0.01, m: 1, inch: 0.0254 };
export const unitScale = (u) => UNITS[u];

export function renderToolbar(ctx) {
  const { app, act } = ctx, T = document.getElementById('toolbar');
  const issues = validate(app.project).filter((i) => Object.keys(app.project.nodes).length || i.level !== 'error'), errs = issues.filter((i) => i.level === 'error').length, warns = issues.length - errs;
  const pop = (k) => () => { app.pop = app.pop === k ? null : k; renderToolbar(ctx); };
  const empty = !Object.keys(app.project.nodes).length;
  const chip = h('button', { class: `chip ${empty ? '' : errs ? 'err' : warns ? 'warn' : 'ok'}`, 'data-tip': empty ? 'Checks – nothing to check yet' : errs ? `${errs} problem(s) block the export` : warns ? `${warns} warning(s)` : 'Ready to export', 'data-act': 'status', onclick: (e) => { e.stopPropagation(); pop('status')(); } },
    icon(empty ? 'info' : errs ? 'error' : warns ? 'warning' : 'check', 15), empty ? '' : errs || warns || '');
  put(T,
    h('span', { class: 'logo' }, icon('mate', 20), h('span', {}, 'stl2', h('b', {}, 'mujoco'))),
    ib('import', 'Import STL parts  (or drop files into the 3D view)', act.import, { primary: true, act: 'import' }),
    ib('assembly', 'Build from a STEP assembly – upload the STEP file and the STL files of its parts', act.openStep, { act: 'step' }),
    ib('mate', 'Mate – attach one part to another like a CAD assembly', act.mate, { primary: true, act: 'mate' }),
    h('span', { class: 'sep' }),
    ib('box', 'Add a box', () => act.addPrimitive('box'), { act: 'box' }),
    ib('cylinder', 'Add a cylinder', () => act.addPrimitive('cylinder'), { act: 'cylinder' }),
    h('select', { class: 'unit-sel', 'data-tip': 'Unit of the STL files you import', onchange: (e) => (app.importUnit = e.target.value) }, Object.keys(UNITS).map((u) => h('option', { value: u, selected: u === app.importUnit }, u))),
    h('span', { style: 'flex:1' }),
    ib('floor', 'Drop the robot onto the floor', act.dropFloor, { act: 'floor' }),
    ib('open', 'Open project', act.open, { act: 'open' }),
    ib('save', 'Save project', act.save, { act: 'save' }),
    h('span', { class: 'sep' }),
    ib('undo', 'Undo  (Ctrl+Z)', act.undo, { act: 'undo', disabled: !ctx.history?.canUndo }),
    ib('redo', 'Redo  (Ctrl+Shift+Z)', act.redo, { act: 'redo', disabled: !ctx.history?.canRedo }),
    h('span', { class: 'sep' }),
    chip,
    ib('sliders', 'Settings', (e) => { e.stopPropagation(); pop('settings')(); }, { act: 'settings', on: app.pop === 'settings' }),
    ib('export', 'Export a MuJoCo model (model.xml + meshes)', act.export, { primary: true, label: 'Export', act: 'export', disabled: empty }),
    app.pop === 'status' ? statusPop(ctx, issues) : null,
    app.pop === 'settings' ? settingsPop(ctx) : null,
  );
}

function statusPop(ctx, issues) {
  return h('div', { class: 'pop', onclick: (e) => e.stopPropagation() }, h('h4', {}, 'Checks'),
    issues.length ? issues.map((i) => h('div', { class: `issue ${i.level}`, onclick: () => { if (i.node) { ctx.app.pop = null; ctx.select(i.node); renderToolbar(ctx); } } }, icon(i.level === 'error' ? 'error' : 'warning', 16), h('span', {}, i.msg)))
      : h('div', { class: 'issue ok' }, icon('check', 16), h('span', {}, 'Everything looks fine – ready to export.')));
}

function settingsPop(ctx) {
  const p = ctx.app.project, s = p.settings;
  const cb = (key, ic, tip) => h('div', { class: 'pr', 'data-tip': tip }, icon(ic, 16), h('span', {}, tip.split(' – ')[0]), h('input', { type: 'checkbox', checked: s[key], onchange: (e) => (s[key] = e.target.checked) }));
  return h('div', { class: 'pop', onclick: (e) => e.stopPropagation() }, h('h4', {}, 'Settings'),
    h('div', { class: 'pr' }, icon('file', 16), h('input', { type: 'text', value: p.name, 'data-tip': 'Project name', onchange: (e) => { p.name = e.target.value; } })),
    h('div', { class: 'pr', 'data-tip': 'Simulation time step' }, icon('play', 16), h('span', {}, 'time step'), num(s.timestep, (v) => (s.timestep = v), { step: 0.0005, unit: 's' })),
    h('div', { class: 'pr', 'data-tip': 'Gravity along Z' }, icon('floor', 16), h('span', {}, 'gravity'), num(s.gravity[2], (v) => (s.gravity[2] = v), { step: 0.1, unit: 'm/s²' })),
    cb('floor', 'baseFixed', 'floor plane – add a ground to the model'),
    cb('sensors', 'actuator', 'sensors – joint position and velocity'),
    cb('imu', 'chip', 'IMU – gyro and accelerometer on the base'),
    h('div', { class: 'pr', 'data-tip': 'Collision meshes above this triangle count are simplified. Visual meshes are exported 1:1.' }, icon('shield', 16), h('span', {}, 'collision detail'), num(s.collisionTriangles, (v) => (s.collisionTriangles = Math.max(100, v | 0)), { step: 1000, unit: 'tris' })));
}
