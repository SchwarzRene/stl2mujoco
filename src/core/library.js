// Standard-parts library: index + part.json prefabs -> project nodes.
import { Matrix4, Quaternion, Vector3, Euler } from 'three';
import { parseSTL } from './stl.js';
import { addPart, addNode, uid, poseToMatrix, matrixToPose } from './project.js';
import { addConnector, quatFromNormal } from './mates.js';
import { newServoState, applyServo } from './servo.js';
import { orientOutward } from './mesh.js';

const UNIT = { mm: 0.001, cm: 0.01, m: 1 };

/** Reader for the browser (fetch). */
export const fetchReader = (base = '/standard_parts') => ({
  json: async (p) => { const r = await fetch(`${base}/${p}`); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); },
  binary: async (p) => { const r = await fetch(`${base}/${p}`); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.arrayBuffer(); },
});

export async function loadIndex(reader) { return (await reader.json('index.json')).parts; }

/**
 * Add a library part to the project.
 * @param at       world Matrix4 where the prefab origin is placed (default: identity)
 * @param parent   optional parent node id (otherwise the part is a free-standing root, to be mated)
 */
export async function instantiate(project, reader, entry, { at = new Matrix4(), parent = null, count = 0 } = {}) {
  const def = await reader.json(`${entry.path}/part.json`);
  const s = UNIT[def.units ?? 'mm'];
  const byName = {}, made = [];
  const group = uid();
  const first = !Object.keys(project.nodes).length;
  for (const b of def.bodies) {
    const key = `${def.id}:${b.mesh}`;
    let part = Object.values(project.parts).find((p) => p.libKey === key);
    if (!part) {
      const positions = orientOutward(parseSTL(await reader.binary(`${entry.path}/${b.mesh}`)));
      part = addPart(project, { name: `${def.id}_${b.name}`, positions, unitScale: s });
      part.libKey = key; if (def.trust_mesh || b.trust_mesh !== false) part.trusted = true;
    }
    const bodyPose = b.pose_mm ? matrixToPose(new Matrix4().compose(new Vector3(...b.pose_mm.map((v) => v * s)), new Quaternion().setFromEuler(new Euler(...(b.rot_deg ?? [0, 0, 0]).map((d) => (d * Math.PI) / 180))), new Vector3(1, 1, 1))) : { pos: [0, 0, 0], quat: [0, 0, 0, 1] };
    const world = at.clone().multiply(poseToMatrix(bodyPose));
    const frameLocal = b.joint?.frame_mm ? new Matrix4().makeTranslation(...b.joint.frame_mm.map((v) => v * s)) : new Matrix4();
    const frame = matrixToPose(at.clone().multiply(frameLocal));
    const label = count ? `${def.name} ${count}` : def.name;
    const node = addNode(project, {
      name: `${label} / ${b.name}`, parent: b.parent ? byName[b.parent].id : parent, partId: part.id,
      role: first && !b.parent ? 'base-fixed' : 'link', frame: b.joint ? frame : matrixToPose(world), partPose: matrixToPose(world),
    });
    node.color = b.color ?? node.color;
    node.collision = b.collision ?? 'mesh';
    node.mass = b.mass_kg != null ? { mode: 'explicit', mass: b.mass_kg, density: 1240 } : { mode: 'density', density: b.mass?.density ?? 1240, mass: 0.1 };
    node.library = { id: def.id, body: b.name, group };
    if (b.joint) {
      node.joint = { ...node.joint, type: b.joint.type, axis: b.joint.axis ?? [0, 0, 1] };
      if (b.servo) { node.role = 'servo'; node.servo = newServoState(b.servo.preset); Object.assign(node.servo, b.servo.overrides ?? {}); applyServo(node); }
    }
    for (const c of b.connectors ?? []) addConnector(node, { name: c.name, pos: c.pos_mm.map((v) => v * s), normal: c.normal ?? [0, 0, 1], quat: c.rot_quat });
    byName[b.name] = node; made.push(node);
  }
  return made;
}
