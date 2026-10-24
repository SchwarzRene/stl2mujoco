// Builds a standard part (part.json + meshes) from a validated part spec (see src/core/part-spec.js).
// Used by the built-in library generator and by the datasheet importer. Dimensions in mm, Z up.
import { writeBinarySTL, parseSTL } from '../src/core/stl.js';
import { orientOutward } from '../src/core/mesh.js';
import { box, cylinder, extrude, polyShape, rectPoints, discShape, circlePath, merge } from './geom.mjs';

const r4 = (v) => +v.toFixed(4);
export const conn = (name, pos, normal, note = '') => ({ name, pos_mm: pos.map(r4), normal, ...(note ? { note } : {}) });

function bodyBase(spec, extra) {
  return { color: spec.color, collision: 'mesh', ...extra };
}
const massOf = (spec, share = 1) => (spec.mass_kg !== undefined ? { mass_kg: r4(spec.mass_kg * share) } : { mass: { mode: 'density', density: spec.density_kg_m3 } });
const head = (spec) => ({ schema: 1, id: spec.id, name: spec.name, category: spec.category, units: 'mm', description: spec.description, dims_status: spec.dims_status, sources: spec.sources, ...(spec.trust_mesh ? { trust_mesh: true } : {}) });
const servoRef = (spec) => (spec.servo?.preset ? { preset: spec.servo.preset } : { spec: spec.servo });

function hobbyServo(spec) {
  const p = spec.params, outMass = p.outMass ?? 0.006;
  const bossD = p.bossD ?? 0, bossH = p.bossH ?? 0; // no boss unless the spec gives one
  const x0 = -p.shaftFromEnd, x1 = x0 + p.L, cx = (x0 + x1) / 2, hy = p.W / 2, earBottom = p.earTop - p.earT;
  const holes = [-1, 1].map((s) => circlePath(cx + (s * p.earSpacing) / 2, 0, p.earHole / 2));
  const caseMesh = merge(
    box(x0, x1, -hy, hy, -p.H, earBottom),
    extrude(polyShape(rectPoints(cx - p.earLen / 2, cx + p.earLen / 2, -hy, hy), holes), earBottom, p.earTop),
    box(x0, x1, -hy, hy, p.earTop, 0),
    ...(bossD > 0 && bossH > 0 ? [cylinder(0, 0, bossD / 2, 0, bossH)] : []),
  );
  const out = cylinder(0, 0, p.splineD / 2, bossH, p.splineTop);
  const json = {
    ...head(spec),
    bodies: [
      { name: 'case', mesh: 'case.stl', color: spec.color, mass_kg: r4(spec.mass_kg - outMass), collision: 'mesh', connectors: [
        conn('ear_hole_1_top', [cx - p.earSpacing / 2, 0, p.earTop], [0, 0, 1], 'mounting hole, top side of the ear'),
        conn('ear_hole_2_top', [cx + p.earSpacing / 2, 0, p.earTop], [0, 0, 1]),
        conn('ear_hole_1_bottom', [cx - p.earSpacing / 2, 0, earBottom], [0, 0, -1], 'mounting hole, underside of the ear'),
        conn('ear_hole_2_bottom', [cx + p.earSpacing / 2, 0, earBottom], [0, 0, -1]),
        conn('case_top', [0, 0, 0], [0, 0, 1], 'case top plane around the shaft'),
        conn('case_bottom', [cx, 0, -p.H], [0, 0, -1]),
        conn('side_back', [x0, 0, (earBottom - p.H) / 2], [-1, 0, 0]),
        conn('side_front', [x1, 0, (earBottom - p.H) / 2], [1, 0, 0]),
        ...spec.connectors] },
      { name: 'output', mesh: 'output.stl', parent: 'case', color: '#e3e6ea', mass_kg: outMass, collision: 'none', joint: { type: 'hinge', axis: [0, 0, 1], frame_mm: [0, 0, 0] }, servo: servoRef(spec),
        connectors: [conn('output_top', [0, 0, p.splineTop], [0, 0, 1], 'top of the output spline – mount the horn / bracket here'), conn('output_base', [0, 0, bossH], [0, 0, -1])] },
    ],
  };
  return { json, meshes: { 'case.stl': caseMesh, 'output.stl': out } };
}

function blockServo(spec) {
  const p = spec.params, outMass = p.outMass ?? 0.006;
  const y0 = -p.shaftFromTop, y1 = p.Hh - p.shaftFromTop, hx = p.W / 2;
  const json = {
    ...head(spec),
    bodies: [
      { name: 'case', mesh: 'case.stl', color: spec.color, mass_kg: r4(spec.mass_kg - outMass), collision: 'mesh', connectors: [
        conn('front_face', [0, 0, 0], [0, 0, 1], 'front face around the horn'), conn('back_face', [0, (y0 + y1) / 2, -p.D], [0, 0, -1]),
        conn('side_left', [-hx, (y0 + y1) / 2, -p.D / 2], [-1, 0, 0]), conn('side_right', [hx, (y0 + y1) / 2, -p.D / 2], [1, 0, 0]),
        conn('end_top', [0, y1, -p.D / 2], [0, 1, 0]), conn('end_bottom', [0, y0, -p.D / 2], [0, -1, 0]), ...spec.connectors] },
      { name: 'output', mesh: 'output.stl', parent: 'case', color: '#e3e6ea', mass_kg: outMass, collision: 'none', joint: { type: 'hinge', axis: [0, 0, 1], frame_mm: [0, 0, 0] }, servo: servoRef(spec),
        connectors: [conn('output_top', [0, 0, p.hornT], [0, 0, 1], 'horn face – mount links here'), conn('output_base', [0, 0, 0], [0, 0, -1])] },
    ],
  };
  return { json, meshes: { 'case.stl': box(-hx, hx, y0, y1, -p.D, 0), 'output.stl': cylinder(0, 0, p.hornD / 2, 0, p.hornT) } };
}

/** Rectangular block / plate, origin at the bottom face centre, optional vertical through holes. */
function blockPart(spec) {
  const { x, y, z, holes = [] } = spec.params;
  const mesh = extrude(polyShape(rectPoints(-x / 2, x / 2, -y / 2, y / 2), holes.map((h) => circlePath(h.x, h.y, h.d / 2))), 0, z);
  const cs = [conn('top', [0, 0, z], [0, 0, 1]), conn('bottom', [0, 0, 0], [0, 0, -1]),
    conn('side_px', [x / 2, 0, z / 2], [1, 0, 0]), conn('side_nx', [-x / 2, 0, z / 2], [-1, 0, 0]), conn('side_py', [0, y / 2, z / 2], [0, 1, 0]), conn('side_ny', [0, -y / 2, z / 2], [0, -1, 0])];
  holes.forEach((h, i) => { cs.push(conn(`hole_${i + 1}_top`, [h.x, h.y, z], [0, 0, 1]), conn(`hole_${i + 1}_bottom`, [h.x, h.y, 0], [0, 0, -1])); });
  return { json: { ...head(spec), bodies: [bodyBase(spec, { name: 'body', mesh: 'body.stl', ...massOf(spec), connectors: [...cs, ...spec.connectors] })] }, meshes: { 'body.stl': mesh } };
}

function cylinderPart(spec) {
  const { d, h, bore } = spec.params;
  const mesh = bore ? extrude(discShape(d / 2, [circlePath(0, 0, bore / 2)]), 0, h) : cylinder(0, 0, d / 2, 0, h);
  const cs = [conn('top', [0, 0, h], [0, 0, 1]), conn('bottom', [0, 0, 0], [0, 0, -1]), conn('side_px', [d / 2, 0, h / 2], [1, 0, 0])];
  return { json: { ...head(spec), bodies: [bodyBase(spec, { name: 'body', mesh: 'body.stl', ...massOf(spec), connectors: [...cs, ...spec.connectors] })] }, meshes: { 'body.stl': mesh } };
}

/** Uses the user's own STL for the shape; connectors come from the datasheet (in the STL's own coordinates). */
function stlPart(spec, files) {
  const raw = files[spec.params.file];
  if (!raw) throw new Error(`STL ${spec.params.file} not provided`);
  const mesh = orientOutward(parseSTL(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
  const json = { ...head(spec), units: spec.params.units, bodies: [bodyBase(spec, { name: 'body', mesh: 'body.stl', ...massOf(spec), connectors: spec.connectors })] };
  return { json, meshes: { 'body.stl': mesh } };
}

/** @returns {{json: object, meshes: Record<string, Float32Array>}} */
export function buildPart(spec, files = {}) {
  switch (spec.type) {
    case 'hobby_servo': return hobbyServo(spec);
    case 'block_servo': return blockServo(spec);
    case 'block': return blockPart(spec);
    case 'cylinder': return cylinderPart(spec);
    case 'stl': return stlPart(spec, files);
    default: throw new Error(`Unknown part type ${spec.type}`);
  }
}

export const meshFiles = (built) => Object.fromEntries(Object.entries(built.meshes).map(([n, m]) => [n, writeBinarySTL(m, 'stl2mujoco standard part')]));
