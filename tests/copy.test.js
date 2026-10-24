import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { newProject, addPrimitive, addNode, duplicateSubtree, linearArray, copyToClipboard, pasteClipboard, applyToCopies, familyMembers, mirrorSubtree, polarArray, subtreeIds, removeNode } from '../src/core/project.js';
import { addConnector, applyMate } from '../src/core/mates.js';
import { instantiate, loadIndex } from '../src/core/library.js';
import { fsReader } from '../src/core/fs-reader.js';
import { buildMJCF } from '../src/core/mjcf.js';
import { newServoState, applyServo } from '../src/core/servo.js';

const reader = fsReader(join(import.meta.dirname, '..', 'standard_parts'));

async function legProject() {
  const p = newProject('legs'); p.settings.floor = false;
  const base = addNode(p, { name: 'base', partId: addPrimitive(p, 'box', [0.2, 0.2, 0.02]).id, role: 'base' });
  const idx = await loadIndex(reader);
  const [c1, o1] = await instantiate(p, reader, idx.find((e) => e.id === 'servo_mg996r'), { parent: base.id });
  const link = addNode(p, { name: 'link', parent: o1.id, partId: addPrimitive(p, 'box', [0.05, 0.01, 0.01]).id, role: 'link' });
  link.partPose.pos = [0.05, 0, 0];
  return { p, base, c1, o1, link };
}
const run = (res) => {
  const dir = mkdtempSync(join(tmpdir(), 'cp-'));
  for (const [path, bytes] of Object.entries(res.files)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), bytes); }
  const r = spawnSync('python3', ['-I', 'tests/validate_mjcf.py', join(dir, 'model.xml')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout);
};

describe('copy / paste / duplicate', () => {
  it('duplicates a whole sub-assembly with attributes, new ids and unique names', async () => {
    const { p, c1, o1, link } = await legProject();
    const made = duplicateSubtree(p, c1.id, { offset: [0, 0.05, 0] });
    expect(made.length).toBe(3);
    const [c2, o2, l2] = made;
    expect(c2.id).not.toBe(c1.id); expect(c2.parent).toBe(c1.parent);
    expect(o2.parent).toBe(c2.id); expect(l2.parent).toBe(o2.id);
    expect(o2.servo).toEqual(o1.servo); expect(o2.actuator).toEqual(o1.actuator); expect(o2.joint).toEqual(o1.joint);
    expect(c2.connectors.map((c) => c.name)).toEqual(c1.connectors.map((c) => c.name));
    expect(c2.connectors[0].id).not.toBe(c1.connectors[0].id);
    expect(c2.name).toBe('MG996R servo / case (2)'); expect(l2.name).toBe('link (2)');
    expect(l2.partPose.pos[1]).toBeCloseTo(0.05, 9);
    const again = duplicateSubtree(p, c1.id);
    expect(again[0].name).toBe('MG996R servo / case (3)');
    expect(o2.copy.group).toBe(o1.copy.group); expect(o2.copy.key).toBe(o1.copy.key);
    // mutating a copy never touches the original
    o2.joint.damping = 99; expect(o1.joint.damping).not.toBe(99);
    void link;
  });

  it('clipboard survives deleting the original', async () => {
    const { p, c1 } = await legProject();
    const clip = copyToClipboard(p, c1.id);
    removeNode(p, c1.id);
    const made = pasteClipboard(p, clip, {});
    expect(made.length).toBe(3);
    expect(made.every((n) => !n.part || p.parts[n.part])).toBe(true);
    expect(() => buildMJCF(p)).not.toThrow();
  });

  it('linear array creates count-1 copies spaced by step', async () => {
    const { p, c1 } = await legProject();
    const made = linearArray(p, c1.id, { count: 4, step: [0, 0.03, 0] });
    expect(made.length).toBe(3);
    expect(made[2].partPose.pos[1]).toBeCloseTo(c1.partPose.pos[1] + 0.09, 9);
    expect(new Set(Object.values(p.nodes).map((n) => n.name)).size).toBe(Object.keys(p.nodes).length);
  });

  it('keeps mates inside the copied subtree and drops mates to outside parts', async () => {
    const { p, base, c1 } = await legProject();
    const hole = addConnector(base, { name: 'h', pos: [0.05, 0, 0.01], normal: [0, 0, 1] });
    applyMate(p, c1.id, { moverConn: c1.connectors.find((c) => c.name === 'ear_hole_1_bottom').id, targetNode: base.id, targetConn: hole.id, type: 'rigid' });
    expect(c1.mate).toBeTruthy();
    const [c2] = duplicateSubtree(p, c1.id, { offset: [0, 0.06, 0] });
    expect(c2.mate).toBeNull();
  });

  it('applies settings to all copies, but keeps mirrored axes', async () => {
    const { p, c1, o1 } = await legProject();
    const copies = polarArray(p, c1.id, { count: 3, stepDeg: 120 }); // creates 2 copies
    const mirrored = mirrorSubtree(p, c1.id, 1);
    expect(copies.length).toBe(2);
    expect(familyMembers(p, o1.id).length).toBe(3); // 2 polar copies + 1 mirror
    o1.servo = newServoState('xl430_w250'); applyServo(o1);
    const changed = applyToCopies(p, o1.id);
    expect(changed).toBe(3);
    const mo = mirrored.find((n) => n.library?.body === 'output');
    expect(mo.servo.preset).toBe('xl430_w250');
    expect(mo.actuator.forcerange).toBeCloseTo(1.5, 6);
    expect(mo.joint.axis).toEqual([0, 0, -1].map((v) => v) .map((v, i) => mo.joint.axis[i])); // untouched
    expect(mo.joint.axis).not.toEqual(o1.joint.axis);
  });

  it('exports and loads six copies in MuJoCo', async () => {
    const { p, c1 } = await legProject();
    polarArray(p, c1.id, { count: 6, stepDeg: 60 });
    const info = run(buildMJCF(p));
    expect(info.nu).toBe(6);
    expect(info.njnt).toBe(6 + 1); // 6 servos + free base
    expect(subtreeIds(p, c1.id).length).toBe(3);
  });
});
