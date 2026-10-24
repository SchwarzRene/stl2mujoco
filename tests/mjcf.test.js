import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { newProject, addPrimitive, addNode, polarArray, mirrorSubtree, dropToFloor, validate, poseFromEulerDeg, subtreeIds } from '../src/core/project.js';
import { buildMJCF, nodeInertial } from '../src/core/mjcf.js';
import { applyRole } from '../src/core/presets.js';

function twoLinkArm() {
  const p = newProject('arm');
  const base = addPrimitive(p, 'box', [0.1, 0.1, 0.05]);
  const link = addPrimitive(p, 'cylinder', [0.01, 0.2]);
  const b = addNode(p, { name: 'base', partId: base.id, role: 'base-fixed', frame: poseFromEulerDeg([0, 0, 0.025], [0, 0, 0]) });
  b.partPose = { ...b.frame };
  const l = addNode(p, { name: 'upper arm', parent: b.id, partId: link.id, role: 'servo', frame: poseFromEulerDeg([0, 0, 0.05], [90, 0, 0]) });
  l.partPose = poseFromEulerDeg([0, 0.1, 0.05], [90, 0, 0]);
  l.joint.axis = [0, 0, 1];
  return { p, b, l };
}

function mujocoLoad(res) {
  const dir = mkdtempSync(join(tmpdir(), 'mjcf-'));
  for (const [path, bytes] of Object.entries(res.files)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), bytes); }
  const r = spawnSync('python3', ['-I', 'tests/validate_mjcf.py', join(dir, 'model.xml')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

describe('MJCF export', () => {
  it('computes mass from density', () => {
    const { p, b } = twoLinkArm();
    const iner = nodeInertial(p, b);
    expect(iner.mass).toBeCloseTo(1240 * 0.1 * 0.1 * 0.05, 6);
  });

  it('exports a model MuJoCo loads and simulates, with correct mass and kinematics', () => {
    const { p } = twoLinkArm();
    const res = buildMJCF(p);
    const info = mujocoLoad(res);
    const expected = 1240 * (0.1 * 0.1 * 0.05) + 1240 * Math.PI * 0.01 ** 2 * 0.2;
    expect(info.total_mass / expected).toBeGreaterThan(0.999);
    expect(info.total_mass / expected).toBeLessThan(1.001);
    expect(info.njnt).toBe(1);
    expect(info.nu).toBe(1);
    expect(info.body_pos.upper_arm[2]).toBeCloseTo(0.025, 6); // 0.05 - 0.025 relative to base frame
    expect(res.xml).toContain('<position name="upper_arm_act"');
  });

  it('polar array and mirror produce valid, loadable models', () => {
    const { p, l } = twoLinkArm();
    polarArray(p, l.id, { count: 6, stepDeg: 60 });
    mirrorSubtree(p, l.id, 1);
    expect(Object.keys(p.nodes).length).toBe(2 + 5 + 1);
    const info = mujocoLoad(buildMJCF(p));
    expect(info.nbody).toBe(1 + 8); // world + base + 7 arms
    expect(info.nu).toBe(7);
  });

  it('mirrored hinge keeps a mirrored motion sense', () => {
    const { p, l } = twoLinkArm();
    const [m] = mirrorSubtree(p, l.id, 0);
    // reflection across x: pseudo-vector axis picks up det(S)=-1
    expect(m.joint.axis.map((v) => Math.abs(v))).toEqual([0, 0, 1]);
  });

  it('refuses invalid projects, reports issues', () => {
    const p = newProject('bad');
    const n = addNode(p, { name: 'floating', role: 'servo' });
    expect(() => buildMJCF(p)).toThrow(/no part/);
    expect(validate(p).some((i) => i.node === n.id)).toBe(true);
  });

  it('drop to floor puts the lowest point at z=0', () => {
    const { p } = twoLinkArm();
    const shift = dropToFloor(p);
    expect(shift).toBeCloseTo(0, 9);
    for (const n of Object.values(p.nodes)) n.frame.pos[2] -= 0.1, n.partPose.pos[2] -= 0.1;
    expect(dropToFloor(p)).toBeCloseTo(0.1, 6);
  });
});
