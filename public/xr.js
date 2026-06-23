/* MedPrompt immersive layer (WebXR).
 *
 * Target-agnostic: requests immersive-ar, falls back to immersive-vr, and reads
 * session.environmentBlendMode at runtime so one renderer adapts to additive
 * displays (HoloLens: black = transparent) and alpha-blend / opaque displays
 * (Quest passthrough, visionOST, VR). It is a *renderer over the existing
 * engine* — all navigation goes through window.MedPromptEngine, so the 2D view,
 * the AI coach, and the hologram stay in lockstep.
 */

import * as THREE from "three";

const E = () => window.MedPromptEngine;

let renderer, scene, xrCam, group, session, refSpace;
let blendMode = "opaque";
let cue, steps; // panel objects
let buttonGroup, buttons = []; // interactive button meshes
let controllers = [];
let raycaster, hovered = null;
let stepsVisible = false;
let lastSig = ""; // change-detection signature so we only redraw on change

const DIST = 1.1; // metres in front
const RISE = 0.12; // metres up (teleprompter sits a little above eye line)

const v = new THREE.Vector3();
const fwd = new THREE.Vector3();
const up = new THREE.Vector3();
const q = new THREE.Quaternion();
const tmpMat = new THREE.Matrix4();

/* ----------------------------- setup ----------------------------- */

async function available() {
  if (!navigator.xr) return null;
  try {
    if (await navigator.xr.isSessionSupported("immersive-ar")) return "immersive-ar";
  } catch {}
  try {
    if (await navigator.xr.isSessionSupported("immersive-vr")) return "immersive-vr";
  } catch {}
  return null;
}

async function init() {
  const mode = await available();
  const btn = document.getElementById("xr-btn");
  if (!btn) return;
  if (!mode) {
    btn.style.display = "none";
    return;
  }
  btn.style.display = "";
  btn.textContent = mode === "immersive-ar" ? "Enter AR" : "Enter VR";
  btn.addEventListener("click", () => enter(mode));
}

async function enter(mode) {
  if (session) return;
  try {
    session = await navigator.xr.requestSession(mode, {
      optionalFeatures: ["local-floor", "hand-tracking"],
    });
  } catch (err) {
    console.warn("XR session failed", err);
    return;
  }
  blendMode = session.environmentBlendMode || "opaque";

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.autoClear = false;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");
  await renderer.xr.setSession(session);

  scene = new THREE.Scene();
  group = new THREE.Group();
  scene.add(group);

  buildPanels();
  setupControllers();
  raycaster = new THREE.Raycaster();

  lastSig = "";
  syncContent(true);

  session.addEventListener("end", onEnd);
  renderer.setAnimationLoop(onFrame);
}

function onEnd() {
  renderer.setAnimationLoop(null);
  controllers = [];
  buttons = [];
  if (renderer) renderer.dispose();
  renderer = scene = group = session = null;
}

/* --------------------------- panels ----------------------------- */

function makePanel(wPx, hPx, wM, hM) {
  const canvas = document.createElement("canvas");
  canvas.width = wPx;
  canvas.height = hPx;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), mat);
  return { canvas, ctx, texture, mesh };
}

function buildPanels() {
  cue = makePanel(1152, 666, 0.92, 0.53);
  group.add(cue.mesh);

  steps = makePanel(560, 666, 0.42, 0.5);
  steps.mesh.position.set(0.71, 0, 0);
  steps.mesh.visible = false;
  group.add(steps.mesh);

  buttonGroup = new THREE.Group();
  buttonGroup.position.set(0, -0.36, 0.001);
  group.add(buttonGroup);
}

/* --------------------------- theming ---------------------------- */

function theme() {
  const additive = blendMode === "additive";
  // Microsoft holographic guidance: keep a dark backplate with light (~R235)
  // text in BOTH blend modes. On additive displays it still secures legibility
  // and gives a dark edge border that reduces colour fringing during head
  // motion. White stays off-white and is used for strokes, never large fills.
  return {
    additive,
    panelBg: additive ? "rgba(8,16,20,0.92)" : "rgba(12,24,30,0.86)",
    text: "#EAF2EE",       // ~235 — bright but below pure white
    dim: "#9fb6ad",
    accent: "#1ec79c",     // teal/green: the efficient, low-fringe channel
    covered: "#5fc7a6",
    btnFill: additive ? "rgba(18,34,40,0.9)" : "rgba(22,44,54,0.92)",
    btnBorder: "#2fe0b0",
  };
}

/* --------------------------- drawing ---------------------------- */

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, x, y, maxW, lineH, max) {
  const words = String(text).split(/\s+/);
  let line = "";
  let lines = 0;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = w;
      y += lineH;
      if (++lines >= max - 1) break;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lineH;
}

function drawCue() {
  const t = theme();
  const { ctx, canvas, texture } = cue;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (t.panelBg) {
    ctx.fillStyle = t.panelBg;
    roundRect(ctx, 8, 8, W - 16, H - 16, 36);
    ctx.fill();
  }
  if (t.additive) {
    ctx.shadowColor = "rgba(30,199,156,0.55)";
    ctx.shadowBlur = 14;
  } else ctx.shadowBlur = 0;

  const eng = E();
  const step = eng.currentStep();
  const branch = eng.branch();
  const prog = eng.progress();
  const idx = eng.order().indexOf(eng.state.currentId) + 1;
  const padX = 64;

  // header
  ctx.shadowBlur = 0;
  ctx.textBaseline = "top";
  ctx.font = "500 30px 'IBM Plex Mono', monospace";
  ctx.fillStyle = t.accent;
  ctx.fillText(String(idx).padStart(2, "0"), padX, 56);
  ctx.fillStyle = t.dim;
  ctx.fillText((step?.label || "").toUpperCase(), padX + 70, 56);
  ctx.textAlign = "right";
  ctx.fillText(`${prog.done} / ${prog.total}`, W - padX, 56);
  ctx.textAlign = "left";

  // cue text
  if (t.additive) {
    ctx.shadowColor = "rgba(20,160,130,0.4)";
    ctx.shadowBlur = 8;
  }
  ctx.fillStyle = t.text;
  ctx.font = "600 60px Inter, system-ui, sans-serif";
  let y = wrap(ctx, step?.cue || "", padX, 150, W - padX * 2, 72, 4);

  // branch options prompt, or detail bullets
  ctx.shadowBlur = 0;
  if (branch) {
    ctx.fillStyle = t.accent;
    ctx.font = "600 32px Inter, system-ui, sans-serif";
    ctx.fillText(branch.prompt, padX, y + 16);
  } else if (step?.detail?.length) {
    ctx.fillStyle = t.dim;
    ctx.font = "500 32px Inter, system-ui, sans-serif";
    let dy = y + 24;
    for (const d of step.detail.slice(0, 3)) {
      ctx.fillStyle = t.accent;
      ctx.fillText("•", padX, dy);
      ctx.fillStyle = t.dim;
      dy = wrap(ctx, d, padX + 34, dy, W - padX * 2 - 34, 40, 2) + 6;
    }
  }
  texture.needsUpdate = true;
}

function drawSteps() {
  const t = theme();
  const { ctx, canvas, texture } = steps;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (t.panelBg) {
    ctx.fillStyle = t.panelBg;
    roundRect(ctx, 8, 8, W - 16, H - 16, 30);
    ctx.fill();
  }
  ctx.textBaseline = "top";
  ctx.font = "500 26px 'IBM Plex Mono', monospace";
  ctx.fillStyle = t.dim;
  ctx.fillText("STEPS", 44, 40);

  const eng = E();
  const order = eng.order();
  let y = 96;
  for (const id of order.slice(0, 13)) {
    const s = eng.stepById(id);
    const cov = eng.isCovered(id);
    const cur = id === eng.state.currentId;
    ctx.fillStyle = cov ? t.covered : cur ? t.accent : t.dim;
    ctx.font = "400 28px Inter, system-ui, sans-serif";
    ctx.fillText(cov ? "✓" : cur ? "▸" : "·", 44, y);
    ctx.fillStyle = cur ? t.text : t.dim;
    ctx.fillText((s?.label || "").slice(0, 28), 86, y);
    y += 42;
  }
  texture.needsUpdate = true;
}

/* --------------------------- buttons ---------------------------- */

function makeButton(label, fn, accent) {
  const p = makePanel(320, 176, 0.2, 0.11);
  p.mesh.userData = { fn, label, accent: !!accent };
  drawButton(p, false);
  return p;
}

function drawButton(p, hover) {
  const t = theme();
  const { ctx, canvas, texture } = p;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const accent = p.mesh.userData.accent;
  ctx.fillStyle = hover
    ? t.accent
    : accent
    ? (t.additive ? "rgba(30,199,156,0.5)" : "rgba(20,90,72,0.95)")
    : t.btnFill;
  roundRect(ctx, 8, 30, canvas.width - 16, canvas.height - 60, 26);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = hover ? "#ffffff" : t.btnBorder;
  ctx.stroke();
  ctx.fillStyle = hover ? "#06241b" : t.text;
  ctx.font = "600 40px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(p.mesh.userData.label, canvas.width / 2, canvas.height / 2);
  ctx.textAlign = "left";
  texture.needsUpdate = true;
}

function layoutButtons() {
  // clear
  buttons.forEach((b) => buttonGroup.remove(b.mesh));
  buttons = [];

  const eng = E();
  const branch = eng.branch();
  let defs;
  if (branch) {
    defs = branch.options.map((o) => ({
      label: o.label,
      fn: () => eng.chooseBranch(o.goto),
      accent: true,
    }));
  } else {
    defs = [
      { label: "‹ Back", fn: () => eng.move(-1) },
      { label: eng.recording() ? "Stop" : "Listen", fn: () => eng.toggleRecord(), accent: true },
      { label: stepsVisible ? "Hide" : "Steps", fn: toggleSteps },
      { label: "Next ›", fn: () => eng.move(1) },
    ];
  }
  defs.push({ label: "Exit", fn: () => session && session.end() });

  const gap = 0.215;
  const startX = -((defs.length - 1) * gap) / 2;
  defs.forEach((d, i) => {
    const b = makeButton(d.label, d.fn, d.accent);
    b.mesh.position.set(startX + i * gap, 0, 0);
    buttonGroup.add(b.mesh);
    buttons.push(b);
  });
}

function toggleSteps() {
  stepsVisible = !stepsVisible;
  steps.mesh.visible = stepsVisible;
  layoutButtons();
}

/* ------------------------- controllers -------------------------- */

function setupControllers() {
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    c.addEventListener("select", () => onSelect(c));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1),
      ]),
      new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35 })
    );
    line.scale.z = 2.5;
    c.add(line);
    scene.add(c);
    controllers.push(c);
  }
}

function rayFrom(c) {
  tmpMat.identity().extractRotation(c.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpMat).normalize();
  return raycaster.intersectObjects(buttons.map((b) => b.mesh), false);
}

function onSelect(c) {
  const hits = rayFrom(c);
  if (hits.length) {
    hits[0].object.userData.fn();
    // navigation mutates engine state → render() calls sync(); ensure buttons refresh
    layoutButtons();
  }
}

/* --------------------------- frame ------------------------------ */

function onFrame() {
  if (!renderer) return;
  const cam = renderer.xr.getCamera();

  // lazy-follow: keep the panel a comfortable distance ahead, slightly raised.
  // Derive forward from the camera quaternion (version-stable) and billboard the
  // panel to the camera's orientation so its front face — un-mirrored text —
  // points at the user.
  cam.getWorldPosition(v);
  cam.getWorldQuaternion(q);
  fwd.set(0, 0, -1).applyQuaternion(q);
  up.set(0, 1, 0);
  const target = v.clone().add(fwd.multiplyScalar(DIST)).add(up.multiplyScalar(RISE));
  group.position.lerp(target, 0.12);
  group.quaternion.slerp(q, 0.14);

  // hover feedback from whichever controller points at a button
  let nowHover = null;
  for (const c of controllers) {
    const hits = rayFrom(c);
    if (hits.length) { nowHover = hits[0].object; break; }
  }
  if (nowHover !== hovered) {
    if (hovered) { hovered.scale.setScalar(1); paint(hovered, false); }
    if (nowHover) { nowHover.scale.setScalar(1.08); paint(nowHover, true); }
    hovered = nowHover;
  }

  renderer.render(scene, cam);
}

function paint(mesh, hover) {
  const b = buttons.find((x) => x.mesh === mesh);
  if (b) drawButton(b, hover);
}

/* ----------------------- change detection ----------------------- */

function signature() {
  const eng = E();
  if (!eng) return "";
  const cov = eng.order().filter((id) => eng.isCovered(id)).join(",");
  return [eng.state.currentId, cov, eng.branch() ? "b" : "", stepsVisible, eng.recording()].join("|");
}

function syncContent(force) {
  if (!renderer || !E() || !E().inEncounter()) return;
  const sig = signature();
  if (!force && sig === lastSig) return;
  lastSig = sig;
  drawCue();
  if (stepsVisible) drawSteps();
  layoutButtons();
}

/* ----------------------------- export --------------------------- */

window.MedPromptXR = { sync: () => syncContent(false), available };

if (document.readyState !== "loading") init();
else document.addEventListener("DOMContentLoaded", init);
