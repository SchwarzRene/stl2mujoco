# 🖥️ cli

⬅️ [Main README](../README.md)

Headless tools (Node, no browser).

| Command | ➡️ What it does |
|---|---|
| `node cli/convert.mjs <project.s2m.zip> <outDir>` | 📦 project → `model.xml` + `meshes/` |
| `node cli/import-step.mjs <stl-folder> <asm.stp> --suggest robot.json` | 🔍 write a starting config |
| `node cli/import-step.mjs <stl-folder> <asm.stp> <out.s2m.zip> --config robot.json` | 🏗️ build from STL folder + STEP |
| `… --auto` | 🤖 build from the suggested config (check the result!) |

```
STL folder + .stp ─▶ import-step ─▶ .s2m.zip ─▶ convert ─▶ model.xml ─▶ MuJoCo
```

📖 Config format: [docs/step-import.md](../docs/step-import.md) · Example: [docs/crabsy-example.md](../docs/crabsy-example.md)
