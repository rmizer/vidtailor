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

## 2026-09-29 (Site 2)

- Removed keywords from **Project details**: the keyword tag input, the keyword chips in the saved view, and the "From your project" keyword suggestions in Research (they came from project keywords). Keywords are now entered only in the Research section.
- Project keywords are no longer sent to Claude as project context (`lib/claude.js`) or written to the exported `project_details.txt`. Keywords saved in the browser by earlier versions are dropped when the page loads.
- Removed the unused keyword-chip CSS and updated `dev/decisions.md`.
- Added the **Agent team** section (between Project details and Research): Jayen (Claude, orchestrator), DJ (Gemini, research), Mimi (Microsoft Copilot, research) and Jordan (Microsoft Copilot, scripting). New `lib/agents.js`, new `/api/agents/*` routes in `server.js`, and the team cards and run board in `public/js/app.js`, `public/index.html` and `public/css/styles.css`.
- Jayen runs through the local Claude Code CLI and DJ through the local Gemini CLI. Mimi and Jordan are copy-and-paste relays through Copilot.
- Tested: Jayen's plan (about 16 s) and review (about 11 s) work through the Claude CLI; Mimi and Jordan prompt building and reply cleanup work.
- Still to do: sign the Gemini CLI in (run `gemini` in a terminal and choose "Sign in with Google"). Until then, DJ shows "isn't signed in" and can be skipped.
- Updated `README.md`, `dev/decisions.md` and the API key banner (the agent team doesn't need `ANTHROPIC_API_KEY`).

## 2026-09-29 (Site 2): DJ moved from Gemini CLI to Antigravity

- Google Antigravity has replaced the Gemini CLI. It launches with `agy` (version 1.2.13, installed at `%LOCALAPPDATA%\agy\bin\agy.exe`).
- DJ now runs `agy --mode plan --output-format json --print=<prompt>` (`lib/agents.js`). agy doesn't read prompts from stdin, so the prompt goes in as an argument. agy is a real .exe, so it runs without a shell.
- In headless mode agy auto-denies any tool that would normally ask for approval, and a denied tool ends the turn with an empty reply. Added `"read_url(*)"` to `permissions.allow` in `~/.gemini/antigravity-cli/settings.json` so DJ can open web pages. A workspace-level `.agents/settings.json` wasn't picked up. Terminal commands stay blocked, and DJ's prompt now tells it to use only web search and URL reading.
- DJ's errors now name any tool agy was denied, and the sign-in message says to run `agy`.
- The UI labels DJ as "Antigravity", and the status check looks for `agy`.
- Tested: the team status check finds agy 1.2.13. A test DJ research run (Rubik's Cube history) returned a 1,998-word brief with a References section in about 3.5 minutes, so the "usually takes" hint is now 2–6 minutes.
- Updated `README.md` and `dev/decisions.md`. The earlier to-do to sign the Gemini CLI in no longer applies.
- Committed and pushed to `origin/main` all work from this session: the Agent team section and the move to Antigravity.
- Handoff for Site 1:
  - Pull `main` and restart the server.
  - Site 1 needs `agy` installed and signed in (run `agy` once in a terminal).
  - It also needs `"read_url(*)"` under `permissions.allow` in `~/.gemini/antigravity-cli/settings.json`. That file is per machine and isn't in the repo.
  - Without these, DJ fails with a sign-in or "wasn't allowed to use: read_url" error and can be skipped.
