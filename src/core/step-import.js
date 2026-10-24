// Builds a project from a STEP assembly (placements) + STL files (geometry) + a small robot.json (kinematics).
//
//   const asm = parseStepAssembly(text);
//   const stl = stlFolder('construction');                    // see stl-folder.js
//   const { project, warnings } = await buildRobot({ asm, stl, config, reader, index });
//   const { config, notes } = suggestConfig({ asm, stl, index });   // a starting robot.json, to be checked by a human
//
// robot.json (all part names are STEP product names; see README):
//   name, units ("mm"), density (kg/m³ for printed parts), collisionDefault ("none"), collision { product: "mesh" },
//   ignore [products], stl { product: "file name" }, floorMargin (m),
//   base    { assembly, root }                 – the rigid body everything hangs from (free joint)
//   boxes   [{ name, size_mm, at_mm, mass_kg }] – mass placeholders for parts that are not in the STEP
//   servoModel { library, case, shaft, shaftOffsetMm } – library servo + the STEP part names of its case and shaft
//   limb    { assembly, label, servos: [{ parent, moves, case: [parts], output: [parts] }] }
//             – one leg/arm/finger; every further instance of the assembly is cloned from the first at its STEP placement.
//             parent: "base" | "<k>.case" | "<k>.output" (servo k of this limb, counted from the base outwards)
//             moves:  "output" (shaft turns, usual) | "case" (shaft is fixed, the body turns around it)
//             parts:  "product" or "product@k" = the instance nearest to the shaft of servo k
import { Matrix4 } from 'three';
import { newProject, addPart, addPrimitive, addNode, matrixToPose, dropToFloor, cloneSubtree, ensureFamily } from './project.js';
import { defaultJoint } from './presets.js';
import { mul, invRigid } from './step-asm.js';
import { instantiate } from './library.js';

const UNITS = { mm: 0.001, cm: 0.01, m: 1 };
const toMatrix = (r) => new Matrix4().set(...r);
const pose = (r) => matrixToPose(toMatrix(r));
const origin = (m) => [m[3], m[7], m[11]];
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Top-level instances of an assembly: [{ root, members }] where members are all occurrences below the root. */
export function instancesOf(asm, name) {
  const out = []; let cur = null;
  for (const o of asm.occurrences) {
    if (o.path.length === 1) { cur = o.name === name || o.product === name ? { root: o, members: [] } : null; if (cur) out.push(cur); }
    else if (cur) cur.members.push(o);
  }
  return out;
}

/** Servo = a case part immediately followed (same parent) by its shaft part. */
export function findServos(members, { case: caseName = 'Case', shaft: shaftName = 'Shaft' } = {}) {
  const out = [];
  members.forEach((c, i) => {
    const s = members[i + 1];
    if (c.product === caseName && s && s.product === shaftName && s.parent === c.parent) out.push({ c, s });
  });
  return out;
}

/** Points on the mesh surface (world, metres). */
export function surfacePoints(positions, M, scale, n = 400) {
  const pts = [], nt = positions.length / 9, step = Math.max(1, Math.floor(nt / n));
  for (let t = 0; t < nt; t += step) for (let k = 0; k < 3; k++) {
    const o = 9 * t + 3 * k, x = positions[o] * scale, y = positions[o + 1] * scale, z = positions[o + 2] * scale;
    pts.push([M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11]]);
  }
  return pts;
}
const distanceToPoint = (stl, occ, scale, point) => {
  const hit = stl.find(occ.product, occ.path.slice(0, -1));
  return hit ? Math.min(...surfacePoints(hit.positions, occ.world, scale).map((p) => dist3(p, point))) : Infinity;
};

const sortServos = (servos, from) => [...servos].sort((a, b) => dist3(origin(a.c.world), from) - dist3(origin(b.c.world), from));

export async function buildRobot({ asm, stl, config, reader, index, warn = () => {} }) {
  const cfg = { units: 'mm', density: 400, collisionDefault: 'none', collision: {}, ignore: [], boxes: [], floorMargin: 0.002, ...config };
  const scale = UNITS[cfg.units] ?? 0.001;
  const warnings = [];
  const note = (m) => { warnings.push(m); warn(m); };
  const P = newProject(cfg.name ?? 'robot');
  P.settings.collisionTriangles = 5000;
  const meshes = {};

  const printed = (occ, parent, role = 'link', suffix = '') => {
    const hit = stl.find(occ.product, occ.path.slice(0, -1));
    if (!hit) return null;
    const part = meshes[occ.product] ??= addPart(P, { name: occ.product, positions: hit.positions, unitScale: scale });
    const n = addNode(P, { name: occ.product + suffix, parent, partId: part.id, role, frame: pose(occ.world), partPose: pose(occ.world) });
    n.mass = { mode: 'density', density: cfg.density, mass: 0.1 };
    n.collision = cfg.collision[occ.product] ?? cfg.collisionDefault;
    return n;
  };

  // ---- base ---------------------------------------------------------------------------------------------
  const baseInst = cfg.base?.assembly ? instancesOf(asm, cfg.base.assembly) : [{ root: null, members: asm.occurrences.filter((o) => o.path.length === 1) }];
  if (!baseInst.length) throw new Error(`base assembly "${cfg.base.assembly}" not found in the STEP file`);
  if (baseInst.length > 1) note(`base assembly "${cfg.base.assembly}" occurs ${baseInst.length}×; only the first is used`);
  const baseLeaves = baseInst[0].members.filter((o) => o.leaf);
  const rootOcc = (cfg.base?.root ? baseLeaves.find((o) => o.product === cfg.base.root) : baseLeaves.find((o) => stl.find(o.product, o.path.slice(0, -1))) ?? baseLeaves[0]) ?? null;
  if (!rootOcc) throw new Error(`the base assembly has no parts${cfg.base?.root ? ` named "${cfg.base.root}"` : ''} – check base.assembly / base.root in robot.json`);
  let base = printed(rootOcc, null, 'base');
  if (!base) { // no STL for the base: a small placeholder box (0.1 kg) so the limbs have something to hang from
    note(`no STL for the base part "${rootOcc.product}" – using a 60x60x10 mm placeholder box (0.1 kg); add its STL for the real shape and mass`);
    const box = addPrimitive(P, 'box', [0.06, 0.06, 0.01]); box.name = `${rootOcc.product}_placeholder`;
    base = addNode(P, { name: rootOcc.product, partId: box.id, role: 'base', frame: pose(rootOcc.world), partPose: pose(rootOcc.world) });
    base.mass = { mode: 'explicit', mass: 0.1, density: 0 }; base.collision = 'none'; base.color = '#c9a227';
  }
  for (const o of baseLeaves) {
    if (o === rootOcc || cfg.ignore.includes(o.product)) continue;
    if (!printed(o, base.id)) note(`no STL for base part "${o.product}" – left out`);
  }
  for (const b of cfg.boxes) {
    const pr = addPrimitive(P, 'box', b.size_mm.map((d) => d / 1000)); pr.name = b.name;
    const at = { pos: b.at_mm.map((v) => v / 1000), quat: [0, 0, 0, 1] };
    const n = addNode(P, { name: b.name, parent: base.id, partId: pr.id, role: 'link', frame: at, partPose: at });
    n.mass = { mode: 'explicit', mass: b.mass_kg, density: 0 }; n.collision = 'none'; n.color = '#c9a227';
  }

  // ---- limb (leg, arm, finger …) ---------------------------------------------------------------------------
  if (cfg.limb) {
    const L = cfg.limb, label = L.label ?? 'limb';
    const insts = instancesOf(asm, L.assembly);
    if (!insts.length) throw new Error(`limb assembly "${L.assembly}" not found in the STEP file`);
    const members = insts[0].members;
    const servos = sortServos(findServos(members, cfg.servoModel), origin(rootOcc.world));
    if (servos.length !== L.servos.length) throw new Error(`limb "${L.assembly}" has ${servos.length} servos in the STEP file but robot.json describes ${L.servos.length}`);
    const entry = index.find((e) => e.id === cfg.servoModel.library);
    if (!entry) throw new Error(`servo "${cfg.servoModel.library}" is not in the standard parts library`);
    const dz = (cfg.servoModel.shaftOffsetMm ?? 0) / 1000;

    const free = members.filter((o) => o.leaf && !servos.some((s) => s.c === o || s.s === o));
    const used = new Set();
    const pick = (spec) => {
      const [prod, at] = spec.split('@');
      const cands = free.filter((o) => o.product === prod && !used.has(o));
      if (!cands.length) throw new Error(`limb part "${spec}" not found (or already placed)`);
      let o = cands[0];
      if (at !== undefined) {
        const shaft = origin(servos[+at].s.world);
        o = cands.map((c) => [c, distanceToPoint(stl, c, scale, shaft)]).sort((a, b) => a[1] - b[1])[0][0];
      } else if (cands.length > 1) throw new Error(`"${prod}" occurs ${cands.length}× in the limb – write "${prod}@<servo>" to take the one nearest to that servo's shaft`);
      used.add(o); return o;
    };
    const limbNodes = [], notedMissing = new Set();
    const sfx = `_${label}1`;
    const track = (n) => { if (n) limbNodes.push(n); return n; };
    const sides = [];

    for (const [i, spec] of L.servos.entries()) {
      const sv = servos[i];
      const ci = invRigid(sv.c.world), sh = origin(sv.s.world);
      const p = [0, 1, 2].map((r) => ci[r * 4] * sh[0] + ci[r * 4 + 1] * sh[1] + ci[r * 4 + 2] * sh[2] + ci[r * 4 + 3]);
      const at = toMatrix(mul(sv.c.world, [1, 0, 0, p[0], 0, 1, 0, p[1], 0, 0, 1, p[2] + dz, 0, 0, 0, 1]));
      let parent = base.id;
      if (spec.parent && spec.parent !== 'base') {
        const [k, side] = spec.parent.split('.');
        parent = sides[+k]?.[side]?.id;
        if (!parent) throw new Error(`servo ${i}: parent "${spec.parent}" must refer to an earlier servo, e.g. "0.output"`);
      }
      const moves = spec.moves ?? 'output';
      const [cs, os] = await instantiate(P, reader, entry, { at, parent: moves === 'output' ? parent : null });
      cs.role = 'link'; cs.collision = 'none';
      cs.name = `servo${i + 1}_case${sfx}`; os.name = `servo${i + 1}_output${sfx}`;
      if (moves === 'case') { // the shaft is fixed to the parent, the body turns around it: move the hinge from the output to the case
        const { joint, servo, actuator } = os;
        cs.joint = { ...joint, axis: joint.axis.map((v) => -v), range: joint.range ? [-joint.range[1], -joint.range[0]] : null };
        cs.servo = servo; cs.actuator = actuator; cs.role = 'servo'; cs.frame = os.frame;
        Object.assign(os, { joint: defaultJoint(), servo: null, actuator: null, role: 'link', parent });
        cs.parent = os.id;
      }
      track(cs); track(os);
      sides[i] = { case: cs, output: os };
      for (const [side, parentId] of [['case', cs.id], ['output', os.id]]) {
        for (const part of spec[side] ?? []) {
          const o = pick(part);
          if (!track(printed(o, parentId, 'link', sfx)) && !notedMissing.has(o.product)) { notedMissing.add(o.product); note(`no STL for "${o.product}" – left out`); }
        }
      }
    }
    for (const o of free) if (!used.has(o) && !cfg.ignore.includes(o.product)) note(`limb part "${o.product}" is not used in robot.json – left out`);

    // every further instance: clone the first one at its STEP placement (not assumed to be a polar array)
    const ids = new Set(limbNodes.map((n) => n.id));
    const roots = limbNodes.filter((n) => !ids.has(n.parent));
    const W0 = toMatrix(insts[0].root.world).invert();
    for (const r of roots) ensureFamily(P, r.id);
    insts.slice(1).forEach((inst, k) => {
      const M = toMatrix(inst.root.world).multiply(W0);
      for (const r of roots) for (const n of cloneSubtree(P, r.id, { M, suffix: '' })) n.name = n.name.replace(new RegExp(`${sfx}$`), `_${label}${k + 2}`);
    });
  }

  dropToFloor(P, cfg.floorMargin);
  return { project: P, warnings };
}

/** A starting robot.json derived from the assembly: parts go to the servo whose shaft they are nearest to. Always review it. */
export function suggestConfig({ asm, stl, index }) {
  const notes = [];
  const tops = new Map();
  for (const o of asm.occurrences.filter((x) => x.path.length === 1)) tops.set(o.name, (tops.get(o.name) ?? 0) + 1);
  const detect = (members) => {
    const out = [];
    members.forEach((c, i) => { const s = members[i + 1]; if (s && c.leaf && s.leaf && c.parent === s.parent && /^(case|body|housing)$/i.test(c.product) && /^(shaft|output|horn|axis)$/i.test(s.product)) out.push({ c, s }); });
    return out;
  };
  let limbName = null, servoNames = null;
  for (const [name] of [...tops].sort((a, b) => b[1] - a[1])) {
    const found = detect(instancesOf(asm, name)[0].members);
    if (found.length) { limbName = name; servoNames = { case: found[0].c.product, shaft: found[0].s.product }; break; }
  }
  const baseName = [...tops.keys()].filter((n) => n !== limbName).map((n) => [n, instancesOf(asm, n)[0].members.filter((o) => o.leaf && stl.find(o.product, o.path.slice(0, -1))).length]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const config = { name: asm.root, units: 'mm', density: 400, collisionDefault: 'none', collision: {}, ignore: [], boxes: [], base: baseName ? { assembly: baseName } : {} };
  if (!limbName) { notes.push('no servo (a "Case" part followed by a "Shaft" part) found – only the base is built'); return { config, notes }; }

  const members = instancesOf(asm, limbName)[0].members;
  const root = baseName ? instancesOf(asm, baseName)[0].members.find((o) => o.leaf && stl.find(o.product, o.path.slice(0, -1))) : null;
  const servos = sortServos(detect(members), root ? origin(root.world) : [0, 0, 0]);
  const subName = servos[0].c.path[servos[0].c.path.length - 2] ?? '';
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const lib = index.filter((e) => e.category === 'Servos').find((e) => norm(subName).includes(norm(e.id).replace(/^servo/, '')));
  if (!lib) notes.push(`servo sub-assembly "${subName}" matches no library servo – set servoModel.library (e.g. ${index.filter((e) => e.category === 'Servos').map((e) => e.id).join(', ')})`);
  config.servoModel = { library: lib?.id ?? 'servo_mg996r', case: servoNames.case, shaft: servoNames.shaft };
  const leaves = members.filter((o) => o.leaf && !servos.some((s) => s.c === o || s.s === o));
  const counts = {}; for (const o of leaves) counts[o.product] = (counts[o.product] ?? 0) + 1;
  const spec = servos.map((_, i) => ({ parent: i === 0 ? 'base' : `${i - 1}.output`, moves: 'output', case: [], output: [] }));
  const taken = new Set();
  for (const o of leaves) {
    if (!stl.find(o.product, o.path.slice(0, -1))) { if (!config.ignore.includes(o.product)) config.ignore.push(o.product); continue; }
    const d = servos.map((s) => distanceToPoint(stl, o, UNITS.mm, origin(s.s.world)));
    const k = d.indexOf(Math.min(...d));
    spec[k].output.push(counts[o.product] > 1 ? `${o.product}@${k}` : o.product);
  }
  for (const s of spec) s.output = [...new Set(s.output)];
  config.limb = { assembly: limbName, label: 'leg', servos: spec };
  notes.push('parts are assigned to the servo whose shaft is nearest, every servo turns its output and hangs from the previous one – check which side of each joint a part is really on (a servo whose body turns needs "moves": "case")');
  if (config.ignore.length) notes.push(`no STL found for: ${config.ignore.join(', ')} (listed under "ignore")`);
  return { config, notes };
}
