#!/usr/bin/env node
// Generates the standard_parts/ library (STL + part.json) and standard_parts/index.json.
//   node tools/standard-parts.mjs            generate everything, rebuild the index
//   node tools/standard-parts.mjs --index    only rebuild index.json (after adding your own parts)
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBinarySTL } from '../src/core/stl.js';
import { SERVO_SPECS } from '../src/core/servo-specs.js';
import { box, cylinder, extrude, polyShape, polyPath, rectPoints, hexPoints, discShape, circlePath, merge } from './geom.mjs';
import { buildPart } from './part-builders.mjs';
import { buildIndex } from './library-index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'standard_parts');
const write = (dir, name, data) => { mkdirSync(join(ROOT, dir), { recursive: true }); writeFileSync(join(ROOT, dir, name), typeof data === 'string' ? data : data); };
const stl = (dir, name, pos) => write(dir, name, writeBinarySTL(pos, 'stl2mujoco standard part'));
const json = (dir, obj) => write(dir, 'part.json', JSON.stringify(obj, null, 2) + '\n');
const r4 = (v) => +v.toFixed(4);

/* Connector helper: `normal` is the outward face normal (connector Z). */
const conn = (name, pos, normal, note = '') => ({ name, pos_mm: pos.map(r4), normal, ...(note ? { note } : {}) });

/* ------------------------------------------------------------------------------------------------ */
/* Standard-size hobby servos (MG996R, SG90, MG90S): case with mounting ears + output spline          */
/* Origin = output shaft axis on the case top plane (z = 0), +Z = shaft direction (towards the horn).  */
/* ------------------------------------------------------------------------------------------------ */
const HOBBY = {
  mg996r: {
    id: 'servo_mg996r', L: 40.7, W: 19.7, H: 36.5, earLen: 53.9, earSpacing: 49.5, earHole: 4.5, earT: 2.5, earTop: -7.2, shaftFromEnd: 10.0,
    bossD: 12.0, bossH: 3.0, splineD: 5.7, splineTop: 6.4, outMass: 0.006,
    status: { overall_size: 'datasheet (retail listings: 40.7×19.7×42.9 mm)', ears_and_holes: 'typical standard-servo pattern – verify', shaft_offset: 'typical standard-servo value – verify', mass_torque_speed: 'datasheet' },
    sources: [{ title: 'MG996R specs (Kitronik)', url: 'https://kitronik.co.uk/products/2575-large-180-servo' }, { title: 'MG996R listing (Probots)', url: 'https://probots.co.in/mg996r-13kg-metal-gear-servo-180.html' }],
  },
  sg90: {
    id: 'servo_sg90', L: 22.2, W: 11.8, H: 22.7, earLen: 32.2, earSpacing: 27.8, earHole: 2.0, earT: 1.2, earTop: -5.5, shaftFromEnd: 6.0,
    bossD: 9.0, bossH: 3.5, splineD: 4.8, splineTop: 8.3, outMass: 0.001,
    status: { overall_size: 'datasheet (22.2×11.8×31 mm)', ears_and_holes: 'typical micro-servo pattern – verify', shaft_offset: 'typical – verify', mass_torque_speed: 'datasheet' },
    sources: [{ title: 'SG90 datasheet (TAMS Hamburg)', url: 'https://tams.informatik.uni-hamburg.de/lehre/2023ss/vorlesung/es/doc/sg90.pdf' }, { title: 'SG90 listing (ProtoSupplies)', url: 'https://protosupplies.com/product/servo-motor-micro-sg90/' }],
  },
  mg90s: {
    id: 'servo_mg90s', L: 22.8, W: 12.2, H: 20.5, earLen: 32.5, earSpacing: 27.8, earHole: 2.0, earT: 1.2, earTop: -5.0, shaftFromEnd: 6.0,
    bossD: 9.0, bossH: 3.0, splineD: 4.8, splineTop: 8.0, outMass: 0.0015,
    status: { overall_size: 'retail listing (22.8×12.2×28.5 mm)', ears_and_holes: 'typical micro-servo pattern – verify', shaft_offset: 'typical – verify', mass_torque_speed: 'datasheet' },
    sources: [{ title: 'MG90S listing (ProtoSupplies bracket page)', url: 'https://protosupplies.com/product/sg90-mg90-servo-bracket/' }],
  },
};

function emit(dir, built) {
  for (const [name, mesh] of Object.entries(built.meshes)) stl(dir, name, mesh);
  json(dir, built.json);
}

function hobbyServo(key, p) {
  const spec = SERVO_SPECS[key];
  emit(`servos/${p.id}`, buildPart({
    id: p.id, name: `${spec.name} servo`, category: 'Servos', type: 'hobby_servo', color: '#5a606b', connectors: [],
    description: `${spec.name} hobby servo. Origin on the output shaft axis at the case top plane, +Z towards the horn. Case is rigid; the \`output\` body is the rotating shaft with a position actuator whose torque/speed come from the datasheet.`,
    params: { L: p.L, W: p.W, H: p.H, earLen: p.earLen, earSpacing: p.earSpacing, earHole: p.earHole, earT: p.earT, earTop: p.earTop, shaftFromEnd: p.shaftFromEnd, bossD: p.bossD, bossH: p.bossH, splineD: p.splineD, splineTop: p.splineTop, outMass: p.outMass },
    mass_kg: spec.mass, servo: { preset: key }, dims_status: p.status, sources: p.sources,
  }));
}

/* ------------------------------------------------------------------------------------------------ */
/* Dynamixel block servos: origin on the horn axis at the front face (z = 0), body extends to -D       */
/* ------------------------------------------------------------------------------------------------ */
const DXL = {
  xl430_w250: { id: 'servo_dynamixel_xl430_w250', W: 28.5, Hh: 46.5, D: 34.0, shaftFromTop: 14.5, hornD: 22.0, hornT: 3.0,
    status: { overall_size: 'datasheet (28.5×46.5×34 mm)', shaft_offset: 'estimate – verify', horn: 'estimate – verify', mass_torque_speed: 'datasheet (e-Manual)' },
    sources: [{ title: 'ROBOTIS e-Manual XL430-W250', url: 'https://emanual.robotis.com/docs/en/dxl/x/xl430-w250/' }, { title: 'ServoDatabase XL430-W250-T', url: 'https://servodatabase.com/servo/dynamixel/xl430-w250-t' }], outMass: 0.006 },
  ax12a: { id: 'servo_dynamixel_ax12a', W: 32.0, Hh: 50.0, D: 40.0, shaftFromTop: 16.0, hornD: 22.0, hornT: 3.0,
    status: { overall_size: 'datasheet listing (32×50×40 mm)', shaft_offset: 'estimate – verify', horn: 'estimate – verify', mass_torque_speed: 'datasheet' },
    sources: [{ title: 'AX-12A spec (Generation Robots)', url: 'https://www.generationrobots.com/media/Whole-Dynamixel-Specification.pdf' }, { title: 'AX-12A (Botland)', url: 'https://botland.com.pl/en/standard-servos/13984-servo-robotis-dynamixel-ax-12a-8809052930196.html' }], outMass: 0.006 },
};
function dynamixel(key, p) {
  const spec = SERVO_SPECS[key];
  emit(`servos/${p.id}`, buildPart({
    id: p.id, name: spec.name, category: 'Servos', type: 'block_servo', color: '#4b525e', connectors: [],
    description: `${spec.name}. Origin on the horn axis at the front face, +Z towards the horn, long side along Y. Horn disc is the rotating \`output\` body.`,
    params: { W: p.W, Hh: p.Hh, D: p.D, shaftFromTop: p.shaftFromTop, hornD: p.hornD, hornT: p.hornT, outMass: p.outMass },
    mass_kg: spec.mass, servo: { preset: key }, dims_status: p.status, sources: p.sources,
  }));
}

/* ------------------------------------------------------------------------------------------------ */
/* DIN fasteners (steel, 7850 kg/m³). Thread is modelled as a plain cylinder of the effective diameter. */
/* ------------------------------------------------------------------------------------------------ */
const S912 = { 2: { k: 2, dk: 3.8, s: 1.5, L: [6, 8, 10, 12] }, 2.5: { k: 2.5, dk: 4.5, s: 2, L: [6, 8, 10, 12, 16] }, 3: { k: 3, dk: 5.5, s: 2.5, L: [6, 8, 10, 12, 16, 20, 25, 30] },
  4: { k: 4, dk: 7, s: 3, L: [8, 10, 12, 16, 20, 25, 30, 40] }, 5: { k: 5, dk: 8.5, s: 4, L: [10, 12, 16, 20, 25, 30, 40] }, 6: { k: 6, dk: 10, s: 5, L: [12, 16, 20, 25, 30, 40] } };
const N934 = { 2: { s: 4, m: 1.6 }, 2.5: { s: 5, m: 2 }, 3: { s: 5.5, m: 2.4 }, 4: { s: 7, m: 3.2 }, 5: { s: 8, m: 4 }, 6: { s: 10, m: 5 } };
const W125 = { 2: { d1: 2.2, d2: 5, h: 0.3 }, 2.5: { d1: 2.7, d2: 6, h: 0.5 }, 3: { d1: 3.2, d2: 7, h: 0.5 }, 4: { d1: 4.3, d2: 9, h: 0.8 }, 5: { d1: 5.3, d2: 10, h: 1 }, 6: { d1: 6.4, d2: 12, h: 1.6 } };
const M = (d) => `M${String(d).replace('.', '_')}`;
const DIN_SRC = [{ title: 'ISO/DIN dimension tables (DIN 912, DIN 934, DIN 125-A)', url: 'https://www.dinstandards.com' }];
const fastenerBase = { schema: 1, units: 'mm', category: 'Fasteners', dims_status: { dimensions: 'standard nominal values', thread: 'plain cylinder of 0.92·d (effective diameter)' }, sources: DIN_SRC };
const steel = { mode: 'density', density: 7850 };

for (const [dd, t] of Object.entries(S912)) for (const L of t.L) {
  const d = +dd, id = `din912_${M(d).toLowerCase()}x${L}`, dir = `fasteners/${id}`;
  const headLow = extrude(discShape(t.dk / 2), 0, t.k * 0.55);
  const headTop = extrude(discShape(t.dk / 2, [polyPath(hexPoints(t.s))]), t.k * 0.55, t.k);
  const shank = cylinder(0, 0, (d * 0.92) / 2, -L, 0);
  stl(dir, 'screw.stl', merge(headLow, headTop, shank));
  json(dir, { ...fastenerBase, id, name: `Socket head cap screw DIN 912 ${M(d)}×${L}`, description: 'Origin on the underside of the head, shank along −Z.', trust_mesh: true,
    bodies: [{ name: 'screw', mesh: 'screw.stl', color: '#8d9298', mass: steel, collision: 'none',
      connectors: [conn('under_head', [0, 0, 0], [0, 0, -1], 'mate to a plate surface/hole: shank goes into the hole'), conn('head_top', [0, 0, t.k], [0, 0, 1]), conn('tip', [0, 0, -L], [0, 0, -1])] }] });
}
for (const [dd, t] of Object.entries(N934)) {
  const d = +dd, id = `din934_${M(d).toLowerCase()}`, dir = `fasteners/${id}`;
  stl(dir, 'nut.stl', extrude(polyShape(hexPoints(t.s), [circlePath(0, 0, (d * 0.84) / 2)]), 0, t.m));
  json(dir, { ...fastenerBase, id, name: `Hexagon nut DIN 934 ${M(d)}`, description: 'Origin at the bottom face centre.',
    bodies: [{ name: 'nut', mesh: 'nut.stl', color: '#8d9298', mass: steel, collision: 'none',
      connectors: [conn('bottom', [0, 0, 0], [0, 0, -1]), conn('top', [0, 0, t.m], [0, 0, 1])] }] });
}
for (const [dd, t] of Object.entries(W125)) {
  const d = +dd, id = `din125a_${M(d).toLowerCase()}`, dir = `fasteners/${id}`;
  stl(dir, 'washer.stl', extrude(discShape(t.d2 / 2, [circlePath(0, 0, t.d1 / 2)]), 0, t.h));
  json(dir, { ...fastenerBase, id, name: `Plain washer DIN 125-A ${M(d)}`, description: 'Origin at the bottom face centre.',
    bodies: [{ name: 'washer', mesh: 'washer.stl', color: '#a4a9ae', mass: steel, collision: 'none',
      connectors: [conn('bottom', [0, 0, 0], [0, 0, -1]), conn('top', [0, 0, t.h], [0, 0, 1])] }] });
}

/* ------------------------------------------------------------------------------------------------ */
if (!process.argv.includes('--index')) {
  for (const [k, p] of Object.entries(HOBBY)) hobbyServo(k, p);
  for (const [k, p] of Object.entries(DXL)) dynamixel(k, p);
}
mkdirSync(ROOT, { recursive: true });
buildIndex(ROOT);
