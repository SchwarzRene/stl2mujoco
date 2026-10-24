import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseStepAssembly } from '../src/core/step-asm.js';
import { stlFolder, normalizeName } from '../src/core/stl-folder.js';
import { buildRobot, suggestConfig, instancesOf } from '../src/core/step-import.js';
import { buildMJCF } from '../src/core/mjcf.js';
import { boxMesh } from '../src/core/mesh.js';
import { writeBinarySTL } from '../src/core/stl.js';
import { loadIndex } from '../src/core/library.js';
import { fsReader } from '../src/core/fs-reader.js';
import { poseToMatrix } from '../src/core/project.js';
import { stepFixture } from './helpers/step-fixture.js';

const reader = fsReader(join(import.meta.dirname, '..', 'standard_parts'));

// robot ─ body ─ plate            (base)
//       ├ arm (x2: +100 mm, and -100 mm turned by 180°) ─ servo ─ Case, Shaft (shaft 35 mm above, 10 mm beside the case origin)
//                                                       └ LINK
const STEP = stepFixture(
  ['robot', 'body', 'plate', 'arm', 'e1_mg996r', 'Case', 'Shaft', 'LINK'],
  [
    { parent: 'robot', child: 'body' },
    { parent: 'body', child: 'plate' },
    { parent: 'robot', child: 'arm', pos: [100, 0, 0] },
    { parent: 'robot', child: 'arm', pos: [-100, 0, 0], rotZ: 180 },
    { parent: 'arm', child: 'e1_mg996r' },
    { parent: 'e1_mg996r', child: 'Case' },
    { parent: 'e1_mg996r', child: 'Shaft', pos: [-10, 0, 35] },
    { parent: 'arm', child: 'LINK', pos: [0, 0, 60] },
  ],
);
// every sub-assembly is instanced per usage, so `arm` appears twice and carries its own servo + link
let dir, index;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'step-import-'));
  mkdirSync(join(dir, 'stl'));
  writeFileSync(join(dir, 'stl', 'Plate.stl'), writeBinarySTL(boxMesh(80, 80, 10)));
  writeFileSync(join(dir, 'stl', 'link.stl'), writeBinarySTL(boxMesh(10, 10, 40)));
  index = await loadIndex(reader);
});

describe('step-asm', () => {
  it('reads the tree with nested placements (mm → m, rotation about z)', () => {
    const asm = parseStepAssembly(STEP);
    expect(asm.root).toBe('robot');
    const arms = instancesOf(asm, 'arm');
    expect(arms).toHaveLength(2);
    expect(arms[0].root.world[3]).toBeCloseTo(0.1);
    expect(arms[1].root.world[3]).toBeCloseTo(-0.1);
    expect(arms[1].root.world[0]).toBeCloseTo(-1); // turned by 180°
    const shaft = arms[1].members.find((o) => o.product === 'Shaft');
    expect(shaft.world[3]).toBeCloseTo(-0.1 + 0.01); // x: arm at -100, shaft at -10 in the turned frame
    expect(shaft.world[11]).toBeCloseTo(0.035);
  });
});

describe('stl-folder', () => {
  it('matches by normalised name, honours overrides and reports missing parts', () => {
    expect(normalizeName('1_Base-Plate.STL')).toBe(normalizeName('1 base plate'));
    const stl = stlFolder(dir);
    expect(stl.find('plate')?.positions.length).toBeGreaterThan(0);
    expect(stl.find('LINK')).toBeTruthy();
    expect(stl.find('missing')).toBeNull();
    expect(stlFolder(dir, { thing: 'link.stl' }).find('thing')).toBeTruthy();
    expect(() => stlFolder(dir, { thing: 'nope.stl' }).find('thing')).toThrow(/override/);
  });
});

describe('buildRobot', () => {
  const config = {
    name: 'test', base: { assembly: 'body' }, ignore: [],
    servoModel: { library: 'servo_mg996r', case: 'Case', shaft: 'Shaft' },
    limb: { assembly: 'arm', label: 'arm', servos: [{ parent: 'base', moves: 'output', output: ['LINK'] }] },
  };

  it('builds the base, one limb and clones every other instance at its STEP placement', async () => {
    const { project } = await buildRobot({ asm: parseStepAssembly(STEP), stl: stlFolder(dir), config, reader, index });
    const nodes = Object.values(project.nodes);
    expect(nodes).toHaveLength(1 + 2 * 3); // plate + 2 × (servo case, servo output, link)
    expect(nodes.filter((n) => n.role === 'servo')).toHaveLength(2);
    const link = (suffix) => nodes.find((n) => n.name === `LINK_arm${suffix}`);
    expect(poseToMatrix(link(1).partPose).elements[12]).toBeCloseTo(0.1);
    expect(poseToMatrix(link(2).partPose).elements[12]).toBeCloseTo(-0.1);
    expect(link(2).copy.group).toBe(link(1).copy.group); // clones stay in one copy family
    const { files } = buildMJCF(project);
    expect(new TextDecoder().decode(files['model.xml'])).toContain('<joint');
  });

  it('can turn the servo body around a fixed shaft (moves: "case")', async () => {
    const cfg = { ...config, limb: { ...config.limb, servos: [{ parent: 'base', moves: 'case', case: ['LINK'] }] } };
    const { project } = await buildRobot({ asm: parseStepAssembly(STEP), stl: stlFolder(dir), config: cfg, reader, index });
    const hinge = Object.values(project.nodes).find((n) => n.role === 'servo' && n.name.endsWith('_arm1'));
    expect(hinge.name).toMatch(/case/);
    expect(hinge.joint.axis).toEqual([-0, -0, -1]);
    const output = Object.values(project.nodes).find((n) => n.name === 'servo1_output_arm1');
    expect(hinge.parent).toBe(output.id);
  });

  it('explains what is wrong with the config', async () => {
    const run = (limb) => buildRobot({ asm: parseStepAssembly(STEP), stl: stlFolder(dir), config: { ...config, limb: { ...config.limb, ...limb } }, reader, index });
    await expect(run({ servos: [] })).rejects.toThrow(/1 servos.*describes 0/);
    await expect(run({ assembly: 'nope' })).rejects.toThrow(/not found/);
    await expect(run({ servos: [{ parent: '3.output', output: ['LINK'] }] })).rejects.toThrow(/earlier servo/);
    await expect(run({ servos: [{ parent: 'base', output: ['ghost'] }] })).rejects.toThrow(/ghost/);
  });
});

describe('suggestConfig', () => {
  it('finds the base, the limb, the servo parts and the library servo', () => {
    const { config } = suggestConfig({ asm: parseStepAssembly(STEP), stl: stlFolder(dir), index });
    expect(config.base.assembly).toBe('body');
    expect(config.limb.assembly).toBe('arm');
    expect(config.servoModel).toEqual({ library: 'servo_mg996r', case: 'Case', shaft: 'Shaft' });
    expect(config.limb.servos[0].output).toEqual(['LINK']);
  });
});
