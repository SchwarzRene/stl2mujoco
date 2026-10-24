// MuJoCo MJCF exporter.
import { Matrix4, Quaternion, Vector3 } from 'three';
import { poseToMatrix, matrixToPose, roots, children, uniqueNames, sanitizeName, validate } from './project.js';
import { massProperties, simplify } from './mesh.js';
import { writeBinarySTL } from './stl.js';

const num = (v) => { const s = String(+Number(v).toPrecision(9)); return s === '-0' ? '0' : s; };
const vec = (a) => a.map(num).join(' ');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const quatWXYZ = (q) => [q[3], q[0], q[1], q[2]];
const hexToRgba = (hex, a = 1) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a].map((v) => +v.toFixed(4)); };

/**
 * Compute inertial properties of a node in its own body frame (the node.frame).
 * Returns null when the node has no part.
 */
export function nodeInertial(project, node) {
  const part = project.parts[node.part];
  if (!part) return null;
  const s = part.unitScale;
  const m = poseToMatrix(node.frame).invert().multiply(poseToMatrix(node.partPose)).multiply(new Matrix4().makeScale(s, s, s));
  const mp = massProperties(part.positions, m.elements);
  if (!(mp.volume > 0)) throw new Error(`Part "${part.name}" has zero volume – cannot compute mass properties`);
  const mass = node.mass.mode === 'explicit' ? node.mass.mass : node.mass.density * mp.volume;
  const rho = mass / mp.volume;
  const I = mp.inertia;
  return {
    mass, volume: mp.volume, density: rho, com: mp.com,
    fullinertia: [I.xx * rho, I.yy * rho, I.zz * rho, I.xy * rho, I.xz * rho, I.yz * rho],
  };
}

/**
 * Build the MJCF document.
 * @returns {{xml: string, files: Record<string, Uint8Array>, report: object[], issues: object[]}}
 */
export function buildMJCF(project, opts = {}) {
  const issues = validate(project);
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length && !opts.force) {
    const e = new Error('Cannot export:\n' + errors.map((i) => ' - ' + i.msg).join('\n'));
    e.issues = issues; throw e;
  }
  const st = project.settings;
  const nodes = Object.values(project.nodes);
  const bodyNames = uniqueNames(nodes);
  const partsUsed = [...new Set(nodes.map((n) => n.part).filter(Boolean))].map((id) => project.parts[id]);
  const meshNames = uniqueNames(partsUsed);
  const files = {};
  const meshXml = [];
  const colName = {};

  for (const p of partsUsed) {
    const base = meshNames[p.id];
    files[`meshes/${base}.stl`] = writeBinarySTL(p.positions);
    const sc = num(p.unitScale);
    meshXml.push(`    <mesh name="${base}" file="${base}.stl" scale="${sc} ${sc} ${sc}"/>`);
    const tris = p.positions.length / 9;
    if (tris > st.collisionTriangles) {
      const simp = simplify(p.positions, st.collisionTriangles);
      files[`meshes/${base}_col.stl`] = writeBinarySTL(simp);
      meshXml.push(`    <mesh name="${base}_col" file="${base}_col.stl" scale="${sc} ${sc} ${sc}"/>`);
      colName[p.id] = `${base}_col`;
    } else colName[p.id] = base;
  }

  const report = [];
  const jointNames = {};
  const act = [], sens = [];
  const lines = [];
  const world = new Matrix4();

  const emitBody = (node, parentFrameInv, depth) => {
    const ind = '  '.repeat(depth + 2);
    const name = bodyNames[node.id];
    const F = poseToMatrix(node.frame);
    const rel = matrixToPose(parentFrameInv.clone().multiply(F));
    lines.push(`${ind}<body name="${name}" pos="${vec(rel.pos)}" quat="${vec(quatWXYZ(rel.quat))}">`);
    const inner = ind + '  ';
    const inertial = nodeInertial(project, node);
    if (inertial) {
      lines.push(`${inner}<inertial pos="${vec(inertial.com)}" mass="${num(inertial.mass)}" fullinertia="${vec(inertial.fullinertia)}"/>`);
      report.push({ body: name, mass: inertial.mass, volume: inertial.volume, com: inertial.com });
    }
    // joint
    const j = node.joint;
    const jn = `${name}_joint`;
    if (j.type === 'free') lines.push(`${inner}<freejoint name="${jn}"/>`);
    else if (j.type !== 'fixed') {
      jointNames[node.id] = jn;
      const a = [`name="${jn}"`, `type="${j.type}"`];
      if (j.type !== 'ball') a.push(`axis="${vec(j.axis)}"`);
      if (j.range) a.push(`range="${vec(j.range)}"`);
      if (j.damping) a.push(`damping="${num(j.damping)}"`);
      if (j.frictionloss && j.type !== 'ball') a.push(`frictionloss="${num(j.frictionloss)}"`);
      if (j.armature) a.push(`armature="${num(j.armature)}"`);
      if (j.stiffness) a.push(`stiffness="${num(j.stiffness)}"`);
      lines.push(`${inner}<joint ${a.join(' ')}/>`);
    }
    // geoms
    const part = project.parts[node.part];
    if (part) {
      const rp = matrixToPose(poseToMatrix(node.frame).invert().multiply(poseToMatrix(node.partPose)));
      const pose = `pos="${vec(rp.pos)}" quat="${vec(quatWXYZ(rp.quat))}"`;
      const rgba = hexToRgba(node.color).join(' ');
      lines.push(`${inner}<geom name="${name}_visual" type="mesh" mesh="${meshNames[part.id]}" ${pose} rgba="${rgba}" contype="0" conaffinity="0" group="1" mass="0"/>`);
      if (node.collision === 'mesh') {
        const fr = node.friction ?? st.friction;
        lines.push(`${inner}<geom name="${name}_collision" type="mesh" mesh="${colName[part.id]}" ${pose} friction="${vec(fr)}" rgba="${rgba}" group="3" mass="0"/>`);
      }
    }
    if (st.imu && opts.imuBody === node.id) {
      lines.push(`${inner}<site name="imu" pos="0 0 0" size="0.005"/>`);
      sens.push(`    <gyro name="imu_gyro" site="imu"/>`, `    <accelerometer name="imu_acc" site="imu"/>`);
      if (j.type === 'free') sens.push(`    <framequat name="base_quat" objtype="site" objname="imu"/>`, `    <framepos name="base_pos" objtype="site" objname="imu"/>`);
    }
    for (const c of children(project, node.id)) emitBody(c, F.clone().invert(), depth + 1);
    lines.push(`${ind}</body>`);
    // actuator + sensors (collected after the body so order follows the tree)
    if (node.actuator && jointNames[node.id]) {
      const a = node.actuator, jn2 = jointNames[node.id];
      const an = `${name}_act`;
      const lim = [];
      if (a.ctrlrange) lim.push(`ctrlrange="${vec(a.ctrlrange)}"`);
      if (a.forcerange) lim.push(`forcerange="${vec([-a.forcerange, a.forcerange])}"`);
      if (a.kind === 'position') act.push(`    <position name="${an}" joint="${jn2}" kp="${num(a.kp)}"${a.kv ? ` kv="${num(a.kv)}"` : ''} ${lim.join(' ')}/>`);
      else if (a.kind === 'velocity') act.push(`    <velocity name="${an}" joint="${jn2}" kv="${num(a.kv)}" ${lim.join(' ')}/>`);
      else act.push(`    <motor name="${an}" joint="${jn2}" gear="${num(a.gear || 1)}" ${lim.join(' ')}/>`);
    }
    if (st.sensors && jointNames[node.id] && node.joint.type !== 'ball') {
      sens.push(`    <jointpos name="${jointNames[node.id]}_pos" joint="${jointNames[node.id]}"/>`, `    <jointvel name="${jointNames[node.id]}_vel" joint="${jointNames[node.id]}"/>`);
    }
  };

  const rootNodes = roots(project);
  const imuBody = rootNodes.find((r) => project.parts[r.part])?.id;
  opts = { ...opts, imuBody };
  for (const r of rootNodes) emitBody(r, world, 0);

  const g = st.gravity;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by stl2mujoco. SI units (m, kg, s, rad). Bodies are in the reference pose (all joints = 0). -->
<mujoco model="${esc(sanitizeName(project.name))}">
  <compiler angle="radian" meshdir="meshes" autolimits="true" inertiafromgeom="false"/>
  <option timestep="${num(st.timestep)}" gravity="${vec(g)}" integrator="implicitfast"/>
  <visual>
    <global offwidth="1280" offheight="720"/>
    <quality shadowsize="4096"/>
  </visual>

  <asset>
    <texture type="skybox" builtin="gradient" rgb1="0.35 0.45 0.60" rgb2="0.05 0.07 0.10" width="256" height="256"/>
    <texture name="grid" type="2d" builtin="checker" rgb1="0.20 0.24 0.28" rgb2="0.26 0.30 0.35" width="256" height="256"/>
    <material name="grid" texture="grid" texrepeat="8 8" texuniform="true" reflectance="0.1"/>
${meshXml.join('\n')}
  </asset>

  <worldbody>
    <light name="sun" pos="0 0 2" dir="0 0 -1" directional="true"/>
${st.floor ? '    <geom name="floor" type="plane" size="0 0 0.05" material="grid" friction="1 0.005 0.0001"/>\n' : ''}${lines.join('\n')}
  </worldbody>
${act.length ? `\n  <actuator>\n${act.join('\n')}\n  </actuator>\n` : ''}${sens.length ? `\n  <sensor>\n${sens.join('\n')}\n  </sensor>\n` : ''}</mujoco>
`;
  files['model.xml'] = new TextEncoder().encode(xml);
  return { xml, files, report, issues };
}
