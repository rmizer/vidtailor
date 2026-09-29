# Build decisions

Choices made where `project_details.txt` was silent or ambiguous (first build, 2026-09-28).
Anything here can be changed; each item names the file to change.

## Architecture

- **Local Node server plus a single page.** Research must run "intelligently" and "cite references",
  which needs an AI model with web search. Calling it from the browser would expose the API key,
  so a small Express server (`server.js`) holds the key in `.env` and makes the calls. It listens on
  `127.0.0.1` only, so nobody else on the network can reach it, since the site is for private use.
- **AI model: Claude Opus 5.5 (`claude-opus-5-5`)** through the official Anthropic SDK, with adaptive
  thinking at `high` effort. Research uses Anthropic's server-side web search tool (up to 8 searches
  per document). If Claude's safety filters decline a request, it is automatically retried on
  Anthropic's recommended fallback model (`fallbacks: "default"`). Costs are billed to your
  Anthropic API account: roughly a few cents to about $0.50 per research document, depending on
  the searches. Change it in `lib/claude.js`.
- **No build step or front-end framework.** Plain HTML, CSS and ES modules, so there's nothing to compile.
- **Node.js 24 LTS and Git** were installed on this PC with winget (neither was present).

## Persistence

- Everything (project details, the research keyword box, all documents, script length, selections) is saved to
  the browser's **localStorage** on every keystroke and change. It survives closing the browser or
  losing the connection. It is tied to this browser and this address (`http://localhost:3000`):
  another browser, or a different port, starts empty.
- Open tabs stay in sync with each other.
- A research or script request that is still running when the page is closed is lost; the page warns
  before you leave while one is running.
- localStorage holds about 5 MB, which is roughly 300+ research documents. If it ever fills up, a
  warning appears. IndexedDB would be the upgrade path if that becomes a limit.

## Project details section

- **Title is required** to Save (it names the script files and the save folder). Description is optional.
- **No keywords here.** Keywords live only in the Research section, one per research request
  (removed from project details on 2026-09-29).

## Research

- **Output format:** Markdown with `#`/`##` headings, `[n]` citation markers and a numbered
  `## References` list with URLs at the end. The prompt aims for 1,200–1,800 words, under the
  2,000-word cap. The word count shown excludes headings, citation markers and references, matching
  the brief. If Claude omits the References section, one is built from the sources it cited.
- **File naming:** `research_<keyword>`, then `research_<keyword>_2`, `_3`… for repeat subjects.
- New research documents are automatically ticked for use in Scripting.
- Deleting a document takes two clicks on × (within 4 seconds). The brief didn't mention deletion,
  but without it lists only grow.

## Scripting

- **Speaking rate: 150 words per minute** to convert the requested minutes and seconds into a target
  word count (±10%). Change `WORDS_PER_MINUTE` in `lib/claude.js` and `public/js/app.js`.
- **Script format:** `# Title`, then `## Section` headings (Hook, Intro, main points, Outro/CTA) with
  only the words to be spoken: no stage directions, B-roll notes or citation markers. Headings are
  for the editor and aren't counted as spoken words.
- **File naming:** `script_<project title>` (or the first research keyword if there is no title),
  then `_2`, `_3`…
- Length limits: 10 seconds to 180 minutes. At least one research document must be selected.

## Downloads and Save Project

- Every document can be downloaded individually as **.docx, .txt or .md**.
- **Save Project** opens a dialog listing every document (all ticked) plus a `project_details.txt`
  summary. You then pick one format for the whole set.
- "Downloads chosen files to a generated folder on the local PC": in **Chrome and Edge** this uses the
  File System Access API. You pick a location once, and the app creates
  `vidTailor_<title>_<YYYY-MM-DD>` (or `_2`, `_3` if it exists) and writes the files into it.
  Browsers can't create folders silently in Downloads, so picking a location is required. **Firefox
  and Safari** get the same folder as a `.zip`.
- Word files use Montserrat for body text and Comfortaa for headings in the brand colors. On a PC
  without those fonts installed, Word substitutes a default font.
- `.txt` files are saved as UTF-8 with a BOM so bullets and quotes display correctly in older
  Windows apps.

## Clear Project Page

- Clears **everything**: project details, all research documents and all scripts. A confirmation
  dialog appears first, and it explains that this can't be undone and suggests Save Project first.

## Design

- Text color `#1c1c1e` ("slightly lighter than perfect black"). Blue `#2060a7` for headings,
  primary buttons and the active menu item. Purple `#811f62` for the menu, secondary headings and
  destructive actions.
- Sections use a 6% blue tint on the white background, and panels inside them are 72% white.
  Everything uses a 10px radius.
- The logo is set in Comfortaa bold, centered in the header. The sticky menu sits below it, with
  links left-justified.
- Centered layout, with justified paragraph text (including the description box). The document
  viewer is left-aligned with centered titles, since justified or centered long documents with
  lists and URLs read poorly. **Worth reviewing, as the brief says.**
- The Research and Scripting panels sit side by side on wide screens and stack below 860px wide.
- Fonts load from Google Fonts. Without internet they fall back to system fonts, and the app still works.

## Not done / possible next steps

- The earlier request for a backlog wasn't created. The brief is now covered by this build.
- No user accounts or sync between computers (private, single-user tool).
- Research and scripting responses aren't streamed live into the viewer; a spinner shows until each finishes.
