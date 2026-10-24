// Surface feature detection on triangle meshes for connector snapping: circles (holes / bosses),
// planar faces, vertices and edge midpoints. All coordinates are in the mesh's own units.
const COS_FEATURE = Math.cos((40 * Math.PI) / 180);
const COS_COPLANAR = Math.cos((2 * Math.PI) / 180);
const cache = new WeakMap();

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function analyze(positions) {
  let a = cache.get(positions);
  if (a) return a;
  const n = positions.length / 9;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], positions[i + k]); hi[k] = Math.max(hi[k], positions[i + k]); }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const q = 2e5 / diag;
  const ids = new Map(), verts = [];
  const vid = (i) => {
    const key = `${Math.round(positions[i] * q)},${Math.round(positions[i + 1] * q)},${Math.round(positions[i + 2] * q)}`;
    let v = ids.get(key);
    if (v === undefined) { v = verts.length; ids.set(key, v); verts.push([positions[i], positions[i + 1], positions[i + 2]]); }
    return v;
  };
  const tri = new Int32Array(n * 3), normals = new Float32Array(n * 3);
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) tri[t * 3 + k] = vid(t * 9 + k * 3);
    const A = verts[tri[t * 3]], B = verts[tri[t * 3 + 1]], C = verts[tri[t * 3 + 2]];
    const nn = norm(cross(sub(B, A), sub(C, A)));
    normals[t * 3] = nn[0]; normals[t * 3 + 1] = nn[1]; normals[t * 3 + 2] = nn[2];
  }
  const edges = new Map(); // key -> [triA, triB, ...]
  const ek = (x, y) => (x < y ? x * 4294967296 + y : y * 4294967296 + x);
  for (let t = 0; t < n; t++) {
    if (tri[t * 3] === tri[t * 3 + 1] || tri[t * 3 + 1] === tri[t * 3 + 2] || tri[t * 3] === tri[t * 3 + 2]) continue; // degenerate after vertex merge
    for (let e = 0; e < 3; e++) {
    const k = ek(tri[t * 3 + e], tri[t * 3 + ((e + 1) % 3)]);
    const l = edges.get(k); if (l) l.push(t); else edges.set(k, [t]);
    }
  }
  a = { n, diag, verts, tri, normals, edges, ek, circles: null, featureEdges: null };
  cache.set(positions, a);
  return a;
}

const triN = (a, t) => [a.normals[t * 3], a.normals[t * 3 + 1], a.normals[t * 3 + 2]];

function featureEdges(a) {
  if (a.featureEdges) return a.featureEdges;
  const out = [];
  for (const [k, tris] of a.edges) {
    if (tris.length === 2 && dot(triN(a, tris[0]), triN(a, tris[1])) < COS_FEATURE) out.push([Math.floor(k / 4294967296), k % 4294967296, tris]);
    else if (tris.length === 1) out.push([Math.floor(k / 4294967296), k % 4294967296, tris]);
  }
  return (a.featureEdges = out);
}

/** All circular edge loops (hole rims, boss rims) with centre, outward normal and radius. */
export function findCircles(positions) {
  const a = analyze(positions);
  if (a.circles) return a.circles;
  const adj = new Map(), edgeTris = new Map();
  for (const [x, y, tris] of featureEdges(a)) {
    (adj.get(x) ?? adj.set(x, []).get(x)).push(y); (adj.get(y) ?? adj.set(y, []).get(y)).push(x);
    edgeTris.set(a.ek(x, y), tris);
  }
  const seen = new Set(), circles = [];
  for (const start of adj.keys()) {
    if (seen.has(start) || adj.get(start).length !== 2) continue;
    const loop = [start]; seen.add(start);
    let prev = -1, cur = start, closed = false;
    for (let guard = 0; guard < 100000; guard++) {
      const nb = adj.get(cur);
      const next = nb[0] !== prev ? nb[0] : nb[1];
      if (next === start) { closed = true; break; }
      if (seen.has(next) || adj.get(next).length !== 2) break;
      loop.push(next); seen.add(next); prev = cur; cur = next;
    }
    if (!closed || loop.length < 8) continue;
    const pts = loop.map((v) => a.verts[v]);
    const c = fitCircle(pts);
    if (!c) continue;
    // outward normal: take the adjacent triangle that is (anti)parallel to the loop plane normal
    let nrm = c.normal;
    for (let i = 0; i < loop.length; i++) {
      const tris = edgeTris.get(a.ek(loop[i], loop[(i + 1) % loop.length]));
      const hit = tris?.find((t) => Math.abs(dot(triN(a, t), c.normal)) > 0.95);
      if (hit !== undefined) { nrm = triN(a, hit); break; }
    }
    circles.push({ center: c.center, normal: nrm, radius: c.radius, points: loop.length });
  }
  return (a.circles = circles);
}

function fitCircle(pts) {
  // plane normal via Newell's method
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const normal = norm([nx, ny, nz]);
  const m = [0, 0, 0]; for (const p of pts) for (let k = 0; k < 3; k++) m[k] += p[k] / pts.length;
  const u = norm(cross(normal, Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), v = cross(normal, u);
  // Kåsa algebraic fit in plane coordinates
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0, sz = 0;
  const xy = pts.map((p) => { const d = sub(p, m); return [dot(d, u), dot(d, v)]; });
  for (const [x, y] of xy) { const z = x * x + y * y; sxx += x * x; sxy += x * y; syy += y * y; sxz += x * z; syz += y * z; sz += z; }
  const det = sxx * syy - sxy * sxy;
  if (Math.abs(det) < 1e-18) return null;
  const cx = (sxz * syy - syz * sxy) / (2 * det), cy = (syz * sxx - sxz * sxy) / (2 * det);
  const r = Math.sqrt(Math.max(0, sz / pts.length + cx * cx + cy * cy));
  if (!(r > 0)) return null;
  let maxDev = 0, planar = 0;
  for (let i = 0; i < pts.length; i++) { maxDev = Math.max(maxDev, Math.abs(Math.hypot(xy[i][0] - cx, xy[i][1] - cy) - r)); planar = Math.max(planar, Math.abs(dot(sub(pts[i], m), normal))); }
  if (maxDev > 0.04 * r || planar > 0.04 * r) return null;
  return { center: [m[0] + u[0] * cx + v[0] * cy, m[1] + u[1] * cx + v[1] * cy, m[2] + u[2] * cx + v[2] * cy], normal, radius: r };
}

/** Planar face region around triangle `t`: bounding-box centre in the face plane + normal. */
export function faceRegion(positions, t, limit = 60000) {
  const a = analyze(positions);
  const n0 = triN(a, t), seen = new Set([t]), queue = [t];
  while (queue.length && seen.size < limit) {
    const c = queue.pop();
    for (let e = 0; e < 3; e++) {
      for (const o of a.edges.get(a.ek(a.tri[c * 3 + e], a.tri[c * 3 + ((e + 1) % 3)])) ?? []) {
        if (!seen.has(o) && dot(triN(a, o), n0) > COS_COPLANAR) { seen.add(o); queue.push(o); }
      }
    }
  }
  const u = norm(cross(n0, Math.abs(n0[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), v = cross(n0, u);
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity], base = null;
  for (const tt of seen) for (let k = 0; k < 3; k++) {
    const p = a.verts[a.tri[tt * 3 + k]]; base ??= p;
    const d = sub(p, base), x = dot(d, u), y = dot(d, v);
    lo = [Math.min(lo[0], x), Math.min(lo[1], y)]; hi = [Math.max(hi[0], x), Math.max(hi[1], y)];
  }
  const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2;
  return { center: [base[0] + u[0] * cx + v[0] * cy, base[1] + u[1] * cx + v[1] * cy, base[2] + u[2] * cx + v[2] * cy], normal: n0, triangles: seen.size, size: [hi[0] - lo[0], hi[1] - lo[1]] };
}

/**
 * Snap a picked point on triangle `t`.
 * mode: 'auto' (circle → planar face → exact point), 'point', 'vertex', 'edge'
 * Returns { kind, pos, normal, radius? } in mesh units.
 */
export function snap(positions, t, point, mode = 'auto') {
  const a = analyze(positions), n = triN(a, t);
  if (mode === 'point') return { kind: 'point', pos: point, normal: n };
  if (mode === 'vertex') {
    let best = null, bd = Infinity;
    for (let k = 0; k < 3; k++) { const p = a.verts[a.tri[t * 3 + k]]; const d = Math.hypot(...sub(p, point)); if (d < bd) { bd = d; best = p; } }
    return { kind: 'vertex', pos: [...best], normal: n };
  }
  if (mode === 'edge') {
    let best = null, bd = Infinity;
    for (let k = 0; k < 3; k++) {
      const p = a.verts[a.tri[t * 3 + k]], q = a.verts[a.tri[t * 3 + ((k + 1) % 3)]];
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
      const d = Math.hypot(...sub(mid, point)); if (d < bd) { bd = d; best = mid; }
    }
    return { kind: 'edge-mid', pos: best, normal: n };
  }
  let bestC = null, bs = Infinity;
  for (const c of findCircles(positions)) {
    const d = sub(point, c.center), along = Math.abs(dot(d, c.normal)), inplane = Math.hypot(...sub(d, c.normal.map((x) => x * dot(d, c.normal))));
    if (dot(c.normal, n) < 0.9 && dot(c.normal, n) > -0.9) { if (along > 0.35 * c.radius + 1e-6) continue; }
    if (along > Math.max(0.35 * c.radius, a.diag * 0.002) || inplane > 1.8 * c.radius + a.diag * 0.002) continue;
    const s = inplane / c.radius; if (s < bs) { bs = s; bestC = c; }
  }
  if (bestC) return { kind: 'circle', pos: [...bestC.center], normal: [...bestC.normal], radius: bestC.radius };
  const f = faceRegion(positions, t);
  if (f.triangles >= 2) return { kind: 'face', pos: f.center, normal: f.normal, size: f.size };
  return { kind: 'point', pos: point, normal: n };
}
