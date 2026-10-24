# stl2mujoco

A browser-based visual editor that turns CAD parts (STL) into a **MuJoCo** robot model.

1. **Add parts** – import STL files from your CAD, or pick **standard parts** (servos, screws, nuts, washers) from the *Parts library*.
2. **Assemble like in a CAD program** – click **⚙ Mate parts**, click a hole / face / edge (or a green marker) on the part to move, then on the part it attaches to. It snaps into place; choose *Rigid*, *Revolute*, *Slider* or *Ball*, flip, offset and rotation.
3. **Define roles and axes** – servo joints, motors, wheels, passive hinges; joint axes are the connector Z axes (or edit them); *Test pose* sliders let you check the motion.
4. **Copy and mirror** whole sub-trees (e.g. circular array of one leg → hexapod).
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
| Servos | Datasheet torque and speed are reproduced: position actuator clipped at the **stall torque** plus joint damping = stall torque ÷ no-load speed (the DC-motor torque/speed line), so a servo never exceeds its no-load speed and is overpowered above its stall torque. Verified in MuJoCo tests. Inertia/friction are flagged estimates. See [standard_parts](standard_parts/README.md). |
| Collision | Separate invisible collision geoms (group 3). MuJoCo uses the **convex hull** of a mesh; large meshes are simplified (default ≤ 20 000 triangles) for collision only. Visuals are exported 1:1. Concave parts (e.g. a ring) collide as their hull – split them or disable collision where that matters. |
| Checks | Warns about non-watertight meshes (mass unreliable → use measured mass), joints without mass, bad ranges, parts below the floor, etc. |
| Sensors | Optional joint position/velocity sensors and a base IMU (gyro, accelerometer, pose). |

## STL files carry no assembly information

CAD assemblies (Solid Edge `.asm`, …) are proprietary, and STL files are exported per part in their own coordinate system,
so **part placement and joint axes cannot be recovered automatically**. That is what the visual editor is for.
Tip: export STLs from the *assembly* (positions preserved) if your CAD supports it – then parts are already in place and only roles/joints are needed.

## What an STL can (and cannot) carry – and "Refresh part"

An STL is **only a bag of unnamed triangles**: no hole names, no features, no parameters, not even units. A hole is just
a ring of triangles. So nothing in the file says "this is the servo hole" – the editor *recognises geometry* instead
(circular rims → hole/boss centres, planar faces, edges) and stores your connectors as frames on the part.

When you change a part in CAD (say, a longer link), re-export the STL and click **↻ Refresh from STL** on that part
(in Chromium the editor remembers the file you imported, so it is one click):

1. each connector is re-found on the new mesh – a hole connector matches a hole of the **same radius and direction**,
   a face connector the face with the same normal;
2. the expected position keeps the **offset from the nearest end** of the part on every axis, so the near holes stay
   and the far holes move with the far end;
3. every part attached to it by a mate is **re-snapped with its sub-assembly** – no need to place anything again;
4. a report lists what was found, what moved by how many mm, and what was not found (those mates are left untouched).

Only the geometry you change should change: if you also move holes around, add holes of the same size next to each
other, or remove one, the matching can pick a different hole or report it as *not found* – check the report.
STEP files do carry exact cylindrical faces (and sometimes names); importing STEP is a possible future improvement.

## Assembly mates

A *connector* is a frame on a part (green marker: origin + Z = surface normal / axis). In **Mate parts** mode you click on the geometry and the editor snaps to **hole/boss centres**, **face centres**, **vertices** or **edge midpoints** (or an exact point); library parts already carry connectors for their mounting holes and shaft.
A mate puts the two connectors together face-to-face (Flip aligns the Z axes instead), with optional offset and rotation, moves the part *and everything attached to it*, makes it a child of the target and sets the joint: rigid = welded, revolute = hinge about connector Z, slider = slide along Z, ball. Servo outputs are already hinge joints – mate your links rigidly to the servo's `output_top` marker.

## Example: Crabsy hexapod

`examples/crabsy/build.mjs` builds a *starting-point* project from a checkout of
[Crabsy](https://github.com/SamuelNoesslboeck/Crabsy) (base, one leg of printed links driven by three library MG996R servos, circular array ×6;
battery/Pi as measured-mass boxes):

```bash
git clone --depth 1 https://github.com/SamuelNoesslboeck/Crabsy
node examples/crabsy/build.mjs Crabsy crabsy.s2m.zip
node cli/convert.mjs crabsy.s2m.zip out/crabsy     # headless export
# or open crabsy.s2m.zip in the editor ("Open project") to refine it
```

Only the feet (tibia) have collision geometry in the example: convex hulls of neighbouring printed parts overlap and would push against each other. Enable collision on more parts in the editor only where the hull is a good approximation.

**The leg placement in this example is an estimate** from part bounding boxes; refine joint frames/part poses in the editor against your CAD.

## Project layout

- `src/core` – DOM-free logic: STL, mass properties, project model, MJCF exporter, zip IO
- `src/ui` – Three.js viewport, styles; `src/main.js` – panels and app logic
- `cli/convert.mjs` – headless export; `tests/` – Vitest + MuJoCo validation

## Roadmap / known limits

- Servo hole patterns/shaft offsets are typical values (see [standard_parts](standard_parts/README.md)); verify against your servo.
- No in-browser physics preview yet (export and use `mujoco.viewer`); MuJoCo-WASM preview is a natural next step.
- Test-pose slider supports hinge and slide joints (not ball/free).
- URDF import / export is not implemented.
