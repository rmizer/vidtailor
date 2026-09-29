import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import JSZip from "jszip";
import { HttpError, hasCredentials, research, writeScript } from "./lib/claude.js";
import { cleanRelayReply, djResearch, jordanPrompt, mimiPrompt, planRun, reviewScript, teamStatus } from "./lib/agents.js";
import { markdownToDocx } from "./lib/docx-export.js";
import { markdownToPlain } from "./public/js/markdown.js";

const here = path.dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(path.join(here, ".env"));
} catch {
  // No .env file: fall back to the environment (or an `ant auth login` profile).
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = "127.0.0.1"; // private tool: only reachable from this computer

const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(here, "public")));

const requireText = (value, field, max = 20000) => {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${field} is required.`);
  if (value.length > max) throw new HttpError(400, `${field} is too long.`);
  return value.trim();
};

const safeFileName = (name) =>
  String(name || "document")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .slice(0, 120) || "document";

app.get("/api/status", (_req, res) => {
  res.json({ credentials: hasCredentials() });
});

app.post("/api/research", async (req, res) => {
  const keyword = requireText(req.body?.keyword, "Keyword", 300);
  res.json(await research({ keyword, project: req.body?.project }));
});

app.post("/api/script", async (req, res) => {
  const { project, documents } = req.body ?? {};
  const minutes = Math.max(0, Math.floor(Number(req.body?.minutes) || 0));
  const seconds = Math.max(0, Math.min(59, Math.floor(Number(req.body?.seconds) || 0)));
  if (!Array.isArray(documents) || !documents.length)
    throw new HttpError(400, "Choose at least one research document.");
  if (minutes * 60 + seconds < 10) throw new HttpError(400, "Script length must be at least 10 seconds.");
  if (minutes > 180) throw new HttpError(400, "Script length must be 3 hours or less.");
  const docs = documents.map((d) => ({
    name: requireText(d?.name, "Document name", 300),
    content: requireText(d?.content, "Document content", 200000),
  }));
  res.json(await writeScript({ project, documents: docs, minutes, seconds }));
});

// ---------- Agent team ----------

const runLength = (body) => {
  const minutes = Math.max(0, Math.floor(Number(body?.minutes) || 0));
  const seconds = Math.max(0, Math.min(59, Math.floor(Number(body?.seconds) || 0)));
  if (minutes * 60 + seconds < 10) throw new HttpError(400, "Script length must be at least 10 seconds.");
  if (minutes > 180) throw new HttpError(400, "Script length must be 3 hours or less.");
  return { minutes, seconds };
};

const requirePlan = (plan) => {
  if (!plan?.dj || !plan?.mimi) throw new HttpError(400, "Jayen's plan is missing. Start the run again.");
  return plan;
};

const requireDocs = (documents) => {
  if (!Array.isArray(documents) || !documents.length) throw new HttpError(400, "No research documents yet.");
  return documents.map((d) => ({
    name: requireText(d?.name, "Document name", 300),
    content: requireText(d?.content, "Document content", 200000),
  }));
};

app.get("/api/agents/status", async (_req, res) => {
  res.json(await teamStatus());
});

app.post("/api/agents/plan", async (req, res) => {
  const subject = requireText(req.body?.subject, "Subject", 300);
  res.json(await planRun({ subject, project: req.body?.project, ...runLength(req.body) }));
});

app.post("/api/agents/dj", async (req, res) => {
  const subject = requireText(req.body?.subject, "Subject", 300);
  res.json(await djResearch({ subject, project: req.body?.project, plan: requirePlan(req.body?.plan) }));
});

app.post("/api/agents/prompt/mimi", (req, res) => {
  const subject = requireText(req.body?.subject, "Subject", 300);
  res.json({ prompt: mimiPrompt({ subject, project: req.body?.project, plan: requirePlan(req.body?.plan) }) });
});

app.post("/api/agents/prompt/jordan", (req, res) => {
  const subject = requireText(req.body?.subject, "Subject", 300);
  res.json({
    prompt: jordanPrompt({
      subject,
      project: req.body?.project,
      plan: req.body?.plan,
      documents: requireDocs(req.body?.documents),
      attach: Boolean(req.body?.attach),
      ...runLength(req.body),
    }),
  });
});

app.post("/api/agents/relay", (req, res) => {
  res.json(cleanRelayReply(requireText(req.body?.text, "Reply", 300000)));
});

app.post("/api/agents/review", async (req, res) => {
  const subject = requireText(req.body?.subject, "Subject", 300);
  res.json(
    await reviewScript({
      subject,
      plan: req.body?.plan,
      script: requireText(req.body?.script, "Script", 300000),
      documents: requireDocs(req.body?.documents),
      ...runLength(req.body),
    }),
  );
});

async function renderFile(content, format, title) {
  if (format === "docx") return markdownToDocx(content, title);
  if (format === "txt") return Buffer.from(markdownToPlain(content), "utf8");
  if (format === "md") return Buffer.from(content, "utf8");
  throw new HttpError(400, `Unsupported format: ${format}`);
}

app.post("/api/export/docx", async (req, res) => {
  const content = requireText(req.body?.content, "Content", 500000);
  const title = safeFileName(req.body?.title);
  res
    .type("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    .attachment(`${title}.docx`)
    .send(await markdownToDocx(content, title));
});

// Fallback for browsers without the File System Access API: one .zip holding the project folder.
app.post("/api/export/zip", async (req, res) => {
  const { folder, format, files, extras } = req.body ?? {};
  const folderName = safeFileName(folder || "vidTailor_project");
  const zip = new JSZip();
  const dir = zip.folder(folderName);
  for (const f of files ?? []) {
    const name = safeFileName(f?.name);
    dir.file(`${name}.${format}`, await renderFile(requireText(f?.content, "Content", 500000), format, name));
  }
  for (const f of extras ?? []) dir.file(safeFileName(f?.name), String(f?.content ?? ""));
  res
    .type("application/zip")
    .attachment(`${folderName}.zip`)
    .send(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
});

app.use((err, _req, res, _next) => {
  const status = err instanceof HttpError ? err.status : err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || "Something went wrong." });
});

app.listen(PORT, HOST, () => {
  console.log(`vidTailor running at http://localhost:${PORT}`);
  if (!hasCredentials())
    console.log("Note: ANTHROPIC_API_KEY is not set. Research and scripting need it - see README.md.");
});
