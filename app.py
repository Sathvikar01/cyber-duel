import os
import sys
import json
import logging

import gradio as gr
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# ------------------------------------------------------------------
# ML stack (optional — UI works fine in mock mode without it)
# ------------------------------------------------------------------
HAS_ML = False
try:
    import torch  # noqa: F401
    from transformers import AutoTokenizer, AutoModelForCausalLM, AutoConfig  # noqa: F401
    from peft import PeftModel  # noqa: F401
    HAS_ML = True
except Exception:
    HAS_ML = False

BASE_MODEL = "google/gemma-3-4b-it"
ADAPTER_MODEL = "Sathvik0101/gemma-3-combat-npc-adapter"

# ------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "5173"))
SKIP_MODEL_LOAD = os.environ.get("SKIP_MODEL_LOAD", "0") == "1"

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s | %(levelname)s | %(message)s",
)
log = logging.getLogger("duel-of-albion")


# ------------------------------------------------------------------
# Token / model state
# ------------------------------------------------------------------
def get_hf_token():
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if token:
        return token
    token_path = os.path.expanduser("~/.cache/huggingface/token")
    if os.path.exists(token_path):
        try:
            with open(token_path, "r") as f:
                return f.read().strip()
        except Exception:
            pass
    return None


hf_token = get_hf_token()
HAS_MODEL = False
MODEL_ERROR = ""
model = None
tokenizer = None

# ------------------------------------------------------------------
# Model loading (skipped when SKIP_MODEL_LOAD=1, when transformers/peft
# is missing, or when there is no HF token — UI testing never needs it)
# ------------------------------------------------------------------
if not HAS_ML:
    log.info("ML stack not installed — running in MOCK MODE (UI only).")
elif SKIP_MODEL_LOAD:
    log.info("SKIP_MODEL_LOAD=1 — skipping model load (UI only).")
elif not hf_token:
    log.info("No HF_TOKEN found — running in MOCK MODE. Set HF_TOKEN to enable the AI model.")
else:
    log.info("Loading tokenizer and base model...")
    try:
        from huggingface_hub import snapshot_download
        import torch

        tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, token=hf_token)

        device_arg = "auto" if torch.cuda.is_available() else None
        dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32

        config = AutoConfig.from_pretrained(BASE_MODEL, token=hf_token)
        if hasattr(config, "vision_config") and config.vision_config is not None:
            config.vision_config = None
            log.info("Stripped vision_config to force text-only load path.")

        base_model = AutoModelForCausalLM.from_pretrained(
            BASE_MODEL,
            config=config,
            token=hf_token,
            torch_dtype=dtype,
            device_map=device_arg,
        )
        adapter_path = snapshot_download(repo_id=ADAPTER_MODEL, token=hf_token, force_download=True)
        model = PeftModel.from_pretrained(base_model, adapter_path)
        model.eval()

        warmup_prompt = (
            "<start_of_turn>user\nYou are an expert fighting game NPC AI. "
            "The user has performed this sequence of 5 moves: jab,cross,low_kick,roundhouse,uppercut.\n"
            "Decide on the best counter-move from: jab, cross, low_kick, roundhouse, uppercut, parry, backstep, clinch, throw.\n"
            "Respond in this format:\n[reasoning]\ncounter_move: [move]"
            "<end_of_turn>\n<start_of_turn>model\n"
        )
        warmup_inputs = tokenizer(warmup_prompt, return_tensors="pt").to(model.device)
        with torch.no_grad():
            _ = model.generate(
                **warmup_inputs,
                max_new_tokens=20,
                do_sample=False,
                pad_token_id=tokenizer.eos_token_id,
            )

        HAS_MODEL = True
        log.info("Model loaded and warmed up.")
    except Exception as e:
        import traceback
        MODEL_ERROR = f"{type(e).__name__}: {e}"
        log.warning("Model load failed: %s", MODEL_ERROR)
        log.debug(traceback.format_exc())
        model = None
        tokenizer = None


# ------------------------------------------------------------------
# Inference helper
# ------------------------------------------------------------------
MOCK_COUNTERS = ["jab", "cross", "low_kick", "roundhouse", "uppercut", "parry", "backstep", "clinch", "throw"]

def run_gemma(moves_sequence: str) -> str:
    if not HAS_MODEL:
        import time, random
        time.sleep(0.25)
        # Offline mode: return a clean scripted counter without leaking any
        # raw model-loader diagnostics to the player UI.
        reasoning = (
            f"Mock Analysis: player performed {moves_sequence}. "
            "AI opponent is offline — using scripted counters."
        )
        return json.dumps({
            "reasoning": reasoning,
            "counterMove": random.choice(MOCK_COUNTERS),
            "sequence": moves_sequence,
        })

    prompt = (
        f"<start_of_turn>user\n"
        f"You are an expert fighting game NPC AI. "
        f"The user has performed this sequence of 5 moves: {moves_sequence}.\n"
        f"Observe the pattern and decide on the best counter-move from: "
        f"jab, cross, low_kick, roundhouse, uppercut, parry, backstep, clinch, throw.\n"
        f"Respond in this format:\n"
        f"[Your reasoning about the player's pattern and tendencies]\n"
        f"counter_move: [your chosen counter move]"
        f"<end_of_turn>\n<start_of_turn>model\n"
    )
    import torch
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=80,
            temperature=0.2,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id,
        )
    text = tokenizer.decode(outputs[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True)

    reasoning = "Unable to process reasoning."
    counter_move = "jab"
    if "counter_move:" in text:
        parts = text.split("counter_move:")
        reasoning = parts[0].strip()
        counter_move = parts[1].strip()
    else:
        reasoning = text.strip()

    return json.dumps({"reasoning": reasoning, "counterMove": counter_move, "sequence": moves_sequence})


# ------------------------------------------------------------------
# FastAPI app setup
# ------------------------------------------------------------------
app = FastAPI(title="Duel of Albion - Gemma AI Fighter")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------
# Static files: the built React game
# ------------------------------------------------------------------
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(PROJECT_ROOT, "3d-game", "dist")
STATIC_DIR_EXISTS = os.path.isdir(STATIC_DIR)

if STATIC_DIR_EXISTS:
    # IMPORTANT: do NOT mount anything at /assets.
    # Gradio serves its own JS/CSS bundles at /assets/* (e.g.
    # /assets/index-DputZZxm.js). Mounting at /assets would shadow
    # Gradio's handler and return 404 for those, leaving the Gradio
    # shell blank. The React build's own assets are served via the
    # /game/{path:path} catch-all below.

    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon_ico():
        return FileResponse(
            os.path.join(STATIC_DIR, "favicon.svg"),
            media_type="image/svg+xml",
        )

    @app.get("/favicon.svg", include_in_schema=False)
    async def favicon_svg():
        return FileResponse(os.path.join(STATIC_DIR, "favicon.svg"))

    @app.get("/manifest.json", include_in_schema=False)
    async def manifest():
        return JSONResponse(content={
            "name": "Duel of Albion",
            "short_name": "Duel of Albion",
            "start_url": "/game/",
            "display": "fullscreen",
            "background_color": "#05040a",
            "theme_color": "#05040a",
            "icons": [],
        })

    NO_CACHE = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }

    @app.get("/models/{path:path}", include_in_schema=False)
    async def game_models(path: str):
        static_root = os.path.normpath(STATIC_DIR)
        candidate = os.path.normpath(os.path.join(STATIC_DIR, "models", path))
        if not candidate.startswith(static_root):
            return HTMLResponse("Forbidden", status_code=403)
        if os.path.isfile(candidate):
            return FileResponse(candidate)
        return HTMLResponse("Not Found", status_code=404)

    @app.get("/game", include_in_schema=False)
    @app.get("/game/", include_in_schema=False)
    async def game_index():
        return FileResponse(
            os.path.join(STATIC_DIR, "index.html"),
            headers=NO_CACHE,
        )

    @app.get("/game/{path:path}", include_in_schema=False)
    async def game_spa(path: str):
        # Path-traversal guard
        static_root = os.path.normpath(STATIC_DIR)
        candidate = os.path.normpath(os.path.join(STATIC_DIR, path))
        if not candidate.startswith(static_root):
            return HTMLResponse("Forbidden", status_code=403)
        if os.path.isfile(candidate):
            return FileResponse(candidate)
        # SPA fallback — unknown path -> index.html
        return FileResponse(
            os.path.join(STATIC_DIR, "index.html"),
            headers=NO_CACHE,
        )
else:
    @app.get("/game", include_in_schema=False)
    @app.get("/game/", include_in_schema=False)
    async def game_not_built():
        return HTMLResponse(
            "<h1 style='font-family:sans-serif;color:#f0e6d2;background:#05040a;"
            "padding:40px;'>React game not built</h1>"
            "<p style='font-family:sans-serif;color:#b8a88a;background:#05040a;"
            "padding:0 40px 40px;'>Run <code>npm run build</code> in "
            "<code>3d-game/</code> to produce the dist directory.</p>",
            status_code=404,
        )


# ------------------------------------------------------------------
# API endpoints used by the React game
# ------------------------------------------------------------------
@app.get("/health")
async def health():
    return JSONResponse(content={
        "ready": HAS_MODEL,
        "has_ml": HAS_ML,
        "skip_model_load": SKIP_MODEL_LOAD,
        "has_token": bool(hf_token),
    })


@app.post("/predict")
async def predict(request: Request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    sequence = data.get("sequence", "")
    result_str = run_gemma(sequence)
    try:
        result = json.loads(result_str)
    except Exception:
        result = {"reasoning": result_str, "counterMove": "jab", "sequence": sequence}
    return JSONResponse(content=result)


# ------------------------------------------------------------------
# Gradio UI — full-screen game shell
# ------------------------------------------------------------------
# The game is always served through a Gradio container. The React app is
# embedded full-screen in an iframe so it keeps its own rendering / input
# logic, while Gradio provides the hosting layer (HF Spaces, local, etc.).
css = """
/* Kill every Gradio container from html down — nothing should add
   padding, margin, gaps, borders, or constrained height. */
html,body,#root,.app,.gradio-container,
.gradio-container>.main,.gradio-container>.main>.wrap,
.gradio-container .column,.gradio-container .column>.form,
.gradio-container [class*="container"],
.gradio-container [class*="panel"],
.gradio-container [class*="gap"] {
  background:#05040a!important;
  padding:0!important;margin:0!important;
  max-width:none!important;width:100%!important;height:100%!important;
  min-height:100vh!important;
  border:none!important;box-shadow:none!important;gap:0!important;
  overflow:hidden!important;
}
/* Hide all Gradio chrome: splash, footer, loader, status bar */
#app_splash,.splash,.loading,.loader,
.progress,.progress-bar,.meta-loader,
footer,.footer,.gradio-footer,.built-with,
#component-status,.meta,[class*="built-with"],
[class*="splash"],[class*="loader"],
.svelte-1ipelgc {
  display:none!important;visibility:hidden!important;opacity:0!important;
  height:0!important;width:0!important;overflow:hidden!important;
}
/* The Column with class game-wrap fills the viewport */
.game-wrap,
.game-wrap>.form {
  position:fixed!important;inset:0!important;
  width:100vw!important;height:100vh!important;
  padding:0!important;margin:0!important;
  overflow:hidden!important;background:#05040a!important;
  z-index:2147483647;
}
/* The iframe itself is also fixed so it ignores any intermediate wrappers
   Gradio may insert around gr.HTML */
#game-iframe,.game-wrap iframe {
  position:fixed!important;top:0!important;left:0!important;
  width:100vw!important;height:100vh!important;
  border:none!important;display:block!important;
  background:#05040a!important;z-index:2147483647;
}
"""
with gr.Blocks(title="Duel of Albion", css=css, theme=gr.themes.Soft()) as demo:
    if STATIC_DIR_EXISTS:
        game_url = f"/game/?v={os.environ.get('BUILD_ID', int.from_bytes(os.urandom(2), 'big'))}"
    else:
        game_url = "/game"
    with gr.Column(elem_classes="game-wrap"):
        gr.HTML(
            f'<iframe id="game-iframe" src="{game_url}" allowfullscreen '
            'allow="autoplay; fullscreen; gamepad; xr-spatial-tracking" '
            'sandbox="allow-scripts allow-same-origin allow-forms allow-popups" '
            'style="background:#05040a;"></iframe>'
        )
app = gr.mount_gradio_app(app, demo, path="/")
log.info("Mounted Gradio shell at /.")


if __name__ == "__main__":
    log.info("=" * 60)
    log.info("Duel of Albion — Gradio server")
    log.info("  Project root : %s", PROJECT_ROOT)
    log.info("  Static dir  : %s (exists=%s)", STATIC_DIR, STATIC_DIR_EXISTS)
    log.info("  Has ML stack: %s", HAS_ML)
    log.info("  Has model   : %s", HAS_MODEL)
    log.info("  HF token    : %s", "yes" if hf_token else "no")
    log.info("  URL         : http://%s:%s/", "localhost" if HOST == "0.0.0.0" else HOST, PORT)
    log.info("=" * 60)
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
