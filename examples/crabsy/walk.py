#!/usr/bin/env python3
"""Load the exported Crabsy hexapod in MuJoCo and walk it with a simple tripod gait.

    pip install mujoco
    python examples/crabsy/walk.py [out/crabsy/model.xml] [--speed 1.0] [--heading 0] [--headless 10]

Opens the interactive viewer. Joint zero is the pose of the CAD assembly; every actuator is a position servo,
so `data.ctrl[i]` is a target angle in radians (range +-1.57). Edit the GAIT section to change the motion.
"""
import argparse
import importlib
import math
import time

import mujoco
import numpy as np

# ---- GAIT ------------------------------------------------------------------------------------------------
PERIOD = 1.2          # seconds per step cycle
SWING = 0.35          # rad, how far the coxa (hip) swings forwards/backwards
LIFT = 0.55           # rad, femur lift while a leg is in the air
TIBIA_FOLLOW = 1.2    # tibia angle per rad of femur lift – large, so the lower joint visibly moves
COXA_SIGN, FEMUR_SIGN = -1.0, -1.0  # the exported joint axes follow the CAD; flip both if a changed model walks backwards
LEG_ANGLES = [-90 + 60 * i for i in range(6)]  # mounting angle of each leg around the body (deg, leg 1 at -Y)
TRIPOD = [0, 1, 0, 1, 0, 1]                    # legs with the same value step together


def find_servos(model):
    """Returns {leg: {'coxa': idx, 'femur': idx, 'tibia': idx}} – the exporter orders each leg tibia, femur, coxa."""
    assert model.nu == 18, f"expected 18 actuators, found {model.nu}"
    return [{'tibia': 3 * leg, 'femur': 3 * leg + 1, 'coxa': 3 * leg + 2} for leg in range(6)]


def gait_targets(t, servos, speed=1.0, heading_deg=0.0):
    """Joint targets (rad) for time t. `speed` scales the stride (negative = backwards), `heading_deg` turns the walking direction."""
    ctrl = np.zeros(18)
    for leg, idx in enumerate(servos):
        phase = 2 * math.pi * t / PERIOD + math.pi * TRIPOD[leg]
        # a leg at angle th moves the body along `heading` by swinging the coxa in proportion to -sin(th - heading)
        stride = -math.sin(math.radians(LEG_ANGLES[leg] - heading_deg)) * speed
        air = max(0.0, math.sin(phase))
        ctrl[idx['coxa']] = COXA_SIGN * SWING * stride * -math.cos(phase)
        ctrl[idx['femur']] = FEMUR_SIGN * LIFT * air * min(1.0, abs(speed) * 2)
        ctrl[idx['tibia']] = TIBIA_FOLLOW * ctrl[idx['femur']]
    return np.clip(ctrl, -1.57, 1.57)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('model', nargs='?', default='out/crabsy/model.xml')
    ap.add_argument('--speed', type=float, default=1.0)
    ap.add_argument('--heading', type=float, default=0.0, help='walking direction in degrees (0 = +X)')
    ap.add_argument('--headless', type=float, default=0.0, help='simulate this many seconds without a window and print the result')
    args = ap.parse_args()

    model = mujoco.MjModel.from_xml_path(args.model)
    data = mujoco.MjData(model)
    servos = find_servos(model)
    start = data.qpos[:3].copy()

    if args.headless:
        while data.time < args.headless:
            data.ctrl[:] = gait_targets(data.time, servos, args.speed, args.heading)
            mujoco.mj_step(model, data)
        d = data.qpos[:3] - start
        print(f'moved dx={d[0]:+.3f} m  dy={d[1]:+.3f} m  height={data.qpos[2]:.3f} m  quat={np.round(data.qpos[3:7], 3)}')
        return

    viewer_module = importlib.import_module('mujoco.viewer')  # imported late so --headless works without a display
    with viewer_module.launch_passive(model, data) as viewer:
        viewer.cam.distance, viewer.cam.elevation, viewer.cam.azimuth = 0.9, -25, 120
        while viewer.is_running():
            tick = time.time()
            data.ctrl[:] = gait_targets(data.time, servos, args.speed, args.heading)
            mujoco.mj_step(model, data)
            viewer.cam.lookat[:] = data.qpos[:3]  # follow the robot
            viewer.sync()
            time.sleep(max(0.0, model.opt.timestep - (time.time() - tick)))


if __name__ == '__main__':
    main()
