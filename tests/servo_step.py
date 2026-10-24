"""Servo behaviour test: python servo_step.py model.xml  -> JSON with measured step response / stall data."""
import json, sys
import mujoco
import numpy as np

m = mujoco.MjModel.from_xml_path(sys.argv[1])
jid = 0
assert m.nu == 1 and m.njnt == 1
dt = m.opt.timestep
lo, hi = m.jnt_range[0]
T = float(m.actuator_forcerange[0][1])

def run(target, seconds, applied=0.0):
    d = mujoco.MjData(m)
    d.ctrl[0] = target
    max_v = 0.0; peak = 0.0; hist = []
    for i in range(int(seconds / dt)):
        d.qfrc_applied[0] = applied
        mujoco.mj_step(m, d)
        max_v = max(max_v, abs(d.qvel[0])); peak = max(peak, d.qpos[0])
        hist.append(d.qpos[0])
    return d, max_v, peak, np.array(hist)

target = float(hi) * 0.95
d, max_v, peak, hist = run(target, 2.0)
step = {"target": target, "final": float(d.qpos[0]), "max_speed": float(max_v), "overshoot": float(max(0.0, peak - target))}
t90 = int(np.argmax(hist > 0.9 * target)) * dt
step["t90"] = t90
# holding: apply 0.8 × stall torque against the command
d2, _, _, _ = run(0.0, 2.0, applied=0.8 * T)
hold = float(d2.qpos[0])
# overload: 1.5 × stall torque must push the servo away
d3, _, _, _ = run(0.0, 2.0, applied=1.5 * T)
overload = float(d3.qpos[0])
print(json.dumps({"stall_torque": T, "step": step, "hold_deflection": hold, "overload_position": overload, "range": [float(lo), float(hi)]}))
