// The agent team. Jayen (Claude) and DJ (Google Antigravity) run through the command-line tools installed on
// this PC, signed in with the user's own accounts. Mimi and Jordan are Microsoft Copilot, which has
// no CLI or API for personal accounts, so they are "relay" agents: vidTailor writes their prompt,
// the user pastes it into Copilot and pastes the reply back.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { countWords, hasReferencesSection } from "../public/js/markdown.js";
import { HttpError, WORDS_PER_MINUTE } from "./claude.js";

export const TEAM = {
  jayen: { name: "Jayen", engine: "Claude", role: "Orchestrator" },
  dj: { name: "DJ", engine: "Antigravity", role: "Research" },
  mimi: { name: "Mimi", engine: "Microsoft Copilot", role: "Research" },
  jordan: { name: "Jordan", engine: "Microsoft Copilot", role: "Scripting" },
};

// A neutral working folder, so neither CLI picks up project files or instructions from this repo.
const WORK_DIR = path.join(os.tmpdir(), "vidtailor-agents");
mkdirSync(WORK_DIR, { recursive: true });

function runCli(command, args, input, { timeoutMs, env = process.env, useShell = false }) {
  return new Promise((resolve, reject) => {
    // Prompts go through stdin, except for agy (a real .exe, run without a shell, so Node quotes the
    // prompt argument safely). Args for shell-launched commands are fixed strings.
    const child = spawn(command, args, { cwd: WORK_DIR, env, shell: useShell, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new HttpError(504, `${command} took longer than ${Math.round(timeoutMs / 60000)} minutes and was stopped.`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        err.code === "ENOENT"
          ? new HttpError(503, `The ${command} command isn't installed or isn't on the PATH.`)
          : err,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // The CLIs can print warnings around the JSON; take the outermost object.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    try {
      return start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
    } catch {
      return null;
    }
  }
}

// ---------- Engines ----------

async function askClaude(prompt, timeoutMs = 4 * 60000) {
  // Use the Claude Code subscription sign-in, not an API key that may be in .env.
  const { ANTHROPIC_API_KEY: _key, ANTHROPIC_AUTH_TOKEN: _token, ...env } = process.env;
  const { code, stdout, stderr } = await runCli(
    "claude",
    ["-p", "--output-format", "json", "--tools", "", "--no-session-persistence"],
    prompt,
    { timeoutMs, env },
  );
  const out = parseJson(stdout);
  if (!out || out.is_error || code !== 0) {
    const detail = (out?.result || stderr || stdout).trim().slice(0, 400);
    throw new HttpError(502, `Jayen (Claude Code) failed${detail ? `: ${detail}` : "."} If you haven't yet, run "claude" once in a terminal to sign in.`);
  }
  return String(out.result || "").trim();
}

// agy can't open pages in headless mode unless "read_url(*)" is in permissions.allow in
// ~/.gemini/antigravity-cli/settings.json. Any other tool it reaches for (such as a terminal command)
// is denied, which ends the turn with an empty reply, so the prompt tells it to stick to web tools.
const AGY_TOOL_RULES =
  "Use only your web search and URL reading tools. Do not run terminal commands and do not read or write files.";

async function askAgy(prompt, timeoutMs = 10 * 60000) {
  // Plan mode is read-only. agy doesn't read the prompt from stdin, so it goes in --print=.
  const { code, stdout, stderr } = await runCli(
    "agy",
    ["--mode", "plan", "--output-format", "json", `--print=${AGY_TOOL_RULES}\n\n${prompt}`],
    "",
    { timeoutMs },
  );
  const out = parseJson(stdout) ?? parseJson(stderr);
  if (out?.status === "ERROR" || out?.error) {
    const message = String(out.error?.message ?? out.error ?? "").trim();
    if (/sign.?in|log.?in|auth|credential/i.test(message))
      throw new HttpError(401, 'DJ (Antigravity) isn\'t signed in. Open a terminal, run "agy", sign in with Google, then try again.');
    throw new HttpError(502, `DJ (Antigravity) failed${message ? `: ${message.slice(0, 400)}` : "."}`);
  }
  if (out && !String(out.response ?? "").trim() && out.denied_actions?.length) {
    const denied = out.denied_actions.map((a) => a.action).join(", ");
    throw new HttpError(
      502,
      `DJ (Antigravity) stopped because it wasn't allowed to use: ${denied}. If that's read_url, add "read_url(*)" to permissions.allow in ~/.gemini/antigravity-cli/settings.json. Otherwise, try again.`,
    );
  }
  if (!out?.response || code !== 0) {
    const detail = (stderr || stdout).trim().slice(0, 400);
    throw new HttpError(502, `DJ (Antigravity) failed${detail ? `: ${detail}` : "."}`);
  }
  return String(out.response).trim();
}

export async function teamStatus() {
  const check = async (command, useShell) => {
    try {
      const { code, stdout } = await runCli(command, ["--version"], "", { timeoutMs: 20000, useShell });
      return code === 0 ? { installed: true, version: stdout.trim().split(/\s+/)[0] } : { installed: false };
    } catch {
      return { installed: false };
    }
  };
  const [claude, agy] = await Promise.all([check("claude", false), check("agy", false)]);
  return { jayen: claude, dj: agy };
}

// ---------- Shared prompt pieces ----------

function projectContext(project = {}) {
  const lines = [];
  if (project.title) lines.push(`Title: ${project.title}`);
  if (project.description) lines.push(`Description: ${project.description}`);
  return lines.length ? lines.join("\n") : "(no project details provided)";
}

const RESEARCH_FORMAT = `Format of the research brief:
- Markdown. Start with a single "# " title line naming the subject.
- Organize the body under short "## " section headings that fit the subject.
- The body (everything except headings and the References section) must be 2,000 words or fewer; aim for 1,200 to 1,800. Favor concrete facts, figures, dates, names and quotable points over general commentary.
- Mark each claim that comes from a source with a bracketed number such as [1] that matches the References list.
- End with a "## References" section: a numbered list, one source per line: 1. Title - Publisher or site (date if known). URL
- Use reliable, current sources and cross-check important facts. If reputable sources disagree, say so briefly.
- Output only the brief: no preamble, closing remarks or notes about your process.`;

const SCRIPT_FORMAT = `Format of the script (Markdown):
- First line: "# " followed by a working title for the video.
- Divide the script with "## " section headings (for example Hook, Introduction, one heading per main point, Outro and call to action). Headings are for the editor and are not read aloud.
- Under each heading, write only the words to be spoken: no stage directions, camera or B-roll notes, timestamps, bullet points or speaker labels.
- Write for the ear: short-to-medium sentences, natural spoken rhythm, clear transitions, a quick explanation for any jargon.
- Use only facts supported by the research documents. Do not include citation markers such as [1].
- Output only the script: no preamble or closing remarks.`;

const bullets = (items) => (items?.length ? items.map((q) => `- ${q}`).join("\n") : "- (none)");

function lengthTarget(minutes, seconds) {
  const total = minutes * 60 + seconds;
  return {
    label: `${minutes} min ${String(seconds).padStart(2, "0")} s`,
    words: Math.max(30, Math.round((total / 60) * WORDS_PER_MINUTE)),
  };
}

function cleanDocument(text) {
  // Drop any chatty preamble before the title line and trailing code fences.
  let t = String(text || "").replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i, "$1").trim();
  const start = t.search(/^# /m);
  if (start > 0) t = t.slice(start);
  return t;
}

// ---------- Jayen: plan ----------

export async function planRun({ subject, project, minutes, seconds }) {
  const target = lengthTarget(minutes, seconds);
  const prompt = `You are Jayen, the orchestrator of a small AI team that researches and scripts YouTube videos. You don't research or write the script yourself: you divide the work.

Your team:
- DJ (Google Antigravity, with web search): writes one research brief.
- Mimi (Microsoft Copilot, with web search): writes a second, separate research brief.
- Jordan (Microsoft Copilot): writes the narration script from both briefs.

Plan the work for this video.
Video subject: ${subject}
Target script length: ${target.label} (about ${target.words} spoken words at ${WORDS_PER_MINUTE} words per minute)
Project context:
${projectContext(project)}

Split the research so DJ and Mimi cover different angles with little overlap, and together give Jordan everything a ${target.label} script needs. Then give Jordan direction for the script.

Reply with only a JSON object, no code fences and no other text, in exactly this shape:
{
  "summary": "one or two sentences on how you split the work",
  "dj": { "focus": "DJ's angle in a short phrase", "questions": ["3 to 6 specific questions DJ must answer"] },
  "mimi": { "focus": "Mimi's angle in a short phrase", "questions": ["3 to 6 specific questions Mimi must answer"] },
  "jordan": { "angle": "the story or hook the script should build around", "audience": "who the video is for", "tone": "voice and tone", "notes": ["2 to 5 specific directions for the script"] }
}`;

  const text = await askClaude(prompt);
  const plan = parseJson(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  if (!plan?.dj?.focus || !plan?.mimi?.focus || !plan?.jordan)
    throw new HttpError(502, "Jayen's plan came back in an unexpected format. Please try again.");
  return plan;
}

// ---------- DJ: research (automatic) ----------

export async function djResearch({ subject, project, plan }) {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `You are DJ, a research specialist on a YouTube production team. Use Google web search to research the assignment below, then write a research brief.

Video subject: ${subject}
Your focus: ${plan.dj.focus}
Questions you must answer:
${bullets(plan.dj.questions)}

A teammate is researching a different angle (${plan.mimi.focus}), so stay on your focus and don't repeat theirs.

Project context:
${projectContext(project)}

Today's date: ${today}

${RESEARCH_FORMAT}`;

  const content = cleanDocument(await askAgy(prompt));
  if (!content) throw new HttpError(502, "DJ returned an empty research brief. Please try again.");
  return { content, words: countWords(content), hasReferences: hasReferencesSection(content) };
}

// ---------- Mimi and Jordan: relay prompts ----------

export function mimiPrompt({ subject, project, plan }) {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Mimi, a research specialist on a YouTube production team. Search the web to research the assignment below, then write a research brief.

Video subject: ${subject}
Your focus: ${plan.mimi.focus}
Questions you must answer:
${bullets(plan.mimi.questions)}

A teammate is researching a different angle (${plan.dj.focus}), so stay on your focus and don't repeat theirs.

Project context:
${projectContext(project)}

Today's date: ${today}

${RESEARCH_FORMAT}`;
}

// With attach = true the research is uploaded to Copilot as files instead of pasted inline,
// which keeps the prompt under Copilot's message length limit.
export function jordanPrompt({ subject, project, plan, minutes, seconds, documents, attach }) {
  const target = lengthTarget(minutes, seconds);
  const direction = plan?.jordan ?? {};
  const research = attach
    ? `The research documents are attached as files: ${documents.map((d) => `${d.name}.txt`).join(", ")}. Read all of them before writing.`
    : `Research documents:\n\n${documents
        .map((d) => `===== ${d.name} =====\n${d.content}\n===== end of ${d.name} =====`)
        .join("\n\n")}`;
  return `You are Jordan, the scriptwriter on a YouTube production team. Write a narration script for one voice-over artist, based only on the research documents ${attach ? "attached" : "below"}.

Video subject: ${subject}
Target running time: ${target.label}. The spoken words (everything except headings) must total about ${target.words} words, within 10%.

Direction from Jayen, the producer:
- Angle: ${direction.angle || "(your choice)"}
- Audience: ${direction.audience || "general YouTube viewers"}
- Tone: ${direction.tone || "clear, engaging and conversational"}
${bullets(direction.notes)}

Project context:
${projectContext(project)}

${SCRIPT_FORMAT}

${research}`;
}

export function cleanRelayReply(text) {
  const content = cleanDocument(text);
  if (!content) throw new HttpError(400, "Paste the reply from Copilot first.");
  return { content, words: countWords(content) };
}

// ---------- Jayen: review ----------

export async function reviewScript({ subject, plan, minutes, seconds, script, documents }) {
  const target = lengthTarget(minutes, seconds);
  const words = countWords(script);
  const prompt = `You are Jayen, the orchestrator of a YouTube production team. Jordan has written the narration script below from research by DJ and Mimi. Review it.

Video subject: ${subject}
Target: ${target.label}, about ${target.words} spoken words. The script has ${words} spoken words (${Math.round((words / target.words) * 100)}% of target).
Your direction to Jordan: ${JSON.stringify(plan?.jordan ?? {})}

Check: length against the target (within 10% is fine), whether it follows your direction, whether every factual claim is supported by the research, how strong the hook and ending are, and whether it reads well aloud.

Reply in Markdown, under 350 words, with exactly these parts:
## Verdict
One line starting with "Ready to record", "Minor fixes" or "Needs revision", then one sentence why.
## What works
2 to 4 bullets.
## Fix before recording
Bullets naming the section and the change, or "Nothing." if none.
## Revision request for Jordan
If changes are needed, a short message Jordan can act on directly. Otherwise "None needed."

Research documents:
${documents.map((d) => `===== ${d.name} =====\n${d.content}`).join("\n\n")}

Jordan's script:
${script}`;

  return { content: (await askClaude(prompt)).trim(), words, targetWords: target.words };
}
