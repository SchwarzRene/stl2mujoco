[< Back to the README](../README.md)

# Add a part from a datasheet (headless Claude Code)

In the **parts library** tab (grid icon, left) click **✨ From datasheet**, upload the datasheet (PDF, image, text – several files are fine),
optionally **link your own STL** for the shape, pick a category and give hints. The editor starts a **headless Claude Code session**
(`claude -p`) that reads the datasheet, extracts dimensions, mounting holes, mass, torque/speed and writes a *part spec*;
the editor validates it and generates the meshes and `part.json`. You then **review** the values (estimates are highlighted),
**try the part in the scene** and finally **install** it into `standard_parts/` – commit that folder to share it.

- **Availability:** needs the editor server (`npm run dev`, or `npm run build && npm run serve`) **and** the Claude Code CLI
  (`npm i -g @anthropic-ai/claude-code`, sign in once with `claude`). If either is missing the dialog says so and stays disabled.
  `S2M_CLAUDE_BIN` points to another binary, `S2M_CLAUDE_MODEL` selects a model, `S2M_CLAUDE_BUDGET` caps the cost per run (default 1.5 USD, typically ~0.05 USD).
- **Safety:** the API listens on 127.0.0.1 only and accepts same-origin requests only. The Claude session runs in a throw-away
  directory with only `Read`/`Glob`/`Write` (no shell, no web, no MCP, no user settings), a turn/time/budget limit, and is told that the datasheet
  is untrusted data. Its only deliverable is one JSON spec, which is whitelisted and range-checked (`src/core/part-spec.js`) before trusted code generates the part;
  invalid specs are sent back once for repair.
- **Part types:** `hobby_servo` (case + ears + spline), `block_servo` (Dynamixel style), `block` (boards/plates with holes), `cylinder`, and `stl` (your mesh + connectors from the datasheet).
  The accepted spec format is documented in `server/claude.mjs` (`SCHEMA_DOC`).
