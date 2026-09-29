import { countWords, markdownToHtml, markdownToPlain } from "./markdown.js";

const STORAGE_KEY = "vidtailor.state.v1";
const WORDS_PER_MINUTE = 150;

const $ = (id) => document.getElementById(id);

// ---------- State (persisted to localStorage on every change) ----------

const defaultState = () => ({
  project: { title: "", description: "", saved: false },
  research: { keyword: "", docs: [], activeId: null },
  scripts: { minutes: 5, seconds: 0, selectedIds: [], docs: [], activeId: null },
  agents: { subject: "", minutes: 5, seconds: 0, run: null },
});

function loadState() {
  const base = defaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && typeof saved === "object") {
      // Older saves had project keywords; research now handles keywords on its own.
      const { keywords: _unused, ...project } = saved.project ?? {};
      return {
        project: { ...base.project, ...project },
        research: { ...base.research, ...saved.research },
        scripts: { ...base.scripts, ...saved.scripts },
        agents: { ...base.agents, ...saved.agents },
      };
    }
  } catch {
    // Unreadable storage: start fresh rather than break the page.
  }
  return base;
}

let state = loadState();
let storageWarned = false;

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    if (!storageWarned) {
      storageWarned = true;
      toast(`Couldn't save to browser storage (${err.name}). Download your documents to keep them.`, true);
    }
  }
}

// Keep several open tabs in sync.
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY) {
    state = loadState();
    renderAll();
  }
});

// ---------- Helpers ----------

const slug = (text) =>
  String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";

function uniqueName(base, docs) {
  const taken = new Set(docs.map((d) => d.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

const newId = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

const formatDate = (iso) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const formatDuration = (totalSeconds) => {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

let toastTimer;
function toast(message, isError = false) {
  const box = $("toast");
  box.textContent = message;
  box.classList.toggle("error", isError);
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), isError ? 7000 : 3500);
}

async function postJson(url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the vidTailor server. Is it still running? (npm start)");
  }
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      message = (await res.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  return res;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function docBlob(doc, format) {
  if (format === "md") return new Blob([doc.content], { type: "text/markdown;charset=utf-8" });
  if (format === "txt") return new Blob([markdownToPlain(doc.content)], { type: "text/plain;charset=utf-8" });
  const res = await postJson("/api/export/docx", { title: doc.name, content: doc.content });
  return res.blob();
}

async function downloadDoc(doc, format) {
  try {
    triggerDownload(await docBlob(doc, format), `${doc.name}.${format}`);
  } catch (err) {
    toast(err.message, true);
  }
}

function setStatus(node, message, { busy = false, error = false } = {}) {
  node.replaceChildren();
  node.classList.toggle("error", error);
  if (busy) node.append(el("span", { class: "spinner", "aria-hidden": "true" }));
  if (message) node.append(message);
}

// ---------- Menu: highlight the section in view ----------

function initMenu() {
  const links = [...document.querySelectorAll(".menu a")];
  const sections = links.map((a) => $(a.dataset.section));
  const update = () => {
    const offset = document.querySelector(".menu").offsetHeight + 40;
    let current = sections[0];
    for (const s of sections) if (s.getBoundingClientRect().top <= offset) current = s;
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4)
      current = sections[sections.length - 1];
    for (const a of links) a.classList.toggle("active", a.dataset.section === current.id);
  };
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
}

// ---------- 1) Project details ----------

function renderProject() {
  const p = state.project;
  $("project-form").hidden = p.saved;
  $("project-view").hidden = !p.saved;
  $("project-title").value = p.title;
  $("project-description").value = p.description;
  $("view-title").textContent = p.title;
  $("view-description").textContent = p.description || "No description yet.";
}

function initProject() {
  $("project-title").addEventListener("input", (e) => {
    state.project.title = e.target.value;
    persist();
  });
  $("project-description").addEventListener("input", (e) => {
    state.project.description = e.target.value;
    persist();
  });

  $("project-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const error = $("project-error");
    if (!state.project.title.trim()) {
      error.textContent = "Please enter a title before saving.";
      error.hidden = false;
      $("project-title").focus();
      return;
    }
    error.hidden = true;
    state.project.title = state.project.title.trim();
    state.project.description = state.project.description.trim();
    state.project.saved = true;
    persist();
    renderProject();
  });

  $("project-edit").addEventListener("click", () => {
    state.project.saved = false;
    persist();
    renderProject();
    $("project-title").focus();
  });
}

// ---------- Shared: document viewer + list ----------

function renderViewer(viewer, doc, emptyText) {
  if (!doc) {
    viewer.replaceChildren(el("p", { class: "placeholder" }, emptyText));
    return;
  }
  viewer.innerHTML = markdownToHtml(doc.content);
  const meta = el(
    "p",
    { class: "doc-meta" },
    `${doc.name}${doc.agent ? ` · by ${doc.agent}` : ""} · ${doc.words.toLocaleString()} words` +
      (doc.kind === "script" ? ` · about ${formatDuration((doc.words / WORDS_PER_MINUTE) * 60)} spoken` : "") +
      ` · ${formatDate(doc.createdAt)}`,
  );
  const firstHeading = viewer.querySelector("h2");
  if (firstHeading) firstHeading.after(meta);
  else viewer.prepend(meta);
  viewer.scrollTop = 0;
}

function renderDocList(list, docs, activeId, { onOpen, onDelete, emptyText }) {
  if (!docs.length) {
    list.replaceChildren(el("li", { class: "empty" }, emptyText));
    return;
  }
  list.replaceChildren(
    ...[...docs].reverse().map((doc) =>
      el(
        "li",
        { class: `doc-item${doc.id === activeId ? " active" : ""}` },
        el(
          "button",
          { type: "button", class: "doc-open", onclick: () => onOpen(doc), "aria-current": doc.id === activeId ? "true" : null },
          el("strong", {}, doc.name),
          el("span", {}, `${doc.agent ? `by ${doc.agent} · ` : ""}${doc.words.toLocaleString()} words · ${formatDate(doc.createdAt)}`),
        ),
        el(
          "div",
          { class: "doc-actions" },
          ...["docx", "txt", "md"].map((fmt) =>
            el(
              "button",
              { type: "button", class: "btn btn-secondary btn-small", title: `Download ${doc.name}.${fmt}`, onclick: () => downloadDoc(doc, fmt) },
              `.${fmt}`,
            ),
          ),
          el("button", { type: "button", class: "icon-btn", title: `Delete ${doc.name}`, "aria-label": `Delete ${doc.name}`, onclick: () => onDelete(doc) }, "×"),
        ),
      ),
    ),
  );
}

const pendingDeletes = new Set();
function confirmDelete(doc, remove) {
  // Two-step delete: first click arms it, second click within 4s removes.
  if (pendingDeletes.has(doc.id)) {
    pendingDeletes.delete(doc.id);
    remove();
    toast(`Deleted ${doc.name}`);
    return;
  }
  pendingDeletes.add(doc.id);
  toast(`Click × again to delete ${doc.name}`);
  setTimeout(() => pendingDeletes.delete(doc.id), 4000);
}

// ---------- 2) Research ----------

let researchBusy = false;

function renderResearch() {
  const r = state.research;
  $("research-keyword").value = r.keyword;
  const active = r.docs.find((d) => d.id === r.activeId) || r.docs[r.docs.length - 1];
  renderViewer($("research-viewer"), active, "Research documents will appear here.");
  renderDocList($("research-list"), r.docs, active?.id, {
    emptyText: "No research documents yet.",
    onOpen: (doc) => {
      r.activeId = doc.id;
      persist();
      renderResearch();
    },
    onDelete: (doc) =>
      confirmDelete(doc, () => {
        r.docs = r.docs.filter((d) => d.id !== doc.id);
        state.scripts.selectedIds = state.scripts.selectedIds.filter((id) => id !== doc.id);
        if (r.activeId === doc.id) r.activeId = null;
        persist();
        renderResearch();
        renderScriptSources();
      }),
  });
}

function initResearch() {
  $("research-keyword").addEventListener("input", (e) => {
    state.research.keyword = e.target.value;
    persist();
  });

  $("research-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (researchBusy) return;
    const status = $("research-status");
    const keyword = $("research-keyword").value.trim();
    if (!keyword) {
      setStatus(status, "Enter a keyword to research.", { error: true });
      $("research-keyword").focus();
      return;
    }

    researchBusy = true;
    $("research-btn").disabled = true;
    setStatus(status, `Researching “${keyword}”… this usually takes 1–3 minutes.`, { busy: true });
    try {
      const res = await postJson("/api/research", { keyword, project: state.project });
      const data = await res.json();
      const r = state.research;
      const doc = {
        id: newId(),
        kind: "research",
        subject: keyword,
        name: uniqueName(`research_${slug(keyword)}`, r.docs),
        content: data.content,
        words: data.words ?? countWords(data.content),
        sources: data.sources ?? [],
        createdAt: new Date().toISOString(),
      };
      r.docs.push(doc);
      r.activeId = doc.id;
      if (!state.scripts.selectedIds.includes(doc.id)) state.scripts.selectedIds.push(doc.id);
      persist();
      renderResearch();
      renderScriptSources();
      setStatus(status, `Done: ${doc.name} (${doc.words.toLocaleString()} words).`);
    } catch (err) {
      setStatus(status, err.message, { error: true });
    } finally {
      researchBusy = false;
      $("research-btn").disabled = false;
    }
  });
}

// ---------- 3) Scripting ----------

let scriptBusy = false;

function renderScriptSources() {
  const docs = state.research.docs;
  const s = state.scripts;
  s.selectedIds = s.selectedIds.filter((id) => docs.some((d) => d.id === id));
  $("script-select-row").hidden = docs.length < 2;
  if (!docs.length) {
    $("script-sources").replaceChildren(el("li", { class: "empty" }, "Generate a research document first."));
    return;
  }
  $("script-sources").replaceChildren(
    ...docs.map((doc) =>
      el(
        "li",
        {},
        el(
          "label",
          {},
          el("input", {
            type: "checkbox",
            value: doc.id,
            checked: s.selectedIds.includes(doc.id),
            onchange: (e) => {
              s.selectedIds = e.target.checked
                ? [...new Set([...s.selectedIds, doc.id])]
                : s.selectedIds.filter((id) => id !== doc.id);
              persist();
            },
          }),
          el("span", {}, doc.name),
        ),
      ),
    ),
  );
}

function scriptLength() {
  const minutes = Math.max(0, Math.floor(Number(state.scripts.minutes) || 0));
  const seconds = Math.max(0, Math.min(59, Math.floor(Number(state.scripts.seconds) || 0)));
  return { minutes, seconds, total: minutes * 60 + seconds };
}

function renderEstimate() {
  const { total } = scriptLength();
  $("script-estimate").textContent = total
    ? `About ${Math.round((total / 60) * WORDS_PER_MINUTE).toLocaleString()} words of narration at ${WORDS_PER_MINUTE} words per minute.`
    : "Enter how long the narration should run.";
}

function renderScripts() {
  const s = state.scripts;
  $("script-minutes").value = s.minutes;
  $("script-seconds").value = s.seconds;
  renderEstimate();
  renderScriptSources();
  const active = s.docs.find((d) => d.id === s.activeId) || s.docs[s.docs.length - 1];
  renderViewer($("script-viewer"), active, "Scripts will appear here.");
  renderDocList($("script-list"), s.docs, active?.id, {
    emptyText: "No scripts yet.",
    onOpen: (doc) => {
      s.activeId = doc.id;
      persist();
      renderScripts();
    },
    onDelete: (doc) =>
      confirmDelete(doc, () => {
        s.docs = s.docs.filter((d) => d.id !== doc.id);
        if (s.activeId === doc.id) s.activeId = null;
        persist();
        renderScripts();
      }),
  });
}

function initScripting() {
  for (const [id, key] of [["script-minutes", "minutes"], ["script-seconds", "seconds"]]) {
    $(id).addEventListener("input", (e) => {
      state.scripts[key] = e.target.value === "" ? "" : Number(e.target.value);
      persist();
      renderEstimate();
    });
  }

  $("script-select-row").addEventListener("click", (e) => {
    const mode = e.target.dataset.select;
    if (!mode) return;
    state.scripts.selectedIds = mode === "all" ? state.research.docs.map((d) => d.id) : [];
    persist();
    renderScriptSources();
  });

  $("script-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (scriptBusy) return;
    const status = $("script-status");
    const s = state.scripts;
    const chosen = state.research.docs.filter((d) => s.selectedIds.includes(d.id));
    const { minutes, seconds, total } = scriptLength();
    if (!chosen.length) {
      setStatus(status, "Choose at least one research document.", { error: true });
      return;
    }
    if (total < 10) {
      setStatus(status, "Script length must be at least 10 seconds.", { error: true });
      return;
    }

    scriptBusy = true;
    $("script-btn").disabled = true;
    setStatus(status, `Writing a ${formatDuration(total)} script from ${chosen.length} document${chosen.length > 1 ? "s" : ""}…`, { busy: true });
    try {
      const res = await postJson("/api/script", {
        project: state.project,
        minutes,
        seconds,
        documents: chosen.map((d) => ({ name: d.name, content: d.content })),
      });
      const data = await res.json();
      const subject = state.project.title.trim() || chosen[0].subject;
      const doc = {
        id: newId(),
        kind: "script",
        subject,
        name: uniqueName(`script_${slug(subject)}`, s.docs),
        content: data.content,
        words: data.words ?? countWords(data.content),
        targetSeconds: total,
        sourceIds: chosen.map((d) => d.id),
        createdAt: new Date().toISOString(),
      };
      s.docs.push(doc);
      s.activeId = doc.id;
      persist();
      renderScripts();
      setStatus(status, `Done: ${doc.name} (${doc.words.toLocaleString()} words, about ${formatDuration((doc.words / WORDS_PER_MINUTE) * 60)}).`);
    } catch (err) {
      setStatus(status, err.message, { error: true });
    } finally {
      scriptBusy = false;
      $("script-btn").disabled = false;
    }
  });
}

// ---------- Agent team ----------

const TEAM = [
  { key: "jayen", name: "Jayen", engine: "Claude", role: "Orchestrator" },
  { key: "dj", name: "DJ", engine: "Antigravity", role: "Research" },
  { key: "mimi", name: "Mimi", engine: "Microsoft Copilot", role: "Research" },
  { key: "jordan", name: "Jordan", engine: "Microsoft Copilot", role: "Scripting" },
];
const COPILOT_URL = "https://copilot.microsoft.com/";
// Copilot rejects very long messages; above this the research is attached as files instead.
const COPILOT_PROMPT_LIMIT = 10000;

const agentsBusy = new Set();
let cliStatus = {};

const newRun = (subject, minutes, seconds) => ({
  id: newId(),
  subject,
  minutes,
  seconds,
  startedAt: new Date().toISOString(),
  plan: null,
  steps: {
    plan: { status: "idle" },
    dj: { status: "idle" },
    mimi: { status: "idle", draft: "" },
    jordan: { status: "idle", draft: "", attach: false, revision: "" },
    review: { status: "idle" },
  },
});

const currentRun = (runId) => (state.agents.run?.id === runId ? state.agents.run : null);

function addResearchDoc({ subject, agent, content, words }) {
  const r = state.research;
  const doc = {
    id: newId(),
    kind: "research",
    subject,
    agent,
    name: uniqueName(`research_${slug(subject)}_${agent.toLowerCase()}`, r.docs),
    content,
    words: words ?? countWords(content),
    sources: [],
    createdAt: new Date().toISOString(),
  };
  r.docs.push(doc);
  r.activeId = doc.id;
  if (!state.scripts.selectedIds.includes(doc.id)) state.scripts.selectedIds.push(doc.id);
  return doc;
}

const researchDocsFor = (run) =>
  [run.steps.dj.docId, run.steps.mimi.docId]
    .map((id) => state.research.docs.find((d) => d.id === id))
    .filter(Boolean);

// Runs one automatic step (Jayen or DJ) and records its outcome on the run.
// `work` returns a callback that applies the result to the run if it's still the current one.
async function runStep(runId, stepKey, work) {
  const run = currentRun(runId);
  if (!run) return;
  run.steps[stepKey] = { ...run.steps[stepKey], status: "working", error: "" };
  agentsBusy.add(stepKey);
  persist();
  renderAgents();
  let apply;
  try {
    apply = await work(run);
    const live = currentRun(runId);
    if (live) {
      live.steps[stepKey].status = "done";
      apply?.(live);
    }
  } catch (err) {
    const live = currentRun(runId);
    if (live) Object.assign(live.steps[stepKey], { status: "error", error: err.message });
  } finally {
    agentsBusy.delete(stepKey);
    persist();
    renderAll();
  }
}

function startRun() {
  const subject = $("run-subject").value.trim();
  const minutes = Math.max(0, Math.floor(Number(state.agents.minutes) || 0));
  const seconds = Math.max(0, Math.min(59, Math.floor(Number(state.agents.seconds) || 0)));
  const status = $("run-status");
  if (!subject) {
    setStatus(status, "Enter a subject for the team.", { error: true });
    $("run-subject").focus();
    return;
  }
  if (minutes * 60 + seconds < 10) {
    setStatus(status, "Script length must be at least 10 seconds.", { error: true });
    return;
  }
  setStatus(status, "");
  const run = newRun(subject, minutes, seconds);
  state.agents.run = run;
  planStep(run.id);
}

function planStep(runId) {
  return runStep(runId, "plan", async (run) => {
    const res = await postJson("/api/agents/plan", {
      subject: run.subject,
      project: state.project,
      minutes: run.minutes,
      seconds: run.seconds,
    });
    const plan = await res.json();
    return (live) => {
      live.plan = plan;
      // Hand out the research: DJ starts automatically; Mimi waits for the user to relay the prompt.
      setTimeout(() => {
        djStep(live.id);
        prepareMimi(live.id);
      });
    };
  });
}

function djStep(runId) {
  return runStep(runId, "dj", async (run) => {
    const res = await postJson("/api/agents/dj", { subject: run.subject, project: state.project, plan: run.plan });
    const data = await res.json();
    return (live) => {
      live.steps.dj.docId = addResearchDoc({ subject: live.subject, agent: "DJ", ...data }).id;
      setTimeout(() => prepareJordan(live.id));
    };
  });
}

async function prepareMimi(runId) {
  const run = currentRun(runId);
  if (!run) return;
  try {
    const res = await postJson("/api/agents/prompt/mimi", { subject: run.subject, project: state.project, plan: run.plan });
    const { prompt } = await res.json();
    const live = currentRun(runId);
    if (!live) return;
    Object.assign(live.steps.mimi, { status: "waiting", prompt, error: "" });
  } catch (err) {
    const live = currentRun(runId);
    if (live) Object.assign(live.steps.mimi, { status: "error", error: err.message });
  }
  persist();
  renderAgents();
}

const settled = (step) => step.status === "done" || step.status === "skipped";

async function prepareJordan(runId, { attach } = {}) {
  const run = currentRun(runId);
  if (!run) return;
  const { dj, mimi, jordan } = run.steps;
  if (!settled(dj) || !settled(mimi) || jordan.status === "done") return;
  const documents = researchDocsFor(run);
  if (!documents.length) {
    Object.assign(jordan, { status: "blocked", error: "There's no research for Jordan to work from: both research steps were skipped or their documents deleted." });
    persist();
    renderAgents();
    return;
  }
  const body = {
    subject: run.subject,
    project: state.project,
    plan: run.plan,
    minutes: run.minutes,
    seconds: run.seconds,
    documents: documents.map((d) => ({ name: d.name, content: d.content })),
  };
  const fetchPrompt = async (asFiles) =>
    (await (await postJson("/api/agents/prompt/jordan", { ...body, attach: asFiles })).json()).prompt;
  try {
    // First time round, pick attach mode automatically when the inline prompt is too long for Copilot.
    let useAttach = Boolean(attach);
    let prompt = await fetchPrompt(useAttach);
    if (attach === undefined && prompt.length > COPILOT_PROMPT_LIMIT) {
      useAttach = true;
      prompt = await fetchPrompt(true);
    }
    const live = currentRun(runId);
    if (!live) return;
    Object.assign(live.steps.jordan, { status: "waiting", prompt, attach: useAttach, revision: "", error: "" });
  } catch (err) {
    const live = currentRun(runId);
    if (live) Object.assign(live.steps.jordan, { status: "error", error: err.message });
  }
  persist();
  renderAgents();
}

async function submitRelay(runId, stepKey) {
  const run = currentRun(runId);
  if (!run) return;
  try {
    const data = await (await postJson("/api/agents/relay", { text: run.steps[stepKey].draft || "" })).json();
    const live = currentRun(runId);
    if (!live) return;
    if (stepKey === "mimi") {
      const doc = addResearchDoc({ subject: live.subject, agent: "Mimi", ...data });
      live.steps.mimi = { ...live.steps.mimi, status: "done", draft: "", docId: doc.id };
      persist();
      renderAll();
      await prepareJordan(runId);
      return;
    }
    const s = state.scripts;
    const subject = state.project.title.trim() || live.subject;
    const doc = {
      id: newId(),
      kind: "script",
      subject,
      agent: "Jordan",
      name: uniqueName(`script_${slug(subject)}`, s.docs),
      content: data.content,
      words: data.words ?? countWords(data.content),
      targetSeconds: live.minutes * 60 + live.seconds,
      sourceIds: researchDocsFor(live).map((d) => d.id),
      createdAt: new Date().toISOString(),
    };
    s.docs.push(doc);
    s.activeId = doc.id;
    live.steps.jordan = { ...live.steps.jordan, status: "done", draft: "", docId: doc.id };
    persist();
    renderAll();
    await reviewStep(runId);
  } catch (err) {
    toast(err.message, true);
  }
}

function reviewStep(runId) {
  return runStep(runId, "review", async (run) => {
    const script = state.scripts.docs.find((d) => d.id === run.steps.jordan.docId);
    if (!script) throw new Error("Jordan's script was deleted from the Scripting list, so there's nothing to review.");
    const res = await postJson("/api/agents/review", {
      subject: run.subject,
      plan: run.plan,
      minutes: run.minutes,
      seconds: run.seconds,
      script: script.content,
      documents: researchDocsFor(run).map((d) => ({ name: d.name, content: d.content })),
    });
    const data = await res.json();
    return (live) => {
      live.steps.review.content = data.content;
    };
  });
}

function revisionRequest(review) {
  const m = String(review || "").match(/##\s*Revision request for Jordan\s*\n([\s\S]*?)(?=\n##\s|$)/i);
  const text = m?.[1]?.trim();
  return text && !/^none needed\.?$/i.test(text) ? text : "";
}

function askForRevision(runId) {
  const run = currentRun(runId);
  if (!run) return;
  const request = revisionRequest(run.steps.review.content);
  const prompt = `Jayen, the producer, reviewed your script and asks for these changes:\n\n${request}\n\nReply with the complete revised script in the same format as before: a "# " title, "## " section headings and only the words to be spoken. No preamble or closing remarks.`;
  run.steps.jordan = { ...run.steps.jordan, status: "waiting", prompt, revision: request, draft: "" };
  run.steps.review = { status: "idle" };
  persist();
  renderAgents();
}

function skipStep(runId, stepKey) {
  const run = currentRun(runId);
  if (!run) return;
  run.steps[stepKey] = { ...run.steps[stepKey], status: "skipped", error: "" };
  persist();
  renderAgents();
  prepareJordan(runId);
}

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${what}. Paste it into Copilot.`);
  } catch {
    toast("Couldn't copy automatically. Select the prompt text and copy it instead.", true);
  }
}

// ----- Rendering -----

const STATUS_LABELS = {
  idle: "Standing by",
  working: "Working",
  waiting: "Your turn",
  done: "Done",
  skipped: "Skipped",
  error: "Needs attention",
  blocked: "Blocked",
};

function agentStatus(key, run) {
  if (!run) return { status: "idle", text: "Ready when you are." };
  const { plan, review } = run.steps;
  if (key === "jayen") {
    if (plan.status === "working") return { status: "working", text: "Planning the video and splitting the research." };
    if (plan.status === "error") return { status: "error", text: plan.error };
    if (review.status === "working") return { status: "working", text: "Reviewing Jordan's script." };
    if (review.status === "error") return { status: "error", text: review.error };
    if (review.status === "done") return { status: "done", text: "Reviewed the script." };
    return { status: "done", text: "Plan handed out. Watching the team." };
  }
  const step = run.steps[key];
  if (step.status === "error" || step.status === "blocked") return { status: step.status, text: step.error };
  if (step.status === "skipped") return { status: "skipped", text: "Skipped for this run." };
  if (key === "dj") {
    if (step.status === "working") return { status: "working", text: `Researching ${run.plan?.dj?.focus ?? "the subject"} with Google Search.` };
    if (step.status === "done") return { status: "done", text: "Research brief delivered." };
  }
  if (key === "mimi") {
    if (step.status === "waiting") return { status: "waiting", text: "Copy Mimi's prompt into Copilot and paste the reply." };
    if (step.status === "done") return { status: "done", text: "Research brief delivered." };
  }
  if (key === "jordan") {
    if (step.status === "waiting")
      return { status: "waiting", text: step.revision ? "Send Jayen's revision request in Copilot." : "Copy Jordan's prompt into Copilot and paste the script." };
    if (step.status === "done") return { status: "done", text: "Script delivered." };
    if (plan.status === "done") return { status: "idle", text: "Waiting for DJ and Mimi's research." };
  }
  return { status: "idle", text: plan.status === "done" ? "Getting ready." : "Waiting for Jayen's plan." };
}

function renderTeam() {
  const run = state.agents.run;
  $("team").replaceChildren(
    ...TEAM.map((agent) => {
      const { status, text } = agentStatus(agent.key, run);
      const cli = cliStatus[agent.key];
      const where = agent.key === "jayen" || agent.key === "dj" ? "on this PC" : "copy and paste";
      const missing = cli && !cli.installed;
      return el(
        "li",
        { class: `agent-card is-${status}` },
        el("span", { class: `avatar avatar-${agent.key}`, "aria-hidden": "true" }, agent.name[0]),
        el(
          "div",
          { class: "agent-body" },
          el("div", { class: "agent-head" }, el("strong", { class: "agent-name" }, agent.name), el("span", { class: `pill pill-${missing ? "error" : status}` }, missing ? "Not installed" : STATUS_LABELS[status])),
          el("span", { class: "agent-role" }, `${agent.role} · ${agent.engine}, ${where}`),
          el("span", { class: "agent-text" }, missing ? `The ${agent.key === "jayen" ? "claude" : "agy"} command wasn't found on this PC.` : text),
        ),
      );
    }),
  );
}

function stepShell(title, who, status, ...body) {
  return el(
    "li",
    { class: `run-step is-${status}` },
    el(
      "div",
      { class: "run-step-head" },
      el("h3", {}, title),
      el("span", { class: "run-step-who" }, who),
      el("span", { class: `pill pill-${status}` }, STATUS_LABELS[status]),
    ),
    ...body,
  );
}

const button = (label, onclick, cls = "btn btn-secondary btn-small") => el("button", { type: "button", class: cls, onclick }, label);
const actions = (...children) => el("div", { class: "button-row relay-actions" }, ...children);
const working = (text) => el("p", { class: "status" }, el("span", { class: "spinner", "aria-hidden": "true" }), text);
const failed = (text) => el("p", { class: "status error" }, text);

function openDocLink(doc) {
  return button(
    `Open ${doc.name}`,
    () => {
      const isScript = doc.kind === "script";
      (isScript ? state.scripts : state.research).activeId = doc.id;
      persist();
      isScript ? renderScripts() : renderResearch();
      $(isScript ? "scripting" : "research").scrollIntoView({ behavior: "smooth" });
    },
    "link-btn",
  );
}

function relayBox(run, stepKey, { copyLabel, pasteLabel, submitLabel, extra = [] }) {
  const step = run.steps[stepKey];
  return el(
    "div",
    { class: "relay stack" },
    el("label", { for: `${stepKey}-prompt` }, "Prompt for Copilot"),
    el("textarea", { id: `${stepKey}-prompt`, class: "relay-prompt", rows: 6, readonly: true }, step.prompt || ""),
    actions(
      button(copyLabel, () => copyText(step.prompt || "", "the prompt"), "btn btn-primary btn-small"),
      el("a", { class: "btn btn-secondary btn-small", href: COPILOT_URL, target: "_blank", rel: "noopener" }, "Open Copilot"),
      ...extra,
    ),
    el("label", { for: `${stepKey}-paste` }, pasteLabel),
    el(
      "textarea",
      {
        id: `${stepKey}-paste`,
        rows: 6,
        placeholder: "Paste Copilot's whole reply here.",
        oninput: (e) => {
          const live = currentRun(run.id);
          if (!live) return;
          live.steps[stepKey].draft = e.target.value;
          persist();
        },
      },
      step.draft || "",
    ),
    actions(button(submitLabel, () => submitRelay(run.id, stepKey), "btn btn-primary btn-small")),
  );
}

function renderRunBoard() {
  const run = state.agents.run;
  const board = $("run-board");
  $("run-btn").textContent = run ? "Start a new run" : "Start run";
  if (!run) {
    board.replaceChildren(el("li", { class: "placeholder" }, "Enter a subject and press Start run. Jayen will plan the work and hand it to the team."));
    return;
  }
  const { plan, dj, mimi, jordan, review } = run.steps;
  const steps = [];

  // 1. Jayen plans
  const planBody = [];
  if (plan.status === "working") planBody.push(working("Planning the video. This usually takes under a minute."));
  if (plan.status === "error") planBody.push(failed(plan.error), actions(button("Try again", () => planStep(run.id))));
  if (run.plan) {
    const p = run.plan;
    planBody.push(
      el("p", { class: "justify" }, p.summary || ""),
      el(
        "dl",
        { class: "plan-list" },
        el("dt", {}, "DJ researches"),
        el("dd", {}, p.dj.focus),
        el("dt", {}, "Mimi researches"),
        el("dd", {}, p.mimi.focus),
        el("dt", {}, "Jordan's angle"),
        el("dd", {}, p.jordan?.angle || "—"),
        el("dt", {}, "Audience and tone"),
        el("dd", {}, [p.jordan?.audience, p.jordan?.tone].filter(Boolean).join(" · ") || "—"),
      ),
    );
  }
  steps.push(stepShell(`1. Plan: “${run.subject}”, ${formatDuration(run.minutes * 60 + run.seconds)}`, "Jayen · Claude", plan.status, ...planBody));

  if (plan.status === "done") {
    // 2. DJ researches (automatic)
    const djDoc = state.research.docs.find((d) => d.id === dj.docId);
    const djBody = [];
    if (dj.status === "working") djBody.push(working("Searching and writing. This usually takes 2–6 minutes."));
    if (dj.status === "error") djBody.push(failed(dj.error), actions(button("Try again", () => djStep(run.id)), button("Skip DJ", () => skipStep(run.id, "dj"))));
    if (djDoc) djBody.push(el("p", {}, `${djDoc.words.toLocaleString()} words. `, openDocLink(djDoc)));
    steps.push(stepShell("2. Research", "DJ · Antigravity", dj.status, ...djBody));

    // 3. Mimi researches (relay through Copilot)
    const mimiDoc = state.research.docs.find((d) => d.id === mimi.docId);
    const mimiBody = [];
    if (mimi.status === "waiting")
      mimiBody.push(
        relayBox(run, "mimi", {
          copyLabel: "Copy Mimi's prompt",
          pasteLabel: "Mimi's research (Copilot's reply)",
          submitLabel: "Save Mimi's research",
          extra: [button("Skip Mimi", () => skipStep(run.id, "mimi"))],
        }),
      );
    if (mimi.status === "error") mimiBody.push(failed(mimi.error), actions(button("Try again", () => prepareMimi(run.id))));
    if (mimiDoc) mimiBody.push(el("p", {}, `${mimiDoc.words.toLocaleString()} words. `, openDocLink(mimiDoc)));
    steps.push(stepShell("3. Research", "Mimi · Copilot", mimi.status, ...mimiBody));

    // 4. Jordan writes (relay through Copilot)
    const jordanDoc = state.scripts.docs.find((d) => d.id === jordan.docId);
    const jordanBody = [];
    if (jordan.status === "idle") jordanBody.push(el("p", { class: "hint" }, "Opens once DJ and Mimi have both delivered (or been skipped)."));
    if (jordan.status === "blocked") jordanBody.push(failed(jordan.error));
    if (jordan.status === "error") jordanBody.push(failed(jordan.error), actions(button("Try again", () => prepareJordan(run.id))));
    if (jordan.status === "waiting") {
      const extra = [];
      if (jordan.revision) {
        jordanBody.push(el("p", { class: "hint justify" }, "Paste this into the same Copilot chat where Jordan wrote the script, so Jordan has the original to work from."));
      } else {
        extra.push(
          el(
            "label",
            { class: "inline-check" },
            el("input", { type: "checkbox", checked: jordan.attach, onchange: (e) => prepareJordan(run.id, { attach: e.target.checked }) }),
            el("span", {}, "Attach research as files"),
          ),
        );
        if (jordan.attach) {
          extra.push(button("Download research files", () => researchDocsFor(run).forEach((d) => downloadDoc(d, "txt"))));
          jordanBody.push(
            el("p", { class: "hint justify" }, "The research is too long for one Copilot message, so it goes as files. Download them, attach them in Copilot, then paste the prompt."),
          );
        }
      }
      jordanBody.push(
        relayBox(run, "jordan", {
          copyLabel: jordan.revision ? "Copy revision request" : "Copy Jordan's prompt",
          pasteLabel: "Jordan's script (Copilot's reply)",
          submitLabel: "Save Jordan's script",
          extra,
        }),
      );
    }
    if (jordanDoc && jordan.status === "done")
      jordanBody.push(el("p", {}, `${jordanDoc.words.toLocaleString()} words, about ${formatDuration((jordanDoc.words / WORDS_PER_MINUTE) * 60)} spoken. `, openDocLink(jordanDoc)));
    steps.push(stepShell("4. Script", "Jordan · Copilot", jordan.status, ...jordanBody));

    // 5. Jayen reviews (automatic)
    if (review.status !== "idle") {
      const reviewBody = [];
      if (review.status === "working") reviewBody.push(working("Checking length, facts and flow."));
      if (review.status === "error") reviewBody.push(failed(review.error), actions(button("Try again", () => reviewStep(run.id))));
      if (review.status === "done") {
        const article = el("article", { class: "review" });
        article.innerHTML = markdownToHtml(review.content);
        reviewBody.push(article);
        if (revisionRequest(review.content))
          reviewBody.push(actions(button("Send revisions to Jordan", () => askForRevision(run.id), "btn btn-primary btn-small")));
      }
      steps.push(stepShell("5. Review", "Jayen · Claude", review.status, ...reviewBody));
    }
  }
  board.replaceChildren(...steps);
}

function renderAgents() {
  const a = state.agents;
  $("run-subject").value = a.subject;
  $("run-minutes").value = a.minutes;
  $("run-seconds").value = a.seconds;
  $("run-btn").disabled = agentsBusy.size > 0;
  // Rebuilding the board would drop the cursor out of a paste box the user is typing in; put it back.
  const active = document.activeElement;
  const typingIn = active?.tagName === "TEXTAREA" && active.closest("#run-board") ? active.id : null;
  const caret = typingIn ? [active.selectionStart, active.selectionEnd] : null;
  renderTeam();
  renderRunBoard();
  if (typingIn && $(typingIn)) {
    $(typingIn).focus();
    $(typingIn).setSelectionRange(...caret);
  }
}

function initAgents() {
  $("run-subject").addEventListener("input", (e) => {
    state.agents.subject = e.target.value;
    persist();
  });
  for (const [id, key] of [["run-minutes", "minutes"], ["run-seconds", "seconds"]]) {
    $(id).addEventListener("input", (e) => {
      state.agents[key] = e.target.value === "" ? "" : Number(e.target.value);
      persist();
    });
  }
  $("run-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!agentsBusy.size) startRun();
  });

  // A step that was still running when the page closed can't be resumed; offer a retry instead.
  const run = state.agents.run;
  if (run) {
    for (const step of Object.values(run.steps))
      if (step.status === "working") Object.assign(step, { status: "error", error: "Interrupted when the page was closed. Try again." });
    persist();
  }

  fetch("/api/agents/status")
    .then((res) => res.json())
    .then((data) => {
      cliStatus = data;
      renderTeam();
    })
    .catch(() => {});
}

// ---------- 4) Save project / clear ----------

function projectDetailsText() {
  const p = state.project;
  return [
    `Title: ${p.title || "(untitled)"}`,
    "",
    "Description:",
    p.description || "(none)",
    "",
    `Saved from vidTailor on ${new Date().toLocaleString()}`,
  ].join("\r\n");
}

function openSaveDialog() {
  const groups = [
    ["Research documents", state.research.docs],
    ["Scripts", state.scripts.docs],
  ];
  const choices = [
    el(
      "label",
      {},
      el("input", { type: "checkbox", value: "__details", checked: true }),
      el("span", {}, "Project details (project_details.txt)"),
    ),
  ];
  for (const [title, docs] of groups) {
    if (!docs.length) continue;
    choices.push(el("h3", {}, title));
    for (const doc of docs)
      choices.push(el("label", {}, el("input", { type: "checkbox", value: doc.id, checked: true }), el("span", {}, doc.name)));
  }
  $("save-choices").replaceChildren(...choices);
  $("save-error").hidden = true;
  $("save-download").disabled = false;
  $("save-dialog").showModal();
}

async function uniqueSubfolder(parent, name) {
  let candidate = name;
  for (let n = 2; ; n++) {
    try {
      await parent.getDirectoryHandle(candidate);
      candidate = `${name}_${n}`;
    } catch (err) {
      if (err.name === "NotFoundError") return parent.getDirectoryHandle(candidate, { create: true });
      throw err;
    }
  }
}

async function saveProject() {
  const checked = [...$("save-choices").querySelectorAll("input:checked")].map((i) => i.value);
  const error = $("save-error");
  if (!checked.length) {
    error.textContent = "Select at least one document.";
    error.hidden = false;
    return;
  }
  const format = $("save-format").value;
  const includeDetails = checked.includes("__details");
  const allDocs = [...state.research.docs, ...state.scripts.docs];
  const docs = allDocs.filter((d) => checked.includes(d.id));
  const date = new Date().toISOString().slice(0, 10);
  const folder = `vidTailor_${slug(state.project.title)}_${date}`;

  $("save-download").disabled = true;
  try {
    if ("showDirectoryPicker" in window) {
      let parent;
      try {
        parent = await window.showDirectoryPicker({ id: "vidtailor-save", mode: "readwrite", startIn: "documents" });
      } catch (err) {
        if (err.name === "AbortError") return; // user closed the folder picker
        throw err;
      }
      const dir = await uniqueSubfolder(parent, folder);
      const files = await Promise.all(docs.map(async (d) => ({ name: `${d.name}.${format}`, blob: await docBlob(d, format) })));
      if (includeDetails) files.push({ name: "project_details.txt", blob: new Blob([projectDetailsText()], { type: "text/plain" }) });
      for (const f of files) {
        const handle = await dir.getFileHandle(f.name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(f.blob);
        await writable.close();
      }
      $("save-dialog").close();
      toast(`Saved ${files.length} file${files.length > 1 ? "s" : ""} to the folder “${dir.name}”.`);
    } else {
      // Browsers without folder access (Firefox, Safari): one .zip containing the folder.
      const res = await postJson("/api/export/zip", {
        folder,
        format,
        files: docs.map((d) => ({ name: d.name, content: d.content })),
        extras: includeDetails ? [{ name: "project_details.txt", content: projectDetailsText() }] : [],
      });
      triggerDownload(await res.blob(), `${folder}.zip`);
      $("save-dialog").close();
      toast("Downloaded the project folder as a .zip file.");
    }
  } catch (err) {
    error.textContent = err.message || "Saving failed.";
    error.hidden = false;
  } finally {
    $("save-download").disabled = false;
  }
}

function initSave() {
  $("save-project-btn").addEventListener("click", openSaveDialog);
  $("save-cancel").addEventListener("click", () => $("save-dialog").close());
  $("save-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveProject();
  });
  $("save-dialog").addEventListener("click", (e) => {
    const mode = e.target.dataset.saveSelect;
    if (!mode) return;
    for (const box of $("save-choices").querySelectorAll("input")) box.checked = mode === "all";
  });

  $("clear-project-btn").addEventListener("click", () => {
    const dialog = $("confirm-dialog");
    dialog.returnValue = "";
    dialog.showModal();
  });
  $("confirm-dialog").addEventListener("close", (e) => {
    if (e.target.returnValue !== "confirm") return;
    state = defaultState();
    persist();
    renderAll();
    setStatus($("research-status"), "");
    setStatus($("script-status"), "");
    setStatus($("run-status"), "");
    window.scrollTo({ top: 0 });
    toast("Project page cleared.");
  });
}

// ---------- Boot ----------

function renderAll() {
  renderProject();
  renderAgents();
  renderResearch();
  renderScripts();
}

async function checkServer() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    $("api-banner").hidden = data.credentials;
  } catch {
    // Server unreachable: requests will report it when made.
  }
}

initMenu();
initProject();
initAgents();
initResearch();
initScripting();
initSave();
renderAll();
checkServer();

// Warn before leaving while a generation is still running (its result would be lost).
window.addEventListener("beforeunload", (e) => {
  if (researchBusy || scriptBusy || agentsBusy.size) e.preventDefault();
});
