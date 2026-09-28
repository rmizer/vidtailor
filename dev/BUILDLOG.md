# Build Log

## 2026-09-28

- Investigated the error "No Anthropic API key found. Add ANTHROPIC_API_KEY to the .env file and restart the server." shown when adding a keyword (Research step).
- Cause: the project had no `.env` file, only the `.env.example` template. The server reads the key from `.env` at startup (`server.js:12`); the error comes from `lib/claude.js:20`.
- Fix: create `.env` in the project root (`C:\Users\rache\Desktop\vidTailor\.env`, next to `server.js`) containing `ANTHROPIC_API_KEY=sk-ant-...`, then restart the server.
- Confirmed a `.env` placed in `dev\` is ignored — the server only loads `.env` from the project root.
- Note: `.env` loading uses `process.loadEnvFile`, which needs Node 20.12 or newer.
- Note: `node` was not on the PATH of the shell used for this session, so the Node version was not checked.
- Created this build log (`dev/BUILDLOG.md`).
- No application code was changed.
- Created `.env` in the project root from `.env.example`. It is git-ignored, so it is not committed.
- Still to do: `ANTHROPIC_API_KEY` in `.env` is still blank. Research will keep showing the error until a key is added and the server is restarted.
