"""Load an exported model with MuJoCo and print/verify key facts. Usage: validate_mjcf.py model.xml [expected.json]"""
import json, sys
import mujoco
import numpy as np

m = mujoco.MjModel.from_xml_path(sys.argv[1])
d = mujoco.MjData(m)
for _ in range(500):
    mujoco.mj_step(m, d)
assert np.all(np.isfinite(d.qpos)), "simulation diverged"
out = {
    "nbody": int(m.nbody), "njnt": int(m.njnt), "nu": int(m.nu), "ngeom": int(m.ngeom), "nmesh": int(m.nmesh),
    "total_mass": float(m.body_mass.sum()),
    "body_mass": {mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, i): float(m.body_mass[i]) for i in range(m.nbody)},
    "joint_axis": {mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_JOINT, i): m.jnt_axis[i].tolist() for i in range(m.njnt)},
    "body_pos": {mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, i): m.body_pos[i].tolist() for i in range(m.nbody)},
}
json.dump(out, sys.stdout)
