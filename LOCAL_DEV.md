# Local UI/UX testing (no AI, no GPU, no Hugging Face Space)

This guide shows how to run the game UI locally in your browser without
touching the Hugging Face Space. The A10G GPU on the Space will stay idle
and will not be billed while you test locally.

> **Architecture note:** Gradio is now the base of the app. The Gradio
> server (`app.py`) hosts a fullscreen iframe that loads the built React
> game from `3d-game/dist/` at `/game/`. The Gradio app also exposes
> `/health` and `/predict` for the React game to call.

## Quick start

From the project root (`C:\Users\arsat\OneDrive\Desktop\hf2`):

```bash
npm run dev
```

This rebuilds `3d-game/dist/` and then starts the Gradio server on
**http://localhost:5173/**. Open that URL in your browser.

You will see the start screen. Click **DUEL** to go through character and
arena select, then **Enter Arena** to start the 3D fight.

## How the AI works in dev (no model loaded)

By default the Gradio app does **not** load the Gemma adapter. The
`/health` endpoint returns `ready: false`, which tells the React game to
use the in-browser `generateMockCounter` policy (defined in
`3d-game/src/combat/aiOffense.js`) — the fight plays fully and your GPU
is not billed.

If you have `transformers`/`peft`/`torch` installed locally *and* a
`HF_TOKEN`, the model will load automatically and `/health` will return
`ready: true`. Set `SKIP_MODEL_LOAD=1` to force mock mode regardless.

## What the GPU is doing

| Screen | Canvas mounted? | GPU work |
|---|---|---|
| Start | No | None |
| Character select | No | None |
| Arena select | No | None |
| Fight | Yes | Normal |
| Pause | Yes (`frameloop="never"`) | None after first frame |
| Game over | No | None |

A small **"GPU IDLE" / "GPU ACTIVE"** pill in the top-right corner of the
page shows the current state.

## Stopping the A10G billing on the Space

The app code cannot sleep the Space from inside. You control the Space
state on the Hugging Face website:

1. Go to https://huggingface.co/spaces/YOUR-SPACE-NAME
2. Click the **⋮** menu → **Sleep this Space** (or use the Settings page).
3. While the Space is asleep, the A10G is released and you are not billed.

The Space will auto-wake if someone visits the public URL, so for local
testing, **do not visit the Space URL** — only use `http://localhost:5173/`.

## Production / Space deployment

When you want the full experience with the real Gemma model:

1. Start the Space (it will allocate the A10G).
2. The Gradio app at `app.py` serves the built React game at `/game/` and
   exposes `/predict` for the NPC AI.
3. The React app probes `/health` on mount; if it returns `{ready: true}`,
   the app uses the real model. Otherwise it falls back to the client-side
   mock.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` (root) | Build the React app **and** start the Gradio server on 5173 |
| `npm run build` (root) | Production build of the React app into `3d-game/dist/` |
| `npm run build:watch` (root) | Rebuild React on changes (run in one terminal) |
| `npm run lint` (root) | ESLint |
| `npm run preview` (root) | Vite preview of the built React app (no Gradio) |
| `npm run serve:gradio` (root) | Run the Gradio + FastAPI app (`python app.py`) |
