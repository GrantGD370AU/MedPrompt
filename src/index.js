/**
 * MedPrompt — AI-augmented teleprompter for healthcare encounters.
 *
 * A single Worker that serves the static frontend (via the ASSETS binding) and
 * exposes a clean /api/* JSON boundary so the frontend can later be swapped for
 * a React build without touching the backend.
 *
 * Bindings (see wrangler.toml):
 *   ASSETS  - static assets (public/)            [required to serve the UI]
 *   AI      - Workers AI                          [optional; enables live coach + generate]
 *   DB      - D1 database                         [optional; enables saved guides + sessions]
 *   AI_GATEWAY_ID (var) - AI Gateway id           [optional; routes AI calls through the gateway]
 *
 * Models match the scribe-tool stack:
 *   transcription: @cf/openai/whisper
 *   reasoning:     @cf/meta/llama-3.1-8b-instruct
 */

import warfarin from "../guides/warfarin-counselling.json";
import history from "../guides/history-taking.json";
import counselling from "../guides/medicine-counselling.json";

const BUILTIN = [warfarin, history, counselling];
const TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const STT_MODEL = "@cf/openai/whisper";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const aiOpts = (env) =>
  env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : {};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, pathname);
      } catch (err) {
        return json({ error: "Server error", detail: String(err) }, 500);
      }
    }

    // Everything else is the static frontend.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("ASSETS binding not configured", { status: 500 });
  },
};

async function handleApi(request, env, pathname) {
  const method = request.method;

  if (pathname === "/api/health") {
    return json({
      ok: true,
      ai: Boolean(env.AI),
      db: Boolean(env.DB),
      gateway: Boolean(env.AI_GATEWAY_ID),
    });
  }

  // --- Guides -------------------------------------------------------------
  if (pathname === "/api/guides" && method === "GET") {
    const custom = await listCustomGuides(env);
    const items = [...BUILTIN, ...custom].map((g) => ({
      id: g.id,
      title: g.title,
      type: g.type,
      discipline: g.discipline || [],
      summary: g.summary || "",
      steps: (g.steps || []).length,
      builtin: BUILTIN.some((b) => b.id === g.id),
    }));
    return json({ guides: items });
  }

  const guideMatch = pathname.match(/^\/api\/guides\/([A-Za-z0-9_-]+)$/);
  if (guideMatch && method === "GET") {
    const id = guideMatch[1];
    const guide =
      BUILTIN.find((g) => g.id === id) || (await getCustomGuide(env, id));
    if (!guide) return json({ error: "Guide not found" }, 404);
    return json({ guide });
  }

  // --- Generate a guide with Workers AI -----------------------------------
  if (pathname === "/api/guides/generate" && method === "POST") {
    if (!env.AI) return json({ error: "Workers AI is not configured" }, 503);
    const body = await request.json().catch(() => ({}));
    const guide = await generateGuide(env, body);
    if (!guide) return json({ error: "Could not generate a usable guide" }, 502);
    if (env.DB && body.save) await saveCustomGuide(env, guide);
    return json({ guide, saved: Boolean(env.DB && body.save) });
  }

  // --- Transcribe an audio chunk (Whisper) --------------------------------
  if (pathname === "/api/transcribe" && method === "POST") {
    if (!env.AI) return json({ error: "Workers AI is not configured" }, 503);
    const buf = await request.arrayBuffer();
    if (!buf || buf.byteLength === 0) return json({ text: "" });
    const res = await env.AI.run(
      STT_MODEL,
      { audio: [...new Uint8Array(buf)] },
      aiOpts(env)
    );
    return json({ text: (res && res.text ? res.text : "").trim() });
  }

  // --- Live coaching: map transcript onto the checklist -------------------
  if (pathname === "/api/coach" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const result = await coach(env, body);
    return json(result);
  }

  // --- Save a finished session (TEXT ONLY — audio is never persisted) ------
  if (pathname === "/api/sessions" && method === "POST") {
    if (!env.DB) return json({ error: "D1 is not configured" }, 503);
    const body = await request.json().catch(() => ({}));
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO sessions (id, guide_id, transcript, covered, created_at) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(
        id,
        body.guideId || "",
        String(body.transcript || ""),
        JSON.stringify(body.covered || []),
        new Date().toISOString()
      )
      .run();
    return json({ id });
  }

  return json({ error: "Not found" }, 404);
}

/* ----------------------------------------------------------------------- */
/* D1 helpers (all optional)                                               */
/* ----------------------------------------------------------------------- */

async function listCustomGuides(env) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT body FROM guides ORDER BY created_at DESC"
    ).all();
    return (results || []).map((r) => JSON.parse(r.body));
  } catch {
    return [];
  }
}

async function getCustomGuide(env, id) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare("SELECT body FROM guides WHERE id = ?")
      .bind(id)
      .first();
    return row ? JSON.parse(row.body) : null;
  } catch {
    return null;
  }
}

async function saveCustomGuide(env, guide) {
  try {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO guides (id, title, body, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(guide.id, guide.title, JSON.stringify(guide), new Date().toISOString())
      .run();
  } catch {
    /* non-fatal */
  }
}

/* ----------------------------------------------------------------------- */
/* AI: guide generation                                                    */
/* ----------------------------------------------------------------------- */

async function generateGuide(env, { topic, type, discipline }) {
  const wantType = ["counselling", "history", "custom"].includes(type)
    ? type
    : "counselling";
  const sys =
    "You design structured teleprompter guides for healthcare communication training. " +
    "Return ONLY valid JSON, no prose, no markdown fences. " +
    "Schema: {\"id\":kebab-case string,\"title\":string,\"type\":\"" +
    wantType +
    "\",\"discipline\":[string],\"summary\":string,\"disclaimer\":\"For simulated education and experimental use only. Not for clinical use.\",\"redFlags\":[string]," +
    "\"steps\":[{\"id\":kebab-case string,\"label\":string (<=3 words),\"cue\":string (one imperative sentence the clinician reads aloud or acts on)," +
    "\"detail\":[string supporting points],\"coverageHints\":[short lowercase phrases a clinician might actually say for this step]}]}. " +
    "Produce 6-11 steps in a sensible clinical order. Keep cues concise and glanceable.";
  const user =
    "Create a guide for: " +
    String(topic || "a general clinical encounter") +
    (discipline ? " (discipline: " + discipline + ")" : "") +
    ". Australian context where relevant.";

  let raw;
  try {
    const res = await env.AI.run(
      TEXT_MODEL,
      {
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        max_tokens: 2048,
        temperature: 0.3,
      },
      aiOpts(env)
    );
    raw = res.response || "";
  } catch {
    return null;
  }

  const guide = extractJson(raw);
  if (!guide || !Array.isArray(guide.steps) || guide.steps.length === 0)
    return null;

  // Normalise / harden the generated object.
  guide.type = wantType;
  guide.id = slug(guide.id || guide.title || topic || "guide-" + Date.now());
  guide.title = String(guide.title || topic || "Generated guide");
  guide.disclaimer =
    "For simulated education and experimental use only. Not for clinical use.";
  guide.discipline = Array.isArray(guide.discipline) ? guide.discipline : [];
  guide.redFlags = Array.isArray(guide.redFlags) ? guide.redFlags : [];
  guide.steps = guide.steps.slice(0, 14).map((s, i) => ({
    id: slug(s.id || s.label || "step-" + (i + 1)) || "step-" + (i + 1),
    label: String(s.label || "Step " + (i + 1)),
    cue: String(s.cue || ""),
    detail: Array.isArray(s.detail) ? s.detail.map(String) : [],
    coverageHints: Array.isArray(s.coverageHints)
      ? s.coverageHints.map((h) => String(h).toLowerCase())
      : [],
  }));
  return guide;
}

/* ----------------------------------------------------------------------- */
/* AI: live coverage coach (with keyword fallback)                          */
/* ----------------------------------------------------------------------- */

async function coach(env, { steps, transcript }) {
  const list = Array.isArray(steps) ? steps : [];
  const text = String(transcript || "");
  if (list.length === 0 || !text.trim())
    return { covered: [], next: list[0]?.id || null, source: "empty" };

  // Always compute the cheap keyword pass — it is the fallback and a sanity net.
  const keyword = keywordCoverage(list, text);

  if (!env.AI) {
    return { covered: keyword, next: firstOutstanding(list, keyword), source: "keyword" };
  }

  const sys =
    "You assess whether a clinician has covered checklist items during a patient conversation. " +
    "You are given checklist items (id + what each item means) and a running transcript. " +
    "Return ONLY JSON: {\"covered\":[ids that have been genuinely addressed]}. " +
    "Be conservative: only mark an item covered if the transcript clearly shows it was addressed.";
  const items = list
    .map((s) => `- ${s.id}: ${s.label} — ${s.cue}`)
    .join("\n");
  const user = `Checklist:\n${items}\n\nTranscript:\n${text.slice(-4000)}`;

  try {
    const res = await env.AI.run(
      TEXT_MODEL,
      {
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        max_tokens: 400,
        temperature: 0,
      },
      aiOpts(env)
    );
    const parsed = extractJson(res.response || "");
    const ids = parsed && Array.isArray(parsed.covered) ? parsed.covered : [];
    const valid = new Set(list.map((s) => s.id));
    // Union of AI + keyword, keeping only ids that exist in this guide.
    const covered = [...new Set([...ids, ...keyword])].filter((id) =>
      valid.has(id)
    );
    return { covered, next: firstOutstanding(list, covered), source: "ai" };
  } catch {
    return { covered: keyword, next: firstOutstanding(list, keyword), source: "keyword" };
  }
}

function keywordCoverage(steps, transcript) {
  const t = transcript.toLowerCase();
  const covered = [];
  for (const s of steps) {
    const hints = s.coverageHints || [];
    if (hints.some((h) => h && t.includes(String(h).toLowerCase())))
      covered.push(s.id);
  }
  return covered;
}

function firstOutstanding(steps, covered) {
  const done = new Set(covered);
  const s = steps.find((x) => !done.has(x.id));
  return s ? s.id : null;
}

/* ----------------------------------------------------------------------- */
/* utils                                                                    */
/* ----------------------------------------------------------------------- */

function extractJson(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  s = s.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

function slug(v) {
  return String(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
