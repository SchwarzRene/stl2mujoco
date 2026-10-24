[< Back to the README](../README.md)

# Example: Crabsy hexapod

![Crabsy hexapod built from its STEP assembly and simulated in MuJoCo](images/crabsy.png)

[Crabsy](https://github.com/SamuelNoesslboeck/Crabsy) is a 3D-printed hexapod with 18 servos. Its STL files plus the assembly exported as STEP
(`construction/a_crabsy.asm`, Save As `.stp`) are enough to rebuild it. One leg of three MG996R servos is described in
[`examples/crabsy/robot.json`](../examples/crabsy/robot.json); every other leg is cloned at its real position.

```bash
git clone --depth 1 https://github.com/SamuelNoesslboeck/Crabsy
node cli/import-step.mjs Crabsy/construction a_crabsy.stp crabsy.s2m.zip --config examples/crabsy/robot.json
node cli/convert.mjs crabsy.s2m.zip out/crabsy       # MJCF export (or open the .s2m.zip in the editor)
python examples/crabsy/walk.py                       # walks the robot in MuJoCo (pip install mujoco)
```

Only the feet have collision geometry, and the aluminium servo flanges (no STL in the repo) are not modelled.
Joint zero is the pose of the exported assembly. The same steps work for your own robot, see [STEP import](step-import.md).