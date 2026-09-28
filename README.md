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

## How it works

- `server.js`: a small Express server that only listens on this computer. It serves the page, calls
  the Claude API for research (with web search) and scripting, and builds `.docx` and `.zip` files.
  The API key stays on the server and never reaches the browser.
- `public/`: the single page (`index.html`, `css/styles.css`, `js/app.js`). All project data lives
  in the browser's localStorage.
- `lib/claude.js`: the prompts and Claude API calls. `lib/docx-export.js` converts Markdown to Word.
- `dev/`: the project brief, the design brief and `decisions.md`, which lists the choices made
  where the brief was silent.

## Saving to a folder

**Save Project** asks you to pick a location, then creates a new folder there
(`vidTailor_<title>_<date>`) and writes the selected files into it. That needs Chrome or Edge.
In Firefox or Safari you get the same folder as a `.zip` download instead.
