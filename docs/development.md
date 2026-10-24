[< Back to the README](../README.md)

# Development

## 🗺️ Project layout

| Folder | 🎯 | 📖 |
|---|---|---|
| `src/` | 🧩 core (no DOM) + ui | [src/README.md](../src/README.md) |
| `cli/` | 🖥️ headless convert + STEP import | [cli/README.md](../cli/README.md) |
| `server/` | 🛰️ local API, datasheet jobs | [server/README.md](../server/README.md) |
| `tools/` | 🛠️ part generators | [tools/README.md](../tools/README.md) |
| `standard_parts/` | 📚 servo + fastener library | [standard_parts/README.md](../standard_parts/README.md) |
| `tests/` | 🧪 Vitest + MuJoCo checks | [tests/README.md](../tests/README.md) |
| `examples/` | 🦀 Crabsy | [examples/README.md](../examples/README.md) |
| `docs/` | 📄 this documentation | [README](../README.md#documentation) |

## Tests

`npm test` runs Vitest. The export tests validate the generated MJCF with the `mujoco` Python package (`pip install mujoco`).

## Roadmap / known limits

- Servo hole patterns/shaft offsets are typical values (see [standard_parts](../standard_parts/README.md)); verify against your servo.
- No in-browser physics preview yet (export and use `mujoco.viewer`); MuJoCo-WASM preview is a natural next step.
- Test-pose slider supports hinge and slide joints (not ball/free).
- URDF import / export is not implemented.
