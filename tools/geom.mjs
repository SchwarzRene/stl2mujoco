// Small solid-modelling helpers for the standard-parts generator (millimetres, Z up).
// Solids are built from watertight extrusions that are stacked along Z without overlapping.
import * as THREE from 'three';
import { massProperties, orientOutward } from '../src/core/mesh.js';

function flat(geom) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  return Float32Array.from(g.getAttribute('position').array);
}
export const orient = orientOutward;

export const circlePath = (cx, cy, r) => { const p = new THREE.Path(); p.absarc(cx, cy, r, 0, Math.PI * 2, true); return p; };
export function polyPath(points) { const p = new THREE.Path(points.map(([x, y]) => new THREE.Vector2(x, y))); p.closePath(); return p; }
export function polyShape(points, holes = []) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  s.holes = holes; return s;
}
export const rectPoints = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
export const hexPoints = (acrossFlats) => { const R = acrossFlats / Math.sqrt(3); return [...Array(6)].map((_, i) => [R * Math.cos((i * Math.PI) / 3), R * Math.sin((i * Math.PI) / 3)]); };
export function discShape(r, holes = []) { const s = new THREE.Shape(); s.absarc(0, 0, r, 0, Math.PI * 2, false); s.holes = holes; return s; }

/** Extrude a 2D shape from z0 to z1. */
export function extrude(shape, z0, z1, segments = 48) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, curveSegments: segments, steps: 1 });
  g.translate(0, 0, z0);
  return orient(flat(g));
}
export const box = (x0, x1, y0, y1, z0, z1) => extrude(polyShape(rectPoints(x0, x1, y0, y1)), z0, z1);
export const cylinder = (cx, cy, r, z0, z1, segments = 48) => extrude(discShape(r), z0, z1, segments).map((v, i) => v + (i % 3 === 0 ? cx : i % 3 === 1 ? cy : 0));

export function merge(...parts) {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export const volume = (p) => massProperties(p).volume;
