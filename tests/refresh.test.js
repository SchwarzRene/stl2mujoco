import { describe, it, expect } from 'vitest';
import { newProject, addPart, addNode } from '../src/core/project.js';
import { addConnector, applyMate, connectorWorld } from '../src/core/mates.js';
import { refreshPart, predictPoint } from '../src/core/refresh.js';
import { bbox } from '../src/core/mesh.js';
import { extrude, polyShape, rectPoints, circlePath, merge } from '../tools/geom.mjs';

// plate along X with its CAD origin at the left end; holes keep a 4 mm offset from each end
const plate = (len) => extrude(polyShape(rectPoints(0, len, -8, 8), [circlePath(4, 0, 2.5), circlePath(len - 4, 0, 2.5)]), 0, 3);
const peg = () => extrude(polyShape(rectPoints(-2, 2, -2, 2)), 0, 10);

function assembly(len = 40) {
  const p = newProject('r');
  const bar = addPart(p, { name: 'bar', positions: plate(len), unitScale: 0.001 });
  const pegP = addPart(p, { name: 'peg', positions: peg(), unitScale: 0.001 });
  const barN = addNode(p, { name: 'bar', partId: bar.id, role: 'base-fixed' });
  const pegN = addNode(p, { name: 'peg', partId: pegP.id, role: 'link' });
  const left = addConnector(barN, { name: 'hole_left', pos: [0.004, 0, 0.003], normal: [0, 0, 1] });
  const right = addConnector(barN, { name: 'hole_right', pos: [(len - 4) / 1000, 0, 0.003], normal: [0, 0, 1] });
  const endFace = addConnector(barN, { name: 'end_face', pos: [len / 1000, 0, 0.0015], normal: [1, 0, 0] });
  const top = addConnector(pegN, { name: 'bottom', pos: [0, 0, 0], normal: [0, 0, -1] });
  applyMate(p, pegN.id, { moverConn: top.id, targetNode: barN.id, targetConn: right.id, type: 'rigid', flip: true });
  return { p, bar, barN, pegN, left, right, endFace };
}

describe('refresh part from updated STL', () => {
  it('predicts positions by keeping the offset from the nearest end', () => {
    const ob = { min: [0, -8, 0], max: [40, 8, 3] }, nb = { min: [0, -8, 0], max: [60, 8, 3] };
    expect(predictPoint([4, 0, 3], ob, nb)).toEqual([4, 0, 3]);
    expect(predictPoint([36, 0, 3], ob, nb)).toEqual([56, 0, 3]);
  });

  it('lengthening a link moves the far holes with the far end, keeps the near holes, and re-snaps attached parts', () => {
    const { p, bar, barN, pegN, left, right, endFace } = assembly(40);
    const before = connectorWorld(pegN, pegN.connectors[0]).elements.slice(12, 15);
    expect(before[0]).toBeCloseTo(0.036, 9);
    const rep = refreshPart(p, bar.id, plate(60));
    const byName = Object.fromEntries(rep.items.map((i) => [i.connector, i]));
    expect(byName.hole_left.status).toBe('matched'); expect(byName.hole_left.movedMm).toBeCloseTo(0, 3);
    expect(byName.hole_right.status).toBe('matched'); expect(byName.hole_right.movedMm).toBeCloseTo(20, 2);
    expect(byName.end_face.status).toBe('matched'); expect(byName.end_face.movedMm).toBeCloseTo(20, 2);
    expect(right.pos[0]).toBeCloseTo(0.056, 6); expect(left.pos[0]).toBeCloseTo(0.004, 6);
    expect(endFace.pos[0]).toBeCloseTo(0.06, 6);
    // the peg followed its hole without being placed again
    expect(rep.resnapped).toContain('peg');
    const after = connectorWorld(pegN, pegN.connectors[0]).elements.slice(12, 15);
    expect(after[0]).toBeCloseTo(0.056, 6); expect(after[2]).toBeCloseTo(0.003, 6);
    expect(pegN.partPose.pos[0]).toBeCloseTo(0.056, 6);
    expect(bbox(p.parts[bar.id].positions).max[0]).toBeCloseTo(60, 3);
    void barN;
  });

  it('shortening works too and mass properties follow the new mesh', async () => {
    const { p, bar } = assembly(40);
    const { massProperties } = await import('../src/core/mesh.js');
    const v0 = massProperties(p.parts[bar.id].positions).volume;
    refreshPart(p, bar.id, plate(30));
    const v1 = massProperties(p.parts[bar.id].positions).volume;
    expect(v1).toBeLessThan(v0);
    expect(p.nodes[Object.keys(p.nodes)[1]].partPose.pos[0]).toBeCloseTo(0.026, 6);
  });

  it('reports an unmatched connector and does not re-snap its mate when the hole disappears', () => {
    const { p, bar, pegN } = assembly(40);
    const solid = extrude(polyShape(rectPoints(0, 60, -8, 8), [circlePath(4, 0, 2.5)]), 0, 3); // right hole removed
    const x0 = pegN.partPose.pos[0];
    const rep = refreshPart(p, bar.id, solid);
    expect(rep.items.find((i) => i.connector === 'hole_right').status).toBe('unmatched');
    expect(rep.errors.join(' ')).toMatch(/not found in the new mesh/);
    expect(pegN.partPose.pos[0]).toBe(x0); // untouched
  });

  it('a hole with a different radius is not matched to the wrong hole', () => {
    const { p, bar } = assembly(40);
    const other = extrude(polyShape(rectPoints(0, 40, -8, 8), [circlePath(4, 0, 2.5), circlePath(36, 0, 4)]), 0, 3); // right hole now r=4
    const rep = refreshPart(p, bar.id, other);
    expect(rep.items.find((i) => i.connector === 'hole_right').status).toBe('unmatched');
    expect(rep.items.find((i) => i.connector === 'hole_left').status).toBe('matched');
  });

  it('keeps neighbouring rims apart (chamfer: inner and outer rim only 0.4 mm apart)', () => {
    // hole r=2.35 with a 0.4 mm deep r=2.75 counterbore on top → two same-direction rims close together
    const chamfered = (len) => merge(
      extrude(polyShape(rectPoints(0, len, -8, 8), [circlePath(len - 4, 0, 2.35)]), 0, 2.6),
      extrude(polyShape(rectPoints(0, len, -8, 8), [circlePath(len - 4, 0, 2.75)]), 2.6, 3),
    );
    const p = newProject('c');
    const part = addPart(p, { name: 'chamfered', positions: chamfered(40), unitScale: 0.001 });
    const n = addNode(p, { name: 'n', partId: part.id });
    const inner = addConnector(n, { name: 'inner', pos: [0.036, 0, 0.0026], normal: [0, 0, 1] });
    const outer = addConnector(n, { name: 'outer', pos: [0.036, 0, 0.003], normal: [0, 0, 1] });
    const rep = refreshPart(p, part.id, chamfered(60));
    expect(rep.items.map((i) => i.status)).toEqual(['matched', 'matched']);
    expect(inner.pos[0]).toBeCloseTo(0.056, 6); expect(inner.pos[2]).toBeCloseTo(0.0026, 6);
    expect(outer.pos[0]).toBeCloseTo(0.056, 6); expect(outer.pos[2]).toBeCloseTo(0.003, 6);
  });

  it('refreshes mirrored copies together with their source part', async () => {
    const { p, bar, barN } = assembly(40);
    const { mirrorSubtree } = await import('../src/core/project.js');
    const [mBar] = mirrorSubtree(p, barN.id, 1);
    expect(p.parts[mBar.part].mirrorOf.part).toBe(bar.id);
    refreshPart(p, bar.id, plate(60));
    expect(bbox(p.parts[mBar.part].positions).max[0]).toBeCloseTo(60, 3); // mirrored mesh follows
    const hole = mBar.connectors.find((c) => c.name === 'hole_right');
    expect(hole.pos[0]).toBeCloseTo(0.056, 6);
  });

  it('refuses a mesh in the wrong unit', () => {
    const { p, bar } = assembly(40);
    const tiny = plate(40).map((v) => v / 1000);
    expect(() => refreshPart(p, bar.id, tiny)).toThrow(/wrong file or wrong unit/);
    expect(bbox(p.parts[bar.id].positions).max[0]).toBeCloseTo(40, 3); // untouched
  });
});
