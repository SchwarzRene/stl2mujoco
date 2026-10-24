# 🛠️ tools

⬅️ [Main README](../README.md)

Generators for the [standard parts library](../standard_parts/README.md). Units: mm, Z up.

| File | 🎯 Role | ▶️ Run |
|---|---|---|
| `standard-parts.mjs` | 🏭 generate all built-in parts + index | `npm run parts` |
| `library-index.mjs` | 🗂️ rebuild `standard_parts/index.json` | `npm run parts:index` |
| `part-builders.mjs` | 🧱 spec → `part.json` + STL (also used by the datasheet import) | – |
| `geom.mjs` | 📐 watertight solids: box, cylinder, extrude, holes | – |

```
part spec ─▶ part-builders ─▶ part.json + *.stl ─▶ library-index ─▶ index.json
```

➕ Own part: drop a folder with `part.json` into `standard_parts/` → `npm run parts:index`.
