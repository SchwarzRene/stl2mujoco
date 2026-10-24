// Servo model: position actuator with torque saturation + joint damping that reproduces the DC-motor
// torque/speed line  τ_avail(ω) = τ_stall·(1 − ω/ω_noload).
//   actuator force = clip(kp·(ctrl − q) − kv·q̇, ±τ_stall)      (position actuator with forcerange)
//   joint damping  b = τ_stall / ω_noload                       (back-EMF) → free-run speed = ω_noload
//   kp = τ_stall / kp_sat_rad                                   (full torque beyond kp_sat_rad of error)
//   kv = sqrt(kp·J_armature)                                    (≈ ζ 0.5 together with b)
import { SERVO_SPECS } from './servo-specs.js';

const rad = (d) => (d * Math.PI) / 180;

/** `specKey` = key in SERVO_SPECS, or a full spec object (e.g. created from a datasheet). */
export function newServoState(specKey = 'mg996r') {
  const custom = specKey && typeof specKey === 'object';
  const s = custom ? specKey : SERVO_SPECS[specKey] ?? SERVO_SPECS.generic;
  return {
    preset: custom ? 'custom' : specKey, name: s.name, voltage: s.defaultVoltage, voltages: JSON.parse(JSON.stringify(s.voltages)),
    range_deg: [...s.range_deg], armature: s.armature, frictionloss_frac: s.frictionloss_frac, kp_sat_rad: s.kp_sat_rad,
  };
}

export function deriveServo(servo) {
  const v = servo.voltages[servo.voltage] ?? Object.values(servo.voltages)[0];
  const T = v.stall_torque, w0 = v.noload_speed;
  const kp = T / servo.kp_sat_rad;
  return { stall_torque: T, noload_speed: w0, kp, kv: Math.sqrt(kp * servo.armature), damping: T / w0, frictionloss: servo.frictionloss_frac * T, armature: servo.armature };
}

/** Write joint + actuator of `node` from its servo state (keeps the user's axis). */
export function applyServo(node) {
  const d = deriveServo(node.servo);
  const range = node.servo.range_deg ? node.servo.range_deg.map(rad) : null;
  node.joint = { ...node.joint, type: 'hinge', range, damping: d.damping, frictionloss: d.frictionloss, armature: d.armature, stiffness: 0 };
  node.actuator = { kind: 'position', kp: d.kp, kv: d.kv, ctrlrange: range ? [...range] : [-Math.PI, Math.PI], forcerange: d.stall_torque, gear: 1 };
  return node;
}
