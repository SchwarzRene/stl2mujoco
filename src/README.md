# 🧩 src

⬅️ [Main README](../README.md)

```
        ┌──────────── main.js (state + actions) ────────────┐
        │                                                   │
   🎨 ui/  (DOM, Three.js)                    🧠 core/  (no DOM, runs in Node too)
```

## 🧠 core

| Group | Files | 🎯 |
|---|---|---|
| 📦 Model | `project.js` `presets.js` `io.js` | nodes, roles, zip save/load |
| 🔗 Assembly | `mates.js` `features.js` `refresh.js` | connectors, snapping, part refresh |
| 🧮 Physics | `mesh.js` `servo.js` `servo-specs.js` | mass, inertia, servo model |
| 📤 Export | `mjcf.js` | MuJoCo XML |
| 📚 Library | `library.js` `part-spec.js` | prefabs, datasheet specs |
| 🏗️ STEP | `step-asm.js` `step-import.js` `stl-folder.js` | placements + robot.json |
| 📄 STL | `stl.js` `fs-reader.js` | parse / write, Node file access |

## 🎨 ui

| File | 🎯 |
|---|---|
| `viewport.js` | 🖼️ 3D view |
| `toolbar.js` `left-panel.js` `inspector.js` `library-panel.js` | 🧰 panels |
| `assemble.js` | 🔗 Mate workflow |
| `datasheet-dialog.js` | 📄 datasheet import |
| `kit.js` `icons.js` `style.css` | 🧱 widgets, icons, theme |

📏 Rules: SI units · poses in world space at joint zero · `core/` never touches the DOM.
