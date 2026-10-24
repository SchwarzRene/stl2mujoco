[< Back to the README](../README.md)

# Build a robot from a folder of STLs + a STEP assembly

STL files carry no placement, but a CAD assembly does. Export the assembly as **STEP** (Solid Edge: Save As, `.stp`; other CAD systems work the same)
and build the whole robot from it: exact part poses, library servos, repeated limbs cloned at their real positions.

```bash
node cli/import-step.mjs <stl-folder> <assembly.stp> --suggest robot.json               # 1. inspect: writes a starting config
node cli/import-step.mjs <stl-folder> <assembly.stp> out.s2m.zip --config robot.json    # 2. build (after reviewing robot.json)
node cli/convert.mjs out.s2m.zip out/robot                                              # 3. headless MJCF export (or open the zip in the editor)
```

- **Geometry** comes from the STL files (searched recursively). A STEP part is matched to an STL by name, ignoring case and `_`/`-`/spaces
  (`1_baseplate` matches `1_base_plate.stl`); use `"stl": { "product": "file.stl" }` for odd names. Parts without an STL are reported and left out.
- **Placement** comes from the STEP file: the assembly tree and every transform (`src/core/step-asm.js`).
- **Kinematics** are *not* in STEP, so they live in a small `robot.json`: which parts sit on which side of which servo.
  `--suggest` writes a first guess (each part goes to the servo whose shaft is nearest; every servo turns its output and hangs from the
  previous one). Check it against the CAD. In particular, a servo whose *body* turns around a fixed shaft needs `"moves": "case"`.

```jsonc
{
  "base":  { "assembly": "a1_base", "root": "1_baseplate" },        // rigid body with the free joint
  "servoModel": { "library": "servo_mg996r", "case": "Case", "shaft": "Shaft" },   // STEP part names of the servo's two halves
  "limb": { "assembly": "a2_leg", "label": "leg",                    // built once, every other instance is cloned
    "servos": [                                                      // ordered from the base outwards
      { "parent": "base",     "moves": "output", "case": ["1_lower_bearing"], "output": ["5_connector@0"] },
      { "parent": "0.output", "moves": "case",   "case": ["2_middle_segment"] },
      { "parent": "1.case",   "moves": "output", "output": ["4_foot_shell"] }
    ] },
  "boxes":  [{ "name": "battery", "size_mm": [70, 18, 15], "at_mm": [0, 0, 25], "mass_kg": 0.1 }],   // parts missing in the STEP
  "collision": { "4_foot_shell": "mesh" }, "ignore": ["screws"], "density": 400
}
```

`"product@k"` picks, of several instances of one part, the one nearest to the shaft of servo *k*. Joint zero is the pose of the exported assembly.
Limits: the base and the limb must be top-level assemblies; one limb type; servos come from the standard parts library; screws, flanges and other
STEP parts without an STL are left out.

A complete example is in the README: [Crabsy](../README.md#example-crabsy-hexapod), config in [examples/crabsy/robot.json](../examples/crabsy/robot.json).
