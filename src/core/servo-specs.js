// Servo specifications. Torque (N·m) and speed (rad/s) come from manufacturer/retailer datasheets,
// converted from kgf·cm (×0.0980665) and s/60° or rpm. `armature` (reflected rotor inertia at the output
// shaft, kg·m²) and `kp_sat_rad` are modelling estimates and flagged as such.
const KGF_CM = 0.0980665;
const sPer60 = (s) => (Math.PI / 3) / s;           // "0.15 s/60°" -> rad/s
const rpm = (n) => (n * 2 * Math.PI) / 60;

export const SERVO_SPECS = {
  mg996r: {
    name: 'MG996R', range_deg: [-90, 90], defaultVoltage: '6.0',
    voltages: { '4.8': { stall_torque: 9.4 * KGF_CM, noload_speed: sPer60(0.19) }, '6.0': { stall_torque: 11 * KGF_CM, noload_speed: sPer60(0.15) } },
    armature: 0.009, frictionloss_frac: 0.03, kp_sat_rad: 0.1, mass: 0.055,
  },
  sg90: {
    name: 'SG90', range_deg: [-90, 90], defaultVoltage: '4.8',
    voltages: { '4.8': { stall_torque: 1.8 * KGF_CM, noload_speed: sPer60(0.1) } },
    armature: 0.0022, frictionloss_frac: 0.05, kp_sat_rad: 0.1, mass: 0.009,
  },
  mg90s: {
    name: 'MG90S', range_deg: [-90, 90], defaultVoltage: '4.8',
    voltages: { '4.8': { stall_torque: 2.2 * KGF_CM, noload_speed: sPer60(0.1) } },
    armature: 0.0022, frictionloss_frac: 0.04, kp_sat_rad: 0.1, mass: 0.0134,
  },
  xl430_w250: {
    name: 'Dynamixel XL430-W250', range_deg: [-180, 180], defaultVoltage: '12.0',
    voltages: { '9.0': { stall_torque: 1.0, noload_speed: rpm(47) }, '11.1': { stall_torque: 1.4, noload_speed: rpm(57) }, '12.0': { stall_torque: 1.5, noload_speed: rpm(61) } },
    armature: 0.0067, frictionloss_frac: 0.02, kp_sat_rad: 0.1, mass: 0.0572,
  },
  ax12a: {
    name: 'Dynamixel AX-12A', range_deg: [-150, 150], defaultVoltage: '12.0',
    voltages: { '12.0': { stall_torque: 1.5, noload_speed: rpm(59) } },
    armature: 0.006, frictionloss_frac: 0.03, kp_sat_rad: 0.1, mass: 0.0546,
  },
  generic: {
    name: 'Generic servo', range_deg: [-90, 90], defaultVoltage: '6.0',
    voltages: { '6.0': { stall_torque: 1.0, noload_speed: 6.0 } },
    armature: 0.005, frictionloss_frac: 0.03, kp_sat_rad: 0.1, mass: 0.05,
  },
};
