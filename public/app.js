/* MedPrompt frontend. Framework-free; talks to the Worker over /api/*. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  guide: null,
  order: [],        // array of step ids in render order
  currentId: null,
  covered: new Set(),
  brand: null,      // chosen branch target id, if any
  transcript: "",
  recording: false,
  autoFollow: true, // AI advances the prompter; pauses briefly after manual nav
  hololens: false,  // headset focus mode
  railOpen: false,  // checklist overlay (HoloLens mode)
  lastCoachAt: 0,
};

/* Desktop records in ~20s segments and coaches each one. HoloLens records in
 * short segments so the "prompter …" voice grammar feels responsive, but the
 * coach is debounced so Workers AI spend doesn't balloon. */
const TIMING = {
  desktop:  { chunkMs: 20000, coachMs: 20000 },
  hololens: { chunkMs: 7000,  coachMs: 18000 },
};
const timing = () => (state.hololens ? TIMING.hololens : TIMING.desktop);

/* Voice grammar (HoloLens). Web Speech API does not work in Edge on the device,
 * so commands are parsed from the Whisper transcript instead. A "prompter"
 * prefix keeps ordinary clinical speech from triggering them. */
const VOICE = [
  { re: /\bprompter\s+(next|forward|go on)\b/, run: () => move(1) },
  { re: /\bprompter\s+(back|previous)\b/,       run: () => move(-1) },
  { re: /\bprompter\s+(steps|menu|checklist)\b/, run: () => toggleRail(true) },
  { re: /\bprompter\s+(close|hide)\b/,           run: () => toggleRail(false) },
  { re: /\bprompter\s+(stop|pause)\b/,           run: () => { if (state.recording) stopRecord(); } },
];

/* ============================ LIBRARY ============================ */

async function loadLibrary() {
  try {
    const health = await fetch("/api/health").then((r) => r.json());
    $("#health-hint").textContent = health.ai
      ? "Live coaching ready"
      : "Manual mode (Workers AI not bound)";
  } catch {
    /* ignore */
  }

  const grid = $("#guide-grid");
  try {
    const { guides } = await fetch("/api/guides").then((r) => r.json());
    grid.innerHTML = "";
    guides.forEach((g) => grid.appendChild(guideCard(g)));
  } catch {
    grid.innerHTML = '<p class="loading">Could not load guides.</p>';
  }
}

function guideCard(g) {
  const card = document.createElement("button");
  card.className = "guide-card";
  card.innerHTML = `
    <span class="gc-type">${esc(g.type)}</span>
    <h3 class="gc-title">${esc(g.title)}</h3>
    <p class="gc-summary">${esc(g.summary || "")}</p>
    <span class="gc-meta">${g.steps} steps<span class="gc-dot"></span>${
    g.builtin ? "built-in" : "generated"
  }</span>`;
  card.addEventListener("click", () => openGuide(g.id));
  return card;
}

async function generate() {
  const topic = $("#gen-topic").value.trim();
  const status = $("#gen-status");
  if (!topic) {
    status.textContent = "Describe the encounter first.";
    return;
  }
  status.className = "gen-status";
  status.textContent = "Drafting a guide…";
  $("#gen-go").disabled = true;
  try {
    const res = await fetch("/api/guides/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        topic,
        type: $("#gen-type").value,
        discipline: $("#gen-discipline").value.trim(),
        save: true,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.guide) throw new Error(data.error || "Failed");
    startEncounter(data.guide);
  } catch (err) {
    status.className = "gen-status err";
    status.textContent =
      "Couldn't generate that one — try rephrasing. (" + err.message + ")";
  } finally {
    $("#gen-go").disabled = false;
  }
}

/* ============================ ENCOUNTER ============================ */

async function openGuide(id) {
  const { guide } = await fetch("/api/guides/" + id).then((r) => r.json());
  startEncounter(guide);
}

function startEncounter(guide) {
  state.guide = guide;
  state.covered = new Set();
  state.brand = null;
  state.transcript = "";
  state.autoFollow = true;
  computeOrder();
  state.currentId = state.order[0] || null;

  $("#enc-type").textContent = (guide.type || "").toUpperCase();
  $("#enc-name").textContent = guide.title;

  // Red flags
  const rf = guide.redFlags || [];
  $("#redflags").classList.toggle("hidden", rf.length === 0);
  $("#redflags-list").innerHTML = rf.map((f) => `<li>${esc(f)}</li>`).join("");
  $("#transcript-text").textContent = "";

  show("encounter");
  render();
}

/* Build the visible step order, honouring the chosen branch (if any). */
function computeOrder() {
  const steps = state.guide.steps;
  const order = [];
  for (const s of steps) {
    if (s.branch) {
      order.push(s.id);
      // Insert only the chosen brand path; if none chosen yet, skip both.
      if (state.brand) {
        const target = steps.find((x) => x.id === state.brand);
        if (target) order.push(target.id);
      }
      continue;
    }
    // Brand-target steps are inserted above; don't duplicate them.
    const isBranchTarget = steps.some(
      (x) => x.branch && x.branch.options.some((o) => o.goto === s.id)
    );
    if (isBranchTarget) continue;
    order.push(s.id);
  }
  state.order = order;
}

function stepById(id) {
  return state.guide.steps.find((s) => s.id === id);
}

function render() {
  renderStage();
  renderRail();
  renderBranch();
  updateProgress();
  scrollToCurrent();
  if (window.MedPromptXR && window.MedPromptXR.sync) window.MedPromptXR.sync();
}

function renderStage() {
  const scroll = $("#stage-scroll");
  scroll.innerHTML = "";
  state.order.forEach((id, i) => {
    const s = stepById(id);
    if (!s) return;
    const el = document.createElement("article");
    el.className = "cue";
    el.dataset.id = id;
    const covered = state.covered.has(id);
    const isCurrent = id === state.currentId;
    el.classList.add(
      isCurrent ? "is-current" : indexOf(id) < indexOf(state.currentId) ? "is-past" : "is-upcoming"
    );
    if (covered) el.classList.add("is-covered");

    const detail = (s.detail || [])
      .map((d) => `<li>${esc(d)}</li>`)
      .join("");
    el.innerHTML = `
      <div class="cue-label">
        <span class="cue-num">${String(i + 1).padStart(2, "0")}</span>
        <span>${esc(s.label)}</span>
        ${covered ? '<span class="cue-check">✓</span>' : ""}
      </div>
      <p class="cue-text">${esc(s.cue)}</p>
      ${detail ? `<ul class="cue-detail">${detail}</ul>` : ""}`;
    el.addEventListener("click", () => goTo(id, true));
    scroll.appendChild(el);
  });
}

function renderRail() {
  const list = $("#checklist");
  list.innerHTML = "";
  state.order.forEach((id) => {
    const s = stepById(id);
    if (!s) return;
    const covered = state.covered.has(id);
    const current = id === state.currentId;
    const item = document.createElement("button");
    item.className =
      "cl-item" + (covered ? " covered" : "") + (current ? " current" : "");
    item.innerHTML = `
      <span class="cl-marker">${covered ? "✓" : ""}</span>
      <span class="cl-label">${esc(s.label)}</span>`;
    item.addEventListener("click", () => goTo(id, true));
    list.appendChild(item);
  });
}

function renderBranch() {
  const cur = stepById(state.currentId);
  const box = $("#branch-box");
  if (cur && cur.branch && !state.brand) {
    box.classList.remove("hidden");
    $("#branch-prompt").textContent = cur.branch.prompt;
    const opts = $("#branch-options");
    opts.innerHTML = "";
    cur.branch.options.forEach((o) => {
      const b = document.createElement("button");
      b.className = "btn btn-primary";
      b.textContent = o.label;
      b.addEventListener("click", () => chooseBranch(o.goto));
      opts.appendChild(b);
    });
  } else {
    box.classList.add("hidden");
  }
}

function chooseBranch(goto) {
  state.brand = goto;
  computeOrder();
  goTo(goto, true);
}

function updateProgress() {
  const total = state.order.length;
  const done = state.order.filter((id) => state.covered.has(id)).length;
  $("#prog-count").textContent = `${done} / ${total}`;
  const circ = 175.9;
  $("#ring-fg").style.strokeDashoffset = String(
    circ - (total ? done / total : 0) * circ
  );
}

function indexOf(id) {
  return state.order.indexOf(id);
}

function goTo(id, manual = false) {
  if (!state.order.includes(id)) return;
  state.currentId = id;
  if (manual) {
    // Pause auto-follow briefly so the AI doesn't yank the view back.
    state.autoFollow = false;
    clearTimeout(goTo._t);
    goTo._t = setTimeout(() => (state.autoFollow = true), 12000);
  }
  render();
}

function move(delta) {
  const i = indexOf(state.currentId);
  const next = state.order[i + delta];
  if (next) goTo(next, true);
}

function scrollToCurrent() {
  const el = $(`.cue[data-id="${cssEscape(state.currentId)}"]`);
  if (!el) return;
  const scroll = $("#stage-scroll");
  const target =
    el.offsetTop - scroll.clientHeight * 0.44 + el.clientHeight * 0.1;
  scroll.scrollTo({ top: target, behavior: "smooth" });
}

/* ---------------------- Recording + coaching ---------------------- */

let media = { stream: null, recorder: null, chunks: [], timer: null };

async function toggleRecord() {
  if (state.recording) return stopRecord();
  try {
    media.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    flashStatus("Microphone permission is needed to listen.");
    return;
  }
  state.recording = true;
  setMicUI(true);
  startSegment();
}

function startSegment() {
  if (!state.recording) return;
  media.chunks = [];
  const mime = pickMime();
  media.recorder = new MediaRecorder(
    media.stream,
    mime ? { mimeType: mime } : undefined
  );
  media.recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) media.chunks.push(e.data);
  };
  media.recorder.onstop = async () => {
    const blob = new Blob(media.chunks, {
      type: media.recorder.mimeType || "audio/webm",
    });
    media.chunks = [];
    if (state.recording) startSegment(); // immediately begin the next segment
    await processSegment(blob); // transcribe + coach on the just-finished one
  };
  media.recorder.start();
  media.timer = setTimeout(() => {
    if (media.recorder && media.recorder.state === "recording")
      media.recorder.stop();
  }, timing().chunkMs);
}

function stopRecord() {
  state.recording = false;
  setMicUI(false);
  clearTimeout(media.timer);
  if (media.recorder && media.recorder.state === "recording")
    media.recorder.stop();
  if (media.stream) media.stream.getTracks().forEach((t) => t.stop());
}

async function processSegment(blob) {
  if (!blob || !blob.size) return;
  let text = "";
  try {
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: blob, // audio is sent once and discarded; never stored
    });
    text = (await res.json()).text || "";
  } catch {
    return;
  }
  if (text) {
    state.transcript += (state.transcript ? " " : "") + text;
    const t = $("#transcript-text");
    t.textContent = state.transcript;
    t.scrollTop = t.scrollHeight;

    // Voice grammar runs on the fresh chunk only (responsive, low false-positives).
    if (state.hololens) handleVoice(text);

    // Coach is debounced so short HoloLens chunks don't multiply AI calls.
    const now = Date.now();
    if (now - state.lastCoachAt >= timing().coachMs) {
      state.lastCoachAt = now;
      await runCoach();
    }
  }
}

function handleVoice(chunk) {
  const text = chunk.toLowerCase();
  for (const cmd of VOICE) {
    if (cmd.re.test(text)) {
      cmd.run();
      flashStatus("Heard you");
      break;
    }
  }
}

async function runCoach() {
  const steps = state.order.map((id) => {
    const s = stepById(id);
    return {
      id: s.id,
      label: s.label,
      cue: s.cue,
      coverageHints: s.coverageHints || [],
    };
  });
  try {
    const res = await fetch("/api/coach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ steps, transcript: state.transcript }),
    });
    const { covered, next } = await res.json();
    (covered || []).forEach((id) => state.covered.add(id));
    if (state.autoFollow && next && state.order.includes(next)) {
      state.currentId = next;
    }
    render();
  } catch {
    /* keep going; manual control still works */
  }
}

/* ---------------------- UI helpers ---------------------- */

function setMicUI(on) {
  const pill = $("#mic-pill");
  pill.textContent = on ? "Listening" : "Mic off";
  pill.className = "pill " + (on ? "pill-live" : "pill-off");
  $("#record-btn").setAttribute("aria-pressed", String(on));
  $("#record-label").textContent = on ? "Stop listening" : "Start listening";
}

function flashStatus(msg) {
  const pill = $("#mic-pill");
  pill.textContent = msg;
  setTimeout(() => setMicUI(state.recording), 2600);
}

function pickMime() {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
}

function show(which) {
  $("#library").classList.toggle("hidden", which !== "library");
  $("#encounter").classList.toggle("hidden", which !== "encounter");
}

function backToLibrary() {
  if (state.recording) stopRecord();
  toggleRail(false);
  show("library");
}

/* ---- Display mode (Desktop vs HoloLens focus) ---- */

function setMode(mode) {
  state.hololens = mode === "hololens";
  document.body.classList.toggle("hololens", state.hololens);
  try { localStorage.setItem("medprompt-mode", mode); } catch {}
  $$(".mode-opt").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode)
  );
  if (!state.hololens) toggleRail(false);
}

function toggleRail(open) {
  state.railOpen = typeof open === "boolean" ? open : !state.railOpen;
  document.body.classList.toggle("rail-open", state.railOpen);
}

function detectMode() {
  let saved = null;
  try { saved = localStorage.getItem("medprompt-mode"); } catch {}
  if (saved) return saved;
  const ua = navigator.userAgent || "";
  // HoloLens Edge doesn't always self-identify; treat WebXR + Windows as a hint.
  if (/HoloLens|Windows Holographic/i.test(ua)) return "hololens";
  return "desktop";
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cssEscape = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);

/* ---------------------- Wiring ---------------------- */

$("#gen-go").addEventListener("click", generate);
$("#gen-topic").addEventListener("keydown", (e) => { if (e.key === "Enter") generate(); });
$("#back-btn").addEventListener("click", backToLibrary);
$("#prev-btn").addEventListener("click", () => move(-1));
$("#next-btn").addEventListener("click", () => move(1));
$("#record-btn").addEventListener("click", toggleRecord);
$("#rail-toggle").addEventListener("click", () => toggleRail());
$$(".mode-opt").forEach((b) =>
  b.addEventListener("click", () => setMode(b.dataset.mode))
);

document.addEventListener("keydown", (e) => {
  if ($("#encounter").classList.contains("hidden")) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
  else if (e.key === " ") { e.preventDefault(); move(1); }
  else if (e.key.toLowerCase() === "r") { e.preventDefault(); toggleRecord(); }
});

setMode(detectMode());
loadLibrary();

/* Engine interface for the immersive (WebXR) layer in xr.js. The XR renderer
 * reads state through these getters and drives navigation through the same
 * functions the 2D UI uses, so both views stay in lockstep. */
window.MedPromptEngine = {
  state,
  move,
  goTo,
  toggleRecord,
  chooseBranch,
  stepById,
  order: () => state.order,
  currentStep: () => stepById(state.currentId),
  isCovered: (id) => state.covered.has(id),
  branch: () => {
    const s = stepById(state.currentId);
    return s && s.branch && !state.brand ? s.branch : null;
  },
  progress: () => ({
    done: state.order.filter((id) => state.covered.has(id)).length,
    total: state.order.length,
  }),
  inEncounter: () => !$("#encounter").classList.contains("hidden"),
  recording: () => state.recording,
};
