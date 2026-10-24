[< Back to the README](../README.md)

# Development

## Project layout

- `src/core` – DOM-free logic: STL, mass properties, project model, MJCF exporter, zip IO
- `src/ui` – Three.js viewport, styles; `src/main.js` – panels and app logic
- `cli/convert.mjs` – headless export; `cli/import-step.mjs` – STL folder + STEP assembly to project; `tests/` – Vitest + MuJoCo validation

## Tests

`npm test` runs Vitest. The export tests validate the generated MJCF with the `mujoco` Python package (`pip install mujoco`).

## Roadmap / known limits

- Servo hole patterns/shaft offsets are typical values (see [standard_parts](../standard_parts/README.md)); verify against your servo.
- No in-browser physics preview yet (export and use `mujoco.viewer`); MuJoCo-WASM preview is a natural next step.
- Test-pose slider supports hinge and slide joints (not ball/free).
- URDF import / export is not implemented.
