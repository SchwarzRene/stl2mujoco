import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Matrix4 } from 'three';
import { newProject, addPrimitive, addNode, poseToMatrix, validate } from '../src/core/project.js';
import { instantiate, loadIndex } from '../src/core/library.js';
import { fsReader } from '../src/core/fs-reader.js';
import { applyMate, connectorWorld, addConnector, mateTargetMatrix } from '../src/core/mates.js';
import { buildMJCF } from '../src/core/mjcf.js';
import { deriveServo } from '../src/core/servo.js';
import { SERVO_SPECS } from '../src/core/servo-specs.js';
import { findCircles, snap, faceRegion } from '../src/core/features.js';
import { box, extrude, polyShape, rectPoints, circlePath } from '../tools/geom.mjs';

const reader = fsReader(join(import.meta.dirname, '..', 'standard_parts'));
const run = (res, script) => {
  const dir = mkdtempSync(join(tmpdir(), 'lib-'));
  for (const [path, bytes] of Object.entries(res.files)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), bytes); }
  const r = spawnSync('python3', ['-I', script, join(dir, 'model.xml')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout);
};

describe('standard parts library', () => {
  it('index lists servos and fasteners', async () => {
    const idx = await loadIndex(reader);
    expect(idx.find((p) => p.id === 'servo_mg996r')).toBeTruthy();
    expect(idx.filter((p) => p.category === 'Fasteners').length).toBeGreaterThan(30);
  });

  it('servo prefab has case + output with datasheet mass, torque and connectors', async () => {
    const p = newProject('t');
    const idx = await loadIndex(reader);
    const nodes = await instantiate(p, reader, idx.find((e) => e.id === 'servo_mg996r'));
    const [caseN, out] = nodes;
    expect(out.parent).toBe(caseN.id);
    expect(caseN.mass.mass + out.mass.mass).toBeCloseTo(0.055, 6);
    expect(out.actuator.forcerange).toBeCloseTo(11 * 0.0980665, 6);
    expect(out.joint.damping).toBeCloseTo(deriveServo(out.servo).stall_torque / deriveServo(out.servo).noload_speed, 9);
    expect(caseN.connectors.map((c) => c.name)).toContain('ear_hole_1_top');
    expect(out.connectors.map((c) => c.name)).toContain('output_top');
    // case + output span the listed overall height of 42.9 mm
    const w = connectorWorld(out, out.connectors.find((c) => c.name === 'output_top')).elements;
    const bottom = connectorWorld(caseN, caseN.connectors.find((c) => c.name === 'case_bottom')).elements;
    expect((w[14] - bottom[14]) * 1000).toBeCloseTo(42.9, 3);
  });

  it('exported servo tracks a command within datasheet torque and speed limits (MuJoCo)', async () => {
    const p = newProject('servo_test'); p.settings.gravity = [0, 0, 0]; p.settings.floor = false;
    const idx = await loadIndex(reader);
    await instantiate(p, reader, idx.find((e) => e.id === 'servo_mg996r'));
    const info = run(buildMJCF(p), 'tests/servo_step.py');
    const spec = deriveServo({ ...SERVO_SPECS.mg996r, voltage: '6.0', voltages: SERVO_SPECS.mg996r.voltages });
    expect(info.stall_torque).toBeCloseTo(spec.stall_torque, 6);
    expect(Math.abs(info.step.final - info.step.target)).toBeLessThan(0.02);      // < ~1°
    expect(info.step.max_speed).toBeLessThan(spec.noload_speed * 1.02);             // never faster than no-load speed
    expect(info.step.max_speed).toBeGreaterThan(spec.noload_speed * 0.7);           // but reaches most of it
    expect(info.step.overshoot).toBeLessThan(0.15);
    expect(info.hold_deflection).toBeGreaterThan(0.0);
    expect(info.hold_deflection).toBeLessThan(0.15);                                // holds 80 % of stall torque
    expect(info.overload_position).toBeGreaterThan(info.range[1] * 0.99);          // 150 % of stall is overpowered
  });

  it('fastener mass matches steel density × volume', async () => {
    const p = newProject('f');
    const idx = await loadIndex(reader);
    const [nut] = await instantiate(p, reader, idx.find((e) => e.id === 'din934_m4'));
    // DIN 934 M4: s=7, m=3.2, bore ≈ 0.84·d ⇒ ~0.8 g in steel
    expect(nut.mass.mode).toBe('density');
    const res = buildMJCF(p);
    expect(res.report[0].mass * 1000).toBeGreaterThan(0.6);
    expect(res.report[0].mass * 1000).toBeLessThan(1.1);
  });
});

describe('mates', () => {
  function plateAndScrew() {
    const p = newProject('m');
    const plate = addPrimitive(p, 'box', [0.1, 0.05, 0.01]);
    const pn = addNode(p, { name: 'plate', partId: plate.id, role: 'base-fixed' });
    const peg = addPrimitive(p, 'cylinder', [0.005, 0.03]);
    const sn = addNode(p, { name: 'peg', partId: peg.id, role: 'link' });
    const top = addConnector(pn, { name: 'top', pos: [0.02, 0, 0.005], normal: [0, 0, 1] });
    const end = addConnector(sn, { name: 'end', pos: [0, 0, 0.015], normal: [0, 0, 1] });
    return { p, pn, sn, top, end };
  }
  it('rigid mate puts connectors coincident with opposing Z (face to face)', () => {
    const { p, pn, sn, top, end } = plateAndScrew();
    applyMate(p, sn.id, { moverConn: end.id, targetNode: pn.id, targetConn: top.id, type: 'rigid' });
    const a = connectorWorld(pn, top).elements, b = connectorWorld(sn, end).elements;
    expect(b[12]).toBeCloseTo(a[12], 9); expect(b[13]).toBeCloseTo(a[13], 9); expect(b[14]).toBeCloseTo(a[14], 9);
    expect(b[8] + a[8]).toBeCloseTo(0, 9); expect(b[10] + a[10]).toBeCloseTo(0, 9); // Z axes opposed
    expect(sn.parent).toBe(pn.id); expect(sn.joint.type).toBe('fixed');
    // the peg now stands on the plate: its centre is 15 mm above the connector
    expect(sn.partPose.pos[2]).toBeCloseTo(0.005 + 0.015, 9);
  });
  it('flip aligns the Z axes, offset and rotation are honoured, revolute sets hinge about connector Z', () => {
    const { p, pn, sn, top, end } = plateAndScrew();
    applyMate(p, sn.id, { moverConn: end.id, targetNode: pn.id, targetConn: top.id, type: 'revolute', flip: true, offset: 0.002, rotation: Math.PI / 2 });
    const a = connectorWorld(pn, top).elements, b = connectorWorld(sn, end).elements;
    expect(b[10]).toBeCloseTo(a[10], 9);
    expect(b[14] - a[14]).toBeCloseTo(0.002, 9);
    expect(b[0]).toBeCloseTo(0, 9); expect(b[1]).toBeCloseTo(1, 9); // x axis rotated 90° about Z
    expect(sn.joint.type).toBe('hinge'); expect(sn.joint.axis).toEqual([0, 0, 1]);
    expect(poseToMatrix(sn.frame).elements[14]).toBeCloseTo(a[14] + 0.002, 9);
  });
  it('moves the whole sub-tree and rejects loops', () => {
    const { p, pn, sn, top, end } = plateAndScrew();
    const cap = addPrimitive(p, 'box', [0.01, 0.01, 0.01]);
    const cn = addNode(p, { name: 'cap', parent: sn.id, partId: cap.id, role: 'link' });
    cn.partPose.pos = [0, 0, 0.03]; cn.frame.pos = [0, 0, 0.03];
    applyMate(p, sn.id, { moverConn: end.id, targetNode: pn.id, targetConn: top.id, type: 'rigid' });
    expect(cn.partPose.pos[2]).toBeCloseTo(0.005 + 0.015 - 0.03, 9); // flipped upside-down with its parent
    const c2 = addConnector(cn, { name: 'c', pos: [0, 0, 0], normal: [0, 0, 1] });
    expect(() => applyMate(p, pn.id, { moverConn: top.id, targetNode: cn.id, targetConn: c2.id, type: 'rigid' })).toThrow(/loop/);
  });
  it('screw mated to a hole connector exports and loads in MuJoCo', async () => {
    const p = newProject('assy'); p.settings.floor = false;
    const plate = addPrimitive(p, 'box', [0.05, 0.05, 0.005]);
    const pn = addNode(p, { name: 'plate', partId: plate.id, role: 'base-fixed' });
    const hole = addConnector(pn, { name: 'hole', pos: [0.01, 0.01, 0.0025], normal: [0, 0, 1] });
    const idx = await loadIndex(reader);
    const [screw] = await instantiate(p, reader, idx.find((e) => e.id === 'din912_m3x10'));
    applyMate(p, screw.id, { moverConn: screw.connectors.find((c) => c.name === 'under_head').id, targetNode: pn.id, targetConn: hole.id, type: 'rigid' });
    // head sits on the plate (above), shank pointing down into it
    expect(screw.partPose.pos[2]).toBeCloseTo(0.0025, 9);
    expect(screw.partPose.pos[0]).toBeCloseTo(0.01, 9);
    const res = buildMJCF(p);
    const info = run({ ...res }, 'tests/validate_mjcf.py');
    expect(info.nbody).toBe(3);
  });
  it('mateTargetMatrix requires a valid target connector', () => {
    const { p, pn } = plateAndScrew();
    expect(() => mateTargetMatrix(p, { targetNode: pn.id, targetConn: 'nope' })).toThrow();
  });
});

describe('feature detection', () => {
  const plate = () => extrude(polyShape(rectPoints(-20, 20, -10, 10), [circlePath(8, 0, 2.5), circlePath(-8, 0, 2.5)]), 0, 3);
  it('finds hole rims as circles with correct centre, radius and outward normal', () => {
    const circles = findCircles(plate()).filter((c) => Math.abs(c.radius - 2.5) < 0.05);
    expect(circles.length).toBe(4); // 2 holes × top and bottom rim
    const top = circles.filter((c) => c.normal[2] > 0.9 && Math.abs(c.center[0] - 8) < 0.05)[0];
    expect(top.center[2]).toBeCloseTo(3, 3); expect(top.center[1]).toBeCloseTo(0, 3);
  });
  it('snaps a click near a hole to its centre, and elsewhere to the face centre', () => {
    const pos = plate();
    // find a top-face triangle close to the hole at x=8
    const near = (x, y) => { // top-face triangle containing (x, y)
      for (let t = 0; t < pos.length / 9; t++) {
        const o = t * 9; if (pos[o + 2] < 2.99 || pos[o + 5] < 2.99 || pos[o + 8] < 2.99) continue;
        const [ax, ay, bx, by, cx, cy] = [pos[o], pos[o + 1], pos[o + 3], pos[o + 4], pos[o + 6], pos[o + 7]];
        const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay), u = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / d, v = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / d;
        if (u >= 0 && v >= 0 && u + v <= 1) return { t, p: [x, y, 3] };
      }
    };
    const h = near(11.0, 0.4);
    const s = snap(pos, h.t, h.p);
    expect(s.kind).toBe('circle'); expect(s.pos[0]).toBeCloseTo(8, 2);
    expect(s.normal[2]).toBeGreaterThan(0.9);
    const far = snap(pos, h.t, [11.0, 0.4, 3], 'point');
    expect(far.kind).toBe('point');
    const f = faceRegion(pos, h.t);
    expect(f.center[0]).toBeCloseTo(0, 2); expect(f.center[1]).toBeCloseTo(0, 2); expect([...f.size].sort((a, b) => a - b).map((v) => +v.toFixed(2))).toEqual([20, 40]);
  });
});
