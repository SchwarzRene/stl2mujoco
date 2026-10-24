// Refresh a part from an updated STL (e.g. after changing a length in CAD).
// An STL carries no feature names, so connectors are re-located geometrically:
//   • a connector on a hole/boss rim is matched to a circle of the same radius and direction,
//   • a connector on a planar face is matched to the face with the same normal,
//   • the expected position keeps the offset from the NEAREST end of the bounding box on every axis,
//     so lengthening a link moves the holes at the far end with that end and keeps the near holes in place.
import { Quaternion, Vector3 } from 'three';
import { bbox, meshQuality, orientOutward } from './mesh.js';
import { analyze, findCircles, faceRegion } from './features.js';
import { reapplyMate } from './mates.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function zAxis(q) { return new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...q)).toArray(); }

/** Where a point should be after the bounding box changed from `ob` to `nb` (offsets kept from the nearest end). */
export function predictPoint(p, ob, nb) {
  return p.map((c, a) => (c - ob.min[a] <= ob.max[a] - c ? nb.min[a] + (c - ob.min[a]) : nb.max[a] - (ob.max[a] - c)));
}

/** Describe what a connector sits on in the OLD mesh (mesh units): a circle, a planar face or a plain point. */
export function describeConnector(oldPos, p, n) {
  const a = analyze(oldPos);
  let nearest = null, nd = Infinity; // nearest circle with the same orientation (chamfer rims can be <0.5 mm apart)
  for (const c of findCircles(oldPos)) {
    const d = dist(c.center, p);
    if (d < Math.max(0.2 * c.radius, a.diag * 0.002) && dot(c.normal, n) > 0.95 && d < nd) { nd = d; nearest = c; }
  }
  if (nearest) return { kind: 'circle', radius: nearest.radius };
  // face: any triangle on the same plane near p
  let best = null, bd = Infinity;
  for (let t = 0; t < a.n; t++) {
    const tn = [a.normals[t * 3], a.normals[t * 3 + 1], a.normals[t * 3 + 2]];
    if (dot(tn, n) < 0.999) continue;
    const v = a.verts[a.tri[t * 3]];
    const off = Math.abs(dot([p[0] - v[0], p[1] - v[1], p[2] - v[2]], n));
    if (off > a.diag * 1e-3) continue;
    const c = [0, 1, 2].map((k) => (a.verts[a.tri[t * 3]][k] + a.verts[a.tri[t * 3 + 1]][k] + a.verts[a.tri[t * 3 + 2]][k]) / 3);
    const d = dist(c, p); if (d < bd) { bd = d; best = t; }
  }
  if (best != null) { const f = faceRegion(oldPos, best); if (dist(f.center, p) < a.diag * 0.02) return { kind: 'face' }; }
  return { kind: 'point' };
}

/**
 * Find a connector in the new mesh. `pos`/`n` are in mesh units. Returns {status, pos, normal, kind}.
 * status: 'matched' (feature found) | 'predicted' (no feature type, moved with the nearest end) | 'unmatched'.
 */
export function matchConnector(oldPos, newPos, pos, n, ob, nb) {
  const desc = describeConnector(oldPos, pos, n);
  const guess = predictPoint(pos, ob, nb);
  const nDiag = analyze(newPos).diag;
  if (desc.kind === 'circle') {
    let best = null, bd = Infinity;
    for (const c of findCircles(newPos)) {
      if (Math.abs(c.radius - desc.radius) > 0.1 * desc.radius || dot(c.normal, n) < 0.9) continue;
      const d = dist(c.center, guess); if (d < bd) { bd = d; best = c; }
    }
    if (best && bd < 0.35 * nDiag) return { status: 'matched', kind: 'circle', pos: [...best.center], normal: [...best.normal] };
    return { status: 'unmatched', kind: 'circle' };
  }
  if (desc.kind === 'face') {
    const a = analyze(newPos);
    let best = null, bd = Infinity;
    for (let t = 0; t < a.n; t++) {
      const tn = [a.normals[t * 3], a.normals[t * 3 + 1], a.normals[t * 3 + 2]];
      if (dot(tn, n) < 0.999) continue;
      const v = a.verts[a.tri[t * 3]];
      if (Math.abs(dot([guess[0] - v[0], guess[1] - v[1], guess[2] - v[2]], n)) > a.diag * 0.02) continue;
      const c = [0, 1, 2].map((k) => (a.verts[a.tri[t * 3]][k] + a.verts[a.tri[t * 3 + 1]][k] + a.verts[a.tri[t * 3 + 2]][k]) / 3);
      const d = dist(c, guess); if (d < bd) { bd = d; best = t; }
    }
    if (best != null) { const f = faceRegion(newPos, best); return { status: 'matched', kind: 'face', pos: f.center, normal: f.normal }; }
    return { status: 'unmatched', kind: 'face' };
  }
  return { status: 'predicted', kind: 'point', pos: guess, normal: n };
}

/**
 * Replace the mesh of `partId` with `newPositions` (same unit scale) and keep the assembly intact:
 * connectors of every node using the part are re-located, mates are re-snapped (own mate first, then the
 * parts attached to it). Mass properties follow automatically at export.
 */
export function refreshPart(project, partId, newPositionsRaw) {
  const part = project.parts[partId];
  if (!part) throw new Error('Part not found');
  const oldPos = part.positions, newPos = orientOutward(newPositionsRaw);
  const ob = bbox(oldPos), nb = bbox(newPos), k = part.unitScale;
  const report = { part: part.name, items: [], resnapped: [], errors: [], bbox: { old: ob, new: nb } };
  const users = Object.values(project.nodes).filter((n) => n.part === partId);
  const matches = [];
  for (const node of users) {
    for (const c of node.connectors ?? []) {
      const pos = c.pos.map((v) => v / k), n = zAxis(c.quat);
      const m = matchConnector(oldPos, newPos, pos, n, ob, nb);
      matches.push([node, c, pos, n, m]);
    }
  }
  // commit the new mesh, then the connectors
  part.positions = newPos; part.stats = meshQuality(newPos); part.bbox = nb;
  for (const [node, c, pos, n, m] of matches) {
    if (m.status === 'unmatched') { report.items.push({ node: node.name, connector: c.name, status: 'unmatched', kind: m.kind, movedMm: 0 }); continue; }
    const q = new Quaternion().setFromUnitVectors(new Vector3(...n).normalize(), new Vector3(...m.normal).normalize()).multiply(new Quaternion(...c.quat));
    const moved = dist(m.pos, pos) * k * 1000;
    c.pos = m.pos.map((v) => v * k); c.quat = [q.x, q.y, q.z, q.w];
    report.items.push({ node: node.name, connector: c.name, status: m.status, kind: m.kind, movedMm: +moved.toFixed(3) });
  }
  const bad = new Set(report.items.filter((i) => i.status === 'unmatched').map((i) => `${i.node}/${i.connector}`));
  const snap = (mover) => {
    try { reapplyMate(project, mover.id); report.resnapped.push(mover.name); } catch (e) { report.errors.push(`${mover.name}: ${e.message}`); }
  };
  const involved = (mover) => {
    const t = project.nodes[mover.mate.targetNode];
    const lost = (node, connId) => node && bad.has(`${node.name}/${node.connectors?.find((c) => c.id === connId)?.name}`);
    if (lost(mover, mover.mate.moverConn) || lost(t, mover.mate.targetConn)) { report.errors.push(`${mover.name}: a connector of its mate was not found in the new mesh – not re-snapped`); return false; }
    return true;
  };
  const userIds = new Set(users.map((u) => u.id));
  // own mates first (the refreshed node returns to its target), then parts attached to refreshed nodes
  for (const u of users) if (u.mate && involved(u)) snap(u);
  for (const m of Object.values(project.nodes)) if (m.mate && userIds.has(m.mate.targetNode) && !userIds.has(m.id) && involved(m)) snap(m);
  return report;
}
