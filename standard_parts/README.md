# Standard parts

Ready-made parts for the editor (**Parts library** tab). Each part is a folder with a `part.json` and its STL files.

```
standard_parts/
  index.json                      ← list of all parts (generated)
  servos/servo_mg996r/            part.json, case.stl, output.stl
  fasteners/din912_m3x10/         part.json, screw.stl
  …
```

| Category | Parts |
|---|---|
| Servos | MG996R, SG90, MG90S, Dynamixel XL430-W250, Dynamixel AX-12A – each as *case* (fixed) + *output* (hinge with position actuator) |
| Fasteners | DIN 912 socket-head screws M2–M6 (many lengths), DIN 934 nuts M2–M6, DIN 125-A washers M2–M6 (steel, 7850 kg/m³) |

## What a part contains

- **Meshes** in mm (STL), origin and axes chosen so mating is easy (servos: origin on the shaft axis at the case top plane, +Z towards the horn).
- **Connectors** – named mounting frames (position + normal): ear holes, shaft top/base, case faces, screw `under_head`/`tip`, nut/washer `top`/`bottom`. They show up as green markers in *Mate parts* mode.
- **Bodies** with measured/explicit mass (or material density), colour, collision setting, and for servos a `servo` preset whose torque, speed, range, inertia come from `src/core/servo-specs.js`.
- `dims_status` and `sources` – which dimensions are datasheet values and which are *typical / estimate – verify*. The editor shows these in the inspector.

## Accuracy of the servo models

| Value | Status |
|---|---|
| Mass, stall torque, no-load speed, travel | from datasheets / retailer specs (sources in each `part.json`) |
| Overall size (e.g. MG996R 40.7 × 19.7 × 42.9 mm) | from datasheet listings |
| Ear length, hole spacing and diameter, shaft offset, boss/spline size | **typical values of the servo class – verify against your servo** (no manufacturer drawing was reachable) |
| Rotor inertia, static friction | modelling **estimates** |

If your servo differs, edit the numbers in `tools/standard-parts.mjs` and run `npm run parts`, or measure and place connectors yourself.

## Adding your own parts

1. Create `standard_parts/<category>/<your_part>/` with `part.json` and STL files. Minimal example:

```json
{
  "schema": 1, "id": "my_bracket", "name": "My bracket", "category": "Brackets", "units": "mm",
  "bodies": [{
    "name": "bracket", "mesh": "bracket.stl", "color": "#9aa4b2",
    "mass": { "mode": "density", "density": 1240 },
    "connectors": [{ "name": "hole_1_top", "pos_mm": [10, 0, 3], "normal": [0, 0, 1] }]
  }]
}
```

   A body may have `parent` (another body name), `joint: { type, axis, frame_mm }` and `servo: { preset }` to build multi-body parts like the servos.
2. Run `npm run parts:index` to refresh `index.json` (or `npm run parts` to also regenerate the built-in parts).
