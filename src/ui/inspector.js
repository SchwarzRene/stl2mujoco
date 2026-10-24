// Inspector: essentials first, details in collapsible icon sections, rarely used numbers behind "advanced" folds.
import { h, ib, seg, xyz, num, section, put } from './kit.js';
import { icon } from './icons.js';
import { ROLES, MATERIALS, applyRole } from '../core/presets.js';
import { SERVO_SPECS } from '../core/servo-specs.js';
import { newServoState, deriveServo, applyServo } from '../core/servo.js';
import { nodeInertial } from '../core/mjcf.js';
import { reapplyMate } from '../core/mates.js';
import { subtreeIds, removeNode, familyMembers, applyToCopies, linearArray, polarArray, mirrorSubtree, poseFromEulerDeg, eulerDegFromPose } from '../core/project.js';
import { Quaternion } from 'three';

const ROLE_ORDER = ['base', 'base-fixed', 'link', 'servo', 'motor-hinge', 'velocity-hinge', 'slider', 'passive', 'ball'];
const ROLE_ICON = { base: 'baseFree', 'base-fixed': 'baseFixed', link: 'link', servo: 'servo', 'motor-hinge': 'motor', 'velocity-hinge': 'wheel', slider: 'slider', passive: 'hinge', ball: 'ball' };
const JOINT_ICON = { fixed: 'link', hinge: 'hinge', slide: 'slider', ball: 'ball', free: 'baseFree' };
const JOINT_TIP = { fixed: 'Fixed – welded to its parent', hinge: 'Hinge – rotates about the axis', slide: 'Slider – moves along the axis', ball: 'Ball – rotates freely in 3D', free: 'Free – floats in the world (base only)' };
export const roleIcon = (n) => (n.servo ? 'servo' : ROLE_ICON[n.role] ?? 'link');

export function renderInspector(ctx) {
  const { app, viewport } = ctx, p = app.project, n = p.nodes[app.selected], R = document.getElementById('right');
  if (!n) { put(R, h('div', { class: 'empty' }, icon('mate', 30), h('div', {}, 'Click a part in the 3D view or the list'))); return; }
  const rr = () => ctx.rerender(), S = app.open, F = app.fold;
  const part = p.parts[n.part], j = n.joint;
  let inertial = null; try { inertial = nodeInertial(p, n); } catch { /* shown as warning below */ }
  const N = (v, set, o) => num(v, (x) => { set(x); ctx.changed(); }, o);
  const XYZ = (vals, set, o) => xyz(vals, (k, v) => { set(k, v); ctx.changed(); }, o);
  const fold = (key, label, body) => [h('div', { class: `fold${F[key] ? ' open' : ''}`, 'data-tip': `More: ${label}`, onclick: () => { F[key] = !F[key]; rr(); } }, icon('chevron', 12), icon('sliders', 14)), F[key] ? h('div', { class: 'adv' }, body) : null];
  const poseRows = (pose, tag) => [
    h('div', { class: 'r', 'data-tip': `${tag} position (mm)` }, icon('move', 16), XYZ(pose.pos.map((v) => v * 1000), (k, v) => { pose.pos[k] = v / 1000; }, { step: 0.5 })),
    h('div', { class: 'r', 'data-tip': `${tag} rotation (°)` }, icon('rotate', 16), XYZ(eulerDegFromPose(pose), (k, v) => { const e = eulerDegFromPose(pose); e[k] = v; pose.quat = poseFromEulerDeg([0, 0, 0], e).quat; }, { step: 5 })),
  ];

  /* ---------- header: name, role icons, action bar ---------- */
  const fam = familyMembers(p, n.id);
  const head = [
    h('div', { class: 'ins-head' }, icon(roleIcon(n), 20),
      h('input', { class: 'name', type: 'text', value: n.name, 'data-tip': 'Name', onchange: (e) => { n.name = e.target.value; ctx.renderLeft(); } }),
      ib('trash', 'Delete this part and its children  (Del)', () => { removeNode(p, n.id); app.selected = null; ctx.structural(false); }, { danger: true })),
    seg(ROLE_ORDER.map((r) => ({ icon: ROLE_ICON[r], tip: `${ROLES[r].label}\n${ROLES[r].help}`, on: n.role === r, onclick: () => { applyRole(n, r); ctx.structural(true); } }))),
    h('div', { class: 'bar' },
      ib('copy', 'Copy with all children  (Ctrl+C)', () => ctx.act.copy()),
      ib('paste', 'Paste next to the original  (Ctrl+V)', () => ctx.act.paste(false), { disabled: !app.clip }),
      ib('duplicate', 'Duplicate  (Ctrl+D)', () => ctx.act.duplicate()),
      h('div', { class: 'seg', 'data-tip': 'Mirror across a plane (X, Y or Z)' }, h('span', { class: 'ib', style: 'pointer-events:none;min-width:26px' }, icon('mirror', 16)),
        ...['X', 'Y', 'Z'].map((a, k) => h('button', { class: `ib axis-chip a${a.toLowerCase()}`, 'data-tip': `Mirror across the ${a} plane`, onclick: () => { mirrorSubtree(p, n.id, k); ctx.structural(true); } }, a))),
      ib('arrayCircular', 'Circular array around Z…', () => { const c = parseInt(prompt('Total number of copies (including this one) around the world Z axis?', '6')); if (c > 1) { polarArray(p, n.id, { count: c, stepDeg: 360 / c }); ctx.structural(true); } }),
      ib('arrayLinear', 'Linear array…', () => { S.copies = true; rr(); }),
      fam.length ? ib('applyAll', `Apply this part's settings to its ${fam.length} copies`, () => { const c = applyToCopies(p, n.id); viewport.setProject(p); ctx.flash(`Applied settings to ${c} copies.`); rr(); }, { primary: true }) : null),
  ];

  /* ---------- placement ---------- */
  const descendants = new Set(subtreeIds(p, n.id));
  const placement = [
    ...poseRows(part ? n.partPose : n.frame, part ? 'Part' : 'Frame'),
    n.mate ? h('div', { class: 'r' }, icon('mate', 16), h('span', { class: 'pill' }, `${n.mate.type} → ${p.nodes[n.mate.targetNode]?.name ?? '?'}`),
      ib('refresh', 'Snap back to the mate', () => { try { reapplyMate(p, n.id); viewport.setProject(p); rr(); } catch (e) { ctx.flash(e.message); } })) : null,
    ...fold('advPlace', 'advanced', [
      part ? h('div', { class: 'r', 'data-tip': 'Joint frame = origin and orientation of the joint' }, icon('frameOnly', 16), h('span', { class: 'unit' }, 'joint frame')) : null,
      part ? poseRows(n.frame, 'Joint frame') : null,
      h('div', { class: 'r', 'data-tip': 'Parent part' }, icon('tree', 16), h('select', { class: 'grow', onchange: (e) => { n.parent = e.target.value || null; ctx.structural(true); } },
        h('option', { value: '' }, '(world)'), Object.values(p.nodes).filter((x) => !descendants.has(x.id)).map((x) => h('option', { value: x.id, selected: x.id === n.parent }, x.name)))),
      h('div', { class: 'r', 'data-tip': 'Colour' }, icon('eye', 16), h('input', { type: 'color', value: n.color, oninput: (e) => { n.color = e.target.value; ctx.changed(); } })),
    ]),
  ];

  /* ---------- joint ---------- */
  const unit = j.type === 'slide' ? 1000 : 180 / Math.PI, ulabel = j.type === 'slide' ? 'mm' : '°';
  const preview = viewport.preview[n.id] || 0, rangeOn = !!j.range;
  const jointBody = [
    seg(['fixed', 'hinge', 'slide', 'ball', 'free'].map((t) => ({ icon: JOINT_ICON[t], tip: JOINT_TIP[t], on: j.type === t, onclick: () => { j.type = t; if (t === 'fixed') n.actuator = null; ctx.structural(true); } }))),
  ];
  if (j.type === 'hinge' || j.type === 'slide') {
    jointBody.push(
      h('div', { class: 'r', 'data-tip': 'Joint axis (in the joint frame)' }, icon('connector', 16),
        ...['x', 'y', 'z'].map((a, k) => h('button', { class: `ib axis-chip a${a}${j.axis[k] && !j.axis[(k + 1) % 3] && !j.axis[(k + 2) % 3] ? ' on' : ''}`, onclick: () => { j.axis = [0, 0, 0]; j.axis[k] = 1; ctx.changed(); rr(); } }, a.toUpperCase())),
        ib('flip', 'Flip the axis direction', () => { j.axis = j.axis.map((v) => -v); ctx.changed(); rr(); })),
      h('div', { class: 'r' }, ib('limits', 'Limit the travel', () => { j.range = rangeOn ? null : (j.type === 'slide' ? [-0.02, 0.02] : [-Math.PI / 2, Math.PI / 2]); rr(); }, { on: rangeOn }),
        rangeOn ? [N(j.range[0] * unit, (v) => (j.range[0] = v / unit), { step: 5, unit: ulabel, tip: 'Lower limit' }), N(j.range[1] * unit, (v) => (j.range[1] = v / unit), { step: 5, unit: ulabel, tip: 'Upper limit' })] : h('span', { class: 'unit' }, 'no limit')),
      h('div', { class: 'r', 'data-tip': 'Test pose – drag to see the joint move like the real robot' }, icon('play', 16),
        h('input', { type: 'range', min: rangeOn ? j.range[0] : -Math.PI, max: rangeOn ? j.range[1] : Math.PI, step: 0.01, value: preview, oninput: (e) => { viewport.preview[n.id] = parseFloat(e.target.value); viewport.refresh(); } }),
        ib('undo', 'Reset all test poses', () => { viewport.preview = {}; viewport.refresh(); rr(); })),
      ...fold('advJoint', 'advanced', [
        h('div', { class: 'r' }, N(j.damping, (v) => (j.damping = v), { step: 0.01, tip: 'Damping (N·m·s/rad)', icon: 'velocity' }), N(j.frictionloss, (v) => (j.frictionloss = v), { step: 0.005, tip: 'Static friction (N·m)', icon: 'hinge' }), N(j.armature, (v) => (j.armature = v), { step: 0.001, tip: 'Rotor inertia (kg·m²)', icon: 'motor' })),
      ]),
    );
    if (!n.actuator) jointBody.push(h('div', { class: 'r' }, ib('actuator', 'Add an actuator (drive) to this joint', () => { n.actuator = { kind: 'position', kp: 20, kv: 0.6, ctrlrange: j.range ? [...j.range] : [-1.57, 1.57], forcerange: 1, gear: 1 }; rr(); }, { label: 'drive' })));
  }

  /* ---------- actuator (non-servo) ---------- */
  const a = n.actuator, au = j.type === 'slide' ? 1000 : 180 / Math.PI;
  const actuatorBody = a && !n.servo ? [
    seg([['position', 'position', 'Position control – goes to a target angle'], ['velocity', 'velocity', 'Velocity control – spins at a target speed'], ['motor', 'motor', 'Torque control – direct motor torque']].map(([k, ic, tip]) => ({ icon: ic, tip, on: a.kind === k, onclick: () => { a.kind = k; rr(); } }))),
    h('div', { class: 'r' }, N(a.forcerange ?? 0, (v) => (a.forcerange = v > 0 ? v : null), { step: 0.1, unit: 'N·m', tip: 'Maximum torque / force (0 = unlimited)', icon: 'motor' })),
    ...fold('advAct', 'advanced', [
      h('div', { class: 'r' }, a.kind === 'position' ? N(a.kp, (v) => (a.kp = v), { step: 1, tip: 'kp – position gain', icon: 'position' }) : null,
        a.kind !== 'motor' ? N(a.kv, (v) => (a.kv = v), { step: 0.1, tip: 'kv – velocity gain / damping', icon: 'velocity' }) : N(a.gear, (v) => (a.gear = v), { step: 0.1, tip: 'gear ratio', icon: 'wheel' })),
      a.ctrlrange ? h('div', { class: 'r', 'data-tip': 'Command range' }, icon('limits', 16), N(a.ctrlrange[0] * (a.kind === 'position' ? au : 1), (v) => (a.ctrlrange[0] = v / (a.kind === 'position' ? au : 1)), { step: 5 }), N(a.ctrlrange[1] * (a.kind === 'position' ? au : 1), (v) => (a.ctrlrange[1] = v / (a.kind === 'position' ? au : 1)), { step: 5 })) : null,
    ]),
  ] : null;

  /* ---------- servo model ---------- */
  let servoBody = null, servoSummary = '';
  if (n.servo) {
    const sv = n.servo, d = deriveServo(sv), upd = () => { applyServo(n); viewport.refresh(); rr(); };
    servoSummary = `${d.stall_torque.toFixed(2)} N·m`;
    servoBody = [
      h('div', { class: 'r' }, icon('servo', 16), h('select', { class: 'grow', onchange: (e) => { if (e.target.value === 'custom') return; n.servo = newServoState(e.target.value); applyServo(n); viewport.refresh(); rr(); } },
        sv.preset === 'custom' ? h('option', { value: 'custom', selected: true }, `${sv.name} (datasheet)`) : null,
        Object.entries(SERVO_SPECS).map(([k, v]) => h('option', { value: k, selected: sv.preset === k }, v.name)))),
      Object.keys(sv.voltages).length > 1 ? h('div', { class: 'r', 'data-tip': 'Supply voltage' }, icon('motor', 16),
        Object.keys(sv.voltages).map((v) => h('button', { class: `pill btn${v === sv.voltage ? ' on' : ''}`, onclick: () => { sv.voltage = v; upd(); } }, `${v} V`))) : null,
      h('div', { class: 'facts' },
        h('span', { class: 'pill', 'data-tip': 'Stall torque' }, icon('rotate', 14), `${d.stall_torque.toFixed(2)} N·m`, h('span', { class: 'unit' }, `${(d.stall_torque / 0.0980665).toFixed(1)} kgf·cm`)),
        h('span', { class: 'pill', 'data-tip': 'No-load speed' }, icon('velocity', 14), `${d.noload_speed.toFixed(1)} rad/s`, h('span', { class: 'unit' }, `${(d.noload_speed * 60 / (2 * Math.PI)).toFixed(0)} rpm`)),
        h('span', { class: 'pill', 'data-tip': 'Mechanical travel' }, icon('limits', 14), `${sv.range_deg[0]}…${sv.range_deg[1]}°`)),
      ...fold('advServo', 'tuning', [
        h('div', { class: 'r' }, N(sv.range_deg[0], (v) => { sv.range_deg[0] = v; upd(); }, { step: 5, unit: '°', tip: 'Travel – lower limit', icon: 'limits' }), N(sv.range_deg[1], (v) => { sv.range_deg[1] = v; upd(); }, { step: 5, unit: '°', tip: 'Travel – upper limit' })),
        h('div', { class: 'r' }, N(sv.kp_sat_rad, (v) => { sv.kp_sat_rad = Math.max(0.01, v); upd(); }, { step: 0.01, unit: 'rad', tip: 'Error at which the servo reaches full torque', icon: 'position' }), N(sv.armature, (v) => { sv.armature = Math.max(0, v); upd(); }, { step: 0.001, tip: 'Rotor inertia (kg·m²)', icon: 'motor' })),
        h('div', { class: 'r' }, N(sv.frictionloss_frac, (v) => { sv.frictionloss_frac = Math.max(0, v); upd(); }, { step: 0.01, tip: 'Static friction as a fraction of stall torque', icon: 'hinge' })),
        h('div', { class: 'stat' }, icon('info', 14), `kp ${d.kp.toFixed(2)} · kv ${d.kv.toFixed(3)} · damping ${d.damping.toFixed(3)}`),
      ]),
    ];
  }

  /* ---------- mass ---------- */
  let massBody = null;
  if (part) {
    massBody = [
      h('div', { class: 'r' },
        seg([{ icon: 'box', tip: 'Mass from volume × material density', on: n.mass.mode === 'density', onclick: () => { n.mass.mode = 'density'; rr(); } }, { icon: 'mass', tip: 'Use a measured mass', on: n.mass.mode === 'explicit', onclick: () => { n.mass.mode = 'explicit'; rr(); } }]),
        seg([{ icon: 'shield', tip: 'Collides (mesh convex hull)', on: n.collision === 'mesh', onclick: () => { n.collision = 'mesh'; rr(); } }, { icon: 'shieldOff', tip: 'No collision (visual only)', on: n.collision === 'none', onclick: () => { n.collision = 'none'; rr(); } }])),
      n.mass.mode === 'density'
        ? h('div', { class: 'r' }, h('select', { class: 'grow', 'data-tip': 'Material', onchange: (e) => { n.mass.density = MATERIALS[e.target.value]; rr(); } }, h('option', {}, 'material…'), Object.keys(MATERIALS).map((k) => h('option', {}, k))),
          N(n.mass.density, (v) => { n.mass.density = v; rr(); }, { step: 10, unit: 'kg/m³', tip: 'Density' }))
        : h('div', { class: 'r' }, N(n.mass.mass * 1000, (v) => { n.mass.mass = v / 1000; rr(); }, { step: 1, unit: 'g', tip: 'Measured mass', icon: 'mass' })),
      h('div', { class: 'facts' },
        inertial ? [h('span', { class: 'pill', 'data-tip': 'Mass' }, icon('mass', 14), `${(inertial.mass * 1000).toFixed(1)} g`), h('span', { class: 'pill', 'data-tip': 'Volume' }, icon('box', 14), `${(inertial.volume * 1e6).toFixed(1)} cm³`)] : null,
        h('span', { class: 'pill', 'data-tip': `${part.stats.triangles.toLocaleString()} triangles` }, icon(part.stats.watertight || part.trusted ? 'check' : 'warning', 14), part.stats.watertight || part.trusted ? 'clean mesh' : 'open mesh')),
      !part.stats.watertight && !part.trusted ? h('div', { class: 'note' }, icon('warning', 14), `${part.stats.openEdges} open / ${part.stats.nonManifoldEdges} non-manifold edges – mass may be off; use a measured mass.`) : null,
    ];
  }

  /* ---------- connectors, file, library info, copies ---------- */
  const connBody = [...(n.connectors ?? []).map((c) => h('div', { class: 'conn' }, icon('connector', 14),
    h('input', { type: 'text', value: c.name, onchange: (e) => (c.name = e.target.value) }),
    ib('flip', 'Flip the connector direction', () => { const q = new Quaternion(...c.quat).multiply(new Quaternion(1, 0, 0, 0)); c.quat = [q.x, q.y, q.z, q.w]; ctx.changed(); }),
    ib('close', 'Delete connector', () => { n.connectors = n.connectors.filter((x) => x !== c); viewport.setProject(p); rr(); }, { danger: true }))),
    h('div', { class: 'help' }, 'Create connectors by clicking in “Mate”.')];

  let fileBody = null;
  if (part && !n.library) {
    const sz = [0, 1, 2].map((k) => ((part.bbox.max[k] - part.bbox.min[k]) * part.unitScale * 1000).toFixed(1));
    const rep = app.refreshReport?.part === part.name ? app.refreshReport : null;
    fileBody = [h('div', { class: 'facts' }, h('span', { class: 'pill' }, icon('file', 14), part.name), h('span', { class: 'pill' }, `${sz.join(' × ')} mm`)),
      h('div', { class: 'r' }, ib('refresh', part.handle ? 'Reload from the linked file – connectors are found again, attached parts re-snap' : 'Load the re-exported STL – connectors are found again, attached parts re-snap', () => ctx.act.refreshFile(part.id), { primary: true, label: 'refresh' })),
      rep ? h('div', { class: 'stat' }, icon('info', 14), `${rep.items.length} connectors · ${rep.resnapped.length} re-snapped`) : null,
      ...(rep ? rep.items.map((i) => h('div', { class: `stat${i.status === 'unmatched' ? ' err' : ''}` }, icon(i.status === 'unmatched' ? 'error' : 'check', 13), `${i.connector}${i.movedMm ? `  ${i.movedMm} mm` : ''}`)) : []),
      ...(rep ? rep.errors.map((e) => h('div', { class: 'note' }, icon('warning', 14), e)) : [])];
  }

  let infoBody = null;
  if (n.library) {
    infoBody = [...Object.entries(n.library.status ?? {}).map(([k, v]) => h('div', { class: /verify|estimate/.test(v) ? 'note' : 'stat' }, icon(/verify|estimate/.test(v) ? 'warning' : 'check', 13), `${k.replace(/_/g, ' ')}: ${v}`)),
      ...(n.library.sources ?? []).map((src) => { let ok = false; try { ok = ['http:', 'https:'].includes(new URL(src.url).protocol); } catch { /* not a URL */ } return h('div', { class: 'stat' }, icon('file', 13), ok ? h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer', style: 'color:var(--acc)' }, src.title) : String(src.title)); })];
  }

  const copiesBody = [
    h('div', { class: 'r', 'data-tip': 'Offset of a pasted / duplicated copy (mm)' }, icon('duplicate', 16), xyz(app.dupOffset, (k, v) => { app.dupOffset[k] = v; }, { step: 5 })),
    h('div', { class: 'r', 'data-tip': 'Linear array: number of copies and step (mm)' }, icon('arrayLinear', 16), num(app.arr.count, (v) => (app.arr.count = Math.max(2, v | 0)), { step: 1, w: '58px' }),
      ib('plus', 'Create the array', () => { linearArray(p, n.id, { count: app.arr.count, step: app.arr.step.map((v) => v / 1000) }); ctx.flash(`Created ${app.arr.count - 1} copies.`); ctx.structural(true); }, { primary: true })),
    h('div', { class: 'r' }, icon('move', 16), xyz(app.arr.step, (k, v) => { app.arr.step[k] = v; }, { step: 5 })),
    ib('paste', 'Paste as a child of this part', () => ctx.act.paste(true), { disabled: !app.clip, label: 'paste as child' }),
  ];

  const sec = (key, ic, title, body, o = {}) => (body ? section(S, key, ic, title, body, { rerender: rr, ...o }) : null);
  put(R, head,
    sec('placement', 'move', 'Placement', placement, { defaultOpen: true }),
    sec('joint', JOINT_ICON[j.type], 'Joint', jointBody, { summary: j.type === 'fixed' ? '' : j.type, defaultOpen: j.type !== 'fixed' }),
    sec('servo', 'servo', 'Servo', servoBody, { summary: servoSummary, defaultOpen: true }),
    sec('actuator', 'actuator', 'Drive', actuatorBody, { summary: a ? a.kind : '', defaultOpen: true }),
    sec('mass', 'mass', 'Mass & collision', massBody, { summary: inertial ? `${(inertial.mass * 1000).toFixed(0)} g` : '' }),
    sec('conn', 'connector', 'Connectors', connBody, { summary: String(n.connectors?.length ?? 0) }),
    sec('file', 'file', 'Part file', fileBody),
    sec('info', 'info', 'Library part', infoBody, { summary: n.library ? n.library.id : '' }),
    sec('copies', 'duplicate', 'Copies & arrays', copiesBody, { summary: fam.length ? `${fam.length} copies` : '' }),
  );
}
