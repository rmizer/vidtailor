// Minimal Markdown support shared by the browser (rendering, .txt export) and the
// server (.docx export). Covers what the generated documents use: headings, paragraphs,
// bullet/numbered lists, block quotes, rules, **bold**, *italic*, [links](url) and bare URLs.

const INLINE =
  /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*([^*\s][^*]*)\*|(https?:\/\/[^\s<>)\]]+[^\s<>)\].,;:!?'"])/g;

const REFERENCE_HEADING = /^(references|sources|works cited|bibliography|citations)\b/i;

export function parseInline(text) {
  const tokens = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) tokens.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) tokens.push({ type: "bold", text: m[1] });
    else if (m[2] !== undefined) tokens.push({ type: "link", text: m[2], href: m[3] });
    else if (m[4] !== undefined) tokens.push({ type: "italic", text: m[4] });
    else tokens.push({ type: "link", text: m[5], href: m[5] });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ type: "text", text: text.slice(last) });
  return tokens;
}

export function parseBlocks(markdown) {
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    let m;
    if (!line) flush();
    else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      blocks.push({ type: "h", level: Math.min(m[1].length, 4), text: m[2].replace(/\s#+$/, "") });
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flush();
      blocks.push({ type: "hr" });
    } else if ((m = line.match(/^[-*+]\s+(.*)$/))) {
      flush();
      blocks.push({ type: "li", ordered: false, text: m[1] });
    } else if ((m = line.match(/^(\d+)[.)]\s+(.*)$/))) {
      flush();
      blocks.push({ type: "li", ordered: true, n: Number(m[1]), text: m[2] });
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flush();
      blocks.push({ type: "quote", text: m[1] });
    } else para.push(line);
  }
  flush();
  return blocks;
}

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inlineToHtml(text) {
  return parseInline(text)
    .map((t) => {
      const body = escapeHtml(t.text);
      if (t.type === "bold") return `<strong>${body}</strong>`;
      if (t.type === "italic") return `<em>${body}</em>`;
      if (t.type === "link")
        return `<a href="${escapeHtml(t.href)}" target="_blank" rel="noopener noreferrer">${body}</a>`;
      return body;
    })
    .join("");
}

export function markdownToHtml(markdown) {
  const out = [];
  let list = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const b of parseBlocks(markdown)) {
    if (b.type === "li") {
      const tag = b.ordered ? "ol" : "ul";
      if (list !== tag) {
        closeList();
        out.push(b.ordered && b.n !== 1 ? `<ol start="${b.n}">` : `<${tag}>`);
        list = tag;
      }
      out.push(`<li>${inlineToHtml(b.text)}</li>`);
      continue;
    }
    closeList();
    if (b.type === "h") out.push(`<h${b.level + 1}>${inlineToHtml(b.text)}</h${b.level + 1}>`);
    else if (b.type === "hr") out.push("<hr>");
    else if (b.type === "quote") out.push(`<blockquote>${inlineToHtml(b.text)}</blockquote>`);
    else out.push(`<p>${inlineToHtml(b.text)}</p>`);
  }
  closeList();
  return out.join("\n");
}

export function inlineToPlain(text) {
  return parseInline(text)
    .map((t) => (t.type === "link" && t.text !== t.href ? `${t.text} (${t.href})` : t.text))
    .join("");
}

export function markdownToPlain(markdown) {
  const lines = [];
  let prev = null;
  for (const b of parseBlocks(markdown)) {
    if (prev && !(prev.type === "li" && b.type === "li")) lines.push("");
    if (b.type === "h") lines.push(inlineToPlain(b.text).toUpperCase());
    else if (b.type === "hr") lines.push("----------");
    else if (b.type === "li") lines.push(`${b.ordered ? `${b.n}.` : "•"} ${inlineToPlain(b.text)}`);
    else if (b.type === "quote") lines.push(`"${inlineToPlain(b.text)}"`);
    else lines.push(inlineToPlain(b.text));
    prev = b;
  }
  // BOM so older Windows apps read the file as UTF-8 (bullets, curly quotes).
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// Words in the body text: headings, citation markers and the references section are excluded.
export function countWords(markdown) {
  let words = 0;
  for (const b of parseBlocks(markdown)) {
    if (b.type === "h") {
      if (REFERENCE_HEADING.test(b.text)) break;
      continue;
    }
    if (b.type === "hr") continue;
    const plain = parseInline(b.text)
      .map((t) => t.text)
      .join("")
      .replace(/\[\d+(?:[,\s–-]+\d+)*\]/g, " ");
    words += plain.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  }
  return words;
}

export function hasReferencesSection(markdown) {
  return parseBlocks(markdown).some((b) => b.type === "h" && REFERENCE_HEADING.test(b.text));
}
