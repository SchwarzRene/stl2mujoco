# stl2mujoco

A browser-based visual editor that turns CAD parts (STL) into a **MuJoCo** robot model.

1. **Import** the STL part files exported from your CAD (Solid Edge, SolidWorks, Fusion, …). Units: mm / cm / m / inch.
2. **Give each part a role** – base (floating or fixed), rigid link, servo joint (hinge + position actuator), motor, wheel, linear actuator, passive hinge, ball joint.
3. **Build the robot visually** – move/rotate parts and joint frames with the 3D gizmo (or type exact numbers), pick the hinge axis, set limits, and drag the *Test pose* slider to check the joint moves like the real robot.
4. **Copy and mirror** whole sub-trees (e.g. circular array of one leg → hexapod, mirror left → right).
5. **Export** a ZIP with `model.xml` + `meshes/` that loads directly in MuJoCo.

```bash
npm install
npm run dev          # editor at http://localhost:5173
npm test             # unit tests (Node + the `mujoco` Python package, `pip install mujoco`)
npm run build        # static build in dist/
```

Run the exported model:

```bash
unzip robot_mujoco.zip
python -m mujoco.viewer --mjcf=robot/model.xml
```

## What makes the export accurate

| Topic | What is done |
|---|---|
| Units | Everything is SI (m, kg, rad). Meshes are scaled by MuJoCo's `scale` – STL data is exported unmodified. |
| Mass / inertia | Volume, centre of mass and the **full inertia tensor** are integrated exactly from the triangle mesh (signed tetrahedra) in the joint frame and written as an explicit `<inertial … fullinertia>`. Mass comes from a material density **or** a measured mass (then the tensor is scaled). Verified against analytic box/cylinder/sphere values in the tests. |
| Kinematics | Poses are stored in world space in the reference pose and converted to parent-relative `pos`/`quat`; joint axes are expressed in the joint frame. |
| Actuators | Servo presets (MG996R, SG90, MG90S, Dynamixel) give `kp`, `kv`, torque limit (`forcerange`), joint damping/friction/armature. Motor and velocity actuators are supported too. |
| Collision | Separate invisible collision geoms (group 3). MuJoCo uses the **convex hull** of a mesh; large meshes are simplified (default ≤ 20 000 triangles) for collision only. Visuals are exported 1:1. Concave parts (e.g. a ring) collide as their hull – split them or disable collision where that matters. |
| Checks | Warns about non-watertight meshes (mass unreliable → use measured mass), joints without mass, bad ranges, parts below the floor, etc. |
| Sensors | Optional joint position/velocity sensors and a base IMU (gyro, accelerometer, pose). |

## STL files carry no assembly information

CAD assemblies (Solid Edge `.asm`, …) are proprietary, and STL files are exported per part in their own coordinate system,
so **part placement and joint axes cannot be recovered automatically**. That is what the visual editor is for.
Tip: export STLs from the *assembly* (positions preserved) if your CAD supports it – then parts are already in place and only roles/joints are needed.

## Example: Crabsy hexapod

`examples/crabsy/build.mjs` builds a *starting-point* project from a checkout of
[Crabsy](https://github.com/SamuelNoesslboeck/Crabsy) (base, one leg with coxa/femur/tibia servo joints, circular array ×6,
servo/battery/Pi stand-ins as measured-mass boxes):

```bash
git clone --depth 1 https://github.com/SamuelNoesslboeck/Crabsy
node examples/crabsy/build.mjs Crabsy crabsy.s2m.zip
node cli/convert.mjs crabsy.s2m.zip out/crabsy     # headless export
# or open crabsy.s2m.zip in the editor ("Open project") to refine it
```

**The leg placement in this example is an estimate** from part bounding boxes; refine joint frames/part poses in the editor against your CAD.

## Project layout

- `src/core` – DOM-free logic: STL, mass properties, project model, MJCF exporter, zip IO
- `src/ui` – Three.js viewport, styles; `src/main.js` – panels and app logic
- `cli/convert.mjs` – headless export; `tests/` – Vitest + MuJoCo validation

## Roadmap / known limits

- No in-browser physics preview yet (export and use `mujoco.viewer`); MuJoCo-WASM preview is a natural next step.
- Test-pose slider supports hinge and slide joints (not ball/free).
- URDF import / export is not implemented.
