import Anthropic from "@anthropic-ai/sdk";
import { countWords, hasReferencesSection } from "../public/js/markdown.js";

const MODEL = "claude-opus-5-5";
export const WORDS_PER_MINUTE = 150;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let client;
function getClient() {
  if (!client) {
    try {
      client = new Anthropic();
    } catch {
      throw new HttpError(401, "No Anthropic API key found. Add ANTHROPIC_API_KEY to the .env file and restart the server.");
    }
  }
  return client;
}

export function hasCredentials() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

// Streams one request to completion, continuing when a long server-side web search pauses the turn.
async function run({ system, prompt, tools, effort, maxTokens }) {
  const messages = [{ role: "user", content: prompt }];
  for (let attempt = 0; attempt < 6; attempt++) {
    let message;
    try {
      message = await getClient()
        .beta.messages.stream({
          model: MODEL,
          max_tokens: maxTokens,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort },
          system,
          tools,
          messages,
        })
        .finalMessage();
    } catch (error) {
      throw translateError(error);
    }

    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    if (message.stop_reason === "refusal") {
      throw new HttpError(422, "Claude declined this request. Try rewording the keyword or project description.");
    }
    return message;
  }
  throw new HttpError(504, "The request took too many steps to finish. Please try again.");
}

function translateError(error) {
  if (error instanceof HttpError) return error;
  if (error instanceof Anthropic.AuthenticationError)
    return new HttpError(401, "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in the .env file.");
  if (error instanceof Anthropic.PermissionDeniedError)
    return new HttpError(403, "This API key doesn't have access to the model or web search. Check your Anthropic Console settings.");
  if (error instanceof Anthropic.RateLimitError)
    return new HttpError(429, "Rate limited by the Anthropic API. Wait a minute and try again.");
  if (error instanceof Anthropic.BadRequestError) return new HttpError(400, `Anthropic API rejected the request: ${error.message}`);
  if (error instanceof Anthropic.APIConnectionError)
    return new HttpError(503, "Couldn't reach the Anthropic API. Check the internet connection and try again.");
  if (error instanceof Anthropic.APIError) return new HttpError(502, `Anthropic API error (${error.status}): ${error.message}`);
  if (error instanceof Anthropic.AnthropicError && !hasCredentials())
    return new HttpError(401, "No Anthropic API key found. Add ANTHROPIC_API_KEY to the .env file and restart the server.");
  if (error instanceof Anthropic.AnthropicError) return new HttpError(502, error.message);
  return error;
}

function textOf(message) {
  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  // Drop any stray preamble before the document's title line.
  const start = text.search(/^# /m);
  return start > 0 ? text.slice(start) : text;
}

function citedSources(message) {
  const seen = new Map();
  for (const block of message.content) {
    if (block.type === "text")
      for (const c of block.citations ?? []) if (c.url && !seen.has(c.url)) seen.set(c.url, c.title || c.url);
  }
  if (!seen.size) {
    for (const block of message.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content))
        for (const r of block.content) if (r.url && !seen.has(r.url)) seen.set(r.url, r.title || r.url);
    }
  }
  return [...seen].map(([url, title]) => ({ url, title }));
}

function projectContext(project = {}) {
  const lines = [];
  if (project.title) lines.push(`Title: ${project.title}`);
  if (project.description) lines.push(`Description: ${project.description}`);
  if (project.keywords?.length) lines.push(`Keywords: ${project.keywords.join(", ")}`);
  return lines.length ? lines.join("\n") : "(no project details provided)";
}

const RESEARCH_SYSTEM = `You are a research assistant for a YouTube creator. You research a subject on the web and write a concise, well-organized research brief that the creator will later turn into a narrated video script.

Requirements for the brief:
- Write in Markdown. Start with a single "# " title line naming the subject.
- Organize the body under "## " section headings chosen to fit the subject (for example: Overview, Background, Key facts and figures, Current developments, Debates or misconceptions, Angles for a video). Keep headings short.
- The body (everything except headings and the References section) must be 2,000 words or fewer; aim for 1,200 to 1,800. Favor concrete facts, figures, dates, names and quotable points over general commentary.
- Mark each claim that comes from a source with a bracketed number such as [1] that matches the References list.
- End with a "## References" section: a numbered list with one source per line, formatted as: 1. Title - Publisher or site (date if known). URL
- Prefer reliable, current sources and cross-check important facts across more than one source. If reputable sources disagree, say so briefly.
- Output only the brief: no preamble, closing remarks or notes about your process.`;

export async function research({ keyword, project }) {
  const today = new Date().toISOString().slice(0, 10);
  const message = await run({
    system: RESEARCH_SYSTEM,
    prompt: `Research subject: ${keyword}\n\nProject context (use it to judge what matters for this video, but research the subject itself):\n${projectContext(project)}\n\nToday's date: ${today}`,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
    effort: "high",
    maxTokens: 32000,
  });

  let content = textOf(message);
  const sources = citedSources(message);
  if (!content) throw new HttpError(502, "Claude returned an empty research document. Please try again.");
  if (!hasReferencesSection(content) && sources.length) {
    content += `\n\n## References\n\n${sources.map((s, i) => `${i + 1}. ${s.title}. ${s.url}`).join("\n")}\n`;
  }
  return { content, words: countWords(content), sources };
}

const SCRIPT_SYSTEM = `You write narration scripts for YouTube videos. A single voice-over artist reads the script aloud, so write for the ear: short-to-medium sentences, a natural spoken rhythm, clear transitions, and a quick explanation for any jargon.

Format (Markdown):
- First line: "# " followed by a working title for the video.
- Divide the script with "## " section headings (for example Hook, Introduction, one heading per main point, Outro and call to action). Headings are for the editor and are not read aloud.
- Under each heading, write only the words to be spoken: no stage directions, camera or B-roll notes, timestamps, bullet points or speaker labels.
- Use only facts supported by the research documents provided. Do not include citation markers such as [1] in the narration.
- Output only the script: no preamble or closing remarks.`;

export async function writeScript({ project, documents, minutes, seconds }) {
  const totalSeconds = minutes * 60 + seconds;
  const targetWords = Math.max(30, Math.round((totalSeconds / 60) * WORDS_PER_MINUTE));
  const docs = documents
    .map((d) => `<document name="${d.name.replace(/"/g, "'")}">\n${d.content}\n</document>`)
    .join("\n\n");

  const message = await run({
    system: SCRIPT_SYSTEM,
    prompt: `Target running time: ${minutes} min ${String(seconds).padStart(2, "0")} s.
The spoken words (everything except headings) must total about ${targetWords} words, within 10%, which matches that running time at about ${WORDS_PER_MINUTE} words per minute.

Project context:
${projectContext(project)}

Research documents to base the script on:
${docs}`,
    effort: "high",
    maxTokens: Math.min(64000, 8000 + targetWords * 3),
  });

  const content = textOf(message);
  if (!content) throw new HttpError(502, "Claude returned an empty script. Please try again.");
  const words = countWords(content);
  return { content, words, targetWords, estimatedSeconds: Math.round((words / WORDS_PER_MINUTE) * 60) };
}
