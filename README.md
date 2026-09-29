# vidTailor

A private, in-browser workspace for putting together YouTube videos: enter the project details, research
keywords into cited briefs, turn the briefs into narration scripts of a set length, and save everything
to a folder on your PC as Word, text or Markdown files.

Your work is saved in the browser automatically and is still there after closing the browser or losing
the connection.

## Setup

1. Install [Node.js](https://nodejs.org/) 20.12 or newer.
2. Install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and paste in your Anthropic API key
   (from https://console.anthropic.com/settings/keys):
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
   Research and Generate Script need this key; everything else works without it.
4. Start the app:
   ```
   npm start
   ```
5. Open http://localhost:3000 in Chrome or Edge.

## Agent team

The **Agents** section runs the whole job with a team of AI agents:

- **Jayen** (Claude, orchestrator) plans the video, splits the research into two angles, gives Jordan
  direction, then reviews the finished script. Runs through the Claude Code CLI (`claude`) on this PC,
  signed in with your Claude account.
- **DJ** (Google Antigravity, research) researches one angle with web search. Runs through the
  Antigravity CLI (`agy`) on this PC. Sign in once first: run `agy` in a terminal and sign in with Google.
  So DJ can open web pages without asking, `~/.gemini/antigravity-cli/settings.json` needs
  `"permissions": { "allow": ["read_url(*)"] }`.
- **Mimi** (Microsoft Copilot, research) researches the other angle.
- **Jordan** (Microsoft Copilot, scripting) writes the script from both research briefs.

Microsoft Copilot has no command-line tool or API for personal accounts, so Mimi and Jordan work by
copy and paste: vidTailor writes their prompt, you paste it into Copilot, then paste Copilot's reply
back. If Jayen's review asks for changes, **Send revisions to Jordan** gives you a follow-up message
for the same Copilot chat. Research and scripts land in the normal Research and Scripting lists.

The agent team doesn't use `ANTHROPIC_API_KEY`; that's only for the Research and Generate Script buttons.

## How it works

- `server.js`: a small Express server that only listens on this computer. It serves the page, calls
  the Claude API for research (with web search) and scripting, and builds `.docx` and `.zip` files.
  The API key stays on the server and never reaches the browser.
- `public/`: the single page (`index.html`, `css/styles.css`, `js/app.js`). All project data lives
  in the browser's localStorage.
- `lib/agents.js`: the agent team's prompts and the calls to the `claude` and `agy` CLIs.
- `lib/claude.js`: the prompts and Claude API calls. `lib/docx-export.js` converts Markdown to Word.
- `dev/`: the project brief, the design brief and `decisions.md`, which lists the choices made
  where the brief was silent.

## Saving to a folder

**Save Project** asks you to pick a location, then creates a new folder there
(`vidTailor_<title>_<date>`) and writes the selected files into it. That needs Chrome or Edge.
In Firefox or Safari you get the same folder as a `.zip` download instead.
