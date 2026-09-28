import { countWords, markdownToHtml, markdownToPlain } from "./markdown.js";

const STORAGE_KEY = "vidtailor.state.v1";
const WORDS_PER_MINUTE = 150;

const $ = (id) => document.getElementById(id);

// ---------- State (persisted to localStorage on every change) ----------

const defaultState = () => ({
  project: { title: "", description: "", keywords: [], saved: false },
  research: { keyword: "", docs: [], activeId: null },
  scripts: { minutes: 5, seconds: 0, selectedIds: [], docs: [], activeId: null },
});

function loadState() {
  const base = defaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && typeof saved === "object") {
      return {
        project: { ...base.project, ...saved.project },
        research: { ...base.research, ...saved.research },
        scripts: { ...base.scripts, ...saved.scripts },
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

function addKeyword(raw) {
  const words = String(raw)
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
  let changed = false;
  for (const word of words) {
    if (!state.project.keywords.some((k) => k.toLowerCase() === word.toLowerCase())) {
      state.project.keywords.push(word);
      changed = true;
    }
  }
  if (changed) {
    persist();
    renderKeywords();
    renderSuggestions();
  }
}

function removeKeyword(index) {
  state.project.keywords.splice(index, 1);
  persist();
  renderKeywords();
  renderSuggestions();
}

function renderKeywords() {
  $("keyword-chips").replaceChildren(
    ...state.project.keywords.map((k, i) =>
      el(
        "li",
        { class: "chip" },
        k,
        el("button", { type: "button", class: "chip-remove", "aria-label": `Remove ${k}`, onclick: () => removeKeyword(i) }, "×"),
      ),
    ),
  );
}

function renderProject() {
  const p = state.project;
  $("project-form").hidden = p.saved;
  $("project-view").hidden = !p.saved;
  $("project-title").value = p.title;
  $("project-description").value = p.description;
  renderKeywords();
  $("view-title").textContent = p.title;
  $("view-description").textContent = p.description || "No description yet.";
  $("view-keywords").replaceChildren(...p.keywords.map((k) => el("li", { class: "chip" }, k)));
  $("view-keywords").hidden = !p.keywords.length;
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

  const kwInput = $("keyword-input");
  kwInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addKeyword(kwInput.value);
      kwInput.value = "";
    } else if (e.key === "Backspace" && !kwInput.value && state.project.keywords.length) {
      removeKeyword(state.project.keywords.length - 1);
    }
  });
  kwInput.addEventListener("blur", () => {
    if (kwInput.value.trim()) {
      addKeyword(kwInput.value);
      kwInput.value = "";
    }
  });
  $("keyword-box").addEventListener("click", (e) => {
    if (e.target.id === "keyword-box") kwInput.focus();
  });

  $("project-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (kwInput.value.trim()) {
      addKeyword(kwInput.value);
      kwInput.value = "";
    }
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
    `${doc.name} · ${doc.words.toLocaleString()} words` +
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
          el("span", {}, `${doc.words.toLocaleString()} words · ${formatDate(doc.createdAt)}`),
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

function renderSuggestions() {
  const keywords = state.project.keywords;
  $("research-suggestions").hidden = !keywords.length;
  $("suggestion-chips").replaceChildren(
    ...keywords.map((k) =>
      el(
        "li",
        {},
        el("button", {
          type: "button",
          class: "chip",
          onclick: () => {
            $("research-keyword").value = k;
            state.research.keyword = k;
            persist();
          },
        }, k),
      ),
    ),
  );
}

function renderResearch() {
  const r = state.research;
  $("research-keyword").value = r.keyword;
  renderSuggestions();
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

// ---------- 4) Save project / clear ----------

function projectDetailsText() {
  const p = state.project;
  return [
    `Title: ${p.title || "(untitled)"}`,
    "",
    "Description:",
    p.description || "(none)",
    "",
    `Keywords: ${p.keywords.join(", ") || "(none)"}`,
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
    window.scrollTo({ top: 0 });
    toast("Project page cleared.");
  });
}

// ---------- Boot ----------

function renderAll() {
  renderProject();
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
initResearch();
initScripting();
initSave();
renderAll();
checkServer();

// Warn before leaving while a generation is still running (its result would be lost).
window.addEventListener("beforeunload", (e) => {
  if (researchBusy || scriptBusy) e.preventDefault();
});
