// Mesh utilities: mass properties, bounding box, quality checks, simplification, primitives.

/** Apply optional column-major 4x4 matrix m to point (x,y,z) -> out array. */
function xf(m, x, y, z, out) {
  if (!m) { out[0] = x; out[1] = y; out[2] = z; return; }
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
}

export function bbox(positions, m = null) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const p = [0, 0, 0];
  for (let i = 0; i < positions.length; i += 3) {
    xf(m, positions[i], positions[i + 1], positions[i + 2], p);
    for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
  }
  return { min: lo, max: hi };
}

/**
 * Volume, centre of mass and second-moment based inertia of a closed triangle mesh of unit density.
 * `m` (optional, column-major 4x4) is applied to every vertex first (e.g. unit scale + frame change).
 * Returns { volume, com:[3], inertia:{xx,yy,zz,xy,xz,yz} } with inertia about the COM (unit density).
 * Uses signed tetrahedra (Eberly / Tonon), accumulated in float64 relative to a reference point.
 */
export function massProperties(positions, m = null) {
  const n = positions.length / 9;
  const p = [0, 0, 0];
  xf(m, positions[0], positions[1], positions[2], p);
  const r = [p[0], p[1], p[2]];
  let V = 0;
  const cx = [0, 0, 0];
  const C = [0, 0, 0, 0, 0, 0]; // xx yy zz xy xz yz second moments about r
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    xf(m, positions[o], positions[o + 1], positions[o + 2], a);
    xf(m, positions[o + 3], positions[o + 4], positions[o + 5], b);
    xf(m, positions[o + 6], positions[o + 7], positions[o + 8], c);
    for (let k = 0; k < 3; k++) { a[k] -= r[k]; b[k] -= r[k]; c[k] -= r[k]; }
    const v = (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    V += v;
    const s0 = a[0] + b[0] + c[0], s1 = a[1] + b[1] + c[1], s2 = a[2] + b[2] + c[2];
    cx[0] += v * s0 / 4; cx[1] += v * s1 / 4; cx[2] += v * s2 / 4;
    const f = v / 20;
    C[0] += f * (a[0] * a[0] + b[0] * b[0] + c[0] * c[0] + s0 * s0);
    C[1] += f * (a[1] * a[1] + b[1] * b[1] + c[1] * c[1] + s1 * s1);
    C[2] += f * (a[2] * a[2] + b[2] * b[2] + c[2] * c[2] + s2 * s2);
    C[3] += f * (a[0] * a[1] + b[0] * b[1] + c[0] * c[1] + s0 * s1);
    C[4] += f * (a[0] * a[2] + b[0] * b[2] + c[0] * c[2] + s0 * s2);
    C[5] += f * (a[1] * a[2] + b[1] * b[2] + c[1] * c[2] + s1 * s2);
  }
  if (V < 0) { // inward-facing normals
    V = -V; for (let k = 0; k < 3; k++) cx[k] = -cx[k]; for (let k = 0; k < 6; k++) C[k] = -C[k];
  }
  if (!(V > 0)) return { volume: 0, com: [r[0], r[1], r[2]], inertia: { xx: 0, yy: 0, zz: 0, xy: 0, xz: 0, yz: 0 } };
  const g = [cx[0] / V, cx[1] / V, cx[2] / V]; // COM relative to r
  // shift second moments to COM
  const Cc = [C[0] - V * g[0] * g[0], C[1] - V * g[1] * g[1], C[2] - V * g[2] * g[2],
              C[3] - V * g[0] * g[1], C[4] - V * g[0] * g[2], C[5] - V * g[1] * g[2]];
  const tr = Cc[0] + Cc[1] + Cc[2];
  return {
    volume: V,
    com: [g[0] + r[0], g[1] + r[1], g[2] + r[2]],
    inertia: { xx: tr - Cc[0], yy: tr - Cc[1], zz: tr - Cc[2], xy: -Cc[3], xz: -Cc[4], yz: -Cc[5] },
  };
}

/** Topology check: counts edges not shared by exactly two triangles. */
export function meshQuality(positions) {
  const n = positions.length / 9;
  const ids = new Map();
  const key = (i) => `${Math.round(positions[i] * 1e4)},${Math.round(positions[i + 1] * 1e4)},${Math.round(positions[i + 2] * 1e4)}`;
  const vid = (i) => { const k = key(i); let v = ids.get(k); if (v === undefined) { v = ids.size; ids.set(k, v); } return v; };
  const edges = new Map();
  for (let t = 0; t < n; t++) {
    const v = [vid(t * 9), vid(t * 9 + 3), vid(t * 9 + 6)];
    for (let e = 0; e < 3; e++) {
      const x = v[e], y = v[(e + 1) % 3];
      if (x === y) continue;
      const k = x < y ? x * 4294967296 + y : y * 4294967296 + x;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  let open = 0, nonManifold = 0;
  for (const c of edges.values()) { if (c === 1) open++; else if (c > 2) nonManifold++; }
  return { triangles: n, vertices: ids.size, openEdges: open, nonManifoldEdges: nonManifold, watertight: open === 0 && nonManifold === 0 };
}

/** Vertex-clustering simplification to at most `target` triangles (used for collision meshes). */
export function simplify(positions, target) {
  const n = positions.length / 9;
  if (n <= target) return positions;
  const { min, max } = bbox(positions);
  const ext = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  let lo = 4, hi = 4096, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const out = cluster(positions, min, ext / mid);
    if (out.length / 9 <= target) { best = out; lo = mid + 1; } else hi = mid - 1;
  }
  return best || cluster(positions, min, ext / 4);
}

function cluster(positions, min, cell) {
  const acc = new Map();
  const idx = new Int32Array(positions.length / 3);
  for (let i = 0; i < idx.length; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const k = `${Math.floor((x - min[0]) / cell)},${Math.floor((y - min[1]) / cell)},${Math.floor((z - min[2]) / cell)}`;
    let e = acc.get(k);
    if (!e) { e = { s: [0, 0, 0], c: 0, id: acc.size }; acc.set(k, e); }
    e.s[0] += x; e.s[1] += y; e.s[2] += z; e.c++;
    idx[i] = e.id;
  }
  const rep = new Float32Array(acc.size * 3);
  for (const e of acc.values()) { rep[e.id * 3] = e.s[0] / e.c; rep[e.id * 3 + 1] = e.s[1] / e.c; rep[e.id * 3 + 2] = e.s[2] / e.c; }
  const out = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (a === b || b === c || a === c) continue;
    for (const v of [a, b, c]) out.push(rep[v * 3], rep[v * 3 + 1], rep[v * 3 + 2]);
  }
  return Float32Array.from(out);
}

/** Mirror a mesh along an axis (0=x,1=y,2=z) and fix the winding. */
export function mirrorMesh(positions, axis) {
  const out = new Float32Array(positions.length);
  for (let t = 0; t < positions.length; t += 9) {
    for (let v = 0; v < 3; v++) {
      const src = t + v * 3;
      const dst = t + (v === 1 ? 2 : v === 2 ? 1 : 0) * 3; // swap vertex 1 and 2
      for (let k = 0; k < 3; k++) out[dst + k] = k === axis ? -positions[src + k] : positions[src + k];
    }
  }
  return out;
}

export function boxMesh(sx, sy, sz) {
  const x = sx / 2, y = sy / 2, z = sz / 2;
  const v = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]];
  const f = [[0, 3, 2], [0, 2, 1], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [1, 2, 6], [1, 6, 5], [3, 0, 4], [3, 4, 7]];
  return Float32Array.from(f.flatMap((t) => t.flatMap((i) => v[i])));
}

/** Cylinder along Z. */
export function cylinderMesh(radius, height, segments = 64) {
  const h = height / 2, out = [];
  const pt = (i, z) => [radius * Math.cos((i / segments) * 2 * Math.PI), radius * Math.sin((i / segments) * 2 * Math.PI), z];
  for (let i = 0; i < segments; i++) {
    const a = pt(i, -h), b = pt(i + 1, -h), c = pt(i + 1, h), d = pt(i, h);
    out.push(...a, ...b, ...c, ...a, ...c, ...d); // side
    out.push(0, 0, h, ...d, ...c); // top
    out.push(0, 0, -h, ...b, ...a); // bottom
  }
  return Float32Array.from(out);
}

export function sphereMesh(radius, seg = 32, rings = 16) {
  const out = [];
  const p = (i, j) => {
    const th = (j / rings) * Math.PI, ph = (i / seg) * 2 * Math.PI;
    return [radius * Math.sin(th) * Math.cos(ph), radius * Math.sin(th) * Math.sin(ph), radius * Math.cos(th)];
  };
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = p(i, j), b = p(i + 1, j), c = p(i + 1, j + 1), d = p(i, j + 1);
    if (j > 0) out.push(...a, ...d, ...b);
    if (j < rings - 1) out.push(...b, ...d, ...c);
  }
  return Float32Array.from(out);
}

/** Flip triangle winding if the mesh is inside-out (negative signed volume). */
export function orientOutward(positions) {
  let v = 0;
  for (let i = 0; i < positions.length; i += 9) {
    v += positions[i] * (positions[i + 4] * positions[i + 8] - positions[i + 5] * positions[i + 7])
       - positions[i + 1] * (positions[i + 3] * positions[i + 8] - positions[i + 5] * positions[i + 6])
       + positions[i + 2] * (positions[i + 3] * positions[i + 7] - positions[i + 4] * positions[i + 6]);
  }
  if (!(v < 0)) return positions;
  const q = Float32Array.from(positions);
  for (let i = 0; i < q.length; i += 9) for (let k = 0; k < 3; k++) { const t = q[i + 3 + k]; q[i + 3 + k] = q[i + 6 + k]; q[i + 6 + k] = t; }
  return q;
}
