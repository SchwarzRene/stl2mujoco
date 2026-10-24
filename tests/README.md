# 🧪 tests

⬅️ [Main README](../README.md)

| ▶️ Command | 🎯 Runs |
|---|---|
| `npm test` | ✅ all Vitest suites |
| `npx vitest run tests/step-import.test.js` | 🏗️ one suite |
| `S2M_REAL_CLAUDE=1 npx vitest run tests/claude-real.test.js` | 💰 real Claude CLI (a few cents) |

## 📋 Suites

| File | 🔍 Checks |
|---|---|
| `mesh.test.js` | 🧮 mass / inertia vs analytic shapes |
| `mjcf.test.js` | 📤 exported XML loads in MuJoCo |
| `library.test.js` | 📚 parts, mates, servo behaviour |
| `copy.test.js` | 📋 copy / mirror / arrays |
| `refresh.test.js` | 🔄 part refresh |
| `datasheet.test.js` | 📄 spec validation, API (stub CLI) |
| `step-import.test.js` | 🏗️ STEP tree, STL matching, robot.json |
| `claude-real.test.js` | 🤖 opt-in, real CLI |

## 🧰 Support

| Path | 🎯 |
|---|---|
| `helpers/step-fixture.js` | 🧱 tiny synthetic STEP assembly |
| `stubs/claude-stub.mjs` | 🎭 fake `claude` CLI |
| `validate_mjcf.py` `servo_step.py` | 🐍 MuJoCo checks (called from tests) |
| `e2e/*.cjs` | 🖱️ browser tests (Playwright, not a dependency) |

⚠️ 🐍 Needs `python3` with `pip install mujoco` on PATH, otherwise MuJoCo-based tests fail.
