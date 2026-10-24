# 🛰️ server

⬅️ [Main README](../README.md)

Local API for the editor (`127.0.0.1` only, same-origin only).

| File | 🎯 Role |
|---|---|
| `serve.mjs` | 🌐 production server: `dist/` + `standard_parts/` + API (`npm run build && npm run serve`) |
| `api.mjs` | 🔌 datasheet jobs: upload → Claude → preview → install |
| `claude.mjs` | 🤖 headless `claude -p` runner (restricted) |

## 🔌 API

| | Route | |
|---|---|---|
| GET | `/api/claude/status` | ✅ CLI available? |
| POST | `/api/datasheet-jobs` | 📄 start a job |
| GET | `/api/jobs/:id` | ⏳ state, log |
| GET | `/api/jobs/:id/result/<file>` | 👁️ preview files |
| POST | `/api/jobs/:id/install` | 📥 copy into `standard_parts/` |
| DELETE | `/api/jobs/:id` | 🗑️ cancel |

## 🔒 Safety

- 📁 throw-away dir · only `Read` `Glob` `Write`
- 🚫 no shell · no web · no MCP
- 💰 turn / time / budget limit (`S2M_CLAUDE_BUDGET`, default 1.5 USD)
- 🧾 output = one JSON spec → validated by `src/core/part-spec.js`

⚙️ Env: `S2M_CLAUDE_BIN` · `S2M_CLAUDE_MODEL` · `S2M_CLAUDE_BUDGET`

📖 [docs/datasheet-parts.md](../docs/datasheet-parts.md)
