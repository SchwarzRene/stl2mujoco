// Roles, materials and actuator presets.

export const MATERIALS = {
  'PLA (1240 kg/m³)': 1240,
  'PETG (1270 kg/m³)': 1270,
  'ABS (1050 kg/m³)': 1050,
  'Resin (1150 kg/m³)': 1150,
  'Aluminium (2700 kg/m³)': 2700,
  'Steel (7850 kg/m³)': 7850,
  'Carbon fibre (1600 kg/m³)': 1600,
};

// Torque in N·m, speed in rad/s. kp/kv follow MuJoCo's position actuator: force = kp*(ctrl-q) - kv*qdot
export const SERVO_PRESETS = {
  'MG996R (≈1.0 N·m, 180°)': { range: [-90, 90], forcerange: 1.0, kp: 20, kv: 0.6, damping: 0.05, frictionloss: 0.02, armature: 0.002 },
  'SG90 (≈0.18 N·m, 180°)': { range: [-90, 90], forcerange: 0.18, kp: 4, kv: 0.1, damping: 0.01, frictionloss: 0.005, armature: 0.0005 },
  'MG90S (≈0.22 N·m, 180°)': { range: [-90, 90], forcerange: 0.22, kp: 5, kv: 0.12, damping: 0.01, frictionloss: 0.005, armature: 0.0005 },
  'Dynamixel XL430 (1.4 N·m)': { range: [-180, 180], forcerange: 1.4, kp: 30, kv: 1.0, damping: 0.05, frictionloss: 0.02, armature: 0.005 },
  'Dynamixel AX-12A (1.5 N·m)': { range: [-150, 150], forcerange: 1.5, kp: 30, kv: 1.0, damping: 0.05, frictionloss: 0.02, armature: 0.005 },
  'Generic servo': { range: [-90, 90], forcerange: 2.0, kp: 30, kv: 1.0, damping: 0.05, frictionloss: 0.0, armature: 0.0 },
};

/** Role = a UI-level shortcut that fills in joint + actuator. */
export const ROLES = {
  base: { label: 'Base (floating)', help: 'Root body with a free joint – the robot can move in the world.' },
  'base-fixed': { label: 'Base (fixed to world)', help: 'Root body welded to the world (arm on a table).' },
  link: { label: 'Rigid link', help: 'Welded to its parent – no joint.' },
  servo: { label: 'Servo joint (hinge + position actuator)', help: 'Revolute joint driven by a position-controlled servo.' },
  'motor-hinge': { label: 'Motor joint (hinge + torque motor)', help: 'Revolute joint driven by a direct torque motor.' },
  'velocity-hinge': { label: 'Wheel / velocity joint', help: 'Continuous revolute joint with velocity actuator.' },
  slider: { label: 'Linear actuator (slide + position)', help: 'Prismatic joint with position actuator.' },
  passive: { label: 'Passive hinge', help: 'Freely rotating hinge (e.g. caster, idler) with optional damping.' },
  ball: { label: 'Ball joint', help: '3-DOF spherical joint.' },
};

export const defaultJoint = () => ({ type: 'fixed', axis: [0, 0, 1], range: null, damping: 0, frictionloss: 0, armature: 0, stiffness: 0 });

export function applyRole(node, role, preset = SERVO_PRESETS['MG996R (≈1.0 N·m, 180°)']) {
  node.role = role;
  const d = (deg) => (deg * Math.PI) / 180;
  const j = (node.joint = { ...defaultJoint(), axis: node.joint?.axis ? [...node.joint.axis] : [0, 0, 1] });
  node.actuator = null;
  switch (role) {
    case 'base': j.type = 'free'; break;
    case 'base-fixed': case 'link': j.type = 'fixed'; break;
    case 'servo':
      Object.assign(j, { type: 'hinge', range: preset.range.map(d), damping: preset.damping, frictionloss: preset.frictionloss, armature: preset.armature });
      node.actuator = { kind: 'position', kp: preset.kp, kv: preset.kv, ctrlrange: preset.range.map(d), forcerange: preset.forcerange, gear: 1 };
      break;
    case 'motor-hinge':
      Object.assign(j, { type: 'hinge', range: [-Math.PI, Math.PI], damping: 0.05 });
      node.actuator = { kind: 'motor', kp: 0, kv: 0, ctrlrange: [-1, 1], forcerange: null, gear: 1 };
      break;
    case 'velocity-hinge':
      Object.assign(j, { type: 'hinge', range: null, damping: 0.01 });
      node.actuator = { kind: 'velocity', kp: 0, kv: 1, ctrlrange: [-20, 20], forcerange: 1, gear: 1 };
      break;
    case 'slider':
      Object.assign(j, { type: 'slide', range: [-0.02, 0.02], damping: 1 });
      node.actuator = { kind: 'position', kp: 500, kv: 20, ctrlrange: [-0.02, 0.02], forcerange: 50, gear: 1 };
      break;
    case 'passive': Object.assign(j, { type: 'hinge', range: null, damping: 0.01 }); break;
    case 'ball': Object.assign(j, { type: 'ball', range: null, damping: 0.01 }); break;
    default: throw new Error(`Unknown role ${role}`);
  }
  return node;
}
