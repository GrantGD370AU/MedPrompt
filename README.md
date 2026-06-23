# MedPrompt

An AI-augmented, teleprompter-style assistant for healthcare communication training.

MedPrompt walks a clinician (usually a student, in simulation) through a structured
encounter — history taking, medicine counselling, or any guide you generate — as
glanceable autocue cues. When the mic is on, it transcribes the conversation in
short chunks, ticks off checklist items as they're genuinely covered, and advances
the prompter to the next thing to address. With the mic off it's a clean manual
teleprompter: arrow keys, tap to jump.

It is the spiritual successor to the Adobe Muse "Warfarin Counselling Guide" — that
content ships as the first built-in guide, now in an editable JSON schema instead of
a frozen page-per-step export.

> For simulated education and experimental use only. **Not for clinical use.**

---

## Architecture

A single Cloudflare Worker serves the plain HTML/JS frontend (via the `ASSETS`
binding) and exposes a clean `/api/*` JSON boundary, so the frontend can later be
swapped for a React build without touching the backend.

```
 Browser (public/)                Worker (src/index.js)              Cloudflare
 ┌────────────────┐   audio       ┌──────────────────────┐   STT    ┌──────────┐
 │ teleprompter   │ ───chunk────► │ POST /api/transcribe │ ───────► │ Whisper  │
 │ MediaRecorder  │               │                      │          │ (AI)     │
 │  ~20s segments │   transcript  │ POST /api/coach      │  reason  ┌──────────┐
 │                │ ◄──covered─── │   (Llama coverage)   │ ───────► │ Llama    │
 │ checklist +    │               │ POST /api/guides/    │          │ (AI)     │
 │ reading line   │               │      generate        │          └──────────┘
 └────────────────┘               │ GET  /api/guides[/id]│   guides ┌──────────┐
                                   │ POST /api/sessions   │ ───────► │ D1 (opt) │
                                   └──────────────────────┘   text   └──────────┘
```

- **Transcription** — `@cf/openai/whisper`
- **Coverage coach & guide generation** — `@cf/meta/llama-3.1-8b-instruct`
- **Audio is never persisted.** Each ~20s segment is sent once, transcribed, and
  discarded. Only text and coverage metadata can be stored (in D1, optionally),
  matching the scribe-tool governance model.
- **AI Gateway** — set `AI_GATEWAY_ID` to route all AI calls through a gateway for
  logging, caching and rate limits.

Everything degrades gracefully: no `AI` binding → manual mode + keyword coverage
fallback; no `DB` binding → built-in guides only, no saving.

---

## Quick start

```bash
npm install
npx wrangler login
npm run deploy
```

That deploys the Worker with the three built-in guides and live coaching (Workers AI
is bound by default in `wrangler.toml`). Local dev:

```bash
npm run dev
```

### Continuous deploy from GitHub

1. Push this repo to GitHub.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Connect to Git**, and
   pick the repo. Cloudflare runs `npm run deploy` (Wrangler) on every push.
3. Confirm the **Workers AI** binding is attached to the Worker (it's declared in
   `wrangler.toml`, so connected projects pick it up automatically).

### D1 (optional — enables saved/generated guides + session text)

```bash
npm run db:create          # prints a database_id
# paste that id into the [[d1_databases]] block in wrangler.toml and uncomment it
npm run db:init            # creates tables on the remote DB
```

### AI Gateway (optional)

Set the var in `wrangler.toml` (or the dashboard):

```toml
[vars]
AI_GATEWAY_ID = "your-gateway-id"
```

---

## Authoring guides

Guides are plain JSON in `guides/` and bundled into the Worker. The schema is small:

```jsonc
{
  "id": "kebab-case-id",
  "title": "Human title",
  "type": "counselling | history | custom",
  "discipline": ["pharmacy", "medicine"],
  "summary": "One line shown on the library card.",
  "redFlags": ["Persistent safety notes shown in the rail."],
  "steps": [
    {
      "id": "intro",
      "label": "Introduction",          // <= 3 words, shown on the cue + checklist
      "cue": "The big line the clinician reads or acts on.",
      "detail": ["Supporting sub-points shown under the current cue."],
      "coverageHints": ["phrases a clinician might actually say"],  // AI hint + keyword fallback
      "branch": {                        // optional fork (e.g. brand / pathway)
        "prompt": "Which brand is the patient on?",
        "options": [
          { "label": "Coumadin", "goto": "step-3-coumadin" },
          { "label": "Marevan",  "goto": "step-3-marevan" }
        ]
      }
    }
  ]
}
```

To add a built-in guide: drop the file in `guides/`, import it in `src/index.js`
(`import x from "../guides/x.json"`), and add it to the `BUILTIN` array. Or skip all
that and use **Generate a new guide** in the app — generated guides are normalised to
this same schema and (with D1) saved.

`coverageHints` matter: they're both the conservative keyword fallback when AI is
unavailable and a strong signal to the coach. Write them as things a clinician would
actually *say*, not clinical jargon.

---

## API reference

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/api/health` | Reports which bindings are active. |
| GET  | `/api/guides` | List built-in + saved guides. |
| GET  | `/api/guides/:id` | Full guide JSON. |
| POST | `/api/guides/generate` | `{topic, type, discipline, save}` → a new guide. |
| POST | `/api/transcribe` | Raw audio body → `{text}` (Whisper). |
| POST | `/api/coach` | `{steps, transcript}` → `{covered[], next}`. |
| POST | `/api/sessions` | `{guideId, transcript, covered}` → saves text only. |

---

## Notes & next steps

- **HoloLens 2**: see below.
- **React migration**: the `/api/*` contract is stable and UI-agnostic. A React
  frontend can replace `public/` and keep the same Worker.
- **Whisper container**: the browser records WebM/Opus by default. If a target
  browser produces a container Whisper rejects, adjust `pickMime()` in `app.js`.
- **Coverage tuning**: the coach is deliberately conservative (it unions a strict AI
  pass with the keyword pass). Loosen or tighten via the system prompt in
  `coach()` in `src/index.js`.
- **Pedagogy hooks** (future): export a session debrief (covered vs missed, time on
  each step) for the five-step ADHA-aligned reflection used in the scribe tool.

---

## Running on HoloLens 2

MedPrompt ships with a **HoloLens focus mode** (toggle in the library header, or
auto-selected from the user agent). It runs as a 2D Edge slate pinned in the
clinician's view — cues float in front of them while they keep eye contact with
the patient. The AI coach's auto-advance is the primary hands-free mechanism: the
prompter moves itself as each checklist item is covered, no gestures required.

What focus mode changes:

- **Single-column layout** sized for the ~52° field of view; the checklist moves
  into a slide-in overlay behind the **☰ Steps** button.
- **Larger type and air-tap targets** for gaze + air-tap (which maps to click).
- **Voice commands via Whisper, not Web Speech.** The Web Speech API does **not**
  work in Edge on HoloLens 2, so commands are parsed from the transcription stream
  instead. Say **"prompter next"**, **"prompter back"**, **"prompter steps"**,
  **"prompter close"**, or **"prompter stop"**. The `prompter` prefix prevents
  ordinary clinical speech from triggering navigation.
- **Shorter transcription chunks (~7s)** so voice commands feel responsive, with
  the **coach debounced (~18s)** so Workers AI spend doesn't balloon. Tune both in
  `TIMING` in `public/app.js`.

On-device checklist:

1. Open the deployed `workers.dev` (or custom) URL in Edge on the headset; pin the
   window where it's comfortable.
2. Grant microphone permission on first **Start listening**. `getUserMedia` works
   in HoloLens Edge; the head-mounted mic array captures both clinician and patient.
3. Verify the `prompter …` grammar picks up in your room acoustics and adjust the
   phrases in `VOICE` (`public/app.js`) if needed.

**Immersive (WebXR) — built in, target-agnostic.** See the section below.

Because it's standards-based web, the same app runs in the Meta Quest browser and
visionOS Safari — it isn't locked to HoloLens.

---

## Immersive mode (WebXR)

`public/xr.js` adds a holographic version of the prompter that runs on any WebXR
headset. An **Enter AR / Enter VR** button appears in the encounter controls when
the device supports an immersive session; on a phone or laptop it stays hidden and
the 2D app is unaffected.

It is a **renderer over the existing engine**, not a second app. The hologram reads
state through `window.MedPromptEngine` and navigates through the same
`move` / `goTo` / `chooseBranch` / `toggleRecord` functions the 2D UI uses, so the
flat view, the AI coach, and the floating panel never disagree. The mic, Whisper
transcription, voice grammar and auto-advance all keep running inside the session.

How it stays target-agnostic:

- **Session selection** — requests `immersive-ar`, falls back to `immersive-vr`,
  falls back to the 2D slate. Covers HoloLens (AR), Quest (AR passthrough or VR)
  and visionOS Safari (VR).
- **Display blending** — reads `session.environmentBlendMode` at runtime. On
  `additive` displays (HoloLens, where black renders as transparent) it drops the
  panel fill and uses bright glyphs with a glow; on `alpha-blend` / `opaque`
  (Quest, visionOS, VR) it draws a translucent dark panel for contrast. One
  renderer, no per-device build.
- **Input** — binds the WebXR `select` event, which every device raises from its
  own gesture: HoloLens air-tap, Quest controller/hand, visionOS eye-and-pinch.
  A ray from the pointer selects the floating Back / Listen / Steps / Next / Exit
  buttons; branch choices (e.g. Coumadin vs Marevan) surface as buttons too.
- **Comfort** — the panel lazy-follows the head at a fixed distance, raised
  slightly like a real teleprompter, and billboards to face the user.

### three.js dependency

The module imports `three` via an import map in `index.html`, pinned to a CDN:

```html
<script type="importmap">
{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js" } }
</script>
```

For a fully self-contained deploy (no third-party CDN, friendlier to strict CSPs
and offline-ish headsets), vendor it instead: download `three.module.js` into
`public/vendor/` and point the import map at `/vendor/three.module.js`. Nothing
else changes.

### Device notes

- **Grant the microphone in the 2D view first** (tap **Start listening** once),
  then enter immersive — some headsets surface the permission prompt awkwardly
  mid-session.
- HoloLens 2 and Quest expose `immersive-ar`; visionOS Safari currently exposes
  `immersive-vr`, so on Vision Pro the cues float against a VR backdrop rather
  than passthrough. The renderer handles both without code changes.
- WebXR requires HTTPS — the Worker's `workers.dev` (or your custom domain)
  already satisfies this.

### Colour & legibility on HoloLens

The palette is built for additive holographic displays, following Microsoft's
holographic design guidance:

- **Dark backplate, off-white text, teal/green accents — in every blend mode.**
  A dark backplate secures legibility and gives a dark edge border that reduces
  colour fringing as the head-locked panel moves with you. Whites are kept around
  R235 (not pure `#FFFFFF`) and used for strokes, not large bright fills, which
  cause eye fatigue and blotchiness on additive displays.
- **Teal/green accents, not pure primaries.** Green is the efficient channel on
  the waveguide; mixed teal tones fringe far less than pure red/green/blue.
- **State is never colour-only** — covered vs current vs upcoming also differ by
  icon and position, so it survives fringing and washout.
- **Avoid red for alerts in immersive.** Red is the worst hue for fringing and
  legibility on HoloLens. Red flags currently render only in the 2D view (an
  opaque Edge slate, where red is fine); if you surface them in the hologram,
  use amber or an icon, not saturated red.
- **Inherent limit:** against bright clinical walls or windows, even bright text
  washes out — additive displays can't subtract light. The levers are weight,
  size and the dark backplate, not a brighter background. Position the panel
  against a darker part of the room where you can.
