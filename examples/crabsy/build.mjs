#!/usr/bin/env node
// Builds an stl2mujoco project for the Crabsy hexapod (github.com/SamuelNoesslboeck/Crabsy) from
//   – the printed-part STL files of a Crabsy checkout (geometry, in each part's own CAD frame) and
//   – the assembly exported from Solid Edge as STEP (File ▸ Save As ▸ .stp of construction/a_crabsy.asm),
//     which supplies the exact placement of every part and servo.
//
//   node examples/crabsy/build.mjs <path-to-Crabsy-checkout> <a_crabsy.stp> <out.s2m.zip>
//
// Kinematic chain of one leg (derived from the contacts between the parts, see README):
//   base ─ servo A case + lower bearing ─(A: output shaft)→ bracket A + bracket B (+ servo B's shaft)
//        ─(B: servo B's *case* turns around its fixed shaft)→ femur housing (middle segment + cap) + servo C case
//        ─(C: output shaft)→ bracket C + foot shell
// The servos come from the standard_parts library (MG996R). The aluminium flanges only exist as .par files
// (no STL), so they are left out. Joint zero is the pose of the STEP assembly.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Matrix4 } from 'three';
import { newProject, addPart, addPrimitive, addNode, polarArray, poseToMatrix, matrixToPose, dropToFloor } from '../../src/core/project.js';
import { defaultJoint } from '../../src/core/presets.js';
import { parseSTL } from '../../src/core/stl.js';
import { parseStepAssembly, mul, invRigid } from '../../src/core/step-asm.js';
import { saveProjectZip } from '../../src/core/io.js';
import { instantiate, loadIndex } from '../../src/core/library.js';
import { fsReader } from '../../src/core/fs-reader.js';

const [, , crabsy, stepFile, out] = process.argv;
if (!crabsy || !stepFile || !out) { console.error('usage: build.mjs <crabsy-checkout> <a_crabsy.stp> <out.s2m.zip>'); process.exit(2); }
const C = join(crabsy, 'construction');
const reader = fsReader(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'standard_parts'));
const index = await loadIndex(reader);
const asm = parseStepAssembly(readFileSync(stepFile, 'utf8'));
const PRINT_DENSITY = 400; // kg/m³ effective for FDM parts with infill – adjust to your slicer settings

const toMatrix = (r) => new Matrix4().set(...r);
const pose = (r) => matrixToPose(toMatrix(r));
const STL = {
  '1_baseplate': 'a1_base/stl/1_base_plate.stl', '2_top_plate': 'a1_base/stl/2_top_plate.stl', '3_lower_carapace': 'a1_base/stl/3_lower_carapace.stl',
  '1_lower_bearing': 'a2_leg/stl/1_lower_bearing.stl', '2_middle_segment': 'a2_leg/stl/2_middle_segment.stl', '3_middle_cap': 'a2_leg/stl/3_middle_cap.stl',
  '4_foot_shell': 'a2_leg/stl/4_foot_shell.stl', '5_connector': 'a2_leg/stl/5_connector.stl',
};
const P = newProject('crabsy');
P.settings.collisionTriangles = 5000;
const meshes = {};
const printed = (occ, parent, role = 'link') => {
  const file = STL[occ.product];
  const part = meshes[occ.product] ??= addPart(P, { name: occ.product, positions: parseSTL(readFileSync(join(C, file))), unitScale: 0.001 });
  const n = addNode(P, { name: occ.product, parent, partId: part.id, role, frame: pose(occ.world), partPose: pose(occ.world) });
  n.mass = { mode: 'density', density: PRINT_DENSITY, mass: 0.1 };
  n.collision = 'none'; // convex hulls of neighbouring printed parts would overlap; only the feet collide
  return n;
};
const box = (name, dims, parent, at, mass) => {
  const pr = addPrimitive(P, 'box', dims.map((d) => d / 1000)); pr.name = name;
  const p = { pos: at.map((v) => v / 1000), quat: [0, 0, 0, 1] };
  const n = addNode(P, { name, parent, partId: pr.id, role: 'link', frame: p, partPose: p });
  n.mass = { mode: 'explicit', mass, density: 0 }; n.collision = 'none'; n.color = '#c9a227'; return n;
};

// ---- body ---------------------------------------------------------------------------------------------
const baseOcc = (prod) => asm.occurrences.find((o) => o.leaf && o.path[0] === 'a1_base' && o.product === prod);
const base = printed(baseOcc('1_baseplate'), null, 'base');
printed(baseOcc('2_top_plate'), base.id);
printed(baseOcc('3_lower_carapace'), base.id);
box('battery_7v4_2000mah', [70, 18, 15], base.id, [0, 0, 25], 0.1); // not part of the STEP export: mass placeholders
box('raspberry_pi_zero', [65, 30, 5], base.id, [0, 0, 12], 0.009);

// ---- one leg: the first a2_leg instance of the assembly; the other five are a polar array ------------------
const leg = []; let g = -1;
for (const o of asm.occurrences) {
  if (o.path.length === 1) g = o.name === 'a2_leg' ? g + 1 : -1;
  if (g === 0 && o.path.length > 1) leg.push(o);
}
const servos = leg.filter((o) => o.product === 'Case').map((c) => ({ c, s: leg[leg.indexOf(c) + 1] }));
servos.sort((x, y) => Math.hypot(x.c.world[3], x.c.world[7]) - Math.hypot(y.c.world[3], y.c.world[7])); // A (coxa), B (femur), C (tibia)
if (servos.length !== 3 || servos.some((s) => s.s?.product !== 'Shaft')) throw new Error('unexpected leg structure in the STEP file');

/** Library MG996R positioned on the STEP servo: prefab origin on the shaft axis (the STEP Shaft frame origin), axes of the STEP Case. */
const servoEntry = index.find((e) => e.id === 'servo_mg996r');
const servoAt = ({ c, s }) => {
  const ci = invRigid(c.world), p = [0, 1, 2].map((i) => ci[i * 4] * s.world[3] + ci[i * 4 + 1] * s.world[7] + ci[i * 4 + 2] * s.world[11] + ci[i * 4 + 3]);
  return toMatrix(mul(c.world, [1, 0, 0, p[0], 0, 1, 0, p[1], 0, 0, 1, p[2], 0, 0, 0, 1]));
};
const mg996r = async (servo, parent) => {
  const nodes = await instantiate(P, reader, servoEntry, { at: servoAt(servo), parent });
  nodes[0].role = 'link'; nodes[0].collision = 'none';
  return nodes;
};
/** Swap which side of the hinge moves: the output shaft stays on `shaftParent`, the case turns around it. */
const caseMoves = ([cs, os], shaftParent) => {
  const { joint, servo, actuator } = os;
  cs.joint = { ...joint, axis: joint.axis.map((v) => -v), range: joint.range ? [-joint.range[1], -joint.range[0]] : null };
  cs.servo = servo; cs.actuator = actuator; cs.role = 'servo'; cs.frame = os.frame;
  Object.assign(os, { joint: defaultJoint(), servo: null, actuator: null, role: 'link', parent: shaftParent });
  cs.parent = os.id;
};

// sampled surface points to match each connector to the servo whose shaft it holds
const surface = (positions, M, n = 400) => {
  const pts = [], nt = positions.length / 9, step = Math.max(1, Math.floor(nt / n));
  for (let t = 0; t < nt; t += step) for (let k = 0; k < 3; k++) { const o = 9 * t + 3 * k; const x = positions[o] * 1e-3, y = positions[o + 1] * 1e-3, z = positions[o + 2] * 1e-3; pts.push([M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11]]); }
  return pts;
};
const nearest = (o, targets) => {
  const pts = surface(parseSTL(readFileSync(join(C, STL[o.product]))), o.world);
  const d = targets.map((s) => Math.min(...pts.map((p) => Math.hypot(p[0] - s.s.world[3], p[1] - s.s.world[7], p[2] - s.s.world[11]))));
  return d.indexOf(Math.min(...d));
};
const one = (prod) => leg.find((o) => o.product === prod);
const connectors = [];
for (const o of leg.filter((x) => x.product === '5_connector')) connectors[nearest(o, servos)] = o;

// base side: servo A's case + the lower bearing it sits on
const [caseA, outA] = await mg996r(servos[0], base.id);
printed(one('1_lower_bearing'), caseA.id);
// joint 1 (coxa): bracket A and bracket B turn with servo A's shaft; servo B's shaft is bolted to bracket B
const bracketA = printed(connectors[0], outA.id);
const bracketB = printed(connectors[1], outA.id);
// joint 2 (femur): servo B's case turns around its fixed shaft and carries the femur housing and servo C
const servoB = await mg996r(servos[1], bracketB.id);
caseMoves(servoB, bracketB.id);
printed(one('2_middle_segment'), servoB[0].id);
printed(one('3_middle_cap'), servoB[0].id);
// joint 3 (tibia): servo C sits in the femur housing; bracket C and the foot turn with its shaft
const servoC = await mg996r(servos[2], servoB[0].id);
const bracketC = printed(connectors[2], servoC[1].id);
const foot = printed(one('4_foot_shell'), servoC[1].id);
foot.collision = 'mesh';

// ---- 6 legs, 60° apart ---------------------------------------------------------------------------------
polarArray(P, caseA.id, { count: 6, stepDeg: 60 });
for (const n of Object.values(P.nodes)) n.name = n.name.replace(/ (\d)( \/ .*)?$/, ' leg$1$2').replace(/_(\d)$/, '_leg$1');
dropToFloor(P, 0.002);

writeFileSync(out, await saveProjectZip(P));
console.log(`Wrote ${out}: ${Object.keys(P.nodes).length} bodies, ${Object.keys(P.parts).length} meshes`);
