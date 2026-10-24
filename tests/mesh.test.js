import { describe, it, expect } from 'vitest';
import { massProperties, boxMesh, cylinderMesh, sphereMesh, meshQuality, simplify, mirrorMesh, bbox } from '../src/core/mesh.js';
import { parseSTL, writeBinarySTL } from '../src/core/stl.js';

describe('massProperties', () => {
  it('box: volume and inertia match closed form', () => {
    const [a, b, c] = [0.2, 0.1, 0.05];
    const mp = massProperties(boxMesh(a, b, c));
    expect(mp.volume).toBeCloseTo(a * b * c, 10);
    expect(mp.inertia.xx).toBeCloseTo((a * b * c * (b * b + c * c)) / 12, 10);
    expect(mp.inertia.yy).toBeCloseTo((a * b * c * (a * a + c * c)) / 12, 10);
    expect(mp.inertia.xy).toBeCloseTo(0, 12);
  });
  it('off-centre box has correct COM and unchanged central inertia', () => {
    const m = new Float64Array(16); m.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, -3, 2, 1]);
    const mp = massProperties(boxMesh(1, 2, 3), m);
    expect(mp.com[0]).toBeCloseTo(5, 9); expect(mp.com[1]).toBeCloseTo(-3, 9); expect(mp.com[2]).toBeCloseTo(2, 9);
    expect(mp.inertia.zz).toBeCloseTo((6 * (1 + 4)) / 12, 9);
  });
  it('cylinder approaches analytic values', () => {
    const r = 0.03, h = 0.1;
    const mp = massProperties(cylinderMesh(r, h, 256));
    expect(mp.volume).toBeCloseTo(Math.PI * r * r * h, 6);
    expect(mp.inertia.zz / mp.volume).toBeCloseTo(0.5 * r * r, 6);
    expect(mp.inertia.xx / mp.volume).toBeCloseTo((3 * r * r + h * h) / 12, 6);
  });
  it('sphere approaches analytic values', () => {
    const r = 0.5;
    const mp = massProperties(sphereMesh(r, 96, 48));
    expect(mp.volume / ((4 / 3) * Math.PI * r ** 3)).toBeGreaterThan(0.995);
    expect(mp.inertia.xx / mp.volume / (0.4 * r * r)).toBeCloseTo(1, 2);
  });
  it('inward-wound mesh still yields positive volume', () => {
    expect(massProperties(mirrorMesh(boxMesh(1, 1, 1), 0)).volume).toBeCloseTo(1, 10);
  });
});

describe('mesh helpers', () => {
  it('closed primitives are watertight', () => {
    expect(meshQuality(boxMesh(1, 1, 1)).watertight).toBe(true);
    expect(meshQuality(cylinderMesh(1, 1)).watertight).toBe(true);
    expect(meshQuality(sphereMesh(1)).watertight).toBe(true);
  });
  it('detects open meshes', () => {
    expect(meshQuality(boxMesh(1, 1, 1).slice(9)).watertight).toBe(false);
  });
  it('simplify reduces triangles and keeps extent', () => {
    const s = sphereMesh(1, 128, 64);
    const out = simplify(s, 2000);
    expect(out.length / 9).toBeLessThanOrEqual(2000);
    expect(bbox(out).max[0]).toBeGreaterThan(0.9);
  });
  it('STL write/parse roundtrip', () => {
    const m = boxMesh(1, 2, 3);
    const back = parseSTL(writeBinarySTL(m).buffer);
    expect(Array.from(back)).toEqual(Array.from(m));
  });
  it('parses ASCII STL', () => {
    const txt = 'solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid';
    expect(Array.from(parseSTL(new TextEncoder().encode(txt).buffer))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });
});
