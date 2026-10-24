import { Viewport } from './ui/viewport.js';
import {
  newProject, addPart, addPrimitive, addNode, removeNode, subtreeIds, children, roots, polarArray, mirrorSubtree,
  dropToFloor, validate, isDescendant, poseFromEulerDeg, eulerDegFromPose, poseToMatrix,
} from './core/project.js';
import { ROLES, MATERIALS, SERVO_PRESETS, applyRole } from './core/presets.js';
import { parseSTL } from './core/stl.js';
import { nodeInertial } from './core/mjcf.js';
import { saveProjectZip, loadProjectZip, exportMujocoZip } from './core/io.js';

const app = { project: newProject('my_robot'), selected: null, tab: 'part', msg: '' };
const $ = (s) => document.querySelector(s);
const deg = (r) => (r * 180) / Math.PI, rad = (d) => (d * Math.PI) / 180;
const round = (v, n = 3) => +Number(v).toFixed(n);

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}

const viewport = new Viewport($('#viewport'), {
  onPick: (id) => select(id),
  onEdit: () => {},
  onEditEnd: () => renderRight(),
});

function select(id) { app.selected = id; viewport.select(id); renderLeft(); renderRight(); }
function structural(keepSel = true) {
  viewport.setProject(app.project);
  if (!keepSel || !app.project.nodes[app.selected]) app.selected = null;
  viewport.select(app.selected); renderLeft(); renderRight();
}
function changed() { viewport.refresh(); }
const node = () => app.project.nodes[app.selected];

/* ------------------------------ import ------------------------------ */
const UNITS = { mm: 0.001, cm: 0.01, m: 1, inch: 0.0254 };
let importUnit = 'mm';

async function importFiles(files) {
  const p = app.project;
  for (const f of files) {
    try {
      const positions = parseSTL(await f.arrayBuffer());
      const name = f.name.replace(/\.stl$/i, '');
      const part = addPart(p, { name, positions, unitScale: UNITS[importUnit] });
      const parent = node()?.id ?? null;
      const first = Object.keys(p.nodes).length === 0;
      const frame = parent ? undefined : { pos: [0, 0, 0], quat: [0, 0, 0, 1] };
      const n = addNode(p, { name, parent, partId: part.id, role: first ? 'base-fixed' : 'link', frame });
      app.selected = n.id;
      if (!part.stats.watertight) flash(`"${name}" is not a clean closed mesh (${part.stats.openEdges} open / ${part.stats.nonManifoldEdges} non-manifold edges) – mass uses it anyway; consider an explicit mass.`);
    } catch (e) { flash(`Could not import ${f.name}: ${e.message}`); }
  }
  structural(true); viewport.frameAll();
}

function pickFiles(accept, multiple, cb) {
  const i = h('input', { type: 'file', accept, multiple, onchange: () => cb([...i.files]) });
  i.click();
}
function download(name, bytes, type = 'application/zip') {
  const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type })), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function flash(msg) { app.msg = msg; $('#hint').textContent = msg; setTimeout(() => { if (app.msg === msg) $('#hint').textContent = HINT; }, 7000); }
const HINT = 'Left-click: select · drag: orbit · right-drag: pan · wheel: zoom · W/E: move/rotate · Del: delete';

/* ------------------------------ toolbar ------------------------------ */
function renderToolbar() {
  const t = $('#toolbar'); t.replaceChildren(
    h('span', { class: 'title' }, 'stl2', h('span', {}, 'mujoco')),
    h('select', { title: 'Unit of the STL files you import', onchange: (e) => (importUnit = e.target.value) },
      Object.keys(UNITS).map((u) => h('option', { value: u, selected: u === importUnit }, `STL in ${u}`))),
    h('button', { class: 'primary', onclick: () => pickFiles('.stl', true, importFiles) }, '＋ Import STL parts'),
    h('button', { onclick: () => { const d = addPrimitive(app.project, 'box', [0.05, 0.05, 0.05]); addPrimitiveNode(d); } }, '＋ Box'),
    h('button', { onclick: () => { const d = addPrimitive(app.project, 'cylinder', [0.02, 0.05]); addPrimitiveNode(d); } }, '＋ Cylinder'),
    h('span', { style: 'flex:1' }),
    h('button', { onclick: () => { const s = dropToFloor(app.project); changed(); renderRight(); flash(`Moved robot ${round(s * 1000, 1)} mm so it rests on the floor.`); } }, 'Drop to floor'),
    h('button', { onclick: () => pickFiles('.zip', false, async ([f]) => { try { app.project = await loadProjectZip(await f.arrayBuffer()); app.selected = null; structural(false); viewport.frameAll(); } catch (e) { flash(e.message); } }) }, 'Open project'),
    h('button', { onclick: async () => download(`${app.project.name}.s2m.zip`, await saveProjectZip(app.project)) }, 'Save project'),
    h('button', { class: 'primary', onclick: doExport }, '⬇ Export MuJoCo'),
  );
}
function addPrimitiveNode(part) {
  const p = app.project, first = !Object.keys(p.nodes).length, parent = node()?.id ?? null;
  const n = addNode(p, { name: part.name, parent, partId: part.id, role: first ? 'base-fixed' : 'link' });
  app.selected = n.id; structural(true);
}
async function doExport() {
  try {
    const res = await exportMujocoZip(app.project);
    download(`${app.project.name}_mujoco.zip`, res.data);
    const mass = res.report.reduce((s, r) => s + r.mass, 0);
    flash(`Exported ${res.report.length} bodies, total mass ${mass.toFixed(3)} kg. Unzip, then: python -m mujoco.viewer --mjcf=<folder>/model.xml`);
  } catch (e) { flash(e.message.split('\n')[0]); renderRight(); }
}

/* ------------------------------ left: tree ------------------------------ */
function renderLeft() {
  const L = $('#left'), p = app.project;
  const items = [];
  const walk = (n, d) => {
    const badge = n.actuator ? 'servo' : n.joint.type === 'free' ? 'base' : '';
    items.push(h('div', { class: 'tree-item' + (n.id === app.selected ? ' sel' : ''), style: `padding-left:${6 + d * 14}px`, onclick: () => select(n.id) },
      h('span', {}, n.joint.type === 'fixed' ? '▪' : '↻'), h('span', { style: 'flex:1;overflow:hidden;text-overflow:ellipsis' }, n.name),
      h('span', { class: 'badge ' + badge }, n.joint.type === 'fixed' ? 'fixed' : n.actuator ? `${n.joint.type}·${n.actuator.kind}` : n.joint.type)));
    for (const c of children(p, n.id)) walk(c, d + 1);
  };
  for (const r of roots(p)) walk(r, 0);
  L.replaceChildren(
    h('h3', {}, 'Robot structure'),
    ...(items.length ? items : [h('div', { class: 'empty' }, 'Import your STL parts to start.', h('br'), 'The first part becomes the base; select a part and import more to attach them as children.')]),
    h('h3', {}, 'Project'),
    field('Name', h('input', { type: 'text', value: p.name, onchange: (e) => { p.name = e.target.value; } })),
    h('h3', {}, 'Simulation'),
    field('Timestep (s)', numInput(p.settings.timestep, (v) => (p.settings.timestep = v), 0.0005)),
    field('Gravity z', numInput(p.settings.gravity[2], (v) => (p.settings.gravity[2] = v), 0.1)),
    field('Floor', h('input', { type: 'checkbox', checked: p.settings.floor, onchange: (e) => (p.settings.floor = e.target.checked) })),
    field('Sensors', h('input', { type: 'checkbox', checked: p.settings.sensors, onchange: (e) => (p.settings.sensors = e.target.checked) })),
    field('IMU on base', h('input', { type: 'checkbox', checked: p.settings.imu, onchange: (e) => (p.settings.imu = e.target.checked) })),
    field('Max collision tris', numInput(p.settings.collisionTriangles, (v) => (p.settings.collisionTriangles = Math.max(100, v | 0)), 1000)),
    h('div', { class: 'help' }, 'Visual meshes are exported 1:1. Collision meshes above this triangle count are simplified (MuJoCo uses their convex hull).'),
  );
}

/* ------------------------------ right: inspector ------------------------------ */
const field = (label, ...inputs) => h('div', { class: 'row' }, h('label', {}, label), inputs.length > 1 ? h('div', { style: 'display:flex;gap:4px' }, inputs) : inputs[0]);
function numInput(value, onset, step = 0.001, { min, max } = {}) {
  const i = h('input', { type: 'number', value: round(value, 6), step, min, max });
  i.addEventListener('change', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) { onset(v); changed(); } });
  return i;
}
function vec3Rows(label, get, set, step) {
  const v = get();
  return h('div', { class: 'row three' }, h('label', {}, label), v.map((x, k) => numInput(x, (nv) => { const a = get(); a[k] = nv; set(a); }, step)));
}

function renderRight() {
  const R = $('#right'), n = node(), p = app.project;
  const issues = validate(p);
  const issueEls = issues.length ? issues.map((i) => h('div', { class: 'issue ' + i.level, onclick: () => i.node && select(i.node) }, (i.level === 'error' ? '✖ ' : '⚠ ') + i.msg))
    : [h('div', { class: 'issue ok' }, '✔ Ready to export')];
  if (!n) { R.replaceChildren(h('h3', {}, 'Inspector'), h('div', { class: 'empty' }, 'Select a part in the 3D view or the structure list.'), h('h3', {}, 'Checks'), ...issueEls); return; }

  const part = p.parts[n.part];
  let inertial = null, inertErr = '';
  try { inertial = nodeInertial(p, n); } catch (e) { inertErr = e.message; }

  const targetBtn = (t, label) => h('button', { class: viewport.target === t ? 'on' : '', onclick: () => { viewport.target = t; viewport.refresh(); renderRight(); } }, label);
  const modeBtn = (m, label) => h('button', { class: viewport.gizmo.mode === m ? 'on' : '', onclick: () => { viewport.setMode(m); renderRight(); } }, label);

  const descendants = new Set(subtreeIds(p, n.id));
  const parents = Object.values(p.nodes).filter((x) => !descendants.has(x.id));

  const framePose = n.frame, partPose = n.partPose;
  const poseRows = (label, pose) => [
    vec3Rows(`${label} pos mm`, () => pose.pos.map((v) => v * 1000), (a) => { pose.pos = a.map((v) => v / 1000); changed(); }, 0.1),
    vec3Rows(`${label} rot °`, () => eulerDegFromPose(pose), (a) => { pose.quat = poseFromEulerDeg([0, 0, 0], a).quat; changed(); }, 1),
  ];

  const j = n.joint, unit = j.type === 'slide' ? 1000 : 180 / Math.PI;
  const rangeOn = !!j.range;
  const preview = viewport.preview[n.id] || 0;

  const sec = [
    h('h3', {}, 'Selected part'),
    field('Name', h('input', { type: 'text', value: n.name, onchange: (e) => { n.name = e.target.value; renderLeft(); } })),
    field('Role', h('select', { onchange: (e) => { applyRole(n, e.target.value); structural(true); } },
      Object.entries(ROLES).map(([k, r]) => h('option', { value: k, selected: k === n.role }, r.label)))),
    h('div', { class: 'help' }, ROLES[n.role]?.help ?? ''),
    n.role === 'servo' ? field('Servo preset', h('select', { onchange: (e) => { applyRole(n, 'servo', SERVO_PRESETS[e.target.value]); renderRight(); } },
      h('option', {}, '— choose —'), Object.keys(SERVO_PRESETS).map((k) => h('option', {}, k)))) : null,
    field('Parent', h('select', { onchange: (e) => { n.parent = e.target.value || null; structural(true); } },
      h('option', { value: '' }, '(world)'), parents.map((x) => h('option', { value: x.id, selected: x.id === n.parent }, x.name)))),
    field('Color', h('input', { type: 'color', value: n.color, oninput: (e) => { n.color = e.target.value; changed(); } })),

    h('h3', {}, 'Placement (reference pose, joints at 0)'),
    h('div', { class: 'btns' }, 'Gizmo:', modeBtn('translate', 'Move'), modeBtn('rotate', 'Rotate')),
    h('div', { class: 'btns' }, 'Edit:', targetBtn('both', 'Part + joint'), targetBtn('part', 'Part only'), targetBtn('frame', 'Joint frame only')),
    field('With children', h('input', { type: 'checkbox', checked: viewport.withSubtree, onchange: (e) => (viewport.withSubtree = e.target.checked) })),
    h('div', { class: 'help' }, '"Joint frame" = origin/orientation of the joint (body frame). Its Z/X/Y axes are shown in the 3D view.'),
    ...poseRows('Frame', framePose),
    part ? poseRows('Part', partPose) : null,
  ];

  sec.push(h('h3', {}, 'Joint'), field('Type', h('select', { onchange: (e) => { j.type = e.target.value; if (j.type === 'fixed') n.actuator = null; structural(true); } },
    ['fixed', 'hinge', 'slide', 'ball', 'free'].map((t) => h('option', { selected: t === j.type }, t)))));
  if (j.type === 'hinge' || j.type === 'slide') {
    sec.push(
      vec3Rows('Axis (frame)', () => j.axis, (a) => { j.axis = a; changed(); }, 0.1),
      h('div', { class: 'btns' }, ['X', 'Y', 'Z'].map((a, k) => h('button', { onclick: () => { j.axis = [0, 0, 0]; j.axis[k] = 1; changed(); renderRight(); } }, `Axis ${a}`)), h('button', { onclick: () => { j.axis = j.axis.map((v) => -v); changed(); renderRight(); } }, 'Flip')),
      field('Limited', h('input', { type: 'checkbox', checked: rangeOn, onchange: (e) => { j.range = e.target.checked ? (j.type === 'slide' ? [-0.02, 0.02] : [-Math.PI / 2, Math.PI / 2]) : null; renderRight(); } })),
      rangeOn ? h('div', { class: 'row two' }, h('label', {}, j.type === 'slide' ? 'Range mm' : 'Range °'),
        numInput(j.range[0] * unit, (v) => (j.range[0] = v / unit), 1), numInput(j.range[1] * unit, (v) => (j.range[1] = v / unit), 1)) : null,
      field('Damping', numInput(j.damping, (v) => (j.damping = v), 0.01)),
      field('Friction loss', numInput(j.frictionloss, (v) => (j.frictionloss = v), 0.005)),
      field('Armature', numInput(j.armature, (v) => (j.armature = v), 0.001)),
      h('div', { class: 'row' }, h('label', {}, 'Test pose'),
        h('input', { type: 'range', min: rangeOn ? j.range[0] : -Math.PI, max: rangeOn ? j.range[1] : Math.PI, step: 0.01, value: preview,
          oninput: (e) => { viewport.preview[n.id] = parseFloat(e.target.value); viewport.refresh(); } })),
      h('div', { class: 'help' }, 'Drag "Test pose" to check the joint moves the way the real robot does. Reset it to 0 to edit placement again.'),
      h('button', { onclick: () => { viewport.preview = {}; viewport.refresh(); renderRight(); } }, 'Reset all test poses'),
    );
  }
  if (n.actuator) {
    const a = n.actuator, u = j.type === 'slide' ? 1000 : 180 / Math.PI;
    sec.push(h('h3', {}, 'Actuator'),
      field('Kind', h('select', { onchange: (e) => { a.kind = e.target.value; renderRight(); } }, ['position', 'velocity', 'motor'].map((k) => h('option', { selected: k === a.kind }, k)))),
      a.kind === 'position' ? field('kp', numInput(a.kp, (v) => (a.kp = v), 1)) : null,
      a.kind !== 'motor' ? field('kv', numInput(a.kv, (v) => (a.kv = v), 0.1)) : field('gear', numInput(a.gear, (v) => (a.gear = v), 0.1)),
      a.ctrlrange ? h('div', { class: 'row two' }, h('label', {}, a.kind === 'position' ? (j.type === 'slide' ? 'Ctrl mm' : 'Ctrl °') : 'Ctrl range'),
        numInput(a.ctrlrange[0] * (a.kind === 'position' ? u : 1), (v) => (a.ctrlrange[0] = v / (a.kind === 'position' ? u : 1)), 1),
        numInput(a.ctrlrange[1] * (a.kind === 'position' ? u : 1), (v) => (a.ctrlrange[1] = v / (a.kind === 'position' ? u : 1)), 1)) : null,
      field('Max force/torque', numInput(a.forcerange ?? 0, (v) => (a.forcerange = v > 0 ? v : null), 0.1)),
      h('div', { class: 'help' }, 'Position servo: τ = kp·(ctrl − q) − kv·q̇, clipped to ± max torque (N·m).'),
    );
  } else if (['hinge', 'slide'].includes(j.type)) {
    sec.push(h('button', { onclick: () => { n.actuator = { kind: 'position', kp: 20, kv: 0.6, ctrlrange: j.range ? [...j.range] : [-1.57, 1.57], forcerange: 1, gear: 1 }; renderRight(); } }, '＋ Add actuator'));
  }

  if (part) {
    sec.push(h('h3', {}, 'Mass & inertia'),
      field('Mass from', h('select', { onchange: (e) => { n.mass.mode = e.target.value; renderRight(); } },
        h('option', { value: 'density', selected: n.mass.mode === 'density' }, 'material density (volume)'), h('option', { value: 'explicit', selected: n.mass.mode === 'explicit' }, 'measured mass (kg)'))),
      n.mass.mode === 'density'
        ? [field('Material', h('select', { onchange: (e) => { n.mass.density = MATERIALS[e.target.value]; renderRight(); } },
            h('option', {}, '— choose —'), Object.keys(MATERIALS).map((k) => h('option', {}, k)))), field('Density kg/m³', numInput(n.mass.density, (v) => { n.mass.density = v; renderRight(); }, 10))]
        : field('Mass (g)', numInput(n.mass.mass * 1000, (v) => { n.mass.mass = v / 1000; renderRight(); }, 1)),
      inertial ? h('div', { class: 'stat' }, `Volume ${(inertial.volume * 1e6).toFixed(2)} cm³ · mass ${(inertial.mass * 1000).toFixed(1)} g`, h('br'),
        `COM (frame, mm): ${inertial.com.map((v) => (v * 1000).toFixed(1)).join(', ')}`, h('br'),
        `Principal-ish Ixx/Iyy/Izz (kg·mm²): ${inertial.fullinertia.slice(0, 3).map((v) => (v * 1e6).toFixed(1)).join(', ')}`) : h('div', { class: 'stat' }, inertErr),
      h('div', { class: 'stat' }, `Mesh: ${part.stats.triangles.toLocaleString()} triangles, ${part.stats.watertight ? 'watertight ✔' : `NOT clean (${part.stats.openEdges} open / ${part.stats.nonManifoldEdges} non-manifold edges)`}`),
      field('Collision', h('select', { onchange: (e) => (n.collision = e.target.value) }, h('option', { value: 'mesh', selected: n.collision === 'mesh' }, 'mesh (convex hull)'), h('option', { value: 'none', selected: n.collision === 'none' }, 'none (visual only)'))),
    );
  }

  sec.push(h('h3', {}, 'Copy / mirror'),
    h('div', { class: 'btns' },
      h('button', { onclick: () => { const c = parseInt(prompt('Total number of copies (including this one) around the world Z axis?', '6')); if (c > 1) { polarArray(p, n.id, { count: c, stepDeg: 360 / c }); structural(true); } } }, 'Circular array (Z)'),
      ['X', 'Y', 'Z'].map((a, k) => h('button', { onclick: () => { mirrorSubtree(p, n.id, k); structural(true); } }, `Mirror ${a}`))),
    h('div', { class: 'help' }, 'Copies include all children. Mirrored copies get mirrored meshes and flipped hinge axes.'),
    h('div', { class: 'btns' }, h('button', { class: 'danger', onclick: () => { removeNode(p, n.id); app.selected = null; structural(false); } }, 'Delete part + children')),
    h('h3', {}, 'Checks'), issueEls);
  R.replaceChildren(...sec.flat().filter(Boolean));
}

addEventListener('keydown', (e) => {
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  if (e.key === 'w') { viewport.setMode('translate'); renderRight(); }
  if (e.key === 'e') { viewport.setMode('rotate'); renderRight(); }
  if (e.key === 'Delete' && node()) { removeNode(app.project, app.selected); app.selected = null; structural(false); }
});

$('#hint').textContent = HINT;
renderToolbar(); structural(false);
window.s2m = { app, viewport, importFiles, structural, select }; // handy for debugging / tests
