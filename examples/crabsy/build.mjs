#!/usr/bin/env node
// Builds a *starting point* stl2mujoco project for the Crabsy hexapod (github.com/SamuelNoesslboeck/Crabsy).
//   node examples/crabsy/build.mjs <path-to-Crabsy-checkout> <out.s2m.zip>
// The Solid Edge assembly (.asm) is a proprietary format, so part placement is NOT available from the STL
// files. Placements below are estimates from part bounding boxes; open the result in the editor
// and fine-tune joint frames / part poses against the CAD (see README).
//
// Structure (like the real robot): base → servo case (fixed) → servo output (hinge + position actuator) →
// printed link (fixed) → next servo case …  The servos come from the standard_parts library (MG996R).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Matrix4, Euler } from 'three';
import { newProject, addPart, addPrimitive, addNode, polarArray, poseFromEulerDeg, dropToFloor } from '../../src/core/project.js';
import { parseSTL } from '../../src/core/stl.js';
import { saveProjectZip } from '../../src/core/io.js';
import { instantiate, loadIndex } from '../../src/core/library.js';
import { fsReader } from '../../src/core/fs-reader.js';

const [, , crabsy, out] = process.argv;
if (!crabsy || !out) { console.error('usage: build.mjs <crabsy-checkout> <out.s2m.zip>'); process.exit(2); }
const C = join(crabsy, 'construction');
const reader = fsReader(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'standard_parts'));
const index = await loadIndex(reader);
const P = newProject('crabsy');
P.settings.collisionTriangles = 5000;
const PRINT_DENSITY = 400; // kg/m³ effective for FDM parts with infill – adjust to your slicer settings
const mm = (x, y, z) => [x / 1000, y / 1000, z / 1000];
const pose = (p, rot = [0, 0, 0]) => poseFromEulerDeg(mm(...p), rot);
const stl = (rel, name) => addPart(P, { name, positions: parseSTL(readFileSync(join(C, rel))), unitScale: 0.001 });
const printed = (name, rel, parent, role, frame, partPose, partName = name) => {
  const n = addNode(P, { name, parent, partId: stl(rel, partName).id, role, frame, partPose });
  n.mass = { mode: 'density', density: PRINT_DENSITY, mass: 0.1 };
  return n;
};
const box = (name, dims, parent, at, mass) => {
  const pr = addPrimitive(P, 'box', dims.map((d) => d / 1000)); pr.name = name;
  const n = addNode(P, { name, parent, partId: pr.id, role: 'link', frame: pose(at), partPose: pose(at) });
  n.mass = { mode: 'explicit', mass, density: 0 }; n.collision = 'none'; n.color = '#c9a227'; return n;
};
/** MG996R whose shaft axis (prefab +Z) sits on the joint axis at `at` (mm). Returns [case, output]. */
const mg996r = async (parent, at, rot) => {
  const m = new Matrix4().makeTranslation(...mm(...at)).multiply(new Matrix4().makeRotationFromEuler(new Euler(...rot.map((d) => (d * Math.PI) / 180))));
  const nodes = await instantiate(P, reader, index.find((e) => e.id === 'servo_mg996r'), { at: m, parent });
  nodes[0].role = 'link'; nodes[0].collision = 'none';
  return nodes;
};

// ---- body --------------------------------------------------------------------------------------------
const base = printed('base_plate', 'a1_base/stl/1_base_plate.stl', null, 'base', pose([0, 0, 0]), pose([0, 0, 0]));
printed('top_plate', 'a1_base/stl/2_top_plate.stl', base.id, 'link', pose([0, 0, 0]), pose([0, 0, 0]));
printed('lower_carapace', 'a1_base/stl/3_lower_carapace.stl', base.id, 'link', pose([0, 0, 0]), pose([0, 0, 0]));
box('battery_7v4_2000mah', [70, 18, 15], base.id, [0, 0, 25], 0.1);
box('raspberry_pi_zero', [65, 30, 5], base.id, [0, 0, 12], 0.009);

// ---- one leg: coxa (about Z) → femur (about Y) → tibia (about Y), later repeated 6× around Z ------------
const [coxaCase, coxaOut] = await mg996r(base.id, [80, 0, 15], [0, 0, 0]);
const bearing = printed('leg_lower_bearing', 'a2_leg/stl/1_lower_bearing.stl', coxaOut.id, 'link', pose([80, 0, 15]), pose([80, 0, 15]), 'lower_bearing');
const [femurCase, femurOut] = await mg996r(bearing.id, [100, 0, 45], [-90, 0, 0]);
const middle = printed('leg_middle_segment', 'a2_leg/stl/2_middle_segment.stl', femurOut.id, 'link', pose([100, 0, 45]), pose([157, 0, 45]), 'middle_segment');
const [tibiaCase, tibiaOut] = await mg996r(middle.id, [200, 0, 45], [-90, 0, 0]);
const foot = printed('leg_foot_shell', 'a2_leg/stl/4_foot_shell.stl', tibiaOut.id, 'link', pose([200, 0, 45]), pose([200, 0, -10]), 'foot_shell');
foot.collision = 'mesh'; // only the feet collide: convex hulls of neighbouring printed parts would overlap

// ---- 6 legs, 60° apart -------------------------------------------------------------------------------
polarArray(P, coxaCase.id, { count: 6, stepDeg: 60 });
for (const n of Object.values(P.nodes)) n.name = n.name.replace(/ (\d)( \/ .*)?$/, ' leg$1$2').replace(/_(\d)$/, '_leg$1');
dropToFloor(P, 0.12); // stand on the (estimated) legs; the free base starts slightly above the ground

writeFileSync(out, await saveProjectZip(P));
console.log(`Wrote ${out}: ${Object.keys(P.nodes).length} bodies, ${Object.keys(P.parts).length} meshes`);
