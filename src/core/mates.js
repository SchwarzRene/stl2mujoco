// Assembly mates (Solid Edge style): connect a connector of the part to move ("mover") to a connector of
// another part ("target"). Connector = local frame on a part (origin + Z = surface normal / axis).
import { Matrix4, Quaternion, Vector3 } from 'three';
import { poseToMatrix, matrixToPose, applyWorldTransform, isDescendant, uid } from './project.js';

export const MATE_TYPES = {
  rigid: { label: 'Rigid (fixed)', joint: 'fixed' },
  revolute: { label: 'Revolute (hinge about connector Z)', joint: 'hinge' },
  slider: { label: 'Slider (along connector Z)', joint: 'slide' },
  ball: { label: 'Ball (spherical)', joint: 'ball' },
};

export const defaultMate = () => ({ type: 'rigid', flip: false, offset: 0, rotation: 0, range: null });

export function connectorLocalMatrix(c) { return poseToMatrix({ pos: c.pos, quat: c.quat }); }
/** World pose of a connector. */
export function connectorWorld(node, c) { return poseToMatrix(node.partPose).multiply(connectorLocalMatrix(c)); }

export function quatFromNormal(n) {
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...n).normalize());
  return [q.x, q.y, q.z, q.w];
}

export function addConnector(node, { name, pos, normal, quat }) {
  const c = { id: uid(), name: name || `connector_${(node.connectors?.length ?? 0) + 1}`, pos: [...pos], quat: quat ? [...quat] : quatFromNormal(normal) };
  (node.connectors ??= []).push(c);
  return c;
}

/** Target pose for the mover connector: T · Tz(offset) · Rz(rotation) · (opposing Z unless flipped). */
export function mateTargetMatrix(project, spec) {
  const target = project.nodes[spec.targetNode];
  const tc = target.connectors.find((c) => c.id === spec.targetConn);
  if (!tc) throw new Error('Target connector not found');
  const m = connectorWorld(target, tc)
    .multiply(new Matrix4().makeTranslation(0, 0, spec.offset || 0))
    .multiply(new Matrix4().makeRotationZ(spec.rotation || 0));
  if (!spec.flip) m.multiply(new Matrix4().makeRotationX(Math.PI)); // face-to-face: Z axes opposed
  return m;
}

/**
 * Apply a mate: moves the mover (with its whole sub-tree) so its connector coincides with the target
 * connector, re-parents it to the target node and sets the joint type from the mate.
 */
export function applyMate(project, moverId, spec) {
  const mover = project.nodes[moverId], target = project.nodes[spec.targetNode];
  if (!mover || !target) throw new Error('Mate needs a mover and a target part');
  if (moverId === spec.targetNode) throw new Error('A part cannot be mated to itself');
  if (isDescendant(project, spec.targetNode, moverId)) throw new Error(`"${target.name}" is attached to "${mover.name}" – mating them would create a loop`);
  const mc = mover.connectors?.find((c) => c.id === spec.moverConn);
  if (!mc) throw new Error('Mover connector not found');
  const T = mateTargetMatrix(project, spec);
  const X = T.clone().multiply(connectorWorld(mover, mc).invert());
  applyWorldTransform(project, moverId, X, { subtree: true });
  mover.parent = spec.targetNode;
  mover.frame = matrixToPose(T);
  mover.mate = { ...defaultMate(), ...spec };
  const jt = MATE_TYPES[spec.type]?.joint ?? 'fixed';
  if (mover.servo && jt !== 'hinge') { mover.servo = null; mover.actuator = null; mover.role = 'link'; }
  if (jt === 'fixed') { mover.joint = { ...mover.joint, type: 'fixed', range: null }; mover.actuator = null; mover.servo = null; mover.role = 'link'; }
  else {
    mover.joint = { ...mover.joint, type: jt, axis: [0, 0, 1], range: spec.range ?? mover.joint.range };
    if (!mover.servo && mover.role === 'link') mover.role = 'passive';
  }
  return mover;
}

export const reapplyMate = (project, moverId) => applyMate(project, moverId, project.nodes[moverId].mate);
