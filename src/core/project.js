// Project data model. Everything is stored in the *reference pose* (all joints at zero), in world
// coordinates, SI units (metres / radians). Parent-relative poses are derived on export.
import { Matrix4, Quaternion, Vector3, Euler } from 'three';
import { applyRole, defaultJoint } from './presets.js';
import { mirrorMesh, meshQuality, bbox, boxMesh, cylinderMesh, sphereMesh } from './mesh.js';

export const uid = () => Math.random().toString(36).slice(2, 9);
export const identityPose = () => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] });

export function newProject(name = 'robot') {
  return {
    name,
    settings: { gravity: [0, 0, -9.81], timestep: 0.002, floor: true, sensors: true, imu: true, collisionTriangles: 20000, friction: [1, 0.005, 0.0001] },
    parts: {},
    nodes: {},
  };
}

export const poseToMatrix = (p) => new Matrix4().compose(new Vector3(...p.pos), new Quaternion(...p.quat), new Vector3(1, 1, 1));
export function matrixToPose(m) {
  const pos = new Vector3(), q = new Quaternion();
  m.decompose(pos, q, new Vector3());
  return { pos: pos.toArray(), quat: [q.x, q.y, q.z, q.w] };
}
export const poseFromEulerDeg = (posM, rotDeg) => ({
  pos: [...posM],
  quat: (() => { const q = new Quaternion().setFromEuler(new Euler(...rotDeg.map((d) => (d * Math.PI) / 180), 'XYZ')); return [q.x, q.y, q.z, q.w]; })(),
});
export function eulerDegFromPose(p) {
  const e = new Euler().setFromQuaternion(new Quaternion(...p.quat), 'XYZ');
  return [e.x, e.y, e.z].map((r) => (r * 180) / Math.PI);
}

export function addPart(project, { name, positions, unitScale = 0.001, source = 'stl', dims = null }) {
  const id = uid();
  const stats = meshQuality(positions);
  project.parts[id] = { id, name, unitScale, source, dims, positions, stats, bbox: bbox(positions) };
  return project.parts[id];
}

export function addPrimitive(project, kind, dims) {
  const positions = kind === 'box' ? boxMesh(...dims) : kind === 'cylinder' ? cylinderMesh(dims[0], dims[1]) : sphereMesh(dims[0]);
  return addPart(project, { name: `${kind}_${Object.keys(project.parts).length + 1}`, positions, unitScale: 1, source: kind, dims });
}

export function addNode(project, { name, parent = null, partId = null, role = 'link', frame, partPose } = {}) {
  const id = uid();
  const base = frame ?? (parent ? { pos: [...project.nodes[parent].frame.pos], quat: [...project.nodes[parent].frame.quat] } : identityPose());
  const node = {
    id, name: name || `node_${Object.keys(project.nodes).length + 1}`, parent, part: partId,
    role: 'link', frame: base, partPose: partPose ?? { pos: [...base.pos], quat: [...base.quat] },
    joint: defaultJoint(), actuator: null,
    mass: { mode: 'density', density: 1240, mass: 0.1 },
    collision: 'mesh', color: '#8aa4c8', friction: null,
  };
  project.nodes[id] = node;
  applyRole(node, role);
  return node;
}

export const children = (project, id) => Object.values(project.nodes).filter((n) => n.parent === id);
export const roots = (project) => Object.values(project.nodes).filter((n) => !n.parent || !project.nodes[n.parent]);
export function subtreeIds(project, id) {
  const out = [id];
  for (const c of children(project, id)) out.push(...subtreeIds(project, c.id));
  return out;
}

export function removeNode(project, id) {
  for (const x of subtreeIds(project, id)) delete project.nodes[x];
  pruneParts(project);
}
export function pruneParts(project) {
  const used = new Set(Object.values(project.nodes).map((n) => n.part));
  for (const pid of Object.keys(project.parts)) if (!used.has(pid)) delete project.parts[pid];
}

export function isDescendant(project, id, maybeAncestor) {
  for (let n = project.nodes[id]; n; n = project.nodes[n.parent]) if (n.id === maybeAncestor) return true;
  return false;
}

/** Rigidly transform (world) a node's frame and part pose, optionally with its whole subtree. */
export function applyWorldTransform(project, id, matrix, { subtree = false, frame = true, part = true } = {}) {
  const ids = subtree ? subtreeIds(project, id) : [id];
  for (const nid of ids) {
    const n = project.nodes[nid];
    if (frame) n.frame = matrixToPose(matrix.clone().multiply(poseToMatrix(n.frame)));
    if (part) n.partPose = matrixToPose(matrix.clone().multiply(poseToMatrix(n.partPose)));
  }
}

function cloneNode(n) { return JSON.parse(JSON.stringify(n)); }

/** Copy a subtree `count` times, rotated about the world Z axis through `center` (e.g. 6 legs of a hexapod). */
export function polarArray(project, id, { count, stepDeg, center = [0, 0, 0], includeOriginalSpacing = true }) {
  const created = [];
  for (let i = 1; i < count; i++) {
    const R = new Matrix4().makeTranslation(...center)
      .multiply(new Matrix4().makeRotationZ((stepDeg * i * Math.PI) / 180))
      .multiply(new Matrix4().makeTranslation(-center[0], -center[1], -center[2]));
    created.push(copySubtree(project, id, R, `_${i + 1}`, project.nodes[id].parent));
  }
  return created;
}

/** Mirror a subtree across the world plane normal to `axis` (0=x,1=y,2=z) – creates mirrored meshes. */
export function mirrorSubtree(project, id, axis = 1, suffix = '_mirror') {
  const S = [1, 1, 1]; S[axis] = -1;
  const Sm = new Matrix4().makeScale(...S);
  const idMap = {}, partMap = {};
  const out = [];
  for (const oid of subtreeIds(project, id)) {
    const o = project.nodes[oid];
    const n = cloneNode(o);
    n.id = uid(); idMap[oid] = n.id;
    n.name = o.name + suffix;
    n.parent = oid === id ? o.parent : idMap[o.parent];
    const reflect = (pose) => matrixToPose(Sm.clone().multiply(poseToMatrix(pose)).multiply(Sm));
    n.frame = reflect(o.frame);
    n.partPose = reflect(o.partPose);
    // axis is a pseudo-vector: a' = det(S)·S·a (S acts on the local axis components)
    const a = o.joint.axis.slice(); a[axis] = -a[axis];
    n.joint.axis = a.map((v) => -v);
    if (o.part) {
      if (!partMap[o.part]) {
        const p = project.parts[o.part];
        const mirrored = mirrorMesh(p.positions, axis);
        partMap[o.part] = addPart(project, { name: p.name + suffix, positions: mirrored, unitScale: p.unitScale, source: p.source, dims: p.dims }).id;
      }
      n.part = partMap[o.part];
    }
    project.nodes[n.id] = n; out.push(n);
  }
  return out;
}

function copySubtree(project, id, M, suffix, newParent) {
  const idMap = {}, out = [];
  for (const oid of subtreeIds(project, id)) {
    const o = project.nodes[oid];
    const n = cloneNode(o);
    n.id = uid(); idMap[oid] = n.id;
    n.name = o.name + suffix;
    n.parent = oid === id ? newParent : idMap[o.parent];
    n.frame = matrixToPose(M.clone().multiply(poseToMatrix(o.frame)));
    n.partPose = matrixToPose(M.clone().multiply(poseToMatrix(o.partPose)));
    project.nodes[n.id] = n; out.push(n);
  }
  return out[0];
}

/** Translate all roots so that the lowest point of the robot rests on z=0. Returns the shift (m). */
export function dropToFloor(project, margin = 0) {
  let lowest = Infinity;
  for (const n of Object.values(project.nodes)) {
    const part = project.parts[n.part];
    if (!part) continue;
    const m = poseToMatrix(n.partPose).multiply(new Matrix4().makeScale(part.unitScale, part.unitScale, part.unitScale));
    lowest = Math.min(lowest, bbox(part.positions, m.elements).min[2]);
  }
  if (!isFinite(lowest)) return 0;
  const shift = margin - lowest;
  const T = new Matrix4().makeTranslation(0, 0, shift);
  for (const n of Object.values(project.nodes)) applyWorldTransform(project, n.id, T);
  return shift;
}

export const sanitizeName = (s) => (String(s).replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'unnamed');

export function uniqueNames(items, key = 'name') {
  const seen = new Map(), out = {};
  for (const it of items) {
    let base = sanitizeName(it[key]), name = base, i = 2;
    while (seen.has(name)) name = `${base}_${i++}`;
    seen.set(name, true); out[it.id] = name;
  }
  return out;
}

export function validate(project) {
  const issues = [];
  const push = (level, msg, node = null) => issues.push({ level, msg, node });
  const nodes = Object.values(project.nodes);
  if (!nodes.length) push('error', 'The robot is empty – import a part first.');
  for (const n of nodes) {
    const part = project.parts[n.part];
    const hasJoint = n.joint.type !== 'fixed';
    if (n.parent && !project.nodes[n.parent]) push('error', `"${n.name}": parent no longer exists`, n.id);
    if (hasJoint && !part) push('error', `"${n.name}" has a joint but no part (no mass) – MuJoCo requires mass on moving bodies`, n.id);
    if (part && !part.stats.watertight) push('warning', `"${n.name}": mesh "${part.name}" is not a clean closed mesh (${part.stats.openEdges} open, ${part.stats.nonManifoldEdges} non-manifold edges) – mass/inertia may be inaccurate; use an explicit mass`, n.id);
    if (part && n.mass.mode === 'explicit' && !(n.mass.mass > 0)) push('error', `"${n.name}": mass must be > 0`, n.id);
    if (part && n.mass.mode === 'density' && !(n.mass.density > 0)) push('error', `"${n.name}": density must be > 0`, n.id);
    if (['hinge', 'slide'].includes(n.joint.type) && Math.hypot(...n.joint.axis) < 1e-9) push('error', `"${n.name}": joint axis is zero`, n.id);
    if (n.joint.range && n.joint.range[0] >= n.joint.range[1]) push('error', `"${n.name}": joint range min must be < max`, n.id);
    if (n.actuator && !['hinge', 'slide', 'ball'].includes(n.joint.type)) push('error', `"${n.name}": actuator needs a hinge/slide joint`, n.id);
    if (n.actuator && n.joint.type === 'ball') push('warning', `"${n.name}": actuators on ball joints are not exported`, n.id);
    if (n.joint.type === 'free' && n.parent) push('error', `"${n.name}": only root bodies can have a free joint`, n.id);
  }
  if (nodes.length && !roots(project).length) push('error', 'No root body (cycle in the tree).');
  if (project.settings.floor && nodes.length) {
    let low = Infinity;
    for (const n of nodes) { const p = project.parts[n.part]; if (!p) continue;
      const m = poseToMatrix(n.partPose).multiply(new Matrix4().makeScale(p.unitScale, p.unitScale, p.unitScale));
      low = Math.min(low, bbox(p.positions, m.elements).min[2]); }
    if (low < -1e-3) push('warning', `The robot is ${(-low * 1000).toFixed(1)} mm below the floor (z<0). Use "Drop to floor".`);
  }
  return issues;
}
