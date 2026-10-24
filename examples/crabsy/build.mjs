#!/usr/bin/env node
// Builds a *starting point* stl2mujoco project for the Crabsy hexapod (github.com/SamuelNoesslboeck/Crabsy).
//   node examples/crabsy/build.mjs <path-to-Crabsy-checkout> <out.s2m.zip>
// The Solid Edge assembly (.asm) is a proprietary format, so part placement is NOT available from the STL
// files. Placements below are estimates from part bounding boxes; open the result in the editor
// and fine-tune joint frames / part poses against the CAD (see README).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newProject, addPart, addPrimitive, addNode, polarArray, poseFromEulerDeg, dropToFloor } from '../../src/core/project.js';
import { parseSTL } from '../../src/core/stl.js';
import { applyRole, SERVO_PRESETS } from '../../src/core/presets.js';
import { saveProjectZip } from '../../src/core/io.js';

const [, , crabsy, out] = process.argv;
if (!crabsy || !out) { console.error('usage: build.mjs <crabsy-checkout> <out.s2m.zip>'); process.exit(2); }
const C = join(crabsy, 'construction');
const stl = (rel, name) => addPart(P, { name, positions: parseSTL(readFileSync(join(C, rel))), unitScale: 0.001 });
const mm = (x, y, z) => [x / 1000, y / 1000, z / 1000];
const pose = (p, rot = [0, 0, 0]) => poseFromEulerDeg(mm(...p), rot);
const PRINT_DENSITY = 400; // kg/m³ effective for FDM parts with infill – adjust to your slicer settings

const P = newProject('crabsy');
P.settings.collisionTriangles = 5000;
const part = (n, k = {}) => { n.mass = { mode: 'density', density: PRINT_DENSITY, mass: 0.1 }; Object.assign(n, k); return n; };

// ---- body -------------------------------------------------------------------------------------------
const base = part(addNode(P, { name: 'base_plate', partId: stl('a1_base/stl/1_base_plate.stl', 'base_plate').id, role: 'base', frame: pose([0, 0, 0]), partPose: pose([0, 0, 0]) }));
const top = part(addNode(P, { name: 'top_plate', parent: base.id, partId: stl('a1_base/stl/2_top_plate.stl', 'top_plate').id, role: 'link', frame: pose([0, 0, 0]), partPose: pose([0, 0, 0]) }));
const carapace = part(addNode(P, { name: 'lower_carapace', parent: base.id, partId: stl('a1_base/stl/3_lower_carapace.stl', 'lower_carapace').id, role: 'link', frame: pose([0, 0, 0]), partPose: pose([0, 0, 0]) }));
const box = (name, dims, parent, at, mass) => {
  const pr = addPrimitive(P, 'box', dims.map((d) => d / 1000)); pr.name = name;
  const n = addNode(P, { name, parent, partId: pr.id, role: 'link', frame: pose(at), partPose: pose(at) });
  n.mass = { mode: 'explicit', mass, density: 0 }; n.collision = 'none'; n.color = '#c9a227'; return n;
};
box('battery_7v4_2000mah', [70, 18, 15], base.id, [0, 0, 25], 0.1);
box('raspberry_pi_zero', [65, 30, 5], base.id, [0, 0, 12], 0.009);

// ---- one leg (coxa → femur → tibia), later repeated 6× around Z ----------------------------------------
const mg996r = (name, parent, at, rot) => box(name, [40.7, 19.7, 42.9], parent, at, 0.055);
const coxa = part(addNode(P, { name: 'leg_coxa', parent: base.id, partId: stl('a2_leg/stl/1_lower_bearing.stl', 'lower_bearing').id, role: 'servo',
  frame: pose([80, 0, 15]), partPose: pose([80, 0, 15]) }));
const femur = part(addNode(P, { name: 'leg_femur', parent: coxa.id, partId: stl('a2_leg/stl/2_middle_segment.stl', 'middle_segment').id, role: 'servo',
  frame: pose([100, 0, 45]), partPose: pose([157, 0, 45]) }));
const tibia = part(addNode(P, { name: 'leg_tibia', parent: femur.id, partId: stl('a2_leg/stl/4_foot_shell.stl', 'foot_shell').id, role: 'servo',
  frame: pose([200, 0, 45]), partPose: pose([200, 0, -10]) }));
// hinge axes: coxa about Z, femur and tibia about Y
coxa.joint.axis = [0, 0, 1]; femur.joint.axis = [0, 1, 0]; tibia.joint.axis = [0, 1, 0];
for (const n of [coxa, femur, tibia]) applyServo(n);
function applyServo(n) { const axis = [...n.joint.axis]; applyRole(n, 'servo', SERVO_PRESETS['MG996R (≈1.0 N·m, 180°)']); n.joint.axis = axis; }
mg996r('coxa_servo_mg996r', base.id, [80, 0, 36], [0, 0, 0]);
mg996r('femur_servo_mg996r', coxa.id, [100, 0, 45], [90, 0, 0]);
mg996r('tibia_servo_mg996r', femur.id, [200, 0, 45], [90, 0, 0]);

// ---- 6 legs, 60° apart ---------------------------------------------------------------------------------------
// Hull collision of the printed parts overlaps their non-adjacent neighbours, so only the feet collide.
for (const n of Object.values(P.nodes)) n.collision = 'none';
tibia.collision = 'mesh';
for (const leg of [coxa]) polarArray(P, leg.id, { count: 6, stepDeg: 60 });
// the original leg keeps its name; give copies tidy names
for (const n of Object.values(P.nodes)) n.name = n.name.replace(/_(\d)$/, '_leg$1');
dropToFloor(P, 0.12); // stand the hexapod on its (estimated) legs; the free base is lifted slightly above the ground

writeFileSync(out, await saveProjectZip(P));
console.log(`Wrote ${out}: ${Object.keys(P.nodes).length} bodies, ${Object.keys(P.parts).length} meshes`);
